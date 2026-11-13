import type { ConversationId, JsonValue } from "@cardiary/engine-adapter";

/** 卡片變更的種類。 */
export type CardChangeKind = "created" | "updated" | "deleted" | "archived" | "refreshed";

/** 外部程式代理的狀態。 */
export type ExternalAgentStatus =
  "starting" | "running" | "waiting-approval" | "completed" | "failed";

/**
 * 模組想送給客戶端的協定事件。
 *
 * 主機的協定閘道會再轉成正式訊息並驗證 schema；`module-event` 是
 * 協定 schema 定案前的暫時出口，之後要收斂成明確的型別。
 */
export type ProtocolEventIntent =
  | {
      readonly kind: "notification";
      readonly title: string;
      readonly body: string;
      readonly level?: "info" | "warning" | "error";
      readonly conversationId?: ConversationId;
    }
  | { readonly kind: "conversation-updated"; readonly conversationId: ConversationId }
  | {
      readonly kind: "card-changed";
      readonly cardId: string;
      readonly change: CardChangeKind;
    }
  | { readonly kind: "board-changed"; readonly boardId: string; readonly payload: JsonValue }
  | {
      readonly kind: "external-agent-status";
      readonly agentId: string;
      readonly status: ExternalAgentStatus;
      readonly message?: string;
    }
  | { readonly kind: "module-event"; readonly type: string; readonly payload: JsonValue };

/** 模組送出協定事件的介面；主機負責驗證與廣播。 */
export interface ProtocolEventEmitter {
  emit(intent: ProtocolEventIntent): void;
}
