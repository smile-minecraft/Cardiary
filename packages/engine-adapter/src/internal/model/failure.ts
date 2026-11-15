import type { EngineErrorInfo } from "../../errors.js";
import { retryAfterMsFrom } from "./provider-response.js";

/**
 * 模型呼叫失敗的種類。
 *
 * 轉接層只從供應商回報的文字判斷；不把原文往外送，避免端點把請求內容
 * 或憑證片段回顯時跟著進事件、日誌或畫面。
 */
export type ModelFailureReason =
  | "credential_missing"
  | "credential_invalid"
  | "quota_exceeded"
  | "provider_timeout"
  | "connection_failed"
  | "model_not_configured"
  | "provider_error";

/** 一次模型失敗的分類結果；`message` 是給人看的中文說明。 */
export interface ModelFailure {
  readonly reason: ModelFailureReason;
  readonly message: string;
  readonly retryable: boolean;
  /** 供應商要求的等待時間；只有回應帶 `Retry-After` 時才有值。 */
  readonly retryAfterMs?: number;
}

const MESSAGES: Readonly<Record<ModelFailureReason, string>> = {
  credential_missing: "模型憑證不存在或讀不到，請在設定頁重新輸入金鑰。",
  credential_invalid: "模型供應商拒絕了這組憑證，請在設定頁確認金鑰。",
  quota_exceeded: "模型額度不足或請求太密集，請稍後重試。",
  provider_timeout: "模型供應商逾時沒有回應，請稍後重試。",
  connection_failed: "連不上模型供應商，請確認網路或端點位址。",
  model_not_configured: "設定的模型不在供應商清單，請重新設定模型。",
  provider_error: "模型供應商回報錯誤，請稍後重試。",
};

const CREDENTIAL_MISSING = /credential_missing/;
const CREDENTIAL_INVALID =
  /\b(401|403)\b|invalid[ _-]?api[ _-]?key|incorrect api key|unauthorized|authentication|permission denied/i;
const QUOTA = /\b429\b|rate[ _-]?limit|quota|insufficient[ _-]?quota|billing|too many requests/i;
const TIMEOUT = /timed?[ _-]?out|timeout|etimedout|und_err_connect_timeout|deadline exceeded/i;
const CONNECTION =
  /econnrefused|econnreset|enotfound|eai_again|epipe|network error|connection error|fetch failed|socket hang up|other side closed/i;
const NOT_CONFIGURED =
  /no model is configured|model .* is not available|not configured|model_not_configured/i;
const SERVER_ERROR = /\b5\d\d\b/;

/**
 * 把供應商錯誤文字分類成固定種類。
 *
 * 只看錯誤訊息，不解析或保留原文；呼叫端拿到的 `message` 一律是固定
 * 中文句子，所以端點回顯的內容不會被轉傳出去。
 */
export function classifyModelFailure(detail: string | null | undefined): ModelFailure {
  const text = detail ?? "";
  const retryAfterMs = retryAfterMsFrom(text);
  const failure = (reason: ModelFailureReason, retryable: boolean): ModelFailure => ({
    reason,
    message: MESSAGES[reason],
    retryable,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });
  if (CREDENTIAL_MISSING.test(text)) {
    return failure("credential_missing", false);
  }
  if (QUOTA.test(text)) {
    return failure("quota_exceeded", true);
  }
  if (TIMEOUT.test(text)) {
    return failure("provider_timeout", true);
  }
  if (CONNECTION.test(text)) {
    return failure("connection_failed", true);
  }
  if (NOT_CONFIGURED.test(text)) {
    return failure("model_not_configured", false);
  }
  if (CREDENTIAL_INVALID.test(text)) {
    return failure("credential_invalid", false);
  }
  return failure("provider_error", SERVER_ERROR.test(text));
}

/**
 * 轉成引擎的失敗資訊；`code` 固定是 `model-unavailable`，原因放 `details`。
 *
 * 閘道會再把原因對照成協定的 `unavailable`／`rate_limited`。
 */
export function modelFailureInfo(failure: ModelFailure): EngineErrorInfo {
  return {
    code: "model-unavailable",
    message: failure.message,
    details: {
      reason: failure.reason,
      retryable: failure.retryable,
      ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
    },
  };
}
