/**
 * 外部代理的快取與暫存檔案系統。
 *
 * 版位：`cache/agents/<session>/` 是快取區（session.json、home/，30 天未用
 * 或使用者手動清除），`tmp/agents/<session>/` 是暫存區，任務結束或主機
 * 啟動時清空。任何檔案刪除只發生在這兩個目錄之下。
 */
import { existsSync } from "node:fs";
import { readdir, readFile, rm, stat, mkdir, writeFile, rename } from "node:fs/promises";
import { join, sep } from "node:path";
import { homedir } from "node:os";

import type { CardiaryPaths } from "@cardiary/module-api";
import {
  AGENT_CACHE_MAX_AGE_MS,
  isAgentCacheStale,
  markUnknownAfterRestart,
  type ExternalAgentSessionRecord,
  type ExternalAgentUsage,
} from "@cardiary/domain";

export interface AgentStoragePaths {
  readonly cacheRoot: string;
  readonly tmpRoot: string;
}

export function agentStoragePaths(paths: CardiaryPaths): AgentStoragePaths {
  return { cacheRoot: join(paths.cache, "agents"), tmpRoot: join(paths.tmp, "agents") };
}

export function sessionDir(paths: AgentStoragePaths, agentSessionId: string): string {
  return join(paths.cacheRoot, agentSessionId);
}

export function homeDir(paths: AgentStoragePaths, agentSessionId: string): string {
  return join(sessionDir(paths, agentSessionId), "home");
}

export function scratchDir(paths: AgentStoragePaths, agentSessionId: string): string {
  return join(paths.tmpRoot, agentSessionId);
}

export async function ensureSessionDirs(
  paths: AgentStoragePaths,
  agentSessionId: string,
): Promise<void> {
  await mkdir(homeDir(paths, agentSessionId), { recursive: true });
  await mkdir(join(homeDir(paths, agentSessionId), ".config", "opencode"), {
    recursive: true,
  });
  await mkdir(scratchDir(paths, agentSessionId), { recursive: true });
}

