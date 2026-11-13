import type { ApprovalAction, ApprovalRisk } from "./approval.js";
import type { ConversationId, ToolCallId, ToolName, TurnId } from "./ids.js";
import type { JsonValue } from "./json.js";
import type { ReplaySafety } from "./tools.js";

/** 三態權限模式；子代理繼承主線當下的模式，不能自己提高。 */
export type PermissionMode = "hard-rules" | "system-one-review" | "allow-all";

/** 工具執行前送給權限閘道的請求。 */
export interface ToolPermissionRequest {
  readonly conversationId: ConversationId;
  readonly turnId: TurnId;
  readonly toolCallId: ToolCallId;
  readonly toolName: ToolName;
  readonly input: JsonValue;
  readonly replay: ReplaySafety;
  /** 這場對話（含子代理）目前的權限模式。 */
  readonly permissionMode: PermissionMode;
}

/**
 * 權限判斷的結果。
 *
 * - `allow` 只能來自硬規則的白名單；M0 不使用。
 * - `deny` 只能來自硬規則；模型不能推翻，工具不會執行。
 * - `ask-human` 建立審批請求並等待；M0 對所有工具都回這個值。
 */
export type ToolPermissionVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "deny"; readonly reason: string }
  | {
      readonly kind: "ask-human";
      readonly action: ApprovalAction;
      readonly risk: ApprovalRisk;
      readonly timeoutMs?: number;
    };

/**
 * 工具執行前的權限掛點。
 *
 * 轉接層必須先呼叫這個介面，再決定是否執行工具；模型輸出不能繞過。
 * 判斷順序固定是硬規則、再依模式交給 System One 或人；M0 只實作
 * 「一律詢問」，但掛點與順序不變。
 */
export interface ToolPermissionGate {
  evaluate(request: ToolPermissionRequest): Promise<ToolPermissionVerdict>;
}
