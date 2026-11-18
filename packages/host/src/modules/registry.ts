import type {
  ContextSectionContribution,
  HostModule,
  HostServiceRegistry,
  ModuleActivationContext,
  ModuleDeactivateOptions,
  ModuleHost,
  ModuleHttpRoute,
  ModuleIdentity,
  ModuleLifecycleErrorCode,
  ModuleManifest,
  ModuleRecord,
  ModuleReloadResult,
  ModuleServices,
  ProtocolEventEmitter,
  ProtocolEventIntent,
  ProtocolRegistrationHandle,
  ProtocolRequestContext,
  ProtocolRequestHandler,
  RegistrationHandle,
  ScheduleDeclaration,
} from "@cardiary/module-api";
import type { JsonValue, ToolBundlePin, ToolRegistry } from "@cardiary/engine-adapter";
import { ModuleLifecycleFailure } from "@cardiary/module-api";
import type { ErrorCode, JSONObject, ModuleInfo } from "@cardiary/protocol";

import type {
  HostServiceTypeMap,
  HostServices,
  ModuleEventSink,
  ModuleRuntimeServices,
} from "./contract.js";
import { ProtocolHandlerError } from "./contract.js";

/**
 * 模組主機的註冊表：服務、協定處理器、HTTP 路由與生命週期。
 *
 * 為什麼不用 `@cardiary/module-api` 的 `ModuleRegistry`：那個實作把同一份
 * `ModuleServices` 給所有模組，協定註冊無法歸屬到模組，停用時也無法撤銷。
 * 這裡按模組包一層 `protocol` 與 `host`，其餘形狀照 `module-api` 的契約。
 */

// ---- 服務註冊表 ---------------------------------------------------------

/**
 * 模組貢獻的上下文區段與排程。
 *
 * 註冊表以服務名稱 `contributions` 提供這份唯讀檢視：上下文模組在每次組裝
 * 時取得第 3 層內容，主機則在模組載入後同步排程清單。排程清單一有變動
 * （模組啟用、停用或註銷宣告）就通知訂閱者，主機靠它把內建排程寫進排程表。
 */
export interface ModuleContributions {
  sections(): readonly ContextSectionContribution[];
  schedules(): readonly ScheduleDeclaration[];
  /** 訂閱排程清單的變動；回傳取消訂閱。 */
  onSchedulesChanged(listener: () => void): () => void;
}

/** 貢獻檢視的服務名稱；主機與模組都從服務註冊表取得。 */
export const CONTRIBUTIONS_SERVICE_NAME = "contributions";

/** 同一個服務名稱被提供兩次。 */
export class HostServiceConflict extends Error {
  constructor(name: string, previousOwner: string, nextOwner: string) {
    super(`服務 ${name} 已經由 ${previousOwner} 提供，${nextOwner} 不能再提供一次`);
    this.name = "HostServiceConflict";
  }
}

/** `require` 取不到服務。 */
export class HostServiceMissing extends Error {
  constructor(name: string) {
    super(`沒有模組提供服務 ${name}`);
    this.name = "HostServiceMissing";
  }
}

interface ServiceEntry {
  readonly owner: string;
  readonly value: unknown;
}

/**
 * 服務註冊表：行程內的參考，不序列化。
 *
 * 重複提供同一個名稱是錯誤：兩個提供者會讓消費者拿到哪一個取決於啟用
 * 順序。停用模組時由擁有者撤銷，之後別的模組才能提供同名服務。
 */
export class HostServiceRegistryImpl implements HostServices {
  readonly #entries = new Map<string, ServiceEntry>();

  provide<N extends keyof HostServiceTypeMap>(name: N, value: HostServiceTypeMap[N]): void;
  provide<T>(name: string, value: T): void;
  provide<T>(name: string, value: T): void {
    this.provideFrom("host", name, value);
  }

  get<N extends keyof HostServiceTypeMap>(name: N): HostServiceTypeMap[N] | undefined;
  get<T>(name: string): T | undefined;
  get<T>(name: string): T | undefined {
    return this.#entries.get(name)?.value as T | undefined;
  }

