import type { ApprovalLedger, ApprovalService } from "./approval.js";
import type {
  CancelTurnRequest,
  ConversationHistoryPage,
  ConversationSummary,
  ConversationUpdate,
  CreateConversationRequest,
  DeleteConversationOptions,
  ForkConversationRequest,
  MessageReceipt,
  ReadConversationHistoryRequest,
  RestoreConversationResult,
  SendMessageRequest,
} from "./conversation.js";
import type { EngineEnvironment } from "./environment.js";
import type { EngineSubscription, SubscribeOptions } from "./events.js";
import type { ConversationId, IsoInstant, TurnId } from "./ids.js";
import type { ModelSettings, ProviderCredentialSource } from "./model.js";
import type { ToolPermissionGate } from "./permission.js";
import type { Clock, EngineLogger, Unsubscribe } from "./runtime.js";
import type {
  NextTurnInjectionReceipt,
  NextTurnInjectionRequest,
  SpawnSubagentRequest,
  SubagentHandle,
  SubagentLimits,
  SubagentOutcome,
} from "./subagent.js";
import type { ToolRegistry } from "./tools.js";

/** 引擎的執行狀態。 */
export type EngineState =
  "starting" | "running" | "paused" | "storage-unavailable" | "failed" | "stopped";

/** 緊急暫停的進行中的一輪。 */
export interface PausedTurn {
  readonly conversationId: ConversationId;
  readonly turnId: TurnId;
}

/** 「緊急全部暫停」的狀態；恢復前所有新工作都送不進去。 */
export interface EmergencyPause {
  readonly pauseId: string;
  readonly reason: string;
  readonly startedAt: IsoInstant;
  readonly pausedTurns: readonly PausedTurn[];
}

/** 引擎狀態快照；給狀態列與健康檢查使用。 */
export interface EngineStatus {
  readonly state: EngineState;
  readonly pause: EmergencyPause | null;
  readonly activeConversations: number;
  readonly activeSubagents: number;
  readonly pendingApprovals: number;
  readonly environment: {
    readonly stateDir: string;
    readonly tempDir: string;
  };
}

/**
 * 引擎的能力旗標。
 *
 * 子代理的同步模式已由 `fork(entryId)` 驗證；背景模式的結果卡要送進
 * 主線上下文，1.5.2 沒有現成的注入 API。這裡明確標出目前支援到什麼程度，
 * 不把未驗證的行為當成已成立。
 */
export interface EngineCapabilities {
  /**
   * 能否在下一個模型請求前注入上下文而不啟動回合。
   * `native` 表示引擎直接支援；`pending` 是設計決定／待驗證；
   * `unsupported` 表示只能等使用者下一則訊息附帶。
   */
  readonly nextTurnContextInjection: "native" | "pending" | "unsupported";
}

/** 引擎本身的身分；更換引擎時由新的實作回報。 */
export interface EngineDescriptor {
  readonly name: string;
  readonly version: string;
  readonly storageBackend: string;
  readonly capabilities: EngineCapabilities;
}

/** 建立轉接層的參數；由主機服務組裝。 */
export interface EngineAdapterOptions {
  readonly environment: EngineEnvironment;
  /** 審批的持久化；儲存層實作。 */
  readonly approvals: ApprovalLedger;
  /** 工具執行前的權限掛點；M0 對所有工具回 `ask-human`。 */
  readonly permissionGate: ToolPermissionGate;
  /** 金鑰來源；由殼提供，轉接層只在需要時取值。 */
  readonly credentials: ProviderCredentialSource;
  readonly logger: EngineLogger;
  /** 測試用時鐘；省略時用系統時間。 */
  readonly clock?: Clock;
  /** 事件補送緩衝的筆數上限；超過時回報 `gap`。 */
  readonly eventBufferSize?: number;
  /**
   * 子代理上限；省略時用產品預設值：同時 4 個、深度 1、結果卡 800 tokens。
   * 轉接層用這組數字拒絕超額請求；`maxConcurrentPerParent` 與 `maxDepth`
   * 的型別是固定值，不能放寬。
   */
  readonly subagentLimits?: SubagentLimits;
}

/**
 * 引擎轉接層；其他程式呼叫引擎的唯一入口。
 *
 * 公開型別只用領域用語，不引用特定引擎套件的型別。更換引擎時
 * 重寫這個介面的實作，呼叫端與資料格式不變。
 */
export interface EngineAdapter {
  /** 開啟引擎與儲存；重複呼叫回傳同一個結果。 */
  open(): Promise<EngineDescriptor>;
  /** 關閉引擎；進行中的工作會被中斷，恢復後由斷點續跑接上。 */
  close(): Promise<void>;
  getStatus(): EngineStatus;
  /** 狀態變化（暫停、儲存不可用、恢復）時通知。 */
  onStatusChange(listener: (status: EngineStatus) => void): Unsubscribe;

  /** 工具註冊表；模組主機透過它註冊與退役工具組。 */
  readonly tools: ToolRegistry;
  /** 審批服務；工具與主機共用。 */
  readonly approvals: ApprovalService;

