import type { AssetStore, CardIndex, CardService } from "@cardiary/domain";
import type { JsonValue, ToolPermissionGate } from "@cardiary/engine-adapter";
import type {
  CardiaryPaths,
  ModelInvoker,
  ModuleHttpRequest,
  ModuleHttpResponse,
  ModuleServices,
  ProtocolEventEmitter,
  ProtocolEventIntent,
  ProtocolRequestContext,
} from "@cardiary/module-api";
import type { ErrorCode, JSONObject, ModuleInfo } from "@cardiary/protocol";
import type { Database, FolderLayout, SettingsStore } from "@cardiary/storage";

import type { BrokerClient } from "../control/broker.js";
import type { HostEngine } from "../engine/types.js";
import type { StorageBundle } from "../storage/interfaces.js";

/**
 * 模組主機的契約：模組之間交換的服務名稱、型別與錯誤。
 *
 * 第一方模組與主機同一個行程；這裡只放「主機定義、模組共用」的部分。
 * 協定與生命週期的形狀由 `@cardiary/module-api` 定義，不在這裡重複。
 */

/** M1 的服務名稱；提供者與消費者都用常數，不要各自寫字串。 */
export const HOST_SERVICE_NAMES = {
  engine: "engine",
  storage: "storage",
  paths: "paths",
  broker: "broker",
  taskApprovals: "taskApprovals",
  settings: "settings",
  cards: "cards",
  cardIndex: "cardIndex",
  assets: "assets",
  context: "context",
  sessions: "sessions",
  models: "models",
  recognition: "recognition",
  blobs: "blobs",
  /** 主機接好的卡片儲存；由 `bootstrap` 提供，卡片模組唯一的使用者。 */
  cardStorage: "cardStorage",
  /** 工具權限閘道；由本機工具（Phase 2）提供，引擎的回呼在呼叫當下才取。 */
  toolPermissionGate: "toolPermissionGate",
} as const;

/** 服務名稱的聯集；`modules.md` 第 5 節那張表。 */
export type HostServiceName = (typeof HOST_SERVICE_NAMES)[keyof typeof HOST_SERVICE_NAMES];

/**
 * 主機已知服務的型別。
 *
 * 還沒有實作型別的服務不在這張表裡，呼叫端用 `HostServiceRegistry` 的
 * 泛型簽章自己指定。提供者實作自己的型別時再擴充這裡，不要先放 `unknown`
 * 佔位，否則消費者拿到的型別會無聲變成 `unknown`。
 */
export interface HostServiceTypeMap {
  engine: HostEngine;
  storage: StorageBundle;
  paths: CardiaryPaths;
  broker: BrokerClient;
  models: ModelInvoker;
  cards: CardService;
  cardIndex: CardIndex;
  assets: AssetStore;
  cardStorage: CardEnvironment;
  toolPermissionGate: ToolPermissionGate;
}

/**
 * 卡片模組用到的儲存連線。
 *
 * 產品組裝由 `PersistentStorage` 提供（狀態庫、快取與設定都共用主機已開的
 * 連線）；記憶體組裝（契約測試與主機單元測試）由 `bootstrap` 開自己的
 * 狀態庫與快取，讓卡片仍然是資料夾裡的真實檔案。
 *
 * `cache()` 每次回傳目前的快取連線：暫停後恢復時儲存層會換一個物件。
 */
export interface CardEnvironment {
  readonly layout: FolderLayout;
  readonly state: Database;
  cache(): Database;
  readonly settings: SettingsStore;
  /** 這個環境擁有連線，關機時要關；產品組裝是 false，由儲存層負責。 */
  readonly ownsConnections: boolean;
  close(): void;
}

/** 服務名稱對應的型別；不在表裡的服務是 `unknown`。 */
export type HostServiceValue<N extends string> = N extends keyof HostServiceTypeMap
  ? HostServiceTypeMap[N]
  : unknown;

/**
 * 帶型別的服務註冊表。
 *
 * 這是 `ModuleServices.host` 的實際形狀：已知名稱有型別，其餘走泛型。
 */
export interface HostServices {
  provide<N extends keyof HostServiceTypeMap>(name: N, value: HostServiceTypeMap[N]): void;
  provide<T>(name: string, value: T): void;
  get<N extends keyof HostServiceTypeMap>(name: N): HostServiceTypeMap[N] | undefined;
  get<T>(name: string): T | undefined;
  require<N extends keyof HostServiceTypeMap>(name: N): HostServiceTypeMap[N];
  require<T>(name: string): T;
}

/**
 * 模組處理器可以丟的錯誤；閘道轉成協定錯誤信封。
 *
 * 只有客戶端看得懂的碼能用；`internal` 不要拿來當萬用碼，未預期的例外
 * 由閘道記日誌並回 `internal`，不把細節送給客戶端。
 */
export class ProtocolHandlerError extends Error {
  readonly code: ErrorCode;
  readonly details: JSONObject | undefined;

  constructor(code: ErrorCode, message: string, details?: JSONObject) {
    super(message);
    this.name = "ProtocolHandlerError";
    this.code = code;
    this.details = details;
  }
}

/** 模組送事件用的出口；由閘道實作，模組只能經 `services.protocol.emit` 拿到。 */
export interface ModuleEventSink {
  emit(intent: ProtocolEventIntent): void;
}

/** 主機提供給模組、但不隨模組改變的服務；`protocol` 與 `host` 由註冊表按模組包一層。 */
export type ModuleRuntimeServices = Omit<ModuleServices, "protocol" | "host">;

/**
 * 閘道看到的模組主機。
 *
 * 分派順序由閘道決定（精確型別 → 核心 switch → 前綴），所以閘道需要
 * 分別問「有沒有精確型別」與「有沒有前綴」，再呼叫 `dispatchProtocol`。
 */
export interface ModuleHostBridge {
  /** `system.modules.get` 的資料；依模組識別碼排序。 */
  listModules(): readonly ModuleInfo[];
  /**
   * `system.modules.set_enabled`。
   *
   * 同一個狀態重複設定是安全的：已經啟用再啟用、已經停用再停用都直接回
   * 目前狀態，不重新啟用也不配發新的 generation。
   */
  setModuleEnabled(moduleId: string, enabled: boolean): Promise<ModuleInfo>;
  /** 這個完整型別是否有模組登記的精確處理器。 */
  hasExactHandler(type: string): boolean;
  /** 這個型別是否有適用的命名空間前綴（最長前綴優先）。 */
  hasPrefixHandler(type: string): boolean;
  /** 依精確型別或最長前綴處理；沒有登記時丟 `ProtocolHandlerError("not_found")`。 */
  dispatchProtocol(request: ProtocolRequestContext): Promise<JsonValue>;
  /** 依 method 與路徑處理 HTTP 路由；沒有登記時回 `null`。 */
  dispatchHttp(request: ModuleHttpRequest): Promise<ModuleHttpResponse | null>;
}

/** 模組啟用時拿到的協定出口；註冊的 handle 由模組主機保管與銷毀。 */
export type ScopedProtocolEmitter = ProtocolEventEmitter;