  require<N extends keyof HostServiceTypeMap>(name: N): HostServiceTypeMap[N];
  require<T>(name: string): T;
  require<T>(name: string): T {
    const entry = this.#entries.get(name);
    if (entry === undefined) {
      throw new HostServiceMissing(name);
    }
    return entry.value as T;
  }

  has(name: string): boolean {
    return this.#entries.has(name);
  }

  /** 由某個擁有者提供；重複提供同一個名稱丟錯。 */
  provideFrom(owner: string, name: string, value: unknown): void {
    if (name.trim().length === 0) {
      throw new Error("服務名稱不能是空的");
    }
    const existing = this.#entries.get(name);
    if (existing !== undefined) {
      throw new HostServiceConflict(name, existing.owner, owner);
    }
    this.#entries.set(name, { owner, value });
  }

  /** 撤銷某個擁有者提供的單一服務；不是它的或已經撤銷過都不做事。 */
  withdrawOwned(owner: string, name: string): void {
    const entry = this.#entries.get(name);
    if (entry?.owner === owner) {
      this.#entries.delete(name);
    }
  }

  /** 撤銷某個擁有者提供的所有服務。 */
  withdraw(owner: string): void {
    for (const [name, entry] of this.#entries) {
      if (entry.owner === owner) {
        this.#entries.delete(name);
      }
    }
  }

  names(): readonly string[] {
    return [...this.#entries.keys()].sort();
  }
}

/**
 * 一個模組看到的服務註冊表。
 *
 * `provide` 記在模組名下，停用時只撤銷自己的；`get`／`require` 讀共用表，
 * 所以消費者拿到的是當下已經就緒的服務，沒就緒就回 `undefined` 或丟錯，
 * 由呼叫端轉成 `unsupported`。
 */
export class ScopedHostServices implements HostServiceRegistry {
  readonly #parent: HostServiceRegistryImpl;
  readonly #owner: string;
  readonly #provided = new Set<string>();
  #withdrawn = false;

  constructor(parent: HostServiceRegistryImpl, owner: string) {
    this.#parent = parent;
    this.#owner = owner;
  }

  provide<T>(name: string, value: T): void {
    if (this.#withdrawn) {
      throw new Error(`模組 ${this.#owner} 已經停用，不能再提供服務 ${name}`);
    }
    this.#parent.provideFrom(this.#owner, name, value);
    this.#provided.add(name);
  }

  get<T>(name: string): T | undefined {
    return this.#parent.get<T>(name);
  }

  require<T>(name: string): T {
    return this.#parent.require<T>(name);
  }

  /** 停用時呼叫；重複呼叫是安全的。 */
  withdraw(): void {
    if (this.#withdrawn) return;
    this.#withdrawn = true;
    for (const name of this.#provided) {
      this.#parent.withdrawOwned(this.#owner, name);
    }
    this.#provided.clear();
  }
}

// ---- 協定處理器 ---------------------------------------------------------

/** 協定註冊被拒絕的原因。 */
export type ProtocolRegistrationErrorCode =
  "invalid-registration" | "reserved-type" | "duplicate-registration";

/** 協定註冊失敗；訊息會變成模組的 failure。 */
export class ProtocolRegistrationError extends Error {
  readonly code: ProtocolRegistrationErrorCode;

  constructor(code: ProtocolRegistrationErrorCode, message: string) {
    super(message);
    this.name = "ProtocolRegistrationError";
    this.code = code;
  }
}

/** 模組不能登記的核心型別；`system.modules.*` 由主機自己處理。 */
const CORE_TYPES: ReadonlySet<string> = new Set([
  "system.hello",
  "system.subscribe",
  "system.unsubscribe",
  "session.create",
  "session.list",
  "session.send_message",
  "session.interrupt",
  "session.subscribe",
  "session.unsubscribe",
  "session.get_history",
  "system.modules.get",
  "system.modules.set_enabled",
]);

/** 整段保留的命名空間；模組連子型別都不能登記。 */
const RESERVED_NAMESPACES: readonly string[] = ["approval", "system.modules"];

/**
 * 登記鍵的格式：命名空間用小寫英文字母、數字與連字號；動作段沿用協定型別，
 * 允許底線（例如 `session.deletion_preview`）。
 */
const REGISTRATION_KEY = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9_-]*)*$/;

