import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import { isUlid } from "@cardiary/domain";

import { StorageError } from "../errors.js";
import type { FolderLayout } from "../paths.js";

/** 卡片檔名：`<cardId>.md`。 */
const CARD_FILE_NAME = /^([0-9A-HJKMNP-TV-Z]{26})\.md$/i;
/** 原子寫入的暫存檔：`.<cardId>.<隨機 8 字元>.tmp`。 */
const TEMP_FILE_NAME = /^\.[0-9A-HJKMNP-TV-Z]{26}\.[a-z0-9]{8}\.tmp$/i;
/** 啟動時，比這個年紀大的暫存檔一律刪掉。 */
export const CARD_TEMP_MAX_AGE_MS = 60 * 60 * 1000;

export interface CardFileEntry {
  readonly cardId: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
}

export interface CardFileContent extends CardFileEntry {
  /** 檔案的 UTF-8 內容，原樣。 */
  readonly text: string;
}

export interface CardFileStoreOptions {
  readonly layout: FolderLayout;
  readonly now?: () => Date;
  readonly trace?: (operation: string) => void;
}

/**
 * `cards/` 正本區的檔案存取。
 *
 * 只處理位元組與檔名：解析 frontmatter、補丁與索引都由呼叫端負責。
 * 寫入是「同目錄暫存檔 → fsync → rename → 目錄 fsync」，任何時刻
 * `cards/<id>.md` 不是舊版就是新版。符號連結不讀也不寫，避免跟著連結
 * 跑到資料夾外面。
 */
export class CardFileStore {
  readonly #layout: FolderLayout;
  readonly #now: () => Date;
  readonly #trace: ((operation: string) => void) | undefined;

  constructor(options: CardFileStoreOptions) {
    this.#layout = options.layout;
    this.#now = options.now ?? (() => new Date());
    this.#trace = options.trace;
  }

  get directory(): string {
    return this.#layout.subfolderPath("cards");
  }

  /** `cards/` 不存在時建立；資料夾初始化已經建過，這裡只補漏。 */
  ensureDirectory(): void {
    mkdirSync(this.directory, { recursive: true });
  }

  /** 卡片檔的內部相對路徑（POSIX 分隔符）。 */
  relativePath(cardId: string): string {
    return `cards/${assertCardId(cardId)}.md`;
  }

  absolutePath(cardId: string): string {
    return this.#layout.absolute(this.relativePath(cardId));
  }

  /**
   * 列出 `cards/*.md`，依檔名排序。
   *
   * 只看一般檔案：暫存檔、`.DS_Store` 與符號連結都不算卡片。
   */
  list(): CardFileEntry[] {
    const entries: CardFileEntry[] = [];
    for (const name of this.#readDirectoryNames()) {
      const match = CARD_FILE_NAME.exec(name);
      if (!match) continue;
      const stats = this.#regularFileStats(path.join(this.directory, name));
      if (stats === undefined) continue;
      entries.push({
        cardId: (match[1] as string).toUpperCase(),
        fileName: name,
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
      });
    }
    entries.sort((left, right) => left.fileName.localeCompare(right.fileName));
    return entries;
  }

