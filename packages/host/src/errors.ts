import type { EngineErrorCode, ToolDiagnostic, ToolDiagnosticCode } from "@cardiary/engine-adapter";
import type { ErrorCode, JSONObject } from "@cardiary/protocol";

/** 協定錯誤信封的內容，不含 `v` 與 `kind`。 */
export interface ProtocolErrorInfo {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: JSONObject;
  readonly retryable: boolean;
}

const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "not_authenticated",
  "busy",
  "rate_limited",
  "unavailable",
  "internal",
  "cancelled",
]);

/** HTTP 狀態碼只是傳輸層對應；錯誤內容仍是同一個信封。 */
export function httpStatusFor(code: ErrorCode): number {
  switch (code) {
    case "auth_invalid":
    case "auth_expired":
    case "not_authenticated":
      return 401;
    case "incompatible_version":
      return 426;
    case "invalid_message":
      return 400;
    case "payload_too_large":
      return 413;
    case "not_found":
      return 404;
    case "conflict":
    case "busy":
    case "cancelled":
      return 409;
    case "permission_denied":
      return 403;
    case "rate_limited":
      return 429;
    case "unavailable":
      return 503;
    case "unsupported":
      return 400;
    case "internal":
      return 500;
  }
}

export function protocolError(
  code: ErrorCode,
  message: string,
  options?: { readonly details?: JSONObject; readonly retryable?: boolean },
): ProtocolErrorInfo {
  return {
    code,
    message,
    retryable: options?.retryable ?? RETRYABLE.has(code),
    ...(options?.details === undefined ? {} : { details: options.details }),
  };
}

/** 轉接層錯誤碼對照；客戶端只認協定碼，原始碼只放在 details 供診斷。 */
export function protocolErrorFromEngine(code: EngineErrorCode, message: string): ProtocolErrorInfo {
  switch (code) {
    case "conversation-not-found":
    case "turn-not-found":
    case "approval-not-found":
    case "subagent-not-found":
      return protocolError("not_found", message, { details: { engineCode: code } });
    case "conversation-busy":
      return protocolError("busy", message);
    case "subagent-limit-reached":
      return protocolError("busy", message, { details: { reason: "subagent_limit" } });
    case "engine-paused":
      return protocolError("unavailable", message, {
        details: { reason: "engine_paused", engineCode: code },
      });
    case "engine-closed":
      return protocolError("unavailable", message, {
        details: { reason: "engine_closed", engineCode: code },
      });
    case "model-unavailable":
      return protocolError("unavailable", message, { details: { engineCode: code } });
    case "storage-unavailable":
      return protocolError("unavailable", message, { details: { reason: "storage" } });
    case "approval-expired":
      return protocolError("conflict", message, { details: { reason: "approval_expired" } });
    case "approval-already-decided":
      return protocolError("conflict", message, { details: { engineCode: code } });
    case "tool-not-registered":
      return protocolError("unsupported", message, {
        details: { reason: "tool_unavailable" },
      });
    case "context-injection-unsupported":
      return protocolError("unsupported", message, {
        details: { reason: "next_turn_injection" },
      });
    case "subagent-depth-exceeded":
    case "invalid-cursor":
    case "invalid-request":
      return protocolError("invalid_message", message, { details: { engineCode: code } });
    case "internal":
      return protocolError("internal", message);
  }
}

/** 工具診斷碼對照；客戶端只認協定診斷碼。 */
export function protocolDiagnostic(diagnostic: ToolDiagnostic): { code: string; message?: string } {
  const code = mapDiagnosticCode(diagnostic.code);
  return diagnostic.message === undefined ? { code } : { code, message: diagnostic.message };
}

function mapDiagnosticCode(code: ToolDiagnosticCode): string {
  switch (code) {
    case "interrupted":
      return "interrupted";
    case "paused":
      return "interrupted";
    case "cancelled":
      return "interrupted";
    case "timed-out":
      return "timeout";
    case "output-truncated":
      return "truncated";
    case "permission-denied":
      return "denied";
    case "approval-denied":
      return "denied";
    case "approval-expired":
      return "approval_expired";
    case "tool-unavailable":
      return "tool_unavailable";
  }
}

/** 儲存層停止寫入時回報的錯誤（Memory 替身與 SQLite 實作共用這個 code）。 */
export function isStorageFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "storage-unavailable"
  );
}

/** 控制面的錯誤碼；不進客戶端協定。 */
export type ControlErrorCode =
  | "unauthorized"
  | "unsupported_route"
  | "invalid_message"
  | "busy"
  | "unavailable"
  | "timeout"
  | "internal";

export class ControlError extends Error {
  readonly code: ControlErrorCode;

  constructor(code: ControlErrorCode, message: string) {
    super(message);
    this.name = "ControlError";
    this.code = code;
  }
}
