import type {
  ApprovalRequestId,
  ConversationId,
  IsoInstant,
  ToolCallId,
  ToolName,
  TurnId,
} from "./ids.js";
import type { JsonValue } from "./json.js";
import type { Unsubscribe } from "./runtime.js";
import type { SubagentOrigin } from "./subagent.js";

/** 審批請求的生命週期狀態。 */
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "withdrawn";

/** 風險等級；M0 一律填 `unknown` 或由硬規則提供。 */
export type ApprovalRisk = "low" | "medium" | "high" | "unknown";

/** 需要審批的動作種類。 */
export type ApprovalActionKind =
  | "tool-execution"
  | "module-enable"
  | "schedule-create"
  | "settings-change"
  | "external-message"
  | "unknown";

/** 給人看的動作摘要；明細由主機組成，轉接層不自行推測。 */
export interface ApprovalDetail {
  readonly label: string;
  readonly value: string;
}

/** 審批請求描述的動作。 */
export interface ApprovalAction {
  readonly kind: ApprovalActionKind;
  readonly summary: string;
  readonly details?: readonly ApprovalDetail[];
  readonly toolName?: ToolName;
  readonly toolInput?: JsonValue;
}

/** 提出審批請求的一方。 */
export type ApprovalRequester =
  | { readonly kind: "tool"; readonly toolName: ToolName; readonly moduleId?: string }
  | { readonly kind: "module"; readonly moduleId: string }
  | { readonly kind: "agent"; readonly agentId: string }
  | { readonly kind: "host"; readonly component: string };

/** 建立審批請求的輸入。 */
export interface ApprovalRequestDraft {
  readonly conversationId?: ConversationId;
  readonly turnId?: TurnId;
  readonly toolCallId?: ToolCallId;
  readonly action: ApprovalAction;
  readonly risk: ApprovalRisk;
  readonly requestedBy: ApprovalRequester;
  /**
   * 來源子代理；主對話自己發出的請求省略。
   *
   * 有這個欄位時，客戶端要標明是哪一個支線在等待，背景子代理的審批
   * 也要送到同一個審批佇列。
   */
  readonly subagent?: SubagentOrigin;
  /** 逾時毫秒數；省略時由主機的預設值決定，`null` 表示不逾時。 */
  readonly timeoutMs?: number | null;
}

/** 已持久化的審批請求。 */
export interface ApprovalRequest {
  readonly id: ApprovalRequestId;
  readonly status: ApprovalStatus;
  readonly requestedAt: IsoInstant;
  readonly expiresAt: IsoInstant | null;
  readonly draft: ApprovalRequestDraft;
  /**
   * 決定性的去重鍵；同一個 `scope`、對話、回合、工具名稱與正規化輸入算出同一個值。
   * 重跑時用它找回同一筆請求與決定，不再詢問已回答的問題。
   */
  readonly approvalKey: string;
  /**
   * 已有的決定；`status` 是 `approved`／`denied` 時一定有值。
   * 從 ledger 讀回時由 `decision_json` 還原，重啟後仍看得到同一個決定。
   */
  readonly decision?: ApprovalDecision | null;
}

/**
 * `ApprovalLedger.record` 的結果。
 *
 * `created` 表示這次真的插入了一筆 `pending`；`existing` 表示接上既有的
 * `pending`；`decided` 表示同一個鍵已有 `approved`／`denied`，直接續跑。
 * 不得回傳已過期的 `pending` 當成 `existing`：ledger 要先把它標成 `expired`
 * 再插一列新的 `pending`。
 */
export type ApprovalRecordOutcome =
  | { readonly kind: "created"; readonly request: ApprovalRequest }
  | { readonly kind: "existing"; readonly request: ApprovalRequest }
  | { readonly kind: "decided"; readonly request: ApprovalRequest };

/**
 * 按下核准或拒絕的人。
 *
 * 型別只接受人類，讓「模型不能替自己核准」在編譯期就成立；
 * 代理或模組嘗試核准時，實作必須拒絕。
 */
export interface HumanActor {
  readonly kind: "human";
  readonly clientId: string;
  readonly deviceName?: string;
}

/** 對話訊息的來源或設定的變更者。 */
export type ActorRef =
  | HumanActor
  | { readonly kind: "agent"; readonly agentId: string }
  | { readonly kind: "system"; readonly component: string }
  | { readonly kind: "module"; readonly moduleId: string }
  | { readonly kind: "schedule"; readonly scheduleId: string };

/** 一個審批決定；同一請求只有第一個決定有效。 */
export interface ApprovalDecision {
  readonly requestId: ApprovalRequestId;
  readonly verdict: "approve" | "deny";
  readonly decidedAt: IsoInstant;
  readonly decidedBy: HumanActor;
  readonly note?: string;
}

/** 送出審批決定。 */
export interface DecideApprovalInput {
  readonly requestId: ApprovalRequestId;
  readonly verdict: "approve" | "deny";
  readonly decidedBy: HumanActor;
  readonly note?: string;
}

