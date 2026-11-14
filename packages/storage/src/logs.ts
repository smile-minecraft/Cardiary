import {
  closeSync,
  constants,
  existsSync,
  openSync,
  readdirSync,
  statSync,
  writeSync,
} from "node:fs";
import path from "node:path";

import { StorageError } from "./errors.js";
import { removeFileSafely } from "./paths.js";
import type { FolderLayout } from "./paths.js";
import { nowIso } from "./util.js";

/** 日誌等級。 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** 允許寫進日誌的欄位；不在這裡的欄位一律拒絕。 */
const ALLOWED_FIELDS = new Set([
  "sessionId",
  "conversationId",
  "turnId",
  "approvalId",
  "toolName",
  "toolCallId",
  "requestId",
  "route",
  "code",
  "errorCode",
  "bytes",
  "durationMs",
  "count",
  "seq",
  "epoch",
  "stream",
  "pid",
  "version",
  "folderId",
  "reasonCode",
  "lifecycle",
  "phase",
  "ownerKind",
  "ownerId",
  "relPath",
  "kind",
  "action",
  "status",
  "table",
  "rows",
]);

const MAX_FIELD_STRING_LENGTH = 256;
const MAX_LINE_BYTES = 4096;

export type LogFieldValue = string | number | boolean | null;

export interface DiagnosticLoggerOptions {
  readonly now?: () => Date;
  readonly maxBytes?: number;
  readonly retainDays?: number;
}

/**
 * `logs/` 的結構化診斷。
 *
 * 只接受白名單欄位；沒有自由文字訊息參數，所以對話內容、工具輸入輸出、
 * 模型輸出與金鑰沒有寫入路徑。
 */
export class DiagnosticLogger {
  readonly #layout: FolderLayout;
  readonly #now: () => Date;
  readonly #maxBytes: number;
  readonly #retainDays: number;
  #skippedWrites = 0;

  constructor(layout: FolderLayout, options: DiagnosticLoggerOptions = {}) {
    this.#layout = layout;
    this.#now = options.now ?? (() => new Date());
    this.#maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
    this.#retainDays = options.retainDays ?? 7;
  }

  /** 寫一筆診斷；未知欄位或過長的字串會丟 `invalid-log-field`。 */
  log(level: LogLevel, event: string, fields: Readonly<Record<string, LogFieldValue>> = {}): void {
    if (!/^[a-z0-9_.-]+$/i.test(event)) {
      throw new StorageError("invalid-log-field", "事件名稱格式不合法", { event });
    }
    for (const [key, value] of Object.entries(fields)) {
      if (!ALLOWED_FIELDS.has(key)) {
        throw new StorageError("invalid-log-field", "日誌欄位不在白名單內", { field: key });
      }
      if (typeof value === "string") {
        if (value.length > MAX_FIELD_STRING_LENGTH) {
          throw new StorageError("invalid-log-field", "日誌欄位過長", { field: key });
        }
        if (/[\r\n\0]/.test(value)) {
          throw new StorageError("invalid-log-field", "日誌欄位不能含換行或 NUL", { field: key });
        }
      }
    }
    const entry = {
      at: nowIso(this.#now),
      level,
      event,
      ...fields,
    };
    const line = `${JSON.stringify(entry)}\n`;
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
      throw new StorageError("invalid-log-field", "日誌行過長");
    }
    this.writeLine(this.#filePath(), line);
  }

  /** 因為日誌檔不是一般檔案而跳過的寫入次數；測試與診斷使用。 */
  get skippedWrites(): number {
    return this.#skippedWrites;
  }

  /** 只記錄錯誤碼，不記錄原始訊息，避免把內容帶進日誌。 */
  error(
    event: string,
    errorCode: string,
    fields: Readonly<Record<string, LogFieldValue>> = {},
  ): void {
    this.log("error", event, { ...fields, errorCode });
  }

  /** 刪除超過保留天數的檔案；超過大小上限時由舊到新刪。 */
  rotate(): { readonly deletedFiles: number; readonly freedBytes: number } {
    const directory = this.#layout.subfolderPath("logs");
    if (!existsSync(directory)) {
      return { deletedFiles: 0, freedBytes: 0 };
    }
    const cutoff = this.#now().getTime() - this.#retainDays * 24 * 60 * 60 * 1000;
    const files = readdirSync(directory)
      .filter((name) => /^service-.*\.log$/.test(name))
      .map((name) => {
        const absolutePath = path.join(directory, name);
        const stats = statSync(absolutePath);
        return { absolutePath, size: stats.size, modifiedAtMs: stats.mtimeMs };
      })
      .sort((left, right) => left.modifiedAtMs - right.modifiedAtMs);

    let deletedFiles = 0;
    let freedBytes = 0;
    const remaining: typeof files = [];
    for (const file of files) {
      if (file.modifiedAtMs < cutoff) {
        removeFileSafely(this.#layout, file.absolutePath, ["logs"]);
        deletedFiles += 1;
        freedBytes += file.size;
      } else {
        remaining.push(file);
      }
    }
    let total = remaining.reduce((sum, file) => sum + file.size, 0);
    for (const file of remaining) {
      if (total <= this.#maxBytes) {
        break;
      }
      removeFileSafely(this.#layout, file.absolutePath, ["logs"]);
      total -= file.size;
      deletedFiles += 1;
      freedBytes += file.size;
    }
    return { deletedFiles, freedBytes };
  }

  /** 目前日誌檔的絕對路徑；同一天共用一個檔。 */
  currentFile(): string {
    return this.#filePath();
  }

  /**
   * 用 `O_NOFOLLOW` 開檔並追加；日誌檔是符號連結時不跟隨，記錄後跳過。
   *
   * 這是唯一寫日誌的位置；`rotate()` 只刪 `service-*.log`，也走安全刪除。
   */
  private writeLine(filePath: string, line: string): void {
    let fd: number | null = null;
    try {
      fd = openSync(
        filePath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
        0o600,
      );
      writeSync(fd, line, null, "utf8");
    } catch {
      this.#skippedWrites += 1;
      if (this.#skippedWrites === 1) {
        process.stderr.write(
          "cardiary: log file is not a regular file; diagnostic write skipped\n",
        );
      }
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // 已關閉或寫入失敗；不影響呼叫端。
        }
      }
    }
  }

  #filePath(): string {
    const date = nowIso(this.#now).slice(0, 10);
    return this.#layout.absolute(`logs/service-${date}.log`);
  }
}
