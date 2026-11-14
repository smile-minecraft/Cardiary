import type { EngineError, EngineErrorCode } from "@cardiary/engine-adapter";
import type { JsonValue } from "@cardiary/engine-adapter";

/** 假引擎回報的錯誤；呼叫端只依賴 `code`。 */
export class EngineFailure extends Error implements EngineError {
  readonly code: EngineErrorCode;
  readonly details?: JsonValue;

  constructor(code: EngineErrorCode, message: string, details?: JsonValue) {
    super(message);
    this.name = "EngineFailure";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
