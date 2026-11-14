/** 儲存層的錯誤碼；呼叫端只依這些代碼決定行為。 */
export type StorageErrorCode =
  | "invalid-path"
  | "invalid-folder-root"
  | "path-outside-root"
  | "protected-path"
  | "folder-unavailable"
  | "folder-mismatch"
  | "already-running"
  | "not-initialized"
  | "application-id-mismatch"
  | "storage-version-newer"
  | "migration-failed"
  | "migration-checksum-mismatch"
  | "storage-failed"
  | "invalid-event-kind"
  | "runtime-state-missing"
  | "approval-not-found"
  | "busy"
  | "invalid-log-field"
  | "invalid-state-transition"
  | "not-found";

/** 儲存層統一的錯誤型別；`code` 是穩定的機器可讀值。 */
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: StorageErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.details = details;
  }
}

/** 判斷錯誤是否為 SQLite 的忙碌或鎖定。 */
export function isBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const errcode = (error as Error & { errcode?: number }).errcode;
  return (
    errcode === 5 ||
    errcode === 6 ||
    /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(error.message)
  );
}

/** 把未知錯誤轉成儲存層錯誤；已是儲存層錯誤時原樣回傳。 */
export function asStorageError(error: unknown, fallbackCode: StorageErrorCode): StorageError {
  if (error instanceof StorageError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new StorageError(fallbackCode, message, {
    cause: error instanceof Error ? error.name : typeof error,
  });
}

/** 這些錯誤代表儲存已失效，之後不得再寫入，也不重開同一個資料庫。 */
export function isFatalStorageError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const errcode = (error as Error & { errcode?: number }).errcode;
  if (errcode === 8 || errcode === 10 || errcode === 11) {
    return true;
  }
  return /SQLITE_IOERR|SQLITE_CORRUPT|SQLITE_READONLY|EIO|EROFS|disk I\/O error|database disk image is malformed/i.test(
    error.message,
  );
}