/** 寫入 session.json；先寫暫存再 rename，讀到半份檔案的機會趨近於零。 */
export async function writeRecord(
  paths: AgentStoragePaths,
  record: ExternalAgentSessionRecord,
): Promise<void> {
  const dir = sessionDir(paths, record.agentSessionId);
  await mkdir(dir, { recursive: true });
  const target = join(dir, "session.json");
  const tmp = join(dir, `.session.json.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
  await rename(tmp, target);
}

export async function readRecord(
  paths: AgentStoragePaths,
  agentSessionId: string,
): Promise<ExternalAgentSessionRecord | null> {
  try {
    const raw = await readFile(join(sessionDir(paths, agentSessionId), "session.json"), "utf8");
    return JSON.parse(raw) as ExternalAgentSessionRecord;
  } catch {
    return null;
  }
}

/** 目前存在的所有紀錄；讀不到或壞掉的目錄跳過。 */
export async function listRecords(paths: AgentStoragePaths): Promise<ExternalAgentSessionRecord[]> {
  const entries = await readdir(paths.cacheRoot, { withFileTypes: true }).catch(() => []);
  const out: ExternalAgentSessionRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readRecord(paths, entry.name);
    if (record) out.push(record);
  }
  return out;
}

/** 讀取資料夾的總位元組；不存在回 0，不讀內容。 */
export async function dirBytes(path: string): Promise<number> {
  const entry = await stat(path).catch(() => null);
  if (!entry) return 0;
  if (!entry.isDirectory()) return entry.size;
  let total = 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const child of entries) {
    total += await dirBytes(join(path, child.name));
  }
  return total;
}

/** Claude Code 在 Cardiary 資料夾外會寫的固定目錄；spike 實測確認。 */
export function outsideWriteCandidates(home: string = homedir()): readonly string[] {
  return [
    join(home, ".claude", "projects"),
    join(home, ".claude", "backups"),
    join(home, ".claude", "plugins"),
    join(home, "Library", "Caches", "claude-cli-nodejs"),
  ];
}

/** 儲存空間統計：快取、暫存、資料夾外寫入。 */
export async function computeUsage(paths: AgentStoragePaths): Promise<ExternalAgentUsage> {
  const cacheBytes = await dirBytes(paths.cacheRoot);
  const tempBytes = await dirBytes(paths.tmpRoot);
  const outsideEntries = [];
  for (const path of outsideWriteCandidates()) {
    const exists = existsSync(path);
    outsideEntries.push({ path, bytes: exists ? await dirBytes(path) : 0, exists });
  }
  return { cacheBytes, tempBytes, outsideEntries };
}

/** 刪除 tmp/agents 底下的工作目錄；回傳實際刪除的目錄數。 */
export async function clearScratch(paths: AgentStoragePaths): Promise<number> {
  const entries = await readdir(paths.tmpRoot, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await rm(join(paths.tmpRoot, entry.name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/** 刪除單一 session 的暫存目錄；任務結束後呼叫。 */
export async function removeScratch(
  paths: AgentStoragePaths,
  agentSessionId: string,
): Promise<void> {
  try {
    await rm(scratchDir(paths, agentSessionId), { recursive: true, force: true });
  } catch {
    // 清不掉不影響任務結果；回報由呼叫端依非例外處理。
  }
}

/** 清掉超過 30 天沒動過的 session 目錄；回傳被清掉的 id。 */
export async function purgeStaleCache(
  paths: AgentStoragePaths,
  nowMs: number,
): Promise<readonly string[]> {
  const entries = await readdir(paths.cacheRoot, { withFileTypes: true }).catch(() => []);
  const purged: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(paths.cacheRoot, entry.name);
    const s = await stat(dir).catch(() => null);
    if (!s) continue;
    if (isAgentCacheStale(s.mtimeMs, nowMs, AGENT_CACHE_MAX_AGE_MS)) {
      await rm(dir, { recursive: true, force: true });
      purged.push(entry.name);
    }
  }
  return purged;
}

/**
 * 主機啟動時對非終態的紀錄做處置：標成失敗、結果未知。
 * 回傳被標記的紀錄；呼叫端先撤回審批再呼叫（markUnknownAfterRestart 會清空 pendingPermission）。
 */
export async function markOrphansAfterRestart(
  paths: AgentStoragePaths,
  now: Date,
): Promise<readonly ExternalAgentSessionRecord[]> {
  const records = await listRecords(paths);
  const marked: ExternalAgentSessionRecord[] = [];
  for (const record of records) {
    if (
      record.status === "completed" ||
      record.status === "stopped" ||
      record.status === "failed"
    ) {
      continue;
    }
    const updated = markUnknownAfterRestart(record, now);
    await writeRecord(paths, updated);
    marked.push(updated);
  }
  return marked;
}

/** 找出所有非終態的紀錄；主機啟動清理用。 */
export async function listNonTerminal(
  paths: AgentStoragePaths,
): Promise<readonly ExternalAgentSessionRecord[]> {
  const records = await listRecords(paths);
  return records.filter(
    (record) =>
      record.status !== "completed" && record.status !== "stopped" && record.status !== "failed",
  );
}

/**
 * 判斷一個絕對路徑是否不允許當 workingDir。
 * 資料夾外：放行；資料夾內：只有 `tmp/` 放行（代理的暫存實驗區），
 * 其餘（正本區、快取、日誌）一律不允許，因為 sandbox 對資料夾內只放行 tmp 與代理 home。
 */
export function isProtectedWorkingDirectory(root: string, target: string): boolean {
  const within = (base: string, path: string): boolean =>
    path === base || path.startsWith(`${base}${sep}`);
  if (!within(root, target)) return false;
  return !within(join(root, "tmp"), target);
}
