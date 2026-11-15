import type { ErrorCode } from "@cardiary/protocol";

/**
 * 匯入模組的錯誤；協定處理器把它轉成錯誤信封。
 *
 * `details` 只放識別碼與計數，不放來源內容、路徑以外的敏感資訊。
 */
export class ImportError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: ErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "ImportError";
    this.code = code;
    this.details = details;
  }
}

/** 沒有指定時間範圍就想匯入對話。 */
export function rangeRequired(): ImportError {
  return new ImportError("invalid_message", "匯入對話要先指定時間範圍。", {
    reason: "range_required",
  });
}

/** 工作狀態不允許這個操作（例如已完成的匯入再寫一次）。 */
export function jobNotWritable(jobId: string, status: string): ImportError {
  return new ImportError("conflict", "這筆匯入不是預覽狀態，不能寫入。", {
    reason: "job_not_writable",
    jobId,
    status,
  });
}
