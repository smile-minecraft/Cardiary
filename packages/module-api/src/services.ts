import type {
  Clock,
  ContentBlock,
  ConversationId,
  JsonValue,
  ModelRole,
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
}

/** 背景模型呼叫的結果。 */
export interface ModelInvocationResult {
  readonly text: string;
}

/** 呼叫模型的方式；主機負責選擇實際模型與處理金鑰。 */
export interface ModelInvoker {
  invoke(
    request: ModelInvocationRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ModelInvocationResult>;
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

/** 主機提供給模組的服務。 */
export interface ModuleServices {
  readonly models: ModelInvoker;
  readonly protocol: ProtocolEventEmitter;
  readonly storage: ModuleStorageAreas;
  readonly settings: ModuleSettingsReader;
  readonly logger: ModuleLogger;
  readonly clock: Clock;
}