/**
 * 送出決定的結果。
 *
 * `already-decided` 會帶回先前的決定，讓同時操作的多個客戶端看到同一個結果；
 * 實作必須以原子操作保證先寫入者勝出。
 */
export type DecideApprovalResult =
  | { readonly outcome: "accepted"; readonly decision: ApprovalDecision }
  | { readonly outcome: "already-decided"; readonly decision: ApprovalDecision }
  | { readonly outcome: "expired"; readonly request: ApprovalRequest }
  | { readonly outcome: "withdrawn"; readonly request: ApprovalRequest }
  | { readonly outcome: "not-found" };

/** 等待審批的結果；逾時與撤回都不是例外，而是明確的結果。 */
export interface ApprovalResolution {
  readonly request: ApprovalRequest;
  readonly outcome: "approved" | "denied" | "expired" | "withdrawn";
  readonly decision: ApprovalDecision | null;
}

/** 等待選項；取消等待用訊號，不用另一個方法。 */
export interface ApprovalWaitOptions {
  readonly signal?: AbortSignal;
}

/** 列出待審批請求的篩選條件。 */
export interface ApprovalListFilter {
  readonly conversationId?: ConversationId;
  /** 包含這個主對話底下所有子代理的請求；用於同一個客戶端審批佇列。 */
  readonly rootConversationId?: ConversationId;
}

/** 審批的即時變化；主機用它把新請求推給所有客戶端。 */
export type ApprovalUpdate =
  | { readonly kind: "requested"; readonly request: ApprovalRequest }
  | { readonly kind: "resolved"; readonly resolution: ApprovalResolution };

/**
 * 審批的持久化介面；由儲存層實作。
 *
 * 審批決定必須先落地，再喚醒等待中的工作。行程重啟後，
 * 工具或任務重跑時先查這份紀錄，才不會重複詢問已決定的事。
 */
export interface ApprovalLedger {
  /**
   * 在同一個 `BEGIN IMMEDIATE` 交易裡先讀 `approvalKey` 的最新列，再決定是否插入。
   *
   * 已有 `pending`（且未過期）回 `existing`，已有 `approved`／`denied` 回 `decided`，
   * 沒有列或只有 `expired`／`withdrawn` 才插入新的 `pending` 並回 `created`。
   * 插入用 `INSERT ... ON CONFLICT DO NOTHING`，衝突時重讀最新列再判斷；
   * `pending` 的唯一性由 partial unique index 保證。`busy` 由 ledger 在交易外圍
   * 重試，重試用完才把錯誤往上報。
   */
  record(request: ApprovalRequest): Promise<ApprovalRecordOutcome>;
  update(request: ApprovalRequest): Promise<void>;
  get(requestId: ApprovalRequestId): Promise<ApprovalRequest | null>;
  /**
   * 用去重鍵找最新一列：`pending` 優先，沒有 `pending` 才取最新的一列。
   * 同毫秒時以 `rowid DESC` 當 tie-breaker；找不到回 `null`。
   */
  findByApprovalKey(approvalKey: string): Promise<ApprovalRequest | null>;
  listPending(filter?: ApprovalListFilter): Promise<readonly ApprovalRequest[]>;
  /**
   * 原子地寫入決定。
   *
   * 只有請求仍在 `pending` 時才寫入並回傳 `committed`；
   * 已有決定時回傳 `already-decided`，不得覆寫。
   */
  commitDecision(decision: ApprovalDecision): Promise<"committed" | "already-decided">;
}

/**
 * 審批服務；轉接層的一部分，供工具與主機使用。
 *
 * 等待中的 Promise 只存在於目前行程。跨重啟時由呼叫端（工具重跑或
 * 任務恢復）用同一份 ledger 重新等待，決定不會遺失。
 */
export interface ApprovalService {
  /** 建立並持久化請求；已有決定時直接回傳該請求。 */
  request(draft: ApprovalRequestDraft): Promise<ApprovalRequest>;
  get(requestId: ApprovalRequestId): Promise<ApprovalRequest | null>;
  listPending(filter?: ApprovalListFilter): Promise<readonly ApprovalRequest[]>;
  /**
   * 等待決定、逾時或撤回。
   *
   * 逾時時間以請求的 `expiresAt` 為準；時間到時把請求標成 `expired`，
   * 回傳 `outcome: "expired"`，不拋錯。
   */
  waitForDecision(
    requestId: ApprovalRequestId,
    options?: ApprovalWaitOptions,
  ): Promise<ApprovalResolution>;
  /** 寫入人類的決定並喚醒等待者；重複呼叫回傳先前的決定。 */
  decide(input: DecideApprovalInput): Promise<DecideApprovalResult>;
  /** 撤回尚未決定的請求，例如工具已被取消。 */
  withdraw(requestId: ApprovalRequestId, reason: string): Promise<ApprovalResolution>;
  /**
   * 訂閱審批變化。
   *
   * 背景子代理的請求用 `{ rootConversationId }` 篩選，送到與主線相同的
   * 客戶端佇列；客戶端不需要另外訂閱支線。
   */
  subscribe(listener: (update: ApprovalUpdate) => void, filter?: ApprovalListFilter): Unsubscribe;
}
