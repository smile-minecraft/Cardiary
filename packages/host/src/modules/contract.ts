import type { AssetStore, CardIndex, CardService } from "@cardiary/domain";
import type {
  ApprovalDecision,
  HumanActor,
  JsonValue,
  ToolBundlePin,
  ToolPermissionGate,
} from "@cardiary/engine-adapter";
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
import type { SpawnRegistry } from "../spawn/wrapper.js";
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
  /** 發牌服務；由發牌模組提供，閘道在 `session.send_message` 前呼叫。 */
  dealing: "dealing",
  /** 主機接好的卡片儲存；由 `bootstrap` 提供，卡片模組唯一的使用者。 */
  cardStorage: "cardStorage",
  /** 工具權限閘道；由本機工具（Phase 2）提供，引擎的回呼在呼叫當下才取。 */
  toolPermissionGate: "toolPermissionGate",
  /** 「一律允許」的決定入口；由權限模組提供，閘道在審批當下才取。 */
  permissionDecision: "permission.decision",
  /** 受控子行程的建立入口；嵌入程序透過它啟動，模組不自己建立子行程。 */
  spawn: "spawn",
  /** 受控通知服務；由排程模組提供，蒸餾用它建立通知而不自己寫儲存。 */
  notifications: "notifications",
} as const;

/** 服務名稱的聯集；`modules.md` 第 5 節那張表。 */
export type HostServiceName = (typeof HOST_SERVICE_NAMES)[keyof typeof HOST_SERVICE_NAMES];

/**
 * 「一律允許」的決定結果；只保留閘道需要判別的部分。
 *
 * 提供者可以帶回更多欄位（例如寫入的白名單），多出來的欄位不影響這裡的型別。
 */
export type AlwaysAllowDecisionOutcome =
  | { readonly outcome: "accepted" | "already-decided"; readonly decision: ApprovalDecision }
  | { readonly outcome: "expired" | "withdrawn" }
  | { readonly outcome: "not-found" }
  | { readonly outcome: "cannot-always-allow"; readonly reason: string };

export interface AlwaysAllowDecisionInput {
  readonly requestId: string;
  readonly effect: "approve_always";
  readonly decidedBy: HumanActor;
  readonly note?: string;
}

/**
 * 「一律允許」的窄介面；服務名稱 `permission.decision`。
 *
 * 由權限模組（本機檔案與終端機）提供，閘道只依賴這兩個方法，不匯入模組實作：
 * `canAlwaysAllow` 依工具政策判斷這筆審批能不能放行到白名單，`decide` 寫入
 * 使用者的決定，成功後由提供者寫入白名單。M1 的提供者是
 * `PermissionDecisionService`，形狀就是這兩個方法，兩者結構對齊：
 * 同一個 `requestId`、同一組判別式結果，`decide` 只在引擎把決定落地後
 * 才回 `accepted`。
 *
 * 決定結果的語意：
 *
 * - `accepted` 代表審批已由提供者落地（引擎已決策），閘道才回
 *   `persisted: true`；`persisted` 只信任提供者的 `accepted`，
 *   不為其他結果標成 `true`。
 * - `already-decided` 代表引擎裡已經有決定，提供者不得寫入白名單；
 *   閘道回 `conflict`，呼叫端要靠 `decision` 裡的先前 verdict 判斷。
 * - `expired`／`withdrawn`／`not-found` 由閘道分別映射成 `conflict`
 *   （逾時／撤回）與 `not_found`；這三種都不寫白名單。
 * - `cannot-always-allow` 代表政策不允許，閘道回 `unsupported`，
 *   `reason` 原樣帶給呼叫端；同樣不寫白名單。
 *
 * 閘道在呼叫 `decide` 前會先確認審批仍是 `pending`；`already-decided`
 * 是防線而不是常態路徑，提供者仍不可倚賴閘道代為把關。
 */
export interface AlwaysAllowService {
  /** 這筆審批是否提供「一律允許」；政策不允許時回 `false`，不是丟錯。 */
  canAlwaysAllow(requestId: string): Promise<boolean>;
  /**
   * 寫入「一律允許」的決定。
   *
   * 只有在引擎把決定落地、且提供者寫好白名單之後，才回 `accepted`；
   * 審批已有決定時回 `already-decided`，這時不得寫入白名單。
   */
  decide(input: AlwaysAllowDecisionInput): Promise<AlwaysAllowDecisionOutcome>;
}

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
  "permission.decision": AlwaysAllowService;
  spawn: SpawnRegistry;
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
   * 啟用中的模組提供的工具組版本；建立對話時釘選。
   *
   * 停用與啟用失敗的模組不在清單裡。重新啟用配發新的 generation，
   * 已建立的對話保留原本釘選的版本。
   */
  activeToolBundles(): readonly ToolBundlePin[];
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
