import type { ActorRef, ApprovalRequest } from "./approval.js";
import type { ConversationCursor, ConversationId, IsoInstant, MessageId, TurnId } from "./ids.js";
import type { ModelSelection } from "./model.js";
import type { ToolBundlePin, ToolDiagnostic } from "./tools.js";

/** 送進對話的內容區塊；卡片由領域層先展開成這些區塊。 */
export type ContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly assetId: string; readonly mediaType: string }
  | { readonly type: "audio"; readonly assetId: string; readonly mediaType: string };

/** 訊息在對話中的角色。 */
export type ConversationRole = "user" | "assistant" | "system" | "tool";

/** 已提交到對話的一則訊息。 */
export interface ConversationMessage {
  readonly id: MessageId;
  readonly role: ConversationRole;
  readonly content: readonly ContentBlock[];
  readonly createdAt: IsoInstant;
  /** 訊息的位置；可作為分岔點。 */
  readonly cursor: ConversationCursor;
}

/** 對話的用途；子代理與背景任務可以選不同模型。 */
export type ConversationPurpose = "conversation" | "checkpoint-subagent" | "background-task";

/** 對話的建立來源；只有分岔出來的對話才有值。 */
export interface ConversationOrigin {
  readonly kind: "fork";
  readonly parentConversationId: ConversationId;
  readonly at: ConversationCursor;
}

/** 對話的即時狀態。 */
export type ConversationState = "idle" | "running" | "paused" | "failed";

/** 對話摘要；建立、恢復與分岔都回傳這個形狀。 */
export interface ConversationSummary {
  readonly id: ConversationId;
  readonly title: string;
  readonly purpose: ConversationPurpose;
  readonly model: ModelSelection;
  readonly state: ConversationState;
  readonly origin: ConversationOrigin | null;
  readonly toolBundles: readonly ToolBundlePin[];
  readonly createdAt: IsoInstant;
  readonly updatedAt: IsoInstant;
  readonly latestCursor: ConversationCursor | null;
}

/**
 * 建立對話。
 *
 * `systemContext` 是領域核心組好的固定前綴；轉接層不拆解內容。
 * `toolBundles` 是釘選的工具組版本，之後重載模組不會改動這場對話。
 */
export interface CreateConversationRequest {
  readonly title?: string;
  readonly purpose?: ConversationPurpose;
  readonly model: ModelSelection;
  readonly systemContext: string;
  readonly toolBundles: readonly ToolBundlePin[];
  /** 同一個請求重送時不建立第二場對話；由呼叫端提供。 */
  readonly clientRequestId?: string;
}

/** 一輪回應的觸發來源。 */
export type TurnTrigger = "user-message" | "resume" | "schedule" | "background-task";

/** 一輪回應的狀態。 */
export type TurnStatus =
  "running" | "completed" | "cancelled" | "paused" | "failed" | "interrupted";

/** 一輪回應已結束時的可能狀態。 */
export type CompletedTurnStatus = Exclude<TurnStatus, "running">;

/** 送訊息時對話正在忙的處理方式。 */
export type MessageDelivery =
  /** 排到目前這一輪之後；空閒時立刻開始。 */
  | "queue"
  /** 插話：下一個模型請求前送進對話，不中斷正在串流的輸出。 */
  | "steer"
  /** 忙碌時直接拒絕。 */
  | "reject";

/** 送出訊息。 */
export interface SendMessageRequest {
  readonly conversationId: ConversationId;
  readonly content: readonly ContentBlock[];
  readonly delivery: MessageDelivery;
  readonly sender: ActorRef;
}

/** 送訊息被接受的方式。 */
export type AcceptedDelivery = "started" | "queued" | "steered";

/** 送訊息後的收據；後續進度由事件流提供。 */
export interface MessageReceipt {
  readonly messageId: MessageId;
  readonly turnId: TurnId | null;
  readonly delivery: AcceptedDelivery;
}

/** 取消一輪回應；省略 `turnId` 時取消目前進行中的那一輪。 */
export interface CancelTurnRequest {
  readonly conversationId: ConversationId;
  readonly turnId?: TurnId;
  readonly reason: string;
}

/** 從既有對話分岔。 */
export interface ForkConversationRequest {
  readonly conversationId: ConversationId;
  readonly at: ConversationCursor;
  readonly purpose: "checkpoint-subagent" | "user-fork";
  readonly title?: string;
  /** 子代理可以換模型；省略時沿用來源對話的模型。 */
  readonly model?: ModelSelection;
  /** 省略時沿用來源對話釘選的工具組。 */
  readonly toolBundles?: readonly ToolBundlePin[];
}

/**
 * 對進行中的對話預告變更；下一次壓縮時才套用。
 *
 * 用來落實「新版模組對新對話立即生效，進行中的對話在壓縮時才換」。
 * 轉接層套用後在 `conversation.compacted` 事件標記 `appliedUpdate`。
 */
export interface ConversationUpdate {
  readonly reason: "module-reload" | "context-refresh" | "manual";
  readonly systemContext?: string;
  readonly toolBundles?: readonly ToolBundlePin[];
}

/** 恢復對話時，引擎回報的進行中工作。 */
export interface TurnRecovery {
  readonly turnId: TurnId;
  readonly outcome: "completed" | "resumed" | "interrupted" | "failed";
  readonly diagnostics: readonly ToolDiagnostic[];
}

/** 恢復對話的結果。 */
export interface RestoreConversationResult {
  readonly conversation: ConversationSummary;
  readonly recoveredTurns: readonly TurnRecovery[];
  readonly pendingApprovals: readonly ApprovalRequest[];
}
