import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { StorageError } from "../errors.js";
import {
  assertNotSymbolicLink,
  clearDirectorySafely,
  removeFileSafely,
  writeFileAtomic,
  type FolderLayout,
  type TreeEntry,
} from "../paths.js";
import type { Database } from "../db.js";

export const CLEANUP_CATEGORIES = ["cache", "temp", "indexes", "logs"] as const;

export type CleanupCategory = (typeof CLEANUP_CATEGORIES)[number];
export type CleanupUsageCategory = "cards" | "assets" | "cache" | "state" | "logs" | "tmp";

export type CleanupUsageItem = {
  readonly category: CleanupUsageCategory;
  readonly bytes: number;
  readonly cleanableBytes: number;
};
export type CleanupPreviewTarget = {
  readonly category: CleanupCategory;
  readonly items: number;
  readonly bytes: number;
};
export type StorageCleanupPreview = {
  readonly targets: readonly CleanupPreviewTarget[];
  readonly totalBytes: number;
};
export type StorageCleanupApplyResult = StorageCleanupPreview & {
  readonly recordId: string;
};

export type StorageCleanupTargetSelector = CleanupCategory | string;

export interface StorageCleanupOptions {
  readonly layout: FolderLayout;
  readonly cache: () => Database;
  readonly now?: () => Date;
  /** 正執行中的工具數量；大於 0 時不清執行工具產生的暫存。 */
  readonly activeToolCalls?: () => number;
  /** 個別相對路徑是否正在使用；回傳 true 就不列入預覽。 */
  readonly isBusy?: (relativePath: string) => boolean;
}

const CACHE_INDEX_FILES = new Set([
  "cache/index.sqlite",
  "cache/index.sqlite-wal",
  "cache/index.sqlite-shm",
]);
const INDEX_TABLES = [
  "card_links",
  "card_tags",
  "card_sources",
  "asset_refs",
  "asset_meta",
  "vec_cards",
  "fts_cards",
  "card_index",
  "card_index_meta",
] as const;
const RECORD_PATH = "state/storage-cleanup.json";

interface PreviewSnapshot extends StorageCleanupPreview {
  readonly categories: readonly CleanupCategory[];
  readonly signature: string;
}

interface IndexMeasurement {
  readonly items: number;
  readonly freedBytes: number;
}

/**
 * 儲存空間的用量、預覽與清理。
 *
 * 允許的目標只有快取、暫存、可重建索引與日誌；卡片、資產、白板、技能、
 * 狀態與模組都是正本，一律拒絕。執行 `apply` 前必須先做同一組類別的
 * `preview`，而且預覽當下的檔案必須和目前一致。
 */
export class StorageCleanup {
  readonly #layout: FolderLayout;
  readonly #cache: () => Database;
  readonly #now: () => Date;
  readonly #activeToolCalls: () => number;
  readonly #isBusy: (relativePath: string) => boolean;
  #preview: PreviewSnapshot | undefined;

  constructor(options: StorageCleanupOptions) {
    this.#layout = options.layout;
    this.#cache = options.cache;
    this.#now = options.now ?? (() => new Date());
    this.#activeToolCalls = options.activeToolCalls ?? (() => 0);
    this.#isBusy = options.isBusy ?? (() => false);
  }

