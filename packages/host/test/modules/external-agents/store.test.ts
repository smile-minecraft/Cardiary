import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExternalAgentSessionRecord } from "@cardiary/domain";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearScratch,
  ensureSessionDirs,
  isProtectedWorkingDirectory,
  listNonTerminal,
  listRecords,
  markOrphansAfterRestart,
  purgeStaleCache,
  readRecord,
  removeScratch,
  writeRecord,
  type AgentStoragePaths,
} from "../../../src/modules/external-agents/store.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = "2026-05-01T00:00:00.000Z";
const T0 = Date.parse(NOW);

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function makePaths(): Promise<AgentStoragePaths> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-agent-store-"));
  roots.push(root);
  return { cacheRoot: join(root, "cache", "agents"), tmpRoot: join(root, "tmp", "agents") };
}

function makeRecord(
  agentSessionId: string,
  overrides: Partial<ExternalAgentSessionRecord> = {},
): ExternalAgentSessionRecord {
  return {
    agentSessionId,
    agentKind: "opencode",
    workingDirectory: "/tmp/work",
    startedAt: NOW,
    updatedAt: NOW,
    status: "running",
    completedSteps: 0,
    lastEventSeq: 1,
    pendingPermission: null,
    resultUnknown: false,
    ...overrides,
  };
}

