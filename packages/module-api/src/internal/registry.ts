import type { ToolBundlePin, ToolRegistry } from "@cardiary/engine-adapter";

import type {
  ContextSectionContribution,
  HookDeclaration,
  ScheduleDeclaration,
} from "../contributions.js";
import type {
  HostModule,
  ModuleActivationContext,
  ModuleDeactivateOptions,
  ModuleGeneration,
  ModuleHost,
  ModuleIdentity,
  ModuleLifecycleError,
  ModuleLifecycleErrorCode,
  ModuleRecord,
  ModuleReloadResult,
  RegistrationHandle,
} from "../lifecycle.js";
import type { ModuleManifest } from "../manifest.js";
import type { ModuleServices } from "../services.js";

/** 生命週期錯誤的實作；呼叫端只依賴 `code` 與 `moduleId`。 */
export class ModuleLifecycleFailure extends Error implements ModuleLifecycleError {
  readonly code: ModuleLifecycleErrorCode;
  readonly moduleId: string;

  constructor(code: ModuleLifecycleErrorCode, moduleId: string, message: string) {
    super(message);
    this.name = "ModuleLifecycleFailure";
    this.code = code;
    this.moduleId = moduleId;
  }
}

interface ModuleEntry {
  module: HostModule;
  identity: ModuleIdentity;
  state: ModuleRecord["state"];
  failure: ModuleRecord["failure"];
  handles: RegistrationHandle[];
  /** 這次啟用的工具組釘選；停用時 retire。 */
  bundles: { bundleId: string; generation: ModuleGeneration }[];
}

/** 模組主機的組裝參數。 */
export interface ModuleHostOptions {
  /** 轉接層的工具註冊表；模組的工具組經它註冊與退役。 */
  readonly tools: ToolRegistry;
  /** 主機介面版本；模組的 `hostApiVersion` 必須相同。 */
  readonly hostApiVersion?: string;
  /** 模組取得的服務；由主機服務提供。 */
  readonly services: ModuleServices;
  /**
   * 列出目前釘選這個模組工具組的對話；重載時用來預告變更。
   * 省略時 `stagedConversationIds` 一律是空陣列。
   */
  readonly listPinnedConversations?: (pins: readonly ToolBundlePin[]) => Promise<readonly string[]>;
  /** 對進行中的對話預告工具組變更；省略時不預告。 */
  readonly stageConversationUpdate?: (
    conversationId: string,
    pins: readonly ToolBundlePin[],
  ) => Promise<void>;
}

const DEFAULT_HOST_API_VERSION = "1";

/**
 * 模組註冊表的實作。
 *
 * 載入只檢查描述檔與相依性；啟用才呼叫 `activate` 並收集註冊。
 * 停用撤銷所有註冊並立即 `retire` 工具組（工具呼叫回 `tool-unavailable`），
 * 重新啟用同一個版本恢復；重載配發新的 generation，舊版保留給已釘選的
 * 進行中對話，新對話用新版。
 */
export class ModuleRegistry implements ModuleHost {
  readonly #entries = new Map<string, ModuleEntry>();
  readonly #options: ModuleHostOptions;
  #generation = 0;

  constructor(options: ModuleHostOptions) {
    this.#options = options;
  }

