import type { ErrorCode } from "@cardiary/protocol";

/** 多模態模組的錯誤；HTTP 與工具都轉成協定看得懂的碼。 */
export class MediaError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: ErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "MediaError";
    this.code = code;
    this.details = details;
  }
}

/** 把任意例外轉成 MediaError；未知例外一律 internal，不把細節送出去。 */
export function asMediaError(error: unknown, message = "多模態操作失敗。"): MediaError {
  if (error instanceof MediaError) return error;
  return new MediaError("internal", message);
}
