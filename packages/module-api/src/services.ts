import type {
  Clock,
  ContentBlock,
  ConversationId,
  JsonValue,
  ModelRole,
  ToolBundlePin,
} from "@cardiary/engine-adapter";
import type { ProtocolEventEmitter } from "./protocol.js";
import type { ModuleSettingsReader } from "./settings.js";

/** 背景模型呼叫；用於蒸餾、摘要、分類等不進主對話的工作。 */
export interface ModelInvocationRequest {
  readonly role: ModelRole;
  /** 用途標籤，用於日誌與用量統計，例如「記憶蒸餾」。 */
  readonly purpose: string;
  readonly prompt: string;
  readonly attachments?: readonly ContentBlock[];
  readonly conversationId?: ConversationId;
  /**
   * 這次呼叫的輸出上限。
   *
   * 摘要需要比一般回覆更大的額度（實測 1,024 會失敗、4,096 才完成）；
   * 省略時用模型或角色的預設值。
   */
  readonly maxOutputTokens?: number;
}

/** 背景模型呼叫的結果。 */
export interface ModelInvocationResult {
  readonly text: string;
}

/** 模型呼叫的介面；主機負責選擇實際模型與處理金鑰。 */
export interface ModelInvoker {
  invoke(
    request: ModelInvocationRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ModelInvocationResult>;
}

/** 鑰匙圈憑證的參照；模組只拿到參照，不直接取得內容。 */
export type SecretRef = string;

/**
 * 使用憑證的介面；回呼結束後不得保留內容。
 *
 * 用於 MCP 伺服器或外部代理需要的權杖。憑證不得寫入日誌、模組資料或
 * 模型上下文；主機負責審計使用紀錄。
 */
export interface SecretAccess {
  withSecret<T>(ref: SecretRef, use: (secret: string) => Promise<T>): Promise<T>;
}

/**
 * 背景任務；需要工具或多輪推理時使用。
 *
 * 主機用轉接層建立一場 `background-task` 對話、送出提示、等它結束，
 * 再把結果摘要交回。排程與 Heartbeat 靠這個介面執行動作，
 * 不需要自己接觸引擎。
 */
export interface BackgroundTaskRequest {
  readonly title: string;
  /** 用途標籤，用於日誌與用量統計。 */
  readonly purpose: string;
  readonly modelRole: ModelRole;
  /** 這場背景任務的固定前綴；由呼叫端組好。 */
  readonly systemContext: string;
  readonly prompt: string;
  /** 要給背景任務使用的工具組；省略時用主機的預設組合。 */
  readonly toolBundles?: readonly ToolBundlePin[];
  /** 來源對話；用於血緣與通知連結。 */
  readonly relatedConversationId?: ConversationId;
}

/** 背景任務的結果。 */
export interface BackgroundTaskOutcome {
  readonly conversationId: ConversationId;
  readonly status: "completed" | "failed" | "cancelled" | "interrupted";
  readonly summary: string | null;
}

/** 執行背景任務的介面。 */
export interface BackgroundTaskRunner {
  run(
    request: BackgroundTaskRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<BackgroundTaskOutcome>;
}

/** 模組日誌；輸出位置與格式由主機決定。 */
export interface ModuleLogger {
  debug(message: string, fields?: { readonly [key: string]: JsonValue }): void;
  info(message: string, fields?: { readonly [key: string]: JsonValue }): void;
  warn(message: string, fields?: { readonly [key: string]: JsonValue }): void;
  error(message: string, fields?: { readonly [key: string]: JsonValue }): void;
}

/**
 * 模組可用的資料夾。
 *
 * `dataDir` 是正本，停用或解除安裝都不刪除；`cacheDir` 可重建；
 * `tempDir` 在啟動時清空。模組不得寫到這三個位置以外。
 */
export interface ModuleStorageAreas {
  readonly dataDir: string;
  readonly cacheDir: string;
  readonly tempDir: string;
}

/** Cardiary 資料夾的根目錄與九個分區路徑；只給需要跨區作業的維護類模組。 */
export interface CardiaryPaths {
  readonly root: string;
  readonly cards: string;
  readonly assets: string;
  readonly boards: string;
  readonly skills: string;
  readonly state: string;
  readonly modules: string;
  readonly cache: string;
  readonly tmp: string;
  readonly logs: string;
}

/**
 * 模組之間的服務註冊表。
 *
 * 第一方模組與主機同一個行程；服務是行程內的參考，不序列化、不跨行程。
 * 提供者在啟用時 `provide`，消費者在請求當下才 `get`／`require`，不要
 * 假設對方已經就緒。名稱由主機定義（`engine`、`cards`、`models` 等），
 * `module-api` 只定形狀。
 */
export interface HostServiceRegistry {
  provide<T>(name: string, value: T): void;
  get<T>(name: string): T | undefined;
  /** 取不到時丟錯；呼叫端要把它轉成 `unsupported` 或明確的診斷。 */
  require<T>(name: string): T;
}

/** 主機提供給模組的服務。 */
export interface ModuleServices {
  readonly models: ModelInvoker;
  readonly backgroundTasks: BackgroundTaskRunner;
  readonly protocol: ProtocolEventEmitter;
  readonly storage: ModuleStorageAreas;
  readonly paths: CardiaryPaths;
  readonly settings: ModuleSettingsReader;
  readonly secrets: SecretAccess;
  readonly logger: ModuleLogger;
  readonly clock: Clock;
  /** 模組之間共用的服務；M1 新增。 */
  readonly host: HostServiceRegistry;
}
