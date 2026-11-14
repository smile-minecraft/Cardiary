import { existsSync, statSync } from "node:fs";

import type { Database } from "./db.js";
import type { FolderLayout } from "./paths.js";
import { clearDirectorySafely, removeFileSafely } from "./paths.js";
import { newUlid } from "./ids.js";
import { nowIso, shiftIso } from "./util.js";

/** 登記簿的主人種類。 */
export type FileOwnerKind =
  "conversation" | "task" | "tool-call" | "module" | "index" | "migration";

/** `live` 正常；`expired` 過期待回收；`orphan` 檔案不見了或沒有主人。 */
export type FileState = "live" | "expired" | "orphan";

export interface FileRegistryRecord {
  readonly id: string;
  readonly zone: "cache" | "tmp";
  readonly relPath: string;
  readonly ownerKind: FileOwnerKind;
  readonly ownerId: string | null;
  readonly state: FileState;
  readonly sizeBytes: number | null;
  readonly createdAt: string;
  readonly renewedAt: string;
  readonly lastUsedAt: string;
  readonly expiresAt: string | null;
}

export interface RegisterFileInput {
  readonly relPath: string;
  readonly ownerKind: FileOwnerKind;
  readonly ownerId?: string | null;
  readonly sizeBytes?: number | null;
  readonly expiresAt?: string | null;
  readonly now?: string;
}

export interface ScanViolation {
  readonly kind: "symlink" | "hard-link" | "malformed-registry-row";
  readonly relPath: string;
}

export interface ScanReport {
  readonly removedUnregistered: number;
  readonly removedExpired: number;
  readonly removedMissingRows: number;
  readonly removedSymlinks: number;
  readonly skippedOverflow: number;
  readonly skippedHardLinks: number;
  readonly kept: number;
  readonly violations: readonly ScanViolation[];
}

export interface ScanOptions {
  readonly now?: Date;
  /** 正在執行的工具呼叫數；大於 0 時跳過 `tmp/tmp-<6>/pi-output-<uuid>.log`。 */
  readonly activeToolCalls?: number;
}

export interface EvictionReport {
  readonly removedFiles: number;
  readonly freedBytes: number;
}

interface RegistryRow {
  readonly id: string;
  readonly zone: string;
  readonly rel_path: string;
  readonly owner_kind: string;
  readonly owner_id: string | null;
  readonly state: string;
  readonly size_bytes: number | null;
  readonly created_at: string;
  readonly renewed_at: string;
  readonly last_used_at: string;
  readonly expires_at: string | null;
}

const OVERFLOW_PATTERN = /^tmp\/tmp-[A-Za-z0-9]{6}\/pi-output-[^/]+\.log$/;

/** SQLite 的 WAL／SHM 由連線管理，不列入登記簿掃描。 */
function isSqliteSidecarOfRegisteredDatabase(
  relativePath: string,
  rows: ReadonlyMap<string, FileRegistryRecord>,
): boolean {
  if (!relativePath.endsWith("-wal") && !relativePath.endsWith("-shm")) {
    return false;
  }
  const base = relativePath.replace(/-wal$|-shm$/, "");
  return base === "cache/index.sqlite" || rows.has(base);
}

/** 引擎的 `NodeExecutionEnv` 溢出檔；唯一不經登記簿的暫存檔。 */
export function isEngineOverflowPath(relativePath: string): boolean {
  return OVERFLOW_PATTERN.test(relativePath);
}

/** `file_registry` 的存取、掃描、回收與容量淘汰。 */
export class FileRegistry {
  readonly #db: Database;
  readonly #layout: FolderLayout;
  readonly #now: () => Date;

