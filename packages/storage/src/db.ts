import { existsSync, lstatSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { StorageError, asStorageError, isBusyError, isFatalStorageError } from "./errors.js";
import { retrySync } from "./util.js";

export interface RunResult {
  readonly changes: number;
  readonly lastInsertRowid: number;
}

/** 交易內可用的最小介面；儲存層的寫入方法都接受它，避免自己開交易。 */
export interface Queryable {
  run(sql: string, ...params: readonly unknown[]): RunResult;
  get<T>(sql: string, ...params: readonly unknown[]): T | undefined;
  all<T>(sql: string, ...params: readonly unknown[]): T[];
  exec(sql: string): void;
}

export interface DatabaseCreateSettings {
  readonly applicationId: number;
  readonly pageSize?: number;
  readonly autoVacuum?: "incremental";
}

export interface DatabaseOpenOptions {
  /** 檔案不存在時自動建立並寫入 header；已存在時只驗證，不覆寫。 */
  readonly create?: DatabaseCreateSettings;
  /** 不建立檔案時要驗證的 application_id。 */
  readonly expectedApplicationId?: number;
  readonly busyTimeoutMs?: number;
  /** 預設 true；所有 Cardiary 與引擎連線都必須開啟。 */
  readonly secureDelete?: boolean;
  /** 測試用來觀察 checkpoint／close 的順序。 */
  readonly trace?: (operation: string) => void;
  /** 資料庫讀寫失效時通知呼叫端（儲存層用它標記 storage-failed）。 */
  readonly onFailure?: (error: unknown, filePath: string) => void;
}

const DEFAULT_PAGE_SIZE = 4096;
const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/**
 * 包住 `node:sqlite` 的同步資料庫連線。
 *
 * 每次開啟都重設 `journal_mode`、`secure_delete`、`busy_timeout` 與
 * `foreign_keys`；header（page_size、auto_vacuum、application_id）只在建立時設定。
 */
export class Database implements Queryable {
  readonly filePath: string;
  readonly #options: DatabaseOpenOptions;
  #db: DatabaseSync | null;
  #txDepth = 0;
  #failure: string | null = null;

  private constructor(filePath: string, options: DatabaseOpenOptions) {
    this.filePath = filePath;
    this.#options = options;
    this.#db = null;
  }

  static open(filePath: string, options: DatabaseOpenOptions = {}): Database {
    assertNoSymlinkDatabaseFiles(filePath);
    const database = new Database(filePath, options);
    if (!existsSync(filePath)) {
      if (options.create === undefined) {
        throw new StorageError("not-found", `資料庫檔不存在：${filePath}`, { filePath });
      }
      createDatabaseFile(filePath, options.create);
    }
    database.#db = database.openRaw();
    database.applyConnectionSettings(options);
    database.verifyApplicationId();
    database.ensureIncrementalAutoVacuum();
    return database;
  }

  private openRaw(): DatabaseSync {
    const timeout = this.#options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    return new DatabaseSync(this.filePath, { timeout });
  }

  private applyConnectionSettings(options: DatabaseOpenOptions): void {
    const db = this.requireDb();
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`);
    db.exec("PRAGMA foreign_keys = ON");
    if (options.secureDelete !== false) {
      db.exec("PRAGMA secure_delete = ON");
      const value = Number(this.pragma("secure_delete"));
      if (value !== 1) {
        throw new StorageError("storage-failed", "無法啟用 secure_delete", { value });
      }
    }
  }

  private verifyApplicationId(): void {
    const expected = this.#options.create?.applicationId ?? this.#options.expectedApplicationId;
    if (expected === undefined) {
      return;
    }
    const actual = Number(this.pragma("application_id"));
    if (actual !== expected) {
      this.closeQuietly();
      throw new StorageError("application-id-mismatch", "資料庫的身分不符", {
        expected,
        actual,
        filePath: this.filePath,
      });
    }
  }

  private ensureIncrementalAutoVacuum(): void {
    if (this.#options.create?.autoVacuum !== "incremental") {
      return;
    }
    const mode = Number(this.pragma("auto_vacuum"));
    if (mode === 2) {
      return;
    }
    // 舊檔不是 INCREMENTAL 時，用一次完整 VACUUM 修正；之後 incremental_vacuum 才有效。
    this.exec("VACUUM");
    this.trace("auto_vacuum:fixed");
  }

  /** 資料庫是否已關閉。 */
  get isClosed(): boolean {
    return this.#db === null;
  }

  /** 資料庫是否已標成 storage-failed；之後的讀寫都直接失敗。 */
  get failed(): boolean {
    return this.#failure !== null;
  }

  /** 是否在交易內。 */
  get inTransaction(): boolean {
    return this.#txDepth > 0;
  }

  /** 重開同一個檔案的連線；連線設定會重新套用。 */
  reopen(): void {
    if (this.#failure !== null) {
      throw new StorageError("storage-failed", "資料庫已失效，不重開", {
        filePath: this.filePath,
        reason: this.#failure,
      });
    }
    this.closeQuietly();
    this.#db = this.openRaw();
    this.applyConnectionSettings(this.#options);
    this.verifyApplicationId();
    this.trace("reopen");
  }

  run(sql: string, ...params: readonly unknown[]): RunResult {
    this.assertHealthy();
    try {
      const result = this.requireDb()
        .prepare(sql)
        .run(...(params as never[]));
      return {
        changes: Number(result.changes),
        lastInsertRowid: Number(result.lastInsertRowid),
      };
    } catch (error) {
      this.noteFailure(error);
      throw error;
    }
  }

  get<T>(sql: string, ...params: readonly unknown[]): T | undefined {
    this.assertHealthy();
    try {
      return this.requireDb()
        .prepare(sql)
        .get(...(params as never[])) as T | undefined;
    } catch (error) {
      this.noteFailure(error);
      throw error;
    }
  }

  all<T>(sql: string, ...params: readonly unknown[]): T[] {
    this.assertHealthy();
    try {
      return this.requireDb()
        .prepare(sql)
        .all(...(params as never[])) as T[];
    } catch (error) {
      this.noteFailure(error);
      throw error;
    }
  }

  exec(sql: string): void {
    this.assertHealthy();
    try {
      this.requireDb().exec(sql);
    } catch (error) {
      this.noteFailure(error);
      throw error;
    }
  }

  /** 標記資料庫失效；由真實錯誤或測試注入呼叫。 */
  markFailed(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (this.#failure !== null) {
      return;
    }
    this.#failure = message;
    this.#options.onFailure?.(error, this.filePath);
  }

  /** 測試注入：模擬一次儲存失效。 */
  failForTests(error: Error): void {
    this.markFailed(error);
  }

  /** 讀取單一 PRAGMA 的值；找不到欄位時回 undefined。 */
  pragma(name: string): unknown {
    const row = this.requireDb().prepare(`PRAGMA ${name}`).get() as
      Record<string, unknown> | undefined;
    if (row === undefined) {
      return undefined;
    }
    return Object.values(row)[0];
  }

  /** 讀取整列 PRAGMA 結果；需要多個欄位時使用。 */
  pragmaRow(name: string): Record<string, unknown> | undefined {
    return this.requireDb().prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
  }

  /** 在 `BEGIN IMMEDIATE` 交易內執行；巢狀呼叫直接沿用外層交易。 */
  transaction<T>(action: (tx: Queryable) => T): T {
    if (this.#txDepth > 0) {
      return action(this);
    }
    this.exec("BEGIN IMMEDIATE");
    this.#txDepth = 1;
    this.trace("begin");
    try {
      const result = action(this);
      this.exec("COMMIT");
      this.trace("commit");
      return result;
    } catch (error) {
      try {
        this.exec("ROLLBACK");
      } catch {
        // 交易已因錯誤結束時，ROLLBACK 也會失敗；保留原始錯誤。
      }
      throw error;
    } finally {
      this.#txDepth = 0;
    }
  }

  /** 交易遇到 SQLITE_BUSY 時，先讓 `busy_timeout` 等待，之後再重試。 */
  transactionWithBusyRetry<T>(action: (tx: Queryable) => T): T {
    return retrySync(() => this.transaction(action), isBusyError, [10, 20, 40]);
  }

  /** `wal_checkpoint(TRUNCATE)`；把 WAL 內容落回主檔並清空 WAL。 */
  checkpoint(): void {
    this.requireDb().exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.trace("checkpoint");
  }

  /** 回收 free pages；只有 `auto_vacuum = INCREMENTAL` 時有效。 */
  incrementalVacuum(): void {
    this.requireDb().exec("PRAGMA incremental_vacuum");
    this.trace("incremental_vacuum");
  }

  /** 完整 VACUUM；重寫整個檔案，只在每日維護使用。 */
  vacuum(): void {
    if (this.inTransaction) {
      throw new StorageError("storage-failed", "VACUUM 不能在交易內執行");
    }
    this.exec("VACUUM");
    this.trace("vacuum");
  }

  /** `PRAGMA integrity_check`；回傳第一個欄位（正常是 `ok`）。 */
  integrityCheck(): string {
    return String(this.pragma("integrity_check"));
  }

  /** 資料庫主檔目前的大小；WAL 不算在內。 */
  fileSize(): number {
    if (!existsSync(this.filePath)) {
      return 0;
    }
    return statSync(this.filePath).size;
  }

  tableExists(table: string): boolean {
    const row = this.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      table,
    );
    return row !== undefined;
  }

  countRows(table: string): number {
    const row = this.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
    return Number(row?.n ?? 0);
  }

  close(): void {
    if (this.#db === null) {
      return;
    }
    this.#db.close();
    this.#db = null;
    this.trace("close");
  }

  private closeQuietly(): void {
    try {
      this.#db?.close();
    } catch {
      // 已經關閉或連線失效時不需要再處理。
    }
    this.#db = null;
  }

  private assertHealthy(): void {
    if (this.#failure !== null) {
      throw new StorageError("storage-failed", "資料庫已標成 storage-failed", {
        filePath: this.filePath,
        reason: this.#failure,
      });
    }
  }

  private noteFailure(error: unknown): void {
    if (isFatalStorageError(error)) {
      this.markFailed(error);
    }
  }

  private requireDb(): DatabaseSync {
    if (this.#db === null) {
      throw new StorageError("storage-failed", "資料庫已關閉", { filePath: this.filePath });
    }
    return this.#db;
  }

  /** 送出一筆測試用的操作紀錄；正式程式不依賴它。 */
  trace(operation: string): void {
    this.#options.trace?.(operation);
  }
}

/**
 * 建立空資料庫並寫入 header；呼叫端必須先確認上層資料夾存在。
 *
 * 失敗時只刪除這次剛建立的檔案（呼叫端已確認呼叫前不存在）；不碰任何既有檔案。
 */
function createDatabaseFile(filePath: string, settings: DatabaseCreateSettings): void {
  assertNoSymlinkDatabaseFiles(filePath);
  const db = new DatabaseSync(filePath);
  try {
    db.exec(`PRAGMA page_size = ${settings.pageSize ?? DEFAULT_PAGE_SIZE}`);
    db.exec(
      `PRAGMA auto_vacuum = ${settings.autoVacuum === "incremental" ? "INCREMENTAL" : "NONE"}`,
    );
    db.exec(`PRAGMA application_id = ${settings.applicationId}`);
    db.exec("VACUUM");
  } catch (error) {
    db.close();
    // 只刪這次剛建立的檔；`Database.open` 只在檔案不存在時呼叫這個函式。
    rmSync(filePath, { force: true });
    throw asStorageError(error, "storage-failed");
  }
  db.close();
}

function assertNoSymlinkDatabaseFiles(filePath: string): void {
  for (const target of [filePath, `${filePath}-wal`, `${filePath}-shm`]) {
    try {
      if (lstatSync(target).isSymbolicLink()) {
        throw new StorageError("protected-path", "資料庫檔或側車檔是符號連結", { target });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
}
