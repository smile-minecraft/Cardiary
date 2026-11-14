export type * from "./approval.js";
export type * from "./conversation.js";
export type * from "./engine.js";
export type * from "./environment.js";
export type * from "./errors.js";
export type * from "./events.js";
export type * from "./ids.js";
export type * from "./json.js";
export type * from "./model.js";
export type * from "./permission.js";
export type * from "./runtime.js";
export type * from "./subagent.js";
export type * from "./tools.js";

export { createEngineAdapter } from "./internal/factory.js";
/**
 * 工具子行程的共用監督器。
 *
 * 轉接層用它啟動工具的子行程；測試用的引擎替身也用同一份實作，
 * 避免 process group 的處理邏輯出現兩份。正式的主機服務不直接使用它。
 */
export { ProcessSupervisor } from "./internal/spawn.js";
export { EngineAdapterFailure, engineError } from "./internal/errors.js";
export { canonicalJson, computeApprovalKey } from "./internal/canonical.js";
export { createInMemoryApprovalLedger } from "./testing/in-memory-approval-ledger.js";