interface ProtocolEntry {
  readonly moduleId: string;
  readonly key: string;
  readonly handler: ProtocolRequestHandler;
  active: boolean;
}

/**
 * 協定處理器表。
 *
 * 一個登記字串同時代表精確型別與前綴，比對規則只有一條：`type === key`
 * 是精確命中，`type` 以 `key + "."` 開頭是前綴命中。閘道先問精確命中，
 * 核心 switch 之後才問前綴，所以 `session.archive` 這種精確登記不會被
 * 別的前綴搶走；整段 `session` 已被核心型別保留擋下。
 */
export class ProtocolRouter {
  readonly #entries = new Map<string, ProtocolEntry>();

  /** 登記一個命名空間或精確型別；重複或保留型別會丟錯。 */
  register(
    moduleId: string,
    key: string,
    handler: ProtocolRequestHandler,
  ): ProtocolRegistrationHandle {
    if (!REGISTRATION_KEY.test(key)) {
      throw new ProtocolRegistrationError("invalid-registration", `協定註冊名稱不合法：${key}`);
    }
    for (const reserved of CORE_TYPES) {
      if (reserved === key || reserved.startsWith(`${key}.`) || key.startsWith(`${reserved}.`)) {
        throw new ProtocolRegistrationError(
          "reserved-type",
          `模組不能登記核心型別 ${key}（保留：${reserved}）`,
        );
      }
    }
    for (const namespace of RESERVED_NAMESPACES) {
      if (key === namespace || key.startsWith(`${namespace}.`)) {
        throw new ProtocolRegistrationError(
          "reserved-type",
          `模組不能登記保留命名空間 ${namespace}（${key}）`,
        );
      }
    }
    const existing = this.#entries.get(key);
    if (existing !== undefined) {
      throw new ProtocolRegistrationError(
        "duplicate-registration",
        `協定名稱 ${key} 已經由 ${existing.moduleId} 登記`,
      );
    }
    const entry: ProtocolEntry = { moduleId, key, handler, active: true };
    this.#entries.set(key, entry);
    return {
      dispose: () => {
        if (!entry.active) return;
        entry.active = false;
        this.#entries.delete(key);
      },
    };
  }

  hasExact(type: string): boolean {
    return this.#entries.get(type)?.active === true;
  }

  hasPrefix(type: string): boolean {
    return this.#longestPrefix(type) !== null;
  }

  /** 依精確型別或最長前綴處理；找不到時丟 `not_found`。 */
  async dispatch(request: ProtocolRequestContext): Promise<JsonValue> {
    const entry = this.#entries.get(request.type) ?? this.#longestPrefix(request.type);
    if (entry === undefined || entry === null || !entry.active) {
      throw new ProtocolHandlerError("not_found", `沒有模組處理 ${request.type}。`);
    }
    return entry.handler(request);
  }

  /** 模組登記的名稱；給 `ModuleInfo.protocolPrefixes`。 */
  keysOf(moduleId: string): string[] {
    return [...this.#entries.values()]
      .filter((entry) => entry.moduleId === moduleId && entry.active)
      .map((entry) => entry.key)
      .sort();
  }

  #longestPrefix(type: string): ProtocolEntry | null {
    let found: ProtocolEntry | null = null;
    for (const entry of this.#entries.values()) {
      if (!entry.active) continue;
      if (!type.startsWith(`${entry.key}.`)) continue;
      if (found === null || entry.key.length > found.key.length) {
        found = entry;
      }
    }
    return found;
  }
}

// ---- HTTP 路由 ----------------------------------------------------------

/** HTTP 路由重複登記或路徑不合法。 */
export class HttpRouteRegistrationError extends Error {
  readonly code: "invalid-route" | "duplicate-route";

