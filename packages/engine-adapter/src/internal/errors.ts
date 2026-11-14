import type { EngineError, EngineErrorCode } from "../errors.js";
import type { JsonValue } from "../json.js";

/** 轉接層實際拋出的錯誤；呼叫端只依賴 `code`。 */
export class EngineAdapterFailure extends Error implements EngineError {
  readonly code: EngineErrorCode;
  readonly details?: JsonValue;

  constructor(code: EngineErrorCode, message: string, details?: JsonValue) {
    super(message);
    this.name = "EngineAdapterFailure";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

/** 建立轉接層錯誤。 */
export function engineError(
  code: EngineErrorCode,
  message: string,
  details?: JsonValue,
): EngineAdapterFailure {
  return new EngineAdapterFailure(code, message, details);
}

/** 把任意例外轉成帶 `code` 的錯誤；未知錯誤一律 `internal`。 */
export function asEngineError(error: unknown): EngineAdapterFailure {
  if (error instanceof EngineAdapterFailure) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new EngineAdapterFailure("internal", message);
}
