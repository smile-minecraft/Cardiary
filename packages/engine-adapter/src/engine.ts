import type { ApprovalLedger, ApprovalService } from "./approval.js";
import type {
  CancelTurnRequest,
  ConversationSummary,
  ConversationUpdate,
  CreateConversationRequest,
  ForkConversationRequest,
  MessageReceipt,
  RestoreConversationResult,
  SendMessageRequest,
} from "./conversation.js";
import type { EngineEnvironment } from "./environment.js";
import type { EngineSubscription, SubscribeOptions } from "./events.js";
import type { ConversationId, IsoInstant, TurnId } from "./ids.js";
import type { ModelSettings, ProviderCredentialSource } from "./model.js";
import type { ToolPermissionGate } from "./permission.js";
import type { Clock, EngineLogger, Unsubscribe } from "./runtime.js";
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
  readonly pendingApprovals: number;
  readonly environment: {
    readonly stateDir: string;
    readonly tempDir: string;
  };
}

/** 引擎本身的身分；更換引擎時由新的實作回報。 */
export interface EngineDescriptor {
  readonly name: string;
  readonly version: string;
  readonly storageBackend: string;
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
   * 分岔支線的生命週期由 Cardiary 管理；呼叫端要先刪支線再刪主線。
   */
  deleteConversation(conversationId: ConversationId): Promise<void>;

  /**
   * 從指定位置分岔出新對話。
   *
   * 支線只包含分岔點之前的內容，並有自己的對話識別碼與模型；
   * 生命週期（封存、刪除）由呼叫端負責。
   */
  forkConversation(request: ForkConversationRequest): Promise<ConversationSummary>;

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