  constructor(code: "invalid-route" | "duplicate-route", message: string) {
    super(message);
    this.name = "HttpRouteRegistrationError";
    this.code = code;
  }
}

interface HttpEntry {
  readonly moduleId: string;
  readonly route: ModuleHttpRoute;
  active: boolean;
}

/**
 * HTTP 路由表。
 *
 * 路徑是精確路徑或以 `/` 結尾的前綴；精確命中優先，其次是最長前綴。
 * 同一個 method 與 path 只能登記一次。
 */
export class HttpRouter {
  readonly #entries: HttpEntry[] = [];

  register(moduleId: string, route: ModuleHttpRoute): ProtocolRegistrationHandle {
    if (!route.path.startsWith("/")) {
      throw new HttpRouteRegistrationError("invalid-route", `路由路徑要以 / 開頭：${route.path}`);
    }
    const duplicate = this.#entries.some(
      (entry) => entry.route.method === route.method && entry.route.path === route.path,
    );
    if (duplicate) {
      throw new HttpRouteRegistrationError(
        "duplicate-route",
        `HTTP 路由 ${route.method} ${route.path} 已經登記`,
      );
    }
    const entry: HttpEntry = { moduleId, route, active: true };
    this.#entries.push(entry);
    return {
      dispose: () => {
        if (!entry.active) return;
        entry.active = false;
        const index = this.#entries.indexOf(entry);
        if (index >= 0) this.#entries.splice(index, 1);
      },
    };
  }

  /** 找適用的路由；沒有時回 `null`。 */
  find(method: string, pathname: string): ModuleHttpRoute | null {
    const candidates = this.#entries.filter(
      (entry) => entry.active && entry.route.method === method,
    );
    const exact = candidates.find((entry) => entry.route.path === pathname);
    if (exact !== undefined) return exact.route;
    let prefix: HttpEntry | null = null;
    for (const entry of candidates) {
      if (!entry.route.path.endsWith("/")) continue;
      if (!pathname.startsWith(entry.route.path)) continue;
      if (prefix === null || entry.route.path.length > prefix.route.path.length) {
        prefix = entry;
      }
    }
    return prefix === null ? null : prefix.route;
  }

  routesOf(moduleId: string): string[] {
    return this.#entries
      .filter((entry) => entry.moduleId === moduleId && entry.active)
      .map((entry) => `${entry.route.method} ${entry.route.path}`)
      .sort();
  }
}

// ---- 註冊 handle --------------------------------------------------------

/** 只銷毀一次的註冊 handle；模組與主機都呼叫也不會重複。 */
export class Registration implements RegistrationHandle {
  readonly registrationId: string;
  readonly #dispose: () => void | Promise<void>;
  #disposed = false;

  constructor(registrationId: string, dispose: () => void | Promise<void>) {
    this.registrationId = registrationId;
    this.#dispose = dispose;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    await this.#dispose();
  }
}

// ---- 模組生命週期 -------------------------------------------------------

interface ModuleEntry {
  module: HostModule;
  identity: ModuleIdentity;
  state: ModuleRecord["state"];
  failure: { message: string; at: string } | null;
  handles: Registration[];
  services: ScopedHostServices | null;
  /** 這次啟用註冊的工具組版本；停用或啟用失敗時清空。 */
  bundles: ToolBundlePin[];
  activationOrder: number;
}

export interface HostModuleRegistryOptions {
  /** 工具組的註冊表；由主機的引擎提供。 */
  readonly tools: ToolRegistry;
  /** 不隨模組改變的服務；`protocol` 與 `host` 由註冊表補上。 */
  readonly services: ModuleRuntimeServices;
  /** 事件出口；模組的 `emit` 走這裡。 */
  readonly events: ModuleEventSink;
  /** 共用的服務註冊表；組合根可以先放好 `engine` 等主機服務再交給載入器。 */
  readonly hostServices?: HostServiceRegistryImpl;
  readonly hostApiVersion?: string;
  readonly now?: () => Date;
  /** 記下模組錯誤；省略時不輸出。 */
  readonly warn?: (message: string, fields?: JSONObject) => void;
}

