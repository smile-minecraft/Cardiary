/**
 * 白板驗證的錯誤型別。
 *
 * 呼叫端把 reason 轉成協定的 invalid_message／conflict／permission_denied；
 * 領域層只用 reason 區分原因，不認識協定。
 */

export type BoardErrorReason =
  | "invalid_id"
  | "invalid_schema_version"
  | "invalid_point"
  | "invalid_edge"
  | "duplicate_projection"
  | "unknown_item"
  | "unknown_card"
  | "unknown_group"
  | "group_cycle"
  | "conflict"
  | "permission_denied";

export class BoardDomainError extends Error {
  readonly reason: BoardErrorReason;

  constructor(reason: BoardErrorReason, message: string) {
    super(message);
    this.name = "BoardDomainError";
    this.reason = reason;
  }
}