  /** 讀一張卡片的原始文字；不存在或不是一般檔案時回 undefined。 */
  read(cardId: string): CardFileContent | undefined {
    const absolutePath = this.absolutePath(cardId);
    try {
      const linkStats = lstatSync(absolutePath);
      if (!linkStats.isFile() || linkStats.isSymbolicLink()) {
        return undefined;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw asStorageError(error, "檢查卡片檔失敗", cardId);
    }
    let fd: number | null = null;
    try {
      fd = openSync(absolutePath, "r");
      const stats = fstatSync(fd);
      if (!stats.isFile()) {
        return undefined;
      }
      return {
        cardId: cardId.toUpperCase(),
        fileName: path.basename(absolutePath),
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
        text: readFileSync(fd, "utf8"),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw asStorageError(error, "讀取卡片檔失敗", cardId);
    } finally {
      if (fd !== null) {
        closeSync(fd);
      }
    }
  }

  /**
   * 原子寫入一張卡片。
   *
   * 呼叫端已經組好完整檔案內容（frontmatter 與內文）；這裡不改內容，
   * 只保證替換是原子的。暫存檔留下來的話由 `cleanupTempFiles` 清。
   */
  write(input: { readonly cardId: string; readonly text: string }): CardFileEntry {
    const cardId = assertCardId(input.cardId);
    const target = this.absolutePath(cardId);
    const tempPath = path.join(this.directory, tempFileName(cardId));
    let fd: number | null = null;
    try {
      fd = openSync(tempPath, "wx", 0o644);
      writeAll(fd, Buffer.from(input.text, "utf8"));
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(tempPath, target);
    } catch (error) {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // 已經關閉或失效；保留原始錯誤。
        }
      }
      rmSync(tempPath, { force: true });
      throw asStorageError(error, "卡片檔寫入失敗", cardId);
    }
    syncDirectory(this.directory);
    this.#trace?.("cards:write");
    const stats = statSync(target);
    return {
      cardId,
      fileName: path.basename(target),
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  }

  /** 刪除一張卡片；檔案不存在時回 false。 */
  remove(cardId: string): boolean {
    const absolutePath = this.absolutePath(cardId);
    try {
      lstatSync(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw asStorageError(error, "檢查卡片檔失敗", cardId);
    }
    try {
      rmSync(absolutePath, { force: true });
    } catch (error) {
      throw asStorageError(error, "刪除卡片檔失敗", cardId);
    }
    syncDirectory(this.directory);
    this.#trace?.("cards:remove");
    return true;
  }

  /**
   * 啟動掃描清暫存檔：`cards/` 底下以 `.` 開頭、以 `.tmp` 結尾，
   * 而且超過 `olderThanMs` 的檔案。回傳刪掉檔名。
   */
  cleanupTempFiles(olderThanMs: number = CARD_TEMP_MAX_AGE_MS): string[] {
    const nowMs = this.#now().getTime();
    const removed: string[] = [];
    for (const name of this.#readDirectoryNames()) {
      if (!name.startsWith(".") || !name.toLowerCase().endsWith(".tmp")) continue;
      const absolutePath = path.join(this.directory, name);
      let stats;
      try {
        stats = lstatSync(absolutePath);
      } catch {
        continue;
      }
      if (!stats.isFile() || stats.isSymbolicLink()) continue;
      if (nowMs - stats.mtimeMs <= olderThanMs) continue;
      rmSync(absolutePath, { force: true });
      removed.push(name);
    }
    if (removed.length > 0) {
      this.#trace?.("cards:cleanup-temp");
    }
    return removed;
  }

  #readDirectoryNames(): string[] {
    try {
      return readdirSync(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw asStorageError(error, "列出卡片資料夾失敗");
    }
  }

  #regularFileStats(absolutePath: string): { size: number; mtimeMs: number } | undefined {
    try {
      const stats = lstatSync(absolutePath);
      return stats.isFile() && !stats.isSymbolicLink()
        ? { size: stats.size, mtimeMs: stats.mtimeMs }
        : undefined;
    } catch {
      return undefined;
    }
  }
}

/** 是否符合卡片檔名樣式；掃描時用來分辨卡片與其他檔案。 */
export function isCardFileName(name: string): boolean {
  return CARD_FILE_NAME.test(name);
}

/** 是否符合暫存檔樣式；只給測試與診斷使用。 */
export function isTempFileName(name: string): boolean {
  return TEMP_FILE_NAME.test(name);
}

function assertCardId(cardId: string): string {
  const normalized = cardId.toUpperCase();
  if (!isUlid(cardId)) {
    throw new StorageError("invalid-path", "卡片識別碼必須是 ULID", { cardId });
  }
  return normalized;
}

function tempFileName(cardId: string): string {
  return `.${cardId}.${randomBytes(4).toString("hex")}.tmp`;
}

/** 寫完整個 buffer；`writeSync` 可能只寫一部分。 */
function writeAll(fd: number, buffer: Buffer): void {
  let offset = 0;
  while (offset < buffer.length) {
    offset += writeSync(fd, buffer, offset, buffer.length - offset);
  }
}

/**
 * 對目錄 fsync，讓 rename 的目錄項真的落盤。
 *
 * 有些檔案系統不支援對目錄 fsync（例如部分網路磁碟），這時資料本身已經
 * 寫入且 rename 完成，只少了一層耐用性保證；不因此讓寫入失敗。
 */
function syncDirectory(directory: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(directory, "r");
    fsyncSync(fd);
  } catch {
    // 忽略：見上面的註解。
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // 同上。
      }
    }
  }
}

function asStorageError(error: unknown, message: string, cardId?: string): StorageError {
  if (error instanceof StorageError) {
    return error;
  }
  const cause = error instanceof Error ? error.message : String(error);
  return new StorageError("storage-failed", message, {
    ...(cardId === undefined ? {} : { cardId }),
    cause,
  });
}
