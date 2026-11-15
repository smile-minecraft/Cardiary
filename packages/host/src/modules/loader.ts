import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { JsonValue, ToolRegistry } from "@cardiary/engine-adapter";
import type { HostModule } from "@cardiary/module-api";
import { ModuleLifecycleFailure } from "@cardiary/module-api";
import type {
  ModuleHttpRequest,
  ModuleHttpResponse,
  ProtocolRequestContext,
} from "@cardiary/module-api";
import type { JSONObject, ModuleInfo } from "@cardiary/protocol";

import type { ModuleEventSink, ModuleHostBridge, ModuleRuntimeServices } from "./contract.js";
import { HostModuleRegistry, HostServiceRegistryImpl } from "./registry.js";

/**
 * 第一方模組的載入器。
 *
 * 掃描 `modules/` 底下的目錄、動態 import 每個 `index.js`、依相依排序、
 * 停用清單與失敗隔離都在這裡。新增一個第一方模組只需要新增目錄，不改
 * 任何共用檔案。
 */

/** 停用的模組清單；M1 由 `settings` 的 `modules.disabled` 實作。 */
export interface ModuleEnablementSettings {
  disabled(): Promise<readonly string[]> | readonly string[];
  setDisabled(moduleIds: readonly string[]): Promise<void> | void;
}

/** 記憶體版；測試與還沒有持久化設定時的預設。 */
export class MemoryModuleEnablementSettings implements ModuleEnablementSettings {
  #disabled: string[];

  constructor(disabled: readonly string[] = []) {
    this.#disabled = [...new Set(disabled)].sort();
  }

  disabled(): readonly string[] {
    return [...this.#disabled];
  }

  setDisabled(moduleIds: readonly string[]): void {
    this.#disabled = [...new Set(moduleIds)].sort();
  }
}

/** 設定庫的最小介面；`SettingsStore` 結構上符合，這裡不直接相依儲存套件。 */
export interface ModuleSettingsStore {
  get(key: string): { readonly value: string } | null;
  set(input: {
    readonly key: string;
    readonly value: string;
    readonly level: "free";
    readonly updatedBy: string;
  }): unknown;
}

/**
 * 把 `modules.disabled` 接上 `state/cardiary.sqlite` 的 `settings`。
 *
 * 值是一段 JSON 字串陣列；讀不到、解析失敗或不是字串陣列時視為沒有停用
 * 任何模組，不讓壞掉的設定擋住啟動。寫入固定 `free` 等級，與
 * `docs/design/modules.md` 第 6.2 節一致；代理沒有改這個鍵的工具。
 */
export class SettingsModuleEnablementSettings implements ModuleEnablementSettings {
  static readonly KEY = "modules.disabled";
  readonly #updatedBy: string;
  readonly #source: ModuleSettingsStore | (() => ModuleSettingsStore);

  constructor(
    store: ModuleSettingsStore | (() => ModuleSettingsStore),
    options: { readonly updatedBy?: string } = {},
  ) {
    this.#source = store;
    this.#updatedBy = options.updatedBy ?? "host";
  }

  #store(): ModuleSettingsStore {
    return typeof this.#source === "function" ? this.#source() : this.#source;
  }

  disabled(): readonly string[] {
    const record = this.#store().get(SettingsModuleEnablementSettings.KEY);
    if (record === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(record.value) as unknown;
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(parsed.filter((entry): entry is string => typeof entry === "string")),
    ].sort();
  }

  setDisabled(moduleIds: readonly string[]): void {
    this.#store().set({
      key: SettingsModuleEnablementSettings.KEY,
      value: JSON.stringify([...new Set(moduleIds)].sort()),
      level: "free",
      updatedBy: this.#updatedBy,
    });
  }
}

/** 掃描或 import 失敗的模組；它沒有進生命週期註冊表，只能顯示。 */
export interface ModuleLoadFailure {
  readonly moduleId: string;
  readonly name: string;
  readonly version: string;
  readonly failure: string;
}

export interface LoadModulesOptions {
  readonly tools: ToolRegistry;
  readonly services: ModuleRuntimeServices;
  readonly events: ModuleEventSink;
  /** 共用的服務註冊表；省略時自己建一個。組合根要先放 `engine` 等服務再載入。 */
  readonly hostServices?: HostServiceRegistryImpl;
  readonly settings?: ModuleEnablementSettings;
  readonly hostApiVersion?: string;
  readonly now?: () => Date;
  /** 記下失敗與被丟棄的事件；省略時不輸出。 */
  readonly warn?: (message: string, fields?: JSONObject) => void;
  /** 要掃描的目錄；省略時是這個檔案所在的 `modules/`。 */
  readonly directory?: string;
}

