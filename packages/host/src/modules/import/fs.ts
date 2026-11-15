import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * 來源轉接器唯一的檔案入口。
 *
 * 轉接器不直接 import `node:fs`：所有讀取都經過這個介面，測試才能用記錄版
 * 驗證「機密檔沒有被開過」（工作驗收條件）。實作只提供讀取；沒有寫入、
 * 改名或刪除的方法，來源在設計上就不可能被改到。
 */
export interface SourceFileSystem {
  /** 檔案或目錄；不存在回 `missing`，不丟錯。 */
  stat(path: string): Promise<SourceStat>;
  /** 列出目錄項目；不存在或不是目錄時丟 `SourceAccessError`。 */
  list(path: string): Promise<readonly SourceEntry[]>;
  /**
   * 讀文字檔。超過 `maxBytes` 時只回前段並標記 `truncated`；
   * 二進位檔由呼叫端以 `isBinary` 判斷後跳過。
   */
  readText(path: string, options?: { readonly maxBytes?: number }): Promise<SourceTextFile>;
  /** 解析符號連結後的路徑；用來確認讀取目標沒有跳出允許的目錄。 */
  realPath(path: string): Promise<string>;
}

export interface SourceStat {
  readonly kind: "file" | "directory" | "missing";
  readonly sizeBytes?: number;
  /** RFC 3339；毫秒精度。 */
  readonly modifiedAt?: string;
}

export interface SourceEntry {
  readonly name: string;
  readonly kind: "file" | "directory" | "symlink" | "other";
}

export interface SourceTextFile {
  readonly text: string;
  readonly truncated: boolean;
  readonly sizeBytes: number;
}

/** 讀取失敗；轉接器把它變成跳過清單的一項，不讓整次匯入失敗。 */
export class SourceAccessError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(message);
    this.name = "SourceAccessError";
    this.path = path;
  }
}

/** 預設的檔案大小上限；超過的檔案不是匯入內容（例如日誌或資料庫）。 */
export const DEFAULT_MAX_TEXT_BYTES = 4 * 1024 * 1024;

/** 產品用的檔案介面。 */
export const nodeSourceFileSystem: SourceFileSystem = {
  async stat(path) {
    try {
      const stats = await stat(path);
      return {
        kind: stats.isDirectory() ? "directory" : "file",
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString(),
      };
    } catch {
      return { kind: "missing" };
    }
  },
  async list(path) {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isFile()
          ? "file"
          : entry.isDirectory()
            ? "directory"
            : entry.isSymbolicLink()
              ? "symlink"
              : "other",
      }));
    } catch (error) {
      throw new SourceAccessError(path, describe(error));
    }
  },
  async readText(path, options = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_TEXT_BYTES;
    try {
      const stats = await stat(path);
      if (!stats.isFile()) {
        throw new SourceAccessError(path, "不是一般檔案");
      }
      const bytes = await readFile(path);
      const slice = bytes.subarray(0, maxBytes);
      return {
        text: new TextDecoder("utf-8", { fatal: false }).decode(slice),
        truncated: bytes.byteLength > maxBytes,
        sizeBytes: bytes.byteLength,
      };
    } catch (error) {
      throw new SourceAccessError(path, describe(error));
    }
  },
  async realPath(path) {
    try {
      return await realpath(path);
    } catch {
      return path;
    }
  },
};

/**
 * 唯讀 SQLite 的窄介面。
 *
 * 轉接器只拿到 `get`／`all`／`close`；沒有 `run` 與 `exec`，所以不可能對
 * 來源資料庫寫入。產品實作用 `node:sqlite` 的 `readOnly: true`。
 */
export interface ReadonlyQuery {
  all<T>(sql: string, ...params: readonly unknown[]): T[];
  get<T>(sql: string, ...params: readonly unknown[]): T | undefined;
  close(): void;
}

export type ReadonlyDatabaseOpener = (path: string) => ReadonlyQuery;

/** SQLite 的 `readOnly` 開啟；Alma 正在執行時也能讀，不會寫入。 */
export const nodeReadonlyDatabase: ReadonlyDatabaseOpener = (path) => {
  const database = new DatabaseSync(path, { readOnly: true });
  return {
    all<T>(sql: string, ...params: readonly unknown[]): T[] {
      return database.prepare(sql).all(...(params as SQLInputValue[])) as T[];
    },
    get<T>(sql: string, ...params: readonly unknown[]): T | undefined {
      return database.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined;
    },
    close() {
      database.close();
    },
  };
};

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
