/**
 * `boards/` 正本區的白板檔存取。
 *
 * 一份白板一個 `<ULID>.json`，整份原子寫入。格式驗證交給領域層，
 * 這裡負責位元組、檔名、路徑邊界與暫存檔清理。
 */

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

import { assertValidBoard, isUlid, type BoardDocument } from "@cardiary/domain";

import { StorageError } from "../errors.js";
import type { FolderLayout } from "../paths.js";

/** 白板檔名：`<boardId>.json`。 */
const BOARD_FILE_NAME = /^([0-9A-HJKMNP-TV-Z]{26})\.json$/i;
/** 啟動時清掉的暫存檔最長年紀。 */
export const BOARD_TEMP_MAX_AGE_MS = 60 * 60 * 1000;

export interface BoardFileEntry {
  readonly boardId: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
}

export interface BoardFileContent extends BoardFileEntry {
  readonly board: BoardDocument;
}

export interface BoardFileStoreOptions {
  readonly layout: FolderLayout;
  readonly now?: () => Date;
  readonly trace?: (operation: string) => void;
}

export interface WriteBoardOptions {
  /** 提供時做樂觀鎖：與目前檔的 updatedAt 不符就拒絕寫入。 */
  readonly expectedUpdatedAt?: string | undefined;
}

/** 白板檔儲存；不做索引，查詢直接掃描 `boards/`。 */
export class BoardFileStore {
  readonly #layout: FolderLayout;
  readonly #now: () => Date;
  readonly #trace: ((operation: string) => void) | undefined;

  constructor(options: BoardFileStoreOptions) {
    this.#layout = options.layout;
    this.#now = options.now ?? (() => new Date());
    this.#trace = options.trace;
  }

  get directory(): string {
    return this.#layout.subfolderPath("boards");
  }

  ensureDirectory(): void {
    mkdirSync(this.directory, { recursive: true });
  }

  relativePath(boardId: string): string {
    return `boards/${assertBoardId(boardId)}.json`;
  }

  absolutePath(boardId: string): string {
    return this.#layout.absolute(this.relativePath(boardId));
  }

  /** 列出所有白板摘要；順序照檔名。 */
  list(): BoardFileContent[] {
    const result: BoardFileContent[] = [];
    for (const name of this.#readDirectoryNames()) {
      const match = BOARD_FILE_NAME.exec(name);
      if (match === null) continue;
      const boardId = (match[1] as string).toUpperCase();
      const entry = this.read(boardId);
      if (entry !== undefined) result.push(entry);
    }
    result.sort((left, right) => left.fileName.localeCompare(right.fileName));
    return result;
  }

  /** 列出所有白板 id，不讀內容。 */
  listIds(): string[] {
    const ids: string[] = [];
    for (const name of this.#readDirectoryNames()) {
      const match = BOARD_FILE_NAME.exec(name);
      if (match !== null) ids.push((match[1] as string).toUpperCase());
    }
    return ids.sort();
  }

