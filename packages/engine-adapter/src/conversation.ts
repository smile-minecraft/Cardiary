import type { ActorRef, ApprovalRequest } from "./approval.js";
import type { ConversationCursor, ConversationId, IsoInstant, MessageId, TurnId } from "./ids.js";
import type { ModelSelection } from "./model.js";
import type { PermissionMode } from "./permission.js";
import type { SubagentDepth } from "./subagent.js";
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
export type ConversationPurpose = "conversation" | "subagent" | "background-task";

/** 對話在會話列表中的可見性；支線不獨立列出。 */
export type ConversationVisibility = "listed" | "branch";

/** 對話的建立來源；只有分岔出來的對話才有值。 */
export interface ConversationOrigin {
  readonly kind: "user-fork" | "subagent";
  readonly parentConversationId: ConversationId;
  readonly rootConversationId: ConversationId;
  readonly at: ConversationCursor;
  readonly depth: SubagentDepth;
}

/** 對話的即時狀態。 */
export type ConversationState = "idle" | "running" | "paused" | "failed";

/** 對話摘要；建立、恢復與分岔都回傳這個形狀。 */
export interface ConversationSummary {
  readonly id: ConversationId;
  readonly title: string;
  readonly purpose: ConversationPurpose;
  /** 根對話；主對話自己就是根，子代理指向主對話。 */
  readonly rootConversationId: ConversationId;
  readonly depth: SubagentDepth;
  readonly visibility: ConversationVisibility;
  readonly permissionMode: PermissionMode;
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
 * `permissionMode` 省略時用「硬規則＋人工確認」。
 */
export interface CreateConversationRequest {
  readonly title?: string;
  readonly purpose?: ConversationPurpose;
  readonly model: ModelSelection;
  readonly systemContext: string;
  readonly toolBundles: readonly ToolBundlePin[];
  readonly permissionMode?: PermissionMode;
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
  /**
   * 呼叫端提供的訊息識別碼；同一個值重送不會新增訊息，重啟後仍查得回來。
   * 對應引擎的 `SubmissionDraft.requestId`。
   */
  readonly clientMessageId?: string;
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

/**
 * 使用者從既有對話分岔。
 *
 * 這不是子代理：新對話是獨立的一場，列在會話列表，深度 0。
 * 工具組與權限模式沿用來源對話；子代理用 `spawnSubagent`，
 * 它同樣繼承工具與權限，但不獨立列出。
 */
export interface ForkConversationRequest {
  readonly conversationId: ConversationId;
  readonly at: ConversationCursor;
  readonly title?: string;
  /** 可以換模型；省略時沿用來源對話的模型。 */
  readonly model?: ModelSelection;
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
  /**
   * 觸發這一輪的使用者訊息 ID；`turnId` 由它推導（`turn_` 加訊息 ID）。
   * 來源依序是 `pi.live.run.first`、`run.inputs[0]` 的 submission entry、`turn_index`。
   */
  readonly triggerMessageId: MessageId;
  readonly outcome: "completed" | "resumed" | "interrupted" | "failed";
  readonly diagnostics: readonly ToolDiagnostic[];
}

/** 恢復對話的結果。 */
export interface RestoreConversationResult {
  readonly conversation: ConversationSummary;
  readonly recoveredTurns: readonly TurnRecovery[];
  readonly pendingApprovals: readonly ApprovalRequest[];
}

/** 刪除對話的選項。 */
export interface DeleteConversationOptions {
  /**
   * 支線生命週期跟著主線，因此刪除**一定**連同所有子代理支線。
   * 這個欄位只是保留給呼叫端表達意圖；`false` 會被拒絕（`invalid-request`），
   * 因為留下祖先被刪的支線會讓引擎的 Session 進入 `failed`。
   */
  readonly includeBranches?: boolean;
}

/** 讀取對話歷史；支線展開查證時使用。 */
export interface ReadConversationHistoryRequest {
  readonly conversationId: ConversationId;
  /** 從這個位置往前讀；省略時從最新一則開始。 */
  readonly before?: ConversationCursor;
  /** 最多回傳幾則；由主機限制上限。 */
  readonly limit?: number;
}

/** 一頁對話歷史。 */
export interface ConversationHistoryPage {
  readonly messages: readonly ConversationMessage[];
  readonly nextBefore: ConversationCursor | null;
}