  /** 六類用量：正本固定不可清，cache 不含索引資料庫檔本身。 */
  usage(): CleanupUsageItem[] {
    const cards = this.#treeUsage("cards");
    const assets = this.#treeUsage("assets");
    const cache = this.#treeUsage("cache");
    const state = this.#treeUsage("state");
    const logs = this.#treeUsage("logs");
    const tmp = this.#treeUsage("tmp");
    return [
      { category: "cards", bytes: cards, cleanableBytes: 0 },
      { category: "assets", bytes: assets, cleanableBytes: 0 },
      {
        category: "cache",
        bytes: cache,
        cleanableBytes: sumSizes(this.#cleanableEntries("cache")),
      },
      { category: "state", bytes: state, cleanableBytes: 0 },
      { category: "logs", bytes: logs, cleanableBytes: sumSizes(this.#cleanableEntries("logs")) },
      { category: "tmp", bytes: tmp, cleanableBytes: sumSizes(this.#cleanableEntries("tmp")) },
    ];
  }

  /** 協定 `storage.usage` 只列得下五類；`tmp` 由面板另外取得。 */
  protocolUsage(): Array<
    Omit<CleanupUsageItem, "category"> & {
      readonly category: "cards" | "assets" | "cache" | "state" | "logs";
    }
  > {
    const all = this.usage();
    const item = (
      category: "cards" | "assets" | "cache" | "state" | "logs",
    ): Omit<CleanupUsageItem, "category"> & {
      readonly category: "cards" | "assets" | "cache" | "state" | "logs";
    } => {
      const usage = all.find((entry) => entry.category === category);
      if (usage === undefined) {
        throw new StorageError("storage-failed", `少了 ${category} 用量。`);
      }
      return { category, bytes: usage.bytes, cleanableBytes: usage.cleanableBytes };
    };
    return [item("cards"), item("assets"), item("cache"), item("state"), item("logs")];
  }

  /** 先算出將刪除的目標；不會修改索引內容。 */
  preview(categories: readonly StorageCleanupTargetSelector[]): StorageCleanupPreview {
    const requested = normalizeCategories(categories);
    const targets: CleanupPreviewTarget[] = [];
    for (const category of requested) {
      if (category === "indexes") {
        const measurement = this.#measureIndexCleanup();
        targets.push({ category, items: measurement.items, bytes: measurement.freedBytes });
        continue;
      }
      const subfolder = category === "temp" ? "tmp" : "cache";
      const entries = this.#cleanableEntries(category === "logs" ? "logs" : subfolder);
      targets.push({ category, items: entries.length, bytes: sumSizes(entries) });
    }
    const snapshot = {
      categories: requested,
      targets,
      totalBytes: targets.reduce((sum, target) => sum + target.bytes, 0),
      signature: this.#signature(requested),
    };
    this.#preview = snapshot;
    return { targets: snapshot.targets, totalBytes: snapshot.totalBytes };
  }

  /** 依先前的預覽清理；目標變了，或還沒預覽過就拒絕。 */
  apply(categories: readonly StorageCleanupTargetSelector[]): StorageCleanupApplyResult {
    const requested = normalizeCategories(categories);
    const preview = this.#preview;
    if (preview === undefined || !sameCategories(preview.categories, requested)) {
      throw new StorageError("invalid-input", "清理前必須先預覽相同的類別。", {
        category: "cleanup",
      });
    }
    if (preview.signature !== this.#signature(requested)) {
      throw new StorageError("invalid-input", "預覽後目標已改變，請重新預覽。", {
        category: "cleanup",
      });
    }

    const expected = preview.targets;
    const actual: CleanupPreviewTarget[] = [];
    let totalBytes = 0;
    for (const target of expected) {
      if (target.category === "indexes") {
        const result = this.#clearIndexes(target.bytes);
        actual.push({ category: "indexes", items: result.items, bytes: result.bytes });
        totalBytes += result.bytes;
        continue;
      }
      const subfolder = target.category === "temp" ? "tmp" : target.category;
      const entries = this.#cleanableEntries(subfolder);
      if (target.category === "logs") {
        const report = clearDirectorySafely(this.#layout, this.#layout.subfolderPath("logs"), [
          "logs",
        ]);
        const removed = report.removedFiles + report.removedLinks;
        const bytes = sumSizes(entries);
        actual.push({ category: "logs", items: removed, bytes });
        totalBytes += bytes;
        continue;
      }
      let items = 0;
      let bytes = 0;
      for (const entry of entries) {
        const result = removeFileSafely(this.#layout, entry.absolutePath, [
          target.category === "temp" ? "tmp" : "cache",
        ]);
        if (result.removed) {
          items += 1;
          bytes += entry.size;
        }
      }
      actual.push({ category: target.category, items, bytes });
      totalBytes += bytes;
    }

    if (!sameTargets(expected, actual)) {
      this.#preview = undefined;
      throw new StorageError("storage-failed", "預覽與實際清理結果不一致，已停止。", {
        expected,
        actual,
      });
    }
    this.#preview = undefined;
    const recordId = newRecordId();
    writeFileAtomic(
      this.#layout,
      this.#layout.absolute(RECORD_PATH),
      `${JSON.stringify(
        {
          recordId,
          at: this.#now().toISOString(),
          categories: requested,
          targets: actual,
          totalBytes,
        },
        null,
        2,
      )}\n`,
    );
    return { targets: actual, totalBytes, recordId };
  }

  /** 目前最近一次預覽；apply 完成或失敗後清掉。 */
  get lastPreview(): StorageCleanupPreview | undefined {
    return this.#preview === undefined
      ? undefined
      : { targets: this.#preview.targets, totalBytes: this.#preview.totalBytes };
  }

  #treeUsage(subfolder: "cards" | "assets" | "cache" | "state" | "logs" | "tmp"): number {
    return sumSizes(this.#entries(subfolder));
  }

  #entries(subfolder: "cards" | "assets" | "cache" | "state" | "logs" | "tmp"): TreeEntry[] {
    if (!this.#pathExists(subfolder)) {
      return [];
    }
    const absolute = this.#layout.subfolderPath(subfolder);
    try {
      return this.#layout.listTree(absolute);
    } catch (error) {
      if (error instanceof StorageError && error.code === "path-outside-root") return [];
      throw error;
    }
  }

  #cleanableEntries(subfolder: "cache" | "tmp" | "logs"): TreeEntry[] {
    return this.#entries(subfolder).filter((entry) => {
      if (entry.isDirectory) return false;
      if (entry.linkCount > 1 && !entry.isSymbolicLink) return false;
      if (subfolder === "cache" && CACHE_INDEX_FILES.has(entry.relativePath)) return false;
      if (this.#isBusy(entry.relativePath)) return false;
      if (
        subfolder === "tmp" &&
        this.#activeToolCalls() > 0 &&
        isEngineOverflowPath(entry.relativePath)
      ) {
        return false;
      }
      return true;
    });
  }

  #signature(categories: readonly CleanupCategory[]): string {
    const hash = createHash("sha256");
    for (const category of categories) {
      hash.update(category);
      hash.update("\0");
      if (category === "indexes") {
        const cache = this.#cache();
        hash.update(cache.filePath);
        for (const table of existingIndexTables(cache)) {
          hash.update(table);
          hash.update(String(cache.countRows(table)));
        }
        continue;
      }
      const subfolder = category === "temp" ? "tmp" : category;
      if (!this.#pathExists(subfolder)) continue;
      for (const entry of this.#cleanableEntries(subfolder)) {
        hash.update(entry.relativePath);
        hash.update("\0");
        hash.update(fileSignature(entry.absolutePath));
      }
    }
    return hash.digest("hex");
  }

  #measureIndexCleanup(): IndexMeasurement {
    const cache = this.#cache();
    cache.checkpoint();
    const before = indexStorageSize(cache.filePath);
    const tables = existingIndexTables(cache);
    const tempDirectory = mkdtempSync(path.join(tmpdir(), "cardiary-cleanup-preview-"));
    const copy = path.join(tempDirectory, "index.sqlite");
    try {
      copyFileSync(cache.filePath, copy);
      for (const suffix of ["-wal", "-shm"]) {
        const source = `${cache.filePath}${suffix}`;
        if (existsSync(source)) {
          copyFileSync(source, `${copy}${suffix}`);
        }
      }
      const temporary = new DatabaseSync(copy);
      try {
        for (const table of tables) {
          temporary.exec(`DELETE FROM ${table}`);
        }
        temporary.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        temporary.exec("VACUUM");
        temporary.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        temporary.close();
      }
      const after = indexStorageSize(copy);
      return { items: tables.length, freedBytes: Math.max(0, before - after) };
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  }

  #clearIndexes(expectedBytes: number): { readonly items: number; readonly bytes: number } {
    const cache = this.#cache();
    const tables = existingIndexTables(cache);
    cache.checkpoint();
    const before = indexStorageSize(cache.filePath);
    cache.transaction(() => {
      for (const table of tables) {
        cache.exec(`DELETE FROM ${table}`);
      }
    });
    cache.checkpoint();
    cache.vacuum();
    cache.checkpoint();
    const after = indexStorageSize(cache.filePath);
    const bytes = Math.max(0, before - after);
    if (bytes !== expectedBytes) {
      throw new StorageError("storage-failed", "索引預估空間與實際清理結果不一致。", {
        expectedBytes,
        actualBytes: bytes,
      });
    }
    return { items: tables.length, bytes };
  }