const DEFAULT_HOST_API_VERSION = "1";
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MODULE_ID = /^[a-z][a-z0-9-]*$/;

/**
 * 第一方模組的生命週期。
 *
 * 載入只檢查描述檔；啟用才呼叫 `activate` 並收集註冊。停用與重載時由
 * **主機**呼叫每個 handle 的 `dispose` 一次（模組不要在停用路徑自己銷毀），
 * 撤銷它提供的服務，工具組一併退役。重複停用會在狀態檢查就被擋下，
 * 不會重複銷毀。
 */
export class HostModuleRegistry implements ModuleHost {
  readonly protocol = new ProtocolRouter();
  readonly http = new HttpRouter();
  readonly #options: HostModuleRegistryOptions;
  readonly #entries = new Map<string, ModuleEntry>();
  readonly #hostServices: HostServiceRegistryImpl;
  readonly #contextSections: ContextSectionContribution[] = [];
  readonly #schedules: ScheduleDeclaration[] = [];
  readonly #scheduleListeners = new Set<() => void>();
  #generation = 0;
  #activationCounter = 0;
  #shuttingDown = false;

  constructor(options: HostModuleRegistryOptions) {
    this.#options = options;
    this.#hostServices = options.hostServices ?? new HostServiceRegistryImpl();
    // 模組只能透過服務取得別人的貢獻；註冊表本身不交給模組。
    this.#hostServices.provide(CONTRIBUTIONS_SERVICE_NAME, {
      sections: () => [...this.#contextSections],
      schedules: () => [...this.#schedules],
      onSchedulesChanged: (listener: () => void) => {
        this.#scheduleListeners.add(listener);
        return () => {
          this.#scheduleListeners.delete(listener);
        };
      },
    } satisfies ModuleContributions);
  }

  /** 共用的服務註冊表；組合根在載入前提供 `engine`、`storage` 等服務。 */
  get hostServices(): HostServiceRegistryImpl {
    return this.#hostServices;
  }