/** 載入完成的模組主機；閘道與服務生命週期都用這個介面。 */
export interface LoadedModules extends ModuleHostBridge {
  readonly registry: HostModuleRegistry;
  readonly hostServices: HostServiceRegistryImpl;
  readonly loadFailures: readonly ModuleLoadFailure[];
  /** 關機時停用所有模組；重複呼叫是安全的。 */
  deactivateAll(reason?: "shutdown" | "user"): Promise<void>;
}

/**
 * 掃描並啟動第一方模組。
 *
 * 一個模組壞掉不影響其他模組：import、描述檔、相依與啟用失敗都記在
 * `system.modules.get` 的 `failure`，其他模組照常啟動。
 */
export async function loadFirstPartyModules(options: LoadModulesOptions): Promise<LoadedModules> {
  const hostServices = options.hostServices ?? new HostServiceRegistryImpl();
  const registry = new HostModuleRegistry({
    tools: options.tools,
    services: options.services,
    events: options.events,
    hostServices,
    ...(options.hostApiVersion === undefined ? {} : { hostApiVersion: options.hostApiVersion }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.warn === undefined ? {} : { warn: options.warn }),
  });
  const settings = options.settings ?? new MemoryModuleEnablementSettings();
  const failures = new Map<string, ModuleLoadFailure>();
  const directory = options.directory ?? fileURLToPath(new URL("./", import.meta.url));

  const candidates: HostModule[] = [];
  for (const moduleId of await listModuleDirectories(directory)) {
    try {
      const module = await importModuleFile(directory, moduleId);
      candidates.push(module);
    } catch (error) {
      failures.set(moduleId, {
        moduleId,
        name: moduleId,
        version: "",
        failure: messageOf(error),
      });
      options.warn?.("模組載入失敗", { moduleId, message: messageOf(error) });
    }
  }

  const ordered = orderByDependencies(candidates, failures);
  // 沒有模組時不要讀設定：記憶體組裝的設定來源可能要開資料庫，沒必要為空
  // 掃描付出這個代價。
  const disabled = candidates.length === 0 ? new Set<string>() : new Set(await settings.disabled());
  const enabledState = (moduleId: string): boolean => !disabled.has(moduleId);
  for (const module of ordered) {
    const isDisabled = disabled.has(module.manifest.id);
    try {
      await registry.load(module, { inactive: isDisabled });
    } catch (error) {
      failures.set(module.manifest.id, {
        moduleId: module.manifest.id,
        name: module.manifest.name,
        version: module.manifest.version,
        failure: messageOf(error),
      });
      options.warn?.("模組描述檔不合法", {
        moduleId: module.manifest.id,
        message: messageOf(error),
      });
    }
  }

  for (const module of ordered) {
    const moduleId = module.manifest.id;
    if (disabled.has(moduleId) || failures.has(moduleId)) continue;
    await registry.activate(moduleId);
  }

  const infoOf = (moduleId: string): ModuleInfo => {
    const failure = failures.get(moduleId);
    const enabled = enabledState(moduleId);
    if (failure !== undefined) {
      return {
        moduleId,
        name: failure.name,
        version: failure.version,
        enabled,
        state: "failed",
        failure: failure.failure,
        protocolPrefixes: [],
        settings: [],
      };
    }
    const info = registry.infoOf(moduleId, enabled);
    if (info === null) {
      throw new Error(`模組 ${moduleId} 不在註冊表裡`);
    }
    return info;
  };

  return {
    registry,
    hostServices,
    loadFailures: [...failures.values()].sort((left, right) =>
      left.moduleId.localeCompare(right.moduleId),
    ),
    listModules(): readonly ModuleInfo[] {
      const ids = new Set<string>([
        ...failures.keys(),
        ...registry.list().map((r) => r.identity.id),
      ]);
      return [...ids].sort().map(infoOf);
    },
    async setModuleEnabled(moduleId: string, enabled: boolean): Promise<ModuleInfo> {
      const known =
        failures.has(moduleId) || registry.list().some((record) => record.identity.id === moduleId);
      if (!known) {
        throw new ModuleLifecycleFailure("not-found", moduleId, `找不到模組 ${moduleId}`);
      }
      const loadFailure = failures.get(moduleId);
      if (loadFailure !== undefined) {
        throw new ModuleLifecycleFailure(
          "activation-failed",
          moduleId,
          `模組 ${moduleId} 載入失敗：${loadFailure.failure}`,
        );
      }
      const current = infoOf(moduleId);
      if (current.enabled === enabled) {
        return current;
      }
      const nextDisabled = new Set(await settings.disabled());
      if (enabled) {
        nextDisabled.delete(moduleId);
      } else {
        nextDisabled.add(moduleId);
      }
      await settings.setDisabled([...nextDisabled].sort());
      if (enabled) {
        disabled.delete(moduleId);
      } else {
        disabled.add(moduleId);
      }
      if (enabled) {
        const record = registry.record(moduleId);
        if (record !== null && record.state !== "active") {
          await registry.activate(moduleId);
        }
      } else {
        const record = registry.record(moduleId);
        if (record !== null && record.state === "active") {
          await registry.deactivate(moduleId, { reason: "user", cascade: true });
        }
      }
      return infoOf(moduleId);
    },
    hasExactHandler(type: string): boolean {
      return registry.protocol.hasExact(type);
    },
    hasPrefixHandler(type: string): boolean {
      return registry.protocol.hasPrefix(type);
    },
    dispatchProtocol(request: ProtocolRequestContext): Promise<JsonValue> {
      return registry.protocol.dispatch(request);
    },
    async dispatchHttp(request: ModuleHttpRequest): Promise<ModuleHttpResponse | null> {
      const route = registry.http.find(request.method, request.url.pathname);
      if (route === null) return null;
      return route.handle(request);
    },
    async deactivateAll(reason: "shutdown" | "user" = "shutdown"): Promise<void> {
      await registry.deactivateAll(reason);
    },
  };
}