  #pathExists(subfolder: string): boolean {
    try {
      return existsSync(this.#layout.subfolderPath(subfolder as "cards"));
    } catch {
      return false;
    }
  }
}

export function normalizeCategories(
  categories: readonly StorageCleanupTargetSelector[],
): CleanupCategory[] {
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new StorageError("invalid-input", "categories 必須是非空陣列。");
  }
  const result: CleanupCategory[] = [];
  for (const category of categories) {
    if (
      typeof category !== "string" ||
      !(CLEANUP_CATEGORIES as readonly string[]).includes(category)
    ) {
      throw new StorageError("invalid-input", "只接受 cache、temp、indexes、logs。", {
        category: typeof category === "string" ? category : String(category),
      });
    }
    const normalized = category as CleanupCategory;
    if (!result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

function sumSizes(entries: readonly TreeEntry[]): number {
  return entries.reduce((sum, entry) => sum + (entry.isDirectory ? 0 : entry.size), 0);
}

function sameCategories(
  expected: readonly CleanupCategory[],
  actual: readonly CleanupCategory[],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every((category, index) => actual[index] === category)
  );
}

function sameTargets(
  expected: readonly CleanupPreviewTarget[],
  actual: readonly CleanupPreviewTarget[],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every(
      (target, index) =>
        actual[index]?.category === target.category &&
        actual[index]?.items === target.items &&
        actual[index]?.bytes === target.bytes,
    )
  );
}

function fileSignature(filePath: string): string {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      return "missing";
    }
    const hash = createHash("sha256");
    hash.update(String(stats.size));
    hash.update("\0");
    hash.update(String(stats.mtimeMs));
    hash.update("\0");
    hash.update(readFileSync(filePath));
    return hash.digest("hex");
  } catch {
    return "missing";
  }
}

function indexStorageSize(filePath: string): number {
  // `-shm` 是連線共用記憶體映射，清理前後都還在，不能算進可釋放空間。
  return [filePath, `${filePath}-wal`].reduce((sum, current) => {
    try {
      const stats = statSync(current);
      return sum + (stats.isFile() ? stats.size : 0);
    } catch {
      return sum;
    }
  }, 0);
}

function existingIndexTables(db: Database): string[] {
  return INDEX_TABLES.filter((table) => db.tableExists(table));
}

function isEngineOverflowPath(relativePath: string): boolean {
  return /^tmp\/tmp-[A-Za-z0-9]{6}\/pi-output-[^/]+\.log$/.test(relativePath);
}

let cleanupCounter = 0;
function newRecordId(): string {
  cleanupCounter += 1;
  return `cleanup-${Date.now().toString(36)}-${cleanupCounter.toString(36)}`;
}
