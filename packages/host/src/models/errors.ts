import type { ModelFailureReason } from "@cardiary/engine-adapter";

/**
 * 模型設定不合法；模組把它轉成協定的 `invalid_message` 與 `details.field`。
 */
export class ModelSettingsError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "ModelSettingsError";
    this.field = field;
  }
}

/**
 * 背景模型呼叫失敗；原因與可否重試要能傳到呼叫端，但不含供應商原文。
 *
 * 原因與引擎轉接層的分類一致（`credential_missing`、`quota_exceeded` 等），
 * 另外加上「模型輸出上限不足」這個主機自己判斷的情況。
 */
export type ModelInvocationReason = ModelFailureReason | "output_limit_exceeded" | "unsupported";

export class ModelInvocationError extends Error {
  readonly reason: ModelInvocationReason;
  readonly retryable: boolean;
  /** 供應商要求的等待時間；有 `Retry-After` 時才有值。 */
  readonly retryAfterMs?: number;

  constructor(
    reason: ModelInvocationReason,
    message: string,
    retryable = false,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ModelInvocationError";
    this.reason = reason;
    this.retryable = retryable;
    if (retryAfterMs !== undefined) {
      this.retryAfterMs = retryAfterMs;
    }
  }
}
