import type { JsonValue } from "./json.js";

/** 轉接層對外回報的錯誤種類。 */
export type EngineErrorCode =
  | "conversation-not-found"
  | "conversation-busy"
  | "turn-not-found"
  | "engine-paused"
  | "engine-closed"
  | "approval-not-found"
  | "approval-expired"
  | "approval-already-decided"
  | "tool-not-registered"
  | "model-unavailable"
  | "storage-unavailable"
  | "subagent-limit-reached"
  | "subagent-depth-exceeded"
  | "subagent-not-found"
  | "context-injection-unsupported"
  | "invalid-cursor"
  | "invalid-request"
  | "internal";

/**
 * 轉接層方法拒絕時拋出的錯誤形狀。
 *
 * 實作可以建立自己的錯誤類別，但必須帶 `code`，呼叫端只依賴 `code`
 * 判斷處理方式，不解析訊息文字。
 */
export interface EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly details?: JsonValue;
}

/** 可序列化的錯誤資訊；事件與恢復結果用這個形狀。 */
export interface EngineErrorInfo {
  readonly code: EngineErrorCode;
  readonly message: string;
  readonly details?: JsonValue;
}