  async load(module: HostModule, options?: { readonly inactive?: boolean }): Promise<ModuleRecord> {
    const manifest = module.manifest;
    validateManifest(manifest, this.#options.hostApiVersion ?? DEFAULT_HOST_API_VERSION);
    if (this.#entries.has(manifest.id)) {
      throw new ModuleLifecycleFailure(
        "already-active",
        manifest.id,
        `模組 ${manifest.id} 已經載入`,
      );
    }
    const entry: ModuleEntry = {
      module,
      identity: { id: manifest.id, version: manifest.version, generation: 0 },
      state: options?.inactive === true ? "inactive" : "loaded",
      failure: null,
      handles: [],
      services: null,
      bundles: [],
      activationOrder: 0,
    };
    this.#entries.set(manifest.id, entry);
    return recordOf(entry);
  }

  async unload(moduleId: string): Promise<void> {
    const entry = this.#require(moduleId);
    if (entry.state === "active") {
      throw new ModuleLifecycleFailure("already-active", moduleId, "停用後才能解除安裝");
    }
    this.#entries.delete(moduleId);
  }

  async activate(moduleId: string): Promise<ModuleRecord> {
    const entry = this.#require(moduleId);
    if (entry.state === "active") {
      throw new ModuleLifecycleFailure("already-active", moduleId, `模組 ${moduleId} 已經啟用`);
    }
    this.#generation += 1;
    this.#activationCounter += 1;
    const generation = this.#generation;
    const identity: ModuleIdentity = {
      id: entry.module.manifest.id,
      version: entry.module.manifest.version,
      generation,
    };
    const handles: Registration[] = [];
    const pending: Promise<void>[] = [];
    const bundles: ToolBundlePin[] = [];
    const services = new ScopedHostServices(this.#hostServices, moduleId);
    const context = this.#activationContext(identity, services, handles, pending, bundles);
    try {
      await entry.module.activate(context);
      await Promise.all(pending);
    } catch (error) {
      await disposeAll(handles);
      services.withdraw();
      entry.state = "failed";
      entry.failure = { message: messageOf(error), at: this.#now() };
      entry.identity = identity;
      entry.handles = [];
      entry.services = null;
      entry.bundles = [];
      this.#options.warn?.("模組啟用失敗", { moduleId, message: messageOf(error) });
      return recordOf(entry);
    }
    entry.identity = identity;
    entry.state = "active";
    entry.failure = null;
    entry.handles = handles;
    entry.services = services;
    entry.bundles = bundles;
    entry.activationOrder = this.#activationCounter;
    return recordOf(entry);
  }

  async deactivate(moduleId: string, options?: ModuleDeactivateOptions): Promise<ModuleRecord> {
    const entry = this.#require(moduleId);
    if (entry.state !== "active" && entry.state !== "failed") {
      throw new ModuleLifecycleFailure("not-active", moduleId, `模組 ${moduleId} 沒有啟用`);
    }
    const dependents = [...this.#entries.values()].filter(
      (candidate) =>
        candidate.state === "active" &&
        candidate.module.manifest.dependencies.some(
          (dependency) => dependency.moduleId === moduleId && dependency.optional !== true,
        ),
    );
    if (dependents.length > 0 && options?.cascade !== true) {
      throw new ModuleLifecycleFailure(
        "dependency-active",
        moduleId,
        `仍有模組相依於 ${moduleId}：${dependents.map((candidate) => candidate.identity.id).join(", ")}`,
      );
    }
    for (const dependent of dependents) {
      await this.deactivate(dependent.identity.id, { ...options, cascade: true });
    }
    const reason = options?.reason ?? "user";
    try {
      await entry.module.deactivate?.({ reason });
    } catch (error) {
      this.#options.warn?.("模組停用處理器失敗", { moduleId, message: messageOf(error) });
    } finally {
      // 銷毀責任在主機：每個 handle 只呼叫一次，模組自己先撤銷過的也安全。
      await disposeAll(entry.handles);
      entry.handles = [];
      entry.services?.withdraw();
      entry.services = null;
      entry.bundles = [];
      entry.state = "inactive";
    }
    return recordOf(entry);
  }

  async reload(moduleId: string, next?: HostModule): Promise<ModuleReloadResult> {
    const entry = this.#require(moduleId);
    const previousGeneration = entry.identity.generation;
    if (entry.state === "active") {
      await this.deactivate(moduleId, { reason: "reload" });
    }
    if (next !== undefined) {
      validateManifest(next.manifest, this.#options.hostApiVersion ?? DEFAULT_HOST_API_VERSION);
      if (next.manifest.id !== moduleId) {
        throw new ModuleLifecycleFailure("invalid-manifest", moduleId, "重載不能換模組識別碼");
      }
      entry.module = next;
    }
    const record = await this.activate(moduleId);
    return {
      identity: record.identity,
      previousGeneration,
      timing: { newConversations: "immediate", activeConversations: "next-compaction" },
      stagedConversationIds: [],
    };
  }

  list(): readonly ModuleRecord[] {
    return [...this.#entries.values()]
      .sort((left, right) => left.identity.id.localeCompare(right.identity.id))
      .map(recordOf);
  }

  record(moduleId: string): ModuleRecord | null {
    const entry = this.#entries.get(moduleId);
    return entry === undefined ? null : recordOf(entry);
  }

  /** 目前啟用中的模組；停用全部時從最後啟用的開始。 */
  activeModules(): readonly string[] {
    return [...this.#entries.values()]
      .filter((entry) => entry.state === "active")
      .sort((left, right) => right.activationOrder - left.activationOrder)
      .map((entry) => entry.identity.id);
  }

  /**
   * 啟用中的模組提供的工具組版本；建立對話時釘選。
   *
   * 依模組識別碼排序，讓同一組模組的釘選結果固定。停用、載入失敗與尚未
   * 啟用的模組都不在清單裡。
   */
  activeToolBundles(): readonly ToolBundlePin[] {
    return [...this.#entries.values()]
      .filter((entry) => entry.state === "active")
      .sort((left, right) => left.identity.id.localeCompare(right.identity.id))
      .flatMap((entry) => entry.bundles);
  }

  /** 目前啟用中的模組註冊的上下文區段，依註冊順序。 */
  contextSections(): readonly ContextSectionContribution[] {
    return [...this.#contextSections];
  }

  /** 目前啟用中的模組註冊的排程，依註冊順序。 */
  schedules(): readonly ScheduleDeclaration[] {
    return [...this.#schedules];
  }

  /** 關機時停用所有模組；重複呼叫是安全的。 */
  async deactivateAll(reason: "shutdown" | "user" = "shutdown"): Promise<void> {
    if (this.#shuttingDown) return;
    this.#shuttingDown = true;
    try {
      for (const moduleId of this.activeModules()) {
        await this.deactivate(moduleId, { reason, cascade: true });
      }
    } finally {
      this.#shuttingDown = false;
    }
  }

  /** `system.modules.get` 的一筆；`enabled` 由呼叫端（設定）決定。 */
  infoOf(moduleId: string, enabled: boolean): ModuleInfo | null {
    const entry = this.#entries.get(moduleId);
    if (entry === undefined) return null;
    const manifest = entry.module.manifest;
    return {
      moduleId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      enabled,
      state: entry.state,
      ...(entry.failure === null ? {} : { failure: entry.failure.message }),
      protocolPrefixes: this.protocol.keysOf(moduleId),
      settings: manifest.settings.map((setting) => ({
        key: setting.key,
        title: setting.title,
        kind: setting.kind,
        level: setting.level ?? "human-only",
        ...(setting.description === undefined ? {} : { description: setting.description }),
      })),
    };
  }

  manifestOf(moduleId: string): ModuleManifest | null {
    return this.#entries.get(moduleId)?.module.manifest ?? null;
  }

  #activationContext(
    identity: ModuleIdentity,
    scoped: ScopedHostServices,
    handles: Registration[],
    pending: Promise<void>[],
    bundles: ToolBundlePin[],
  ): ModuleActivationContext {
    let counter = 0;
    const handle = (suffix: string, dispose: () => void | Promise<void>): Registration => {
      counter += 1;
      const registration = new Registration(
        `${identity.id}:${identity.generation}:${counter}:${suffix}`,
        dispose,
      );
      handles.push(registration);
      return registration;
    };
    const protocol: ProtocolEventEmitter = {
      emit: (intent: ProtocolEventIntent): void => {
        this.#options.events.emit(intent);
      },
      registerNamespace: (key, handler) => {
        const inner = this.protocol.register(identity.id, key, handler);
        return handle("protocol", () => inner.dispose());
      },
      registerHttpRoute: (route) => {
        const inner = this.http.register(identity.id, route);
        return handle("http", () => inner.dispose());
      },
    };
    const keys = new Set(
      this.#require(identity.id).module.manifest.settings.map((item) => item.key),
    );
    const source = this.#options.services.settings;
    const services: ModuleServices = {
      ...this.#options.services,
      settings: {
        get: (key) =>
          keys.has(key) && source.getLevel(key) !== "human-only" ? source.get(key) : undefined,
        getLevel: (key) => (keys.has(key) ? source.getLevel(key) : "human-only"),
        onChange: (listener) => {
          const unsubscribe = source.onChange((change) => {
            if (keys.has(change.key)) listener(change);
          });
          const registration = handle("settings", unsubscribe);
          return () => {
            void registration.dispose();
          };
        },
      },
      protocol,
      host: scoped,
    };
    return {
      identity,
      services,
      registerToolBundle: (draft) => {
        const previous = bundles.findIndex((pin) => pin.bundleId === draft.bundleId);
        if (previous >= 0) bundles.splice(previous, 1);
        const pin = { bundleId: draft.bundleId, generation: identity.generation };
        bundles.push(pin);
        pending.push(this.#options.tools.register({ ...draft, generation: identity.generation }));
        return handle("tools", () => {
          const index = bundles.indexOf(pin);
          if (index < 0) return;
          bundles.splice(index, 1);
          return this.#options.tools.retire(draft.bundleId, identity.generation);
        });
      },
      registerContextSection: (section: ContextSectionContribution) => {
        this.#contextSections.push(section);
        return handle("context-section", () => {
          const index = this.#contextSections.indexOf(section);
          if (index >= 0) this.#contextSections.splice(index, 1);
        });
      },
      registerHook: () => handle("hook", () => {}),
      registerSchedule: (schedule: ScheduleDeclaration) => {
        this.#schedules.push(schedule);
        this.#notifySchedulesChanged();
        return handle("schedule", () => {
          const index = this.#schedules.indexOf(schedule);
          if (index < 0) return;
          this.#schedules.splice(index, 1);
          this.#notifySchedulesChanged();
        });
      },
    };
  }

  /**
   * 排程清單一有變動就通知訂閱者。
   *
   * 訂閱者（排程器）會同步寫入排程表，失敗由訂閱者自己處理；這裡吞掉
   * 例外只記 warn，模組的啟用與停用不受訂閱者影響。
   *
   * 關機時模組依序停用，宣告跟著消失，但那不是宣告被移除：通知下去會把
   * 內建排程寫成停用，下次啟動就少了一次錯過時段的補跑。使用者停用模組
   * 不經過 `deactivateAll`，照常通知。
   */
  #notifySchedulesChanged(): void {
    if (this.#shuttingDown) return;
    for (const listener of [...this.#scheduleListeners]) {
      try {
        listener();
      } catch (error) {
        this.#options.warn?.("排程變更通知失敗", { message: messageOf(error) });
      }
    }
  }

  #require(moduleId: string): ModuleEntry {
    const entry = this.#entries.get(moduleId);
    if (entry === undefined) {
      throw new ModuleLifecycleFailure("not-found", moduleId, `找不到模組 ${moduleId}`);
    }
    return entry;
  }

  #now(): string {
    return (this.#options.now ?? (() => new Date()))().toISOString();
  }
}

async function disposeAll(handles: readonly Registration[]): Promise<void> {
  for (const handle of [...handles].reverse()) {
    try {
      await handle.dispose();
    } catch (error) {
      void error;
    }
  }
}

function recordOf(entry: ModuleEntry): ModuleRecord {
  return { identity: entry.identity, state: entry.state, failure: entry.failure };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateManifest(manifest: ModuleManifest, hostApiVersion: string): void {
  if (!MODULE_ID.test(manifest.id)) {
    throw new ModuleLifecycleFailure(
      "invalid-manifest",
      manifest.id,
      `模組識別碼只能是小寫英數字與連字號：${manifest.id}`,
    );
  }
  if (!SEMVER.test(manifest.version)) {
    throw new ModuleLifecycleFailure(
      "invalid-manifest",
      manifest.id,
      `模組版本不是 semver：${manifest.version}`,
    );
  }
  if (manifest.hostApiVersion !== hostApiVersion) {
    throw new ModuleLifecycleFailure(
      "host-api-incompatible",
      manifest.id,
      `模組需要主機介面 ${manifest.hostApiVersion}，目前是 ${hostApiVersion}`,
    );
  }
  for (const setting of manifest.settings) {
    if (setting.level === undefined) {
      (setting as { level?: string }).level = "human-only";
    }
  }
}

/** 生命週期錯誤碼對應的協定錯誤碼；閘道與管理介面共用。 */
export function lifecycleErrorCode(code: ModuleLifecycleErrorCode): ErrorCode {
  switch (code) {
    case "not-found":
      return "not_found";
    case "host-api-incompatible":
    case "dependency-missing":
      return "unsupported";
    case "invalid-manifest":
    case "dependency-active":
    case "already-active":
    case "not-active":
      return "conflict";
    case "activation-failed":
      return "unavailable";
  }
}