  read(boardId: string): BoardFileContent | undefined {
    const absolutePath = this.absolutePath(boardId);
    try {
      const stats = lstatSync(absolutePath);
      if (!stats.isFile() || stats.isSymbolicLink()) return undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw asStorageError(error, "檢查白板檔失敗", boardId);
    }
    let fd: number | null = null;
    try {
      fd = openSync(absolutePath, "r");
      const stats = fstatSync(fd);
      if (!stats.isFile()) return undefined;
      const text = readFileSync(fd, "utf8");
      const parsed: unknown = JSON.parse(text);
      const board = parseBoardDocument(parsed, boardId);
      return {
        boardId,
        fileName: path.basename(absolutePath),
        sizeBytes: stats.size,
        mtimeMs: stats.mtimeMs,
        board,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      if (error instanceof SyntaxError) {
        throw new StorageError("invalid-input", "白板檔不是有效的 JSON", {
          boardId,
          cause: error.message,
        });
      }
      throw asStorageError(error, "讀取白板檔失敗", boardId);
    } finally {
      if (fd !== null) closeSync(fd);
    }
  }

  /**
   * 原子寫入一份白板。
   *
   * 順序：同目錄暫存檔 → fsync → rename → 目錄 fsync。任何時刻磁碟上的
   * `<boardId>.json` 不是舊版就是新版。
   */
  write(board: BoardDocument, options: WriteBoardOptions = {}): BoardFileEntry {
    assertValidBoard({ board });
    const boardId = assertBoardId(board.id);
    if (options.expectedUpdatedAt !== undefined) {
      const current = this.read(boardId);
      if (current === undefined || current.board.updatedAt !== options.expectedUpdatedAt) {
        throw new StorageError("invalid-state-transition", "白板已被其他客戶端更新", {
          boardId,
          expectedUpdatedAt: options.expectedUpdatedAt,
          actualUpdatedAt: current?.board.updatedAt ?? null,
          reason: "conflict",
        });
      }
    }
    const target = this.absolutePath(boardId);
    const tempPath = path.join(this.directory, `.tmp-${boardId}.${randomBytes(4).toString("hex")}.tmp`);
    let fd: number | null = null;
    try {
      fd = openSync(tempPath, "wx", 0o644);
      writeAll(fd, Buffer.from(JSON.stringify(board), "utf8"));
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(tempPath, target);
    } catch (error) {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // 已關閉或失效；保留原始錯誤。
        }
      }
      rmSync(tempPath, { force: true });
      throw asStorageError(error, "白板檔寫入失敗", boardId);
    }
    syncDirectory(this.directory);
    this.#trace?.("boards:write");
    const stats = statSync(target);
    return {
      boardId,
      fileName: path.basename(target),
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  }