describe("外部代理紀錄儲存", () => {
  it("同一工作階段連續寫入時全部成功，最後一份是最後呼叫的內容", async () => {
    const paths = await makePaths();
    const records = Array.from({ length: 24 }, (_, index) =>
      makeRecord("agent_concurrent", { message: `第 ${index} 筆`, lastEventSeq: index + 1 }),
    );

    await expect(
      Promise.all(records.map((record) => writeRecord(paths, record))),
    ).resolves.toBeDefined();

    const stored = await readRecord(paths, "agent_concurrent");
    expect(stored?.message).toBe("第 23 筆");
    expect(stored?.lastEventSeq).toBe(24);
  });

  it("不同工作階段可以同時寫入，互不等待", async () => {
    const paths = await makePaths();
    await Promise.all([
      writeRecord(paths, makeRecord("agent_a", { message: "A" })),
      writeRecord(paths, makeRecord("agent_b", { message: "B" })),
    ]);

    expect((await readRecord(paths, "agent_a"))?.message).toBe("A");
    expect((await readRecord(paths, "agent_b"))?.message).toBe("B");
  });

  it("啟動時建立快取 home 與暫存目錄", async () => {
    const paths = await makePaths();
    await ensureSessionDirs(paths, "agent_dirs");

    expect(existsSync(join(paths.cacheRoot, "agent_dirs", "home", ".config", "opencode"))).toBe(
      true,
    );
    expect(existsSync(join(paths.tmpRoot, "agent_dirs"))).toBe(true);
  });

  it("讀不到或壞掉的紀錄回 null，列表跳過沒有紀錄的目錄", async () => {
    const paths = await makePaths();
    await writeRecord(paths, makeRecord("agent_ok"));
    await mkdir(join(paths.cacheRoot, "agent_empty"), { recursive: true });
    await mkdir(join(paths.cacheRoot, "agent_broken"), { recursive: true });
    await writeFile(join(paths.cacheRoot, "agent_broken", "session.json"), "{not json", "utf8");

    expect(await readRecord(paths, "agent_missing")).toBeNull();
    expect(await readRecord(paths, "agent_broken")).toBeNull();
    expect((await listRecords(paths)).map((record) => record.agentSessionId)).toEqual(["agent_ok"]);
  });

  it("清暫存只動 tmp 底下的目錄，快取原封不動", async () => {
    const paths = await makePaths();
    await ensureSessionDirs(paths, "agent_keep");
    await writeRecord(paths, makeRecord("agent_keep"));
    await writeFile(join(paths.tmpRoot, "agent_keep", "scratch.txt"), "x", "utf8");
    await mkdir(join(paths.tmpRoot, "agent_other"), { recursive: true });

    expect(await clearScratch(paths)).toBe(2);
    expect(existsSync(paths.tmpRoot) && (await readDirNames(paths.tmpRoot)).length).toBe(0);
    expect((await readRecord(paths, "agent_keep"))?.agentSessionId).toBe("agent_keep");
  });

  it("任務結束只移除自己的工作階段暫存", async () => {
    const paths = await makePaths();
    await ensureSessionDirs(paths, "agent_one");
    await ensureSessionDirs(paths, "agent_two");

    await removeScratch(paths, "agent_one");

    expect(existsSync(join(paths.tmpRoot, "agent_one"))).toBe(false);
    expect(existsSync(join(paths.tmpRoot, "agent_two"))).toBe(true);
  });

  it("超過 30 天沒動的快取被清掉，最近用過的不動", async () => {
    const paths = await makePaths();
    await writeRecord(paths, makeRecord("agent_stale"));
    await writeRecord(paths, makeRecord("agent_fresh"));
    const staleDir = join(paths.cacheRoot, "agent_stale");
    const old = new Date(T0 - 40 * DAY_MS);
    await utimes(staleDir, old, old);
    const remembered = await stat(join(paths.cacheRoot, "agent_fresh"));

    const purged = await purgeStaleCache(paths, T0);

    expect(purged).toEqual(["agent_stale"]);
    expect(existsSync(staleDir)).toBe(false);
    const fresh = await stat(join(paths.cacheRoot, "agent_fresh"));
    expect(fresh.mtimeMs).toBe(remembered.mtimeMs);
  });

  it("主機重啟把非終態紀錄標成結果未知，已完成的不重寫", async () => {
    const paths = await makePaths();
    await writeRecord(paths, makeRecord("agent_running", { status: "running" }));
    await writeRecord(
      paths,
      makeRecord("agent_waiting", {
        status: "waiting-approval",
        pendingPermission: {
          requestKey: "opencode:9",
          approvalId: "appr_1",
          toolName: "bash",
          input: {},
          replyToken: "9",
        },
        startApprovalId: "appr_start",
      }),
    );
    await writeRecord(paths, makeRecord("agent_done", { status: "completed", message: "完成" }));

    const marked = await markOrphansAfterRestart(paths, new Date(NOW));

    expect(marked.map((record) => record.agentSessionId).sort()).toEqual([
      "agent_running",
      "agent_waiting",
    ]);
    for (const id of ["agent_running", "agent_waiting"]) {
      const stored = await readRecord(paths, id);
      expect(stored?.status).toBe("failed");
      expect(stored?.resultUnknown).toBe(true);
      expect(stored?.pendingPermission).toBeNull();
      expect(stored?.message).toContain("結果未知");
    }
    expect((await readRecord(paths, "agent_done"))?.message).toBe("完成");
    expect(await listNonTerminal(paths)).toEqual([]);
  });

  it("資料夾內只有 tmp 可以當工作目錄，資料夾外全部放行", () => {
    const root = "/Volumes/Cardiary/folder";

    expect(isProtectedWorkingDirectory(root, root)).toBe(true);
    expect(isProtectedWorkingDirectory(root, `${root}/state`)).toBe(true);
    expect(isProtectedWorkingDirectory(root, `${root}/cards/a.json`)).toBe(true);
    expect(isProtectedWorkingDirectory(root, `${root}/tmp`)).toBe(false);
    expect(isProtectedWorkingDirectory(root, `${root}/tmp/agent/work`)).toBe(false);
    expect(isProtectedWorkingDirectory(root, "/Volumes/other/project")).toBe(false);
    expect(isProtectedWorkingDirectory(root, `${root}-other`)).toBe(false);
  });

  it("紀錄以可讀的 JSON 落地，方便使用者自行檢查", async () => {
    const paths = await makePaths();
    await writeRecord(paths, makeRecord("agent_json", { message: "整理結果" }));

    const raw = await readFile(join(paths.cacheRoot, "agent_json", "session.json"), "utf8");
    const parsed = JSON.parse(raw) as { message: string };
    expect(parsed.message).toBe("整理結果");
    expect(raw).toContain("\n");
  });
});

async function readDirNames(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  return readdir(dir);
}