  async load(module: HostModule): Promise<ModuleRecord> {
    const manifest = module.manifest;
    const existing = this.#entries.get(manifest.id);
    if (existing !== undefined) {
      throw new ModuleLifecycleFailure(
        "already-active",
        manifest.id,
        `模組 ${manifest.id} 已經載入`,
      );
    }
    validateManifest(manifest, this.#options.hostApiVersion ?? DEFAULT_HOST_API_VERSION);
    for (const dependency of manifest.dependencies) {
      if (dependency.optional === true) {
        continue;
      }
      if (!this.#entries.has(dependency.moduleId)) {
        throw new ModuleLifecycleFailure(
          "dependency-missing",
          manifest.id,
          `缺少相依模組 ${dependency.moduleId}`,
        );
      }
    }
    const entry: ModuleEntry = {
      module,
      identity: { id: manifest.id, version: manifest.version, generation: 0 },
      state: "loaded",
      failure: null,
      handles: [],
      bundles: [],
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
    const generation = this.#generation;
    const identity: ModuleIdentity = {
      id: entry.module.manifest.id,
      version: entry.module.manifest.version,
      generation,
    };
    const handles: RegistrationHandle[] = [];
    const bundles: { bundleId: string; generation: ModuleGeneration }[] = [];
    const context = this.#activationContext(identity, handles, bundles);
    try {
      await entry.module.activate(context);
    } catch (error) {
      await this.#disposeAll(handles, false);
      entry.state = "failed";
      entry.failure = {
        message: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
      };
      entry.identity = identity;
      return recordOf(entry);
    }
    entry.identity = identity;
    entry.state = "active";
    entry.failure = null;
    entry.handles = handles;
    entry.bundles = bundles;
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
    } finally {
      await this.#disposeAll(entry.handles, reason === "reload");
      if (reason !== "reload") {
        for (const bundle of entry.bundles) {
          // 停用立即退役：使用該模組的對話失去工具，呼叫回 tool-unavailable。
          // 重載不退役：舊 generation 要留給已釘選的進行中對話。
          await this.#options.tools.retire(bundle.bundleId, bundle.generation);
        }
      }
      entry.handles = [];
      entry.bundles = [];
      entry.state = "inactive";
    }
    return recordOf(entry);
  }

  async reload(moduleId: string, next?: HostModule): Promise<ModuleReloadResult> {
    const entry = this.#require(moduleId);
    const previousGeneration = entry.identity.generation;
    const previousBundles = [...entry.bundles];
    if (entry.state === "active") {
      await this.deactivate(moduleId, { reason: "reload" });
    }
    const replacement = next ?? entry.module;
    if (next !== undefined) {
      validateManifest(next.manifest, this.#options.hostApiVersion ?? DEFAULT_HOST_API_VERSION);
      if (next.manifest.id !== moduleId) {
        throw new ModuleLifecycleFailure("invalid-manifest", moduleId, "重載不能換模組識別碼");
      }
      entry.module = next;
    }
    const record = await this.activate(moduleId);
    const newPins: ToolBundlePin[] =
      record.identity.generation === 0
        ? []
        : entry.bundles.map((bundle) => ({
            bundleId: bundle.bundleId,
            generation: bundle.generation,
          }));
    const stagedConversationIds =
      this.#options.listPinnedConversations === undefined
        ? []
        : [...(await this.#options.listPinnedConversations(previousBundles))];
    if (this.#options.stageConversationUpdate !== undefined) {
      for (const conversationId of stagedConversationIds) {
        await this.#options.stageConversationUpdate(conversationId, newPins);
      }
    }
    void replacement;
    return {
      identity: record.identity,
      previousGeneration,
      timing: { newConversations: "immediate", activeConversations: "next-compaction" },
      stagedConversationIds,
    };
  }

  list(): readonly ModuleRecord[] {
    return [...this.#entries.values()].map(recordOf);
  }

  #activationContext(
    identity: ModuleIdentity,
    handles: RegistrationHandle[],
    bundles: { bundleId: string; generation: ModuleGeneration }[],
  ): ModuleActivationContext {
    let counter = 0;
    const handle = (dispose: () => Promise<void>): RegistrationHandle => {
      counter += 1;
      const registration: RegistrationHandle = {
        registrationId: `${identity.id}:${identity.generation}:${counter}`,
        dispose,
      };
      handles.push(registration);
      return registration;
    };
    return {
      identity,
      services: this.#options.services,
      registerToolBundle: (draft) => {
        const generation = identity.generation;
        bundles.push({ bundleId: draft.bundleId, generation });
        const registration = handle(async () => {
          await this.#options.tools.retire(draft.bundleId, generation);
        });
        (registration as { registrationId: string }).registrationId =
          `${registration.registrationId}:bundle`;
        void this.#options.tools.register({ ...draft, generation });
        return registration;
      },
      registerContextSection: (section: ContextSectionContribution) => {
        void section;
        return handle(async () => {});
      },
      registerHook: (hook: HookDeclaration) => {
        void hook;
        return handle(async () => {});
      },
      registerSchedule: (schedule: ScheduleDeclaration) => {
        void schedule;
        return handle(async () => {});
      },
    };
  }

  async #disposeAll(handles: readonly RegistrationHandle[], keepBundles: boolean): Promise<void> {
    for (const registration of [...handles].reverse()) {
      if (keepBundles && registration.registrationId.endsWith(":bundle")) {
        continue;
      }
      try {
        await registration.dispose();
      } catch {
        // 單一註冊的撤銷失敗不阻擋其他註冊。
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
}

function recordOf(entry: ModuleEntry): ModuleRecord {
  return { identity: entry.identity, state: entry.state, failure: entry.failure };
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function validateManifest(manifest: ModuleManifest, hostApiVersion: string): void {
  if (manifest.id.trim().length === 0) {
    throw new ModuleLifecycleFailure("invalid-manifest", manifest.id, "模組識別碼不能是空的");
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
  // 未標明等級的設定一律視為「僅限人類」。
  for (const setting of manifest.settings) {
    if (setting.level === undefined) {
      (setting as { level?: string }).level = "human-only";
    }
  }
}

/** 建立模組主機。 */
export function createModuleHost(options: ModuleHostOptions): ModuleHost {
  return new ModuleRegistry(options);
}