  /** 讀取對話摘要；不存在時回傳 `null`。 */
  getConversation(conversationId: ConversationId): Promise<ConversationSummary | null>;

  /**
   * 建立對話並持久化。
   *
   * 建立後是 `idle`；要開始回應必須另外送訊息。
   */
  createConversation(request: CreateConversationRequest): Promise<ConversationSummary>;

  /**
   * 從引擎儲存恢復對話。
   *
   * 主機啟動時對每場進行中的對話呼叫一次；引擎會接回未完成的工作，
   * 回報每一輪是續跑、完成、還是被中斷。恢復前必須先註冊對話釘選的
   * 所有工具組版本，否則工具呼叫會得到 `tool-unavailable`。
   */
  restoreConversation(conversationId: ConversationId): Promise<RestoreConversationResult>;

  /**
   * 刪除對話與它的引擎資料。
   *
   * 支線生命週期跟著主線：預設連同所有子代理一起刪除；`includeBranches: false`
   * 只刪這一場。刪除子代理不能連帶刪別人的主線。
   */
  deleteConversation(
    conversationId: ConversationId,
    options?: DeleteConversationOptions,
  ): Promise<void>;

  /** 讀取對話歷史；展開支線查證時使用。 */
  readConversationHistory(
    request: ReadConversationHistoryRequest,
  ): Promise<ConversationHistoryPage>;

  /**
   * 從指定位置分岔出獨立對話（使用者操作）。
   *
   * 新對話列在會話列表、深度 0；不是子代理。子代理用 `spawnSubagent`。
   */
  forkConversation(request: ForkConversationRequest): Promise<ConversationSummary>;

  /**
   * 從主對話分岔出子代理。
   *
   * 子代理繼承分岔點當下的上下文、工具組與權限模式；呼叫端不能另外
   * 指定工具或權限。主線不受支線寫入影響。深度必須是父對話深度加 1，
   * 超過上限回 `subagent-depth-exceeded`；同一個主對話同時超過 4 個
   * 回 `subagent-limit-reached`。
   *
   * `waiting: "blocking"` 會等子代理完成才回傳，適合當工具呼叫，
   * 可同時等多個；結果卡就是工具結果。`waiting: "background"` 立即回傳
   * running 的 handle；完成後由主機建立結果卡並排進下一輪注入。
   */
  spawnSubagent(request: SpawnSubagentRequest): Promise<SubagentHandle>;

  /** 等待背景子代理結束；已結束時立刻回傳。 */
  waitForSubagent(
    subagentConversationId: ConversationId,
    options?: { readonly signal?: AbortSignal },
  ): Promise<SubagentOutcome>;

  /** 取消子代理；支線保留已產生的內容。 */
  cancelSubagent(subagentConversationId: ConversationId, reason: string): Promise<void>;

  /**
   * 把背景子代理的結果卡排進主線的下一個模型請求前。
   *
   * 結果卡本身由主機的卡片管線建立（協定用卡片事件、UI 顯示卡片）；
   * 這個方法只負責上下文注入，不建立回合、不新增訊息型別。主線閒置時
   * 也不得因此啟動模型。不支援時回 `unsupported`，呼叫端把卡片留到
   * 使用者下一則訊息再帶入。
   */
  queueNextTurnInjection(request: NextTurnInjectionRequest): Promise<NextTurnInjectionReceipt>;

  /** 列出某場對話的子代理（含已結束）；供介面展開查證，不用於會話列表。 */
  listSubagents(parentConversationId: ConversationId): Promise<readonly SubagentHandle[]>;

  /**
   * 預告對話的固定前綴與工具組變更；下一次壓縮時才套用。
   *
   * 新對話不受影響，會直接使用最新版本。
   */
  stageConversationUpdate(
    conversationId: ConversationId,
    update: ConversationUpdate,
  ): Promise<void>;

  /**
   * 送入使用者訊息。
   *
   * `delivery: "steer"` 在回應進行中有效，訊息在下一個模型請求前送達；
   * 不會中斷正在串流的輸出。`delivery: "reject"` 在忙碌時回傳
   * `conversation-busy` 錯誤。
   */
  sendMessage(request: SendMessageRequest): Promise<MessageReceipt>;

  /** 取消一輪回應；已產生的內容保留在對話中。 */
  cancelTurn(request: CancelTurnRequest): Promise<void>;

  /**
   * 訂閱對話事件；回傳的序號由轉接層簽發，支援從指定序號補送。
   */
  subscribe(options: SubscribeOptions): EngineSubscription;

  /** 設定模型供應商與角色；只影響之後建立的對話。 */
  configureModels(settings: ModelSettings): Promise<void>;
  getModelSettings(): Promise<ModelSettings>;

  /**
   * 緊急全部暫停：停止所有進行中的回應與工具，拒絕新工作。
   *
   * 待審批的請求保持原狀；恢復後可繼續處理。
   */
  pauseAll(reason: string): Promise<EmergencyPause>;
  /** 解除緊急暫停；被中斷的回合由呼叫端決定是否續跑。 */
  resumeAll(): Promise<void>;
}
