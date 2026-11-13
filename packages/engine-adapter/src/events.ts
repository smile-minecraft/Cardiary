import type { ApprovalRequest, ApprovalResolution } from "./approval.js";
import type {
  ConversationMessage,
  CompletedTurnStatus,
  ConversationSummary,
  TurnTrigger,
} from "./conversation.js";
import type { EngineErrorInfo } from "./errors.js";
import type {
  ConversationId,
  EventSeq,
  IsoInstant,
  MessageId,
  ToolCallId,
  ToolName,
  TurnId,
} from "./ids.js";
import type { JsonValue } from "./json.js";
import type { SubagentHandle, SubagentOutcome } from "./subagent.js";
import type { ToolOutcome, ToolProgress } from "./tools.js";

/**
 * 對話事件。
 *
 * `seq` 由轉接層簽發：同一場對話嚴格遞增，批次提交也會展開成逐筆事件。
 * 客戶端只認這個序號；引擎內部的提交序號不對外暴露。
 */
export interface EngineEventBase {
  readonly seq: EventSeq;
  readonly at: IsoInstant;
  readonly conversationId: ConversationId;
}

export interface TurnStartedEvent extends EngineEventBase {
  readonly kind: "turn.started";
  readonly turnId: TurnId;
  readonly trigger: TurnTrigger;
}

export interface AssistantTextDeltaEvent extends EngineEventBase {
  readonly kind: "assistant.text.delta";
  readonly turnId: TurnId;
  readonly messageId: MessageId;
  readonly text: string;
}

export interface MessageAppendedEvent extends EngineEventBase {
  readonly kind: "message.appended";
  readonly turnId: TurnId | null;
  readonly message: ConversationMessage;
}

export interface ToolStartedEvent extends EngineEventBase {
  readonly kind: "tool.started";
  readonly turnId: TurnId;
  readonly callId: ToolCallId;
  readonly toolName: ToolName;
  readonly input: JsonValue;
}

export interface ToolProgressEvent extends EngineEventBase {
  readonly kind: "tool.progress";
  readonly turnId: TurnId;
  readonly callId: ToolCallId;
  readonly toolName: ToolName;
  readonly progress: ToolProgress;
}

export interface ToolFinishedEvent extends EngineEventBase {
  readonly kind: "tool.finished";
  readonly turnId: TurnId;
  readonly callId: ToolCallId;
  readonly toolName: ToolName;
  readonly outcome: ToolOutcome;
}

export interface ApprovalRequestedEvent extends EngineEventBase {
  readonly kind: "approval.requested";
  readonly request: ApprovalRequest;
}

export interface ApprovalResolvedEvent extends EngineEventBase {
  readonly kind: "approval.resolved";
  readonly resolution: ApprovalResolution;
}

export interface TurnCompletedEvent extends EngineEventBase {
  readonly kind: "turn.completed";
  readonly turnId: TurnId;
  readonly status: CompletedTurnStatus;
  readonly failure: EngineErrorInfo | null;
}

export interface ConversationCompactedEvent extends EngineEventBase {
  readonly kind: "conversation.compacted";
  readonly turnId: TurnId | null;
  /** 這次壓縮是否套用了預告的變更（模組新版本或重建的固定前綴）。 */
  readonly appliedUpdate: boolean;
  readonly beforeTokens: number | null;
  readonly afterTokens: number | null;
}

export interface ConversationBranchCreatedEvent extends EngineEventBase {
  readonly kind: "conversation.branch-created";
  readonly branch: ConversationSummary;
}

export interface ConversationDeletedEvent extends EngineEventBase {
  readonly kind: "conversation.deleted";
}

/** 子代理開始；事件掛在主線的串流上，`conversationId` 是主線。 */
export interface SubagentStartedEvent extends EngineEventBase {
  readonly kind: "subagent.started";
  readonly handle: SubagentHandle;
}

/** 子代理結束；事件掛在主線的串流上。 */
export interface SubagentCompletedEvent extends EngineEventBase {
  readonly kind: "subagent.completed";
  readonly outcome: SubagentOutcome;
}

/** 一場對話的事件聯集。 */
export type EngineEvent =
  | TurnStartedEvent
  | AssistantTextDeltaEvent
  | MessageAppendedEvent
  | ToolStartedEvent
  | ToolProgressEvent
  | ToolFinishedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | TurnCompletedEvent
  | ConversationCompactedEvent
  | ConversationBranchCreatedEvent
  | ConversationDeletedEvent
  | SubagentStartedEvent
  | SubagentCompletedEvent;

/** 訂閱選項。 */
export interface SubscribeOptions {
  readonly conversationId: ConversationId;
  /** 從這個序號之後開始送；省略時只送新事件。 */
  readonly afterSeq?: EventSeq;
}

/**
 * 補送狀態。
 *
 * `gap` 為 true 表示要求的序號早於轉接層保留的範圍，呼叫端要改用
 * 自己的事件紀錄或快照重建畫面，不能假設補送是完整的。
 */
export interface SubscriptionReplay {
  readonly requestedAfter: EventSeq | null;
  readonly firstSeq: EventSeq | null;
  readonly gap: boolean;
}

/** 事件訂閱；關閉後非同步迭代結束。 */
export interface EngineSubscription {
  readonly conversationId: ConversationId;
  readonly replay: SubscriptionReplay;
  readonly events: AsyncIterable<EngineEvent>;
  close(): void;
}