  constructor(db: Database, layout: FolderLayout, options: { readonly now?: () => Date } = {}) {
    this.#db = db;
    this.#layout = layout;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * 寫入檔案**之前**先登記。
   *
   * 同一個路徑重複登記時更新原本那一列，不新增第二列。
   */
  register(input: RegisterFileInput): FileRegistryRecord {
    const relPath = this.#layout.assertRegistryPath(input.relPath);
    const now = input.now ?? nowIso(this.#now);
    const zone = relPath.startsWith("cache/") ? "cache" : "tmp";
    this.#db.run(
      `INSERT INTO file_registry (
         id, zone, rel_path, owner_kind, owner_id, state, size_bytes,
         created_at, renewed_at, last_used_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, 'live', ?, ?, ?, ?, ?)
       ON CONFLICT (rel_path) DO UPDATE SET
         owner_kind = excluded.owner_kind,
         owner_id = excluded.owner_id,
         state = 'live',
         size_bytes = COALESCE(excluded.size_bytes, file_registry.size_bytes),
         renewed_at = excluded.renewed_at,
         last_used_at = excluded.last_used_at,
         expires_at = excluded.expires_at`,
      newUlid(this.#now().getTime()),
      zone,
      relPath,
      input.ownerKind,
      input.ownerId ?? null,
      input.sizeBytes ?? null,
      now,
      now,
      now,
      input.expiresAt ?? null,
    );
    const record = this.get(relPath);
    if (record === null) {
      throw new Error(`file_registry 寫入後找不到 ${relPath}`);
    }
    return record;
  }

  get(relPath: string): FileRegistryRecord | null {
    const row = this.#db.get<RegistryRow>(
      "SELECT * FROM file_registry WHERE rel_path = ?",
      relPath,
    );
    return row === undefined ? null : rowToRecord(row);
  }

  list(): FileRegistryRecord[] {
    return this.#db
      .all<RegistryRow>("SELECT * FROM file_registry ORDER BY rel_path")
      .map(rowToRecord);
  }

  listByOwner(ownerKind: FileOwnerKind, ownerId: string): FileRegistryRecord[] {
    return this.#db
      .all<RegistryRow>(
        "SELECT * FROM file_registry WHERE owner_kind = ? AND owner_id = ?",
        ownerKind,
        ownerId,
      )
      .map(rowToRecord);
  }

  /** 最近一次被讀取或寫入；容量淘汰用它，不用檔案 atime。 */
  touch(relPath: string, now = nowIso(this.#now)): void {
    this.#db.run(
      "UPDATE file_registry SET last_used_at = ?, renewed_at = ? WHERE rel_path = ?",
      now,
      now,
      relPath,
    );
  }

  /** 主人還活著時續期。 */
  renew(relPath: string, expiresAt: string | null = null): void {
    const now = nowIso(this.#now);
    this.#db.run(
      "UPDATE file_registry SET renewed_at = ?, last_used_at = ?, expires_at = ? WHERE rel_path = ?",
      now,
      now,
      expiresAt,
      relPath,
    );
  }

  /** 主人結束時設定到期時間；預設留 10 分鐘緩衝讓收尾讀取。 */
  expireOwner(ownerKind: FileOwnerKind, ownerId: string, bufferMs = 10 * 60 * 1000): number {
    const expiresAt = shiftIso(nowIso(this.#now), bufferMs);
    return this.#db.run(
      "UPDATE file_registry SET expires_at = ? WHERE owner_kind = ? AND owner_id = ?",
      expiresAt,
      ownerKind,
      ownerId,
    ).changes;
  }

  /**
   * 掃描 `cache/` 與 `tmp/`：未登記、過期、孤兒檔案回收。
   *
   * 正本區完全不在掃描範圍；符號連結只刪連結本身；硬連結不刪；
   * 工具執行中跳過引擎溢出檔。
   */
  scan(options: ScanOptions = {}): ScanReport {
    const now = (options.now ?? this.#now()).toISOString();
    const activeToolCalls = options.activeToolCalls ?? 0;
    const rows = new Map(this.list().map((record) => [record.relPath, record]));
    const seen = new Set<string>();
    const violations: ScanViolation[] = [];
    let removedUnregistered = 0;
    let removedExpired = 0;
    let removedSymlinks = 0;
    let skippedOverflow = 0;
    let skippedHardLinks = 0;
    let kept = 0;

    for (const zone of ["cache", "tmp"] as const) {
      const zonePath = this.#layout.subfolderPath(zone);
      if (!existsSync(zonePath)) {
        continue;
      }
      for (const entry of this.#layout.listTree(zonePath)) {
        if (entry.isDirectory) {
          continue;
        }
        const relPath = entry.relativePath;
        if (entry.isSymbolicLink) {
          const result = removeFileSafely(this.#layout, entry.absolutePath);
          if (result.removed) {
            removedSymlinks += 1;
            violations.push({ kind: "symlink", relPath });
            if (rows.has(relPath)) {
              this.#db.run("DELETE FROM file_registry WHERE rel_path = ?", relPath);
              rows.delete(relPath);
            }
          }
          continue;
        }
        if (isSqliteSidecarOfRegisteredDatabase(relPath, rows)) {
          continue;
        }
        seen.add(relPath);

        const record = rows.get(relPath);
        if (record === undefined && relPath === "cache/index.sqlite") {
          // 索引檔由儲存層自己管理；即使登記列暫時不見，也不能在連線開著時刪掉。
          kept += 1;
          continue;
        }
        if (record === undefined) {
          if (activeToolCalls > 0 && isEngineOverflowPath(relPath)) {
            skippedOverflow += 1;
            continue;
          }
          const result = removeFileSafely(this.#layout, entry.absolutePath);
          if (result.removed) {
            removedUnregistered += 1;
          } else if (result.reason === "hard-link") {
            skippedHardLinks += 1;
            violations.push({ kind: "hard-link", relPath });
          }
          continue;
        }

        const expired = record.expiresAt !== null && record.expiresAt < now;
        if (record.state === "orphan" || expired) {
          const result = removeFileSafely(this.#layout, entry.absolutePath);
          if (result.removed) {
            this.#db.run("DELETE FROM file_registry WHERE rel_path = ?", relPath);
            removedExpired += 1;
          } else if (result.reason === "hard-link") {
            skippedHardLinks += 1;
            violations.push({ kind: "hard-link", relPath });
          }
          continue;
        }
        this.#db.run(
          "UPDATE file_registry SET size_bytes = ? WHERE rel_path = ? AND size_bytes IS NOT ?",
          entry.size,
          relPath,
          entry.size,
        );
        kept += 1;
      }
    }

    let removedMissingRows = 0;
    for (const record of rows.values()) {
      if (seen.has(record.relPath)) {
        continue;
      }
      this.#db.run("DELETE FROM file_registry WHERE rel_path = ?", record.relPath);
      removedMissingRows += 1;
    }

    return {
      removedUnregistered,
      removedExpired,
      removedMissingRows,
      removedSymlinks,
      skippedOverflow,
      skippedHardLinks,
      kept,
      violations,
    };
  }

  /** 刪除指定主人的登記列與檔案；刪列先於刪檔。 */
  purgeOwner(ownerKind: FileOwnerKind, ownerIds: readonly string[]): number {
    if (ownerIds.length === 0) {
      return 0;
    }
    let removed = 0;
    this.#db.transaction((tx) => {
      for (const ownerId of ownerIds) {
        const records = tx
          .all<RegistryRow>(
            "SELECT * FROM file_registry WHERE owner_kind = ? AND owner_id = ?",
            ownerKind,
            ownerId,
          )
          .map(rowToRecord);
        for (const record of records) {
          tx.run("DELETE FROM file_registry WHERE id = ?", record.id);
          try {
            if (existsSync(this.#layout.absolute(record.relPath))) {
              const result = removeFileSafely(this.#layout, this.#layout.absolute(record.relPath));
              if (result.removed) {
                removed += 1;
              }
            }
          } catch {
            // 登記列已刪；路徑不合法或超出區域時，掃描會留下可供診斷的痕跡。
          }
        }
      }
    });
    return removed;
  }

  /** 刪除 tmp 或 cache 區域內的所有檔案，保留區域目錄。 */
  clearZone(zone: "cache" | "tmp"): number {
    const zonePath = this.#layout.subfolderPath(zone);
    if (existsSync(zonePath)) {
      const report = clearDirectorySafely(this.#layout, zonePath);
      this.#db.run("DELETE FROM file_registry WHERE zone = ?", zone);
      return report.removedFiles + report.removedLinks;
    }
    return 0;
  }

  /** 啟動時整個清空 `tmp/`；殘留的引擎溢出檔也在這裡消失。 */
  prepareStartup(): number {
    return this.clearZone("tmp");
  }

  /**
   * 任務結束時清掉該次呼叫產生的引擎溢出檔。
   *
   * 依 `mtime` 落在時間窗內判斷；只碰 `tmp/tmp-<6>/pi-output-<uuid>.log`。
   */
  cleanupToolOutputs(options: { readonly sinceMs: number; readonly untilMs?: number }): number {
    const until = options.untilMs ?? Date.now();
    const tmpPath = this.#layout.subfolderPath("tmp");
    if (!existsSync(tmpPath)) {
      return 0;
    }
    let removed = 0;
    for (const entry of this.#layout.listTree(tmpPath)) {
      if (entry.isDirectory || entry.isSymbolicLink) {
        continue;
      }
      if (!isEngineOverflowPath(entry.relativePath)) {
        continue;
      }
      if (entry.modifiedAtMs < options.sinceMs || Math.floor(entry.modifiedAtMs) > until) {
        continue;
      }
      const result = removeFileSafely(this.#layout, entry.absolutePath);
      if (result.removed) {
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * 容量淘汰：依 `last_used_at` 由舊到新刪，直到降回上限。
   *
   * `cache/index.sqlite` 不淘汰；它太大是索引設計的問題。
   */
  evictCache(options: {
    readonly limitBytes: number;
    readonly protectedPaths?: readonly string[];
  }): EvictionReport {
    const protectedPaths = new Set(["cache/index.sqlite", ...(options.protectedPaths ?? [])]);
    const rows = this.#db
      .all<RegistryRow>(
        "SELECT * FROM file_registry WHERE zone = 'cache' ORDER BY last_used_at ASC, id ASC",
      )
      .map(rowToRecord);
    const sizes = new Map<string, number>();
    let total = 0;
    for (const record of rows) {
      let size = record.sizeBytes ?? 0;
      try {
        if (existsSync(this.#layout.absolute(record.relPath))) {
          size = statSync(this.#layout.absolute(record.relPath)).size;
        }
      } catch {
        size = 0;
      }
      sizes.set(record.relPath, size);
      total += size;
    }
    let removedFiles = 0;
    let freedBytes = 0;
    for (const record of rows) {
      if (total <= options.limitBytes) {
        break;
      }
      if (protectedPaths.has(record.relPath)) {
        continue;
      }
      const size = sizes.get(record.relPath) ?? 0;
      try {
        const result = removeFileSafely(this.#layout, this.#layout.absolute(record.relPath));
        if (result.removed) {
          removedFiles += 1;
          freedBytes += size;
          total -= size;
        }
      } catch {
        // 壞路徑不在淘汰路徑處理；掃描會回報。
      }
      this.#db.run("DELETE FROM file_registry WHERE rel_path = ?", record.relPath);
    }
    return { removedFiles, freedBytes };
  }
}

function rowToRecord(row: RegistryRow): FileRegistryRecord {
  return {
    id: row.id,
    zone: row.zone as "cache" | "tmp",
    relPath: row.rel_path,
    ownerKind: row.owner_kind as FileOwnerKind,
    ownerId: row.owner_id,
    state: row.state as FileState,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    renewedAt: row.renewed_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  };
}