  /** 刪除白板；檔案不存在時回 false。不影響卡片。 */
  remove(boardId: string): boolean {
    const absolutePath = this.absolutePath(boardId);
    try {
      lstatSync(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw asStorageError(error, "檢查白板檔失敗", boardId);
    }
    try {
      rmSync(absolutePath, { force: true });
    } catch (error) {
      throw asStorageError(error, "刪除白板檔失敗", boardId);
    }
    syncDirectory(this.directory);
    this.#trace?.("boards:remove");
    return true;
  }

  /** 啟動掃描清暫存檔。 */
  cleanupTempFiles(olderThanMs: number = BOARD_TEMP_MAX_AGE_MS): string[] {
    const nowMs = this.#now().getTime();
    const removed: string[] = [];
    for (const name of this.#readDirectoryNames()) {
      if (!name.startsWith(".tmp-") || !name.toLowerCase().endsWith(".tmp")) continue;
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
    if (removed.length > 0) this.#trace?.("boards:cleanup-temp");
    return removed;
  }

  #readDirectoryNames(): string[] {
    try {
      return readdirSync(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw asStorageError(error, "列出白板資料夾失敗");
    }
  }
}

/** 是否符合白板檔名樣式。 */
export function isBoardFileName(name: string): boolean {
  return BOARD_FILE_NAME.test(name);
}

function assertBoardId(boardId: string): string {
  if (!isUlid(boardId)) {
    throw new StorageError("invalid-path", "白板 id 必須是 ULID", { boardId });
  }
  return boardId.toUpperCase();
}

/**
 * 檔案邊界的嚴格解析。JSON.parse 的結果是 unknown，先逐欄確認形狀，
 * 再由 assertValidBoard 檢查商業規則（重複投影、循環、不存在的物件）。
 */
function parseBoardDocument(value: unknown, boardId: string): BoardDocument {
  if (!isRecord(value)) throw invalidBoard(boardId, "白板檔必須是物件");
  if (value["schema"] !== 1) throw invalidBoard(boardId, "白板格式版本必須是 1");
  if (!isString(value["id"]) || value["id"] !== boardId) {
    throw invalidBoard(boardId, "白板檔的 id 與檔名不符");
  }
  if (!isString(value["title"])) throw invalidBoard(boardId, "白板標題必須是字串");
  if (!isString(value["createdAt"])) throw invalidBoard(boardId, "createdAt 必須是字串");
  if (!isString(value["updatedAt"])) throw invalidBoard(boardId, "updatedAt 必須是字串");

  const items = parseArray(value["items"], boardId, "items").map((raw, index) => {
    if (!isRecord(raw)) throw invalidBoard(boardId, `items[${index}] 必須是物件`);
    const position = parsePoint(raw["position"], boardId, `items[${index}].position`, "x", "y");
    const size = parsePoint(raw["size"], boardId, `items[${index}].size`, "width", "height");
    return {
      id: requiredString(raw["id"], boardId, `items[${index}].id`),
      cardId: requiredString(raw["cardId"], boardId, `items[${index}].cardId`),
      position: { x: position.first, y: position.second },
      size: { width: size.first, height: size.second },
      pinned: requiredBoolean(raw["pinned"], boardId, `items[${index}].pinned`),
      ...(optionalString(raw["groupId"], boardId, "groupId", `items[${index}].groupId`) ?? {}),
    };
  });
  const edges = parseArray(value["edges"], boardId, "edges").map((raw, index) => {
    if (!isRecord(raw)) throw invalidBoard(boardId, `edges[${index}] 必須是物件`);
    return {
      id: requiredString(raw["id"], boardId, `edges[${index}].id`),
      from: requiredString(raw["from"], boardId, `edges[${index}].from`),
      to: requiredString(raw["to"], boardId, `edges[${index}].to`),
      ...(optionalString(raw["label"], boardId, "label", `edges[${index}].label`) ?? {}),
    };
  });
  const groups = parseArray(value["groups"], boardId, "groups").map((raw, index) => {
    if (!isRecord(raw)) throw invalidBoard(boardId, `groups[${index}] 必須是物件`);
    return {
      id: requiredString(raw["id"], boardId, `groups[${index}].id`),
      label: requiredString(raw["label"], boardId, `groups[${index}].label`),
      ...(optionalString(raw["parentId"], boardId, "parentId", `groups[${index}].parentId`) ?? {}),
    };
  });

  const board: BoardDocument = {
    schema: 1,
    id: boardId,
    title: value["title"],
    createdAt: value["createdAt"],
    updatedAt: value["updatedAt"],
    items,
    edges,
    groups,
  };
  assertValidBoard({ board });
  return board;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function requiredString(value: unknown, boardId: string, field: string): string {
  if (!isString(value)) throw invalidBoard(boardId, `${field} 必須是字串`);
  return value;
}

function requiredBoolean(value: unknown, boardId: string, field: string): boolean {
  if (typeof value !== "boolean") throw invalidBoard(boardId, `${field} 必須是布林值`);
  return value;
}

function optionalString(
  value: unknown,
  boardId: string,
  key: string,
  field: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  return { [key]: requiredString(value, boardId, field) };
}

function parseArray(value: unknown, boardId: string, field: string): unknown[] {
  if (!Array.isArray(value)) throw invalidBoard(boardId, `${field} 必須是陣列`);
  return value;
}

function parsePoint(
  value: unknown,
  boardId: string,
  field: string,
  firstKey: string,
  secondKey: string,
): { first: number; second: number } {
  if (!isRecord(value)) throw invalidBoard(boardId, `${field} 必須是物件`);
  const first = value[firstKey];
  const second = value[secondKey];
  if (typeof first !== "number" || typeof second !== "number") {
    throw invalidBoard(boardId, `${field} 必須有數值 ${firstKey} 與 ${secondKey}`);
  }
  return { first, second };
}

function invalidBoard(boardId: string, message: string): StorageError {
  return new StorageError("invalid-input", `白板檔格式不正確：${message}`, { boardId });
}

function writeAll(fd: number, buffer: Buffer): void {
  let offset = 0;
  while (offset < buffer.length) {
    offset += writeSync(fd, buffer, offset, buffer.length - offset);
  }
}

function syncDirectory(directory: string): void {
  let fd: number | null = null;
  try {
    fd = openSync(directory, "r");
    fsyncSync(fd);
  } catch {
    // 有些檔案系統不支援目錄 fsync；資料本身已寫入，不因此失敗。
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

function asStorageError(error: unknown, message: string, boardId?: string): StorageError {
  if (error instanceof StorageError) return error;
  const cause = error instanceof Error ? error.message : String(error);
  return new StorageError("storage-failed", message, {
    ...(boardId === undefined ? {} : { boardId }),
    cause,
  });
}