/** 列出 `modules/` 底下有 `index.js` 的目錄，依名稱排序。 */
async function listModuleDirectories(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (isNotFound(error)) return [];
    throw error;
  });
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const index = join(directory, entry.name, "index.js");
    const exists = await stat(index).then(
      () => true,
      () => false,
    );
    if (exists) ids.push(entry.name);
  }
  return ids.sort();
}

async function importModuleFile(directory: string, moduleId: string): Promise<HostModule> {
  const url = pathToFileURL(join(directory, moduleId, "index.js")).href;
  const loaded: unknown = await import(url);
  return readHostModule(loaded, moduleId);
}

/** 取出並檢查 `hostModule` 的基本形狀；描述檔的細節由註冊表驗。 */
function readHostModule(loaded: unknown, moduleId: string): HostModule {
  if (typeof loaded !== "object" || loaded === null) {
    throw new Error(`模組 ${moduleId} 沒有匯出 hostModule`);
  }
  const hostModule = (loaded as { hostModule?: unknown }).hostModule;
  if (typeof hostModule !== "object" || hostModule === null) {
    throw new Error(`模組 ${moduleId} 沒有匯出 hostModule`);
  }
  const candidate = hostModule as Partial<HostModule>;
  if (typeof candidate.manifest !== "object" || candidate.manifest === null) {
    throw new Error(`模組 ${moduleId} 的 hostModule 缺少描述檔`);
  }
  if (typeof candidate.activate !== "function") {
    throw new Error(`模組 ${moduleId} 的 hostModule 缺少 activate`);
  }
  if (candidate.manifest.id !== moduleId) {
    throw new Error(`模組目錄 ${moduleId} 與描述檔的識別碼 ${String(candidate.manifest.id)} 不同`);
  }
  return candidate as HostModule;
}

/**
 * 依相依關係排序；缺少必要相依與循環都標成載入失敗，其他模組照常。
 *
 * 排序穩定：同一層依模組識別碼。
 */
function orderByDependencies(
  modules: readonly HostModule[],
  failures: Map<string, ModuleLoadFailure>,
): HostModule[] {
  const byId = new Map(modules.map((module) => [module.manifest.id, module]));
  for (const module of modules) {
    for (const dependency of module.manifest.dependencies) {
      if (dependency.optional === true) continue;
      if (byId.has(dependency.moduleId)) continue;
      failures.set(module.manifest.id, {
        moduleId: module.manifest.id,
        name: module.manifest.name,
        version: module.manifest.version,
        failure: `缺少相依模組 ${dependency.moduleId}`,
      });
      break;
    }
  }
  const ready = modules.filter((module) => !failures.has(module.manifest.id));
  const ordered: HostModule[] = [];
  const placed = new Set<string>();
  while (ordered.length < ready.length) {
    const next = ready
      .filter((module) => !placed.has(module.manifest.id))
      .filter((module) =>
        module.manifest.dependencies
          .filter((dependency) => dependency.optional !== true)
          .every((dependency) => placed.has(dependency.moduleId)),
      )
      .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id))[0];
    if (next === undefined) {
      for (const module of ready) {
        if (placed.has(module.manifest.id)) continue;
        failures.set(module.manifest.id, {
          moduleId: module.manifest.id,
          name: module.manifest.name,
          version: module.manifest.version,
          failure: "相依關係有循環，無法決定啟用順序",
        });
      }
      break;
    }
    placed.add(next.manifest.id);
    ordered.push(next);
  }
  return ordered;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT"
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
