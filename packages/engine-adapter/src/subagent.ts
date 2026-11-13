import type { EngineErrorInfo } from "./errors.js";
import type { ConversationCursor, ConversationId, IsoInstant } from "./ids.js";
import type { ModelSelection } from "./model.js";

/**
 * 子代理的深度。
 *
 * 主對話是 0，子代理是 1。子代理不能再開子代理，所以型別沒有 2；
 * 轉接層仍要在執行時拒絕大於上限的值，避免繞過型別。
 */
export type SubagentDepth = 0 | 1;

/** 等待子代理的方式。 */
export type SubagentWaiting =
  /** 同步工具呼叫：主線等這一輪，可以同時等多個。 */
  | "blocking"
  /** 背景：立即取得 handle，完成後把結果卡附加到主線。 */
  | "background";

/** 子代理的執行狀態。 */
export type SubagentStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";

/**
 * 子代理的上限。
 *
 * 產品規則：同一個主對話最多 4 個同時進行，深度最多 1。
 * 轉接層依這組數字拒絕超額的請求；型別的 `SubagentDepth` 只有 0 與 1。
 */
export interface SubagentLimits {
  /** 同一個主對話同時進行的子代理上限；產品固定 4。 */
  readonly maxConcurrentPerParent: 4;
  /** 深度上限；子代理不能再開子代理。 */
  readonly maxDepth: 1;
  /** 結果卡最多使用的 token 數；超過時由子代理端截斷。 */
  readonly resultTokenBudget: number;
}

/** 子代理的分岔來源；審批與對話摘要都用它標明出處。 */
export interface SubagentOrigin {
  readonly parentConversationId: ConversationId;
  readonly rootConversationId: ConversationId;
  readonly depth: SubagentDepth;
  readonly forkedAt: ConversationCursor;
}

/** 結果卡中的一項依據。 */
export interface SubagentEvidence {
  /** 子代理的結論或主張。 */
  readonly statement: string;
  /** 支持這個主張的證據；引用檔案、卡片或支線位置。 */
  readonly support: string;
}

/** 結果卡引用的位置；使用者可以展開回支線查證。 */
export interface SubagentReference {
  readonly kind: "branch-entry" | "card" | "file" | "url";
  readonly label: string;
  readonly conversationId?: ConversationId;
  readonly cursor?: ConversationCursor;
  readonly cardId?: string;
  readonly path?: string;
  readonly url?: string;
}

/**
 * 子代理的結果卡。
 *
 * 這是**一張卡片**，不是新的訊息型別。同步模式由主機把它包成
 * `ToolContent` 的 `card` 內容，當成工具結果回傳；背景模式由主機走既有的
 * 卡片管線建立、用協定卡片事件顯示，再附加到主線。
 * 預設只存在對話內，不自動進卡片庫；要保留時由主代理或使用者存成正式卡片（M1）。
 */
export interface SubagentResultCard {
  readonly cardKind: "subagent-summary";
  /** 正式卡片建立後的識別碼；對話內的結果卡可以是 `null`。 */
  readonly cardId: string | null;
  /** 卡片歸屬；預設 `conversation`，使用者或主代理保存後才是 `library`。 */
  readonly scope: "conversation" | "library";
  readonly title: string;
  readonly conclusion: string;
  readonly evidence: readonly SubagentEvidence[];
  readonly references: readonly SubagentReference[];
  readonly unresolved: readonly string[];
  readonly tokenEstimate: number;
  readonly branchConversationId: ConversationId;
  readonly createdAt: IsoInstant;
}

/** 子代理的 handle；背景模式立即回傳，同步模式完成後才回傳。 */
export interface SubagentHandle {
  readonly subagentConversationId: ConversationId;
  readonly parentConversationId: ConversationId;
  readonly rootConversationId: ConversationId;
  readonly depth: SubagentDepth;
  readonly status: SubagentStatus;
  readonly startedAt: IsoInstant;
  readonly resultCard: SubagentResultCard | null;
}

/**
 * 開始一個子代理。
 *
 * 上下文、工具組與權限模式都從 `parentConversationId` 當下的分岔點繼承；
 * 呼叫端不能另外指定，避免子代理繞過主線的限制。模型可以另外選，
 * 供自動路由用在子代理上。
 *
 * `depth` 由呼叫端申報並由轉接層驗證：必須是父對話深度加 1，且不得
 * 超過 `SubagentLimits.maxDepth`。
 */
export interface SpawnSubagentRequest {
  readonly parentConversationId: ConversationId;
  readonly at: ConversationCursor;
  readonly depth: SubagentDepth;
  readonly waiting: SubagentWaiting;
  readonly instruction: string;
  readonly title?: string;
  readonly model?: ModelSelection;
}

/** 子代理結束後的結果。 */
export interface SubagentOutcome {
  readonly handle: SubagentHandle;
  readonly status: Exclude<SubagentStatus, "running">;
  readonly resultCard: SubagentResultCard | null;
  readonly failure: EngineErrorInfo | null;
}

/**
 * 下一個模型請求前的上下文注入。
 *
 * 只用來把背景子代理的結果卡放進主線上下文：不建立回合、不新增訊息型別。
 * 同步模式不需要這個；工具結果已經是那張卡。
 */
export interface NextTurnInjectionRequest {
  readonly conversationId: ConversationId;
  readonly source: "subagent-result-card" | "host";
  /** 已渲染的卡片內容，由卡片管線產生；轉接層不拆解格式。 */
  readonly text: string;
  /** 這次注入引用的卡片；主機的卡片管線已建立。 */
  readonly cardIds: readonly string[];
}

/** 注入的結果；不支援時呼叫端把卡片留到使用者下一則訊息再帶入。 */
export type NextTurnInjectionOutcome = "queued" | "unsupported";

/** 注入收據。 */
export interface NextTurnInjectionReceipt {
  readonly injectionId: string;
  readonly outcome: NextTurnInjectionOutcome;
}
