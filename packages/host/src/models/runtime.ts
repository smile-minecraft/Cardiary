import {
  createModelCompletion,
  type JsonValue,
  type ModelCompletion,
  type ProviderCredentialSource,
} from "@cardiary/engine-adapter";
import type {
  ModelInvocationRequest,
  ModelInvocationResult,
  ModelInvoker,
} from "@cardiary/module-api";
import type {
  JSONValue as ProtocolJSONValue,
  ModelInfo,
  ModelProviderInfo,
  ModelRole,
  SystemModelsState,
} from "@cardiary/protocol";

import type { HostEngine } from "../engine/types.js";
import { ModelInvocationError, ModelSettingsError } from "./errors.js";
import { fetchProviderModels } from "./providers.js";
import {
  findModel,
  modelSettingsOf,
  modelsStateOf,
  normalizeSetInput,
  resolveRoles,
  snapshotOf,
  toEngineProvider,
  validateRoleReferences,
} from "./state.js";
import {
  MODEL_SETTING_KEYS,
  SUMMARY_MAX_OUTPUT_TOKENS,
  MODEL_ROLES,
  type ModelsSnapshot,
  type RoleResolution,
} from "./types.js";
import type { SettingsService } from "../settings/service.js";

/**
 * 主機的模型執行環境。
 *
 * - 角色解析只在主機發生；引擎只拿到「每個角色用哪個模型」。
 * - `system.models.set` 只影響新對話：引擎建立對話時就固定模型，這裡
 *   只換之後的新對話與背景呼叫會用的設定。
 * - 金鑰不進記憶體以外的任何地方；`ProviderCredentialSource` 在請求
 *   當下才被呼叫。
 */
export class ModelRuntime implements ModelInvoker {
  readonly #engine: HostEngine;
  readonly #settings: SettingsService;
  readonly #credentials: ProviderCredentialSource;
  readonly #warn: (message: string, fields?: Readonly<Record<string, JsonValue>>) => void;
  readonly #fetchModels: typeof fetchProviderModels;
  readonly #aggregatorCache = new Map<string, readonly ModelInfo[]>();
  readonly #listeners = new Set<(state: SystemModelsState) => void>();
  #snapshot: ModelsSnapshot = snapshotOf([], new Map());

  constructor(options: {
    readonly engine: HostEngine;
    readonly settings: SettingsService;
    readonly credentials: ProviderCredentialSource;
    readonly warn?: (message: string, fields?: Readonly<Record<string, JsonValue>>) => void;
    /** 測試用：換掉聚合平台清單的抓取實作。 */
    readonly fetchModels?: typeof fetchProviderModels;
  }) {
    this.#engine = options.engine;
    this.#settings = options.settings;
    this.#credentials = options.credentials;
    this.#warn = options.warn ?? (() => {});
    this.#fetchModels = options.fetchModels ?? fetchProviderModels;
  }

  /**
   * 從 `settings` 載入已存的設定。
   *
   * 只有解析出主力模型時才呼叫 `configureModels`：測試與腳本化模型會在
   * 啟動時自己設定模型，空的設定不應該把他們蓋掉。
   */
  async initialize(): Promise<void> {
    const providers = readProviders(this.#settings.get(MODEL_SETTING_KEYS.providers));
    const roles = readRoles(this.#settings.get(MODEL_SETTING_KEYS.roles));
    this.#snapshot = snapshotOf(providers, roles);
    if (this.#snapshot.resolved.main.selection !== null) {
      await this.#engine.configureModels(modelSettingsOf(this.#snapshot));
    }
  }

  get state(): SystemModelsState {
    return modelsStateOf(this.#snapshot);
  }

  /** 這一刻的完整設定；給閘道判斷有沒有主力模型。 */
  stateSnapshot(): SystemModelsState {
    return this.state;
  }

  configured(): boolean {
    return this.#snapshot.resolved.main.selection !== null;
  }

  role(role: ModelRole): RoleResolution {
    return this.#snapshot.resolved[role];
  }

  providers(): readonly ModelProviderInfo[] {
    return this.#snapshot.providers;
  }

  /** 摘要的輸出上限；設定低於 4,096 時仍用 4,096。 */
  summaryMaxOutputTokens(): number {
    const configured = this.#settings.getNumber(
      MODEL_SETTING_KEYS.summaryMaxOutputTokens,
      SUMMARY_MAX_OUTPUT_TOKENS,
    );
    return Math.max(SUMMARY_MAX_OUTPUT_TOKENS, configured);
  }

  onChange(listener: (state: SystemModelsState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * 套用一次 `system.models.set`。
   *
   * 聚合平台的清單先抓一次；抓不到就用上次成功的清單，再沒有就保留
   * 靜態宣告，不讓清單端點壞掉時整個設定失敗。
   */
  async apply(
    input: { readonly providers?: unknown; readonly roles?: unknown },
    actor: string,
  ): Promise<SystemModelsState> {
    const normalized = normalizeSetInput(
      {
        providers: input.providers,
        roles: input.roles,
        currentProviders: this.#snapshot.providers,
        currentRoles: this.#snapshot.roles,
      },
      // 聚合平台的模型清單要抓完才知道角色指到的模型是否存在。
      { validateReferences: false },
    );
    const providers = await this.#refreshAggregators(normalized.providers);
    validateRoleReferences(providers, normalized.roles);
    const next = snapshotOf(providers, normalized.roles);

    const previous = this.#snapshot;
    try {
      await this.#engine.configureModels(modelSettingsOf(next));
    } catch (error) {
      // 引擎不接受這份設定時，回到上一份，不留下半套狀態。
      await this.#engine.configureModels(modelSettingsOf(previous)).catch(() => undefined);
      throw error;
    }
    try {
      // 供應商與角色是同一個設定的兩半，同一個交易寫入：失敗時兩鍵都不變。
      this.#settings.setMany([
        {
          key: MODEL_SETTING_KEYS.providers,
          value: providers as unknown as ProtocolJSONValue,
          actor,
          level: "approval",
        },
        {
          key: MODEL_SETTING_KEYS.roles,
          value: [...next.roles.values()] as unknown as ProtocolJSONValue,
          actor,
          level: "approval",
        },
      ]);
    } catch (error) {
      this.#snapshot = previous;
      await this.#engine.configureModels(modelSettingsOf(previous)).catch(() => undefined);
      throw error;
    }
    this.#snapshot = next;
    const state = this.state;
    for (const listener of [...this.#listeners]) {
      try {
        listener(state);
      } catch {
        // 監聽者的錯誤不影響設定結果。
      }
    }
    return state;
  }

  /** 背景模型呼叫；角色每次呼叫都重新解析，設定變更會影響之後的呼叫。 */
  async invoke(
    request: ModelInvocationRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ModelInvocationResult> {
    const resolved = this.#snapshot.resolved[request.role];
    const primary = resolved.selection;
    if (primary === null) {
      throw new ModelInvocationError(
        "model_not_configured",
        `角色 ${request.role} 沒有可用的模型。`,
      );
    }
    const prompt = promptOf(request);
    const requested = request.maxOutputTokens;
    const required =
      request.role === "small"
        ? Math.max(this.summaryMaxOutputTokens(), requested ?? 0)
        : requested;

    let selection = primary;
    const capacity = capacityOf(this.#snapshot.providers, primary);
    if (required !== undefined && capacity !== undefined && capacity < required) {
      const main = this.#snapshot.resolved.main.selection;
      const mainCapacity = main === null ? undefined : capacityOf(this.#snapshot.providers, main);
      if (
        request.role !== "main" &&
        main !== null &&
        (mainCapacity === undefined || mainCapacity >= required)
      ) {
        selection = main;
      } else {
        throw new ModelInvocationError(
          "output_limit_exceeded",
          `模型 ${primary.provider}/${primary.model} 的輸出上限不足 ${required} tokens。`,
        );
      }
    }

    const completion = this.#completion();
    let result;
    try {
      result = await completion.complete({
        provider: selection.provider,
        model: selection.model,
        prompt,
        ...(required === undefined ? {} : { maxOutputTokens: required }),
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
    } finally {
      await completion.close();
    }
    if (result.stopReason === "error" || result.failure !== undefined) {
      const failure = result.failure;
      throw new ModelInvocationError(
        failure?.reason ?? "provider_error",
        failure?.message ?? "模型呼叫失敗。",
        failure?.retryable ?? false,
        failure?.retryAfterMs,
      );
    }
    if (result.stopReason === "length") {
      throw new ModelInvocationError(
        "output_limit_exceeded",
        `模型 ${selection.provider}/${selection.model} 的輸出撞到上限 ${required ?? "未知"} tokens，結果不完整。`,
      );
    }
    return { text: result.text };
  }

  #completion(): ModelCompletion {
    return createModelCompletion({
      credentials: this.#credentials,
      providers: this.#snapshot.providers.map(toEngineProvider),
    });
  }

  async #refreshAggregators(
    providers: readonly ModelProviderInfo[],
  ): Promise<readonly ModelProviderInfo[]> {
    const updated: ModelProviderInfo[] = [];
    for (const provider of providers) {
      if (provider.kind !== "aggregator") {
        updated.push(provider);
        continue;
      }
      try {
        const models = await this.#fetchModels(provider, {
          credentials: this.#credentials,
        });
        this.#aggregatorCache.set(provider.providerId, models);
        updated.push({ ...provider, models: [...models] });
      } catch (error) {
        const cached = this.#aggregatorCache.get(provider.providerId);
        if (cached !== undefined) {
          updated.push({ ...provider, models: [...cached] });
        } else {
          updated.push(provider);
        }
        this.#warn("聚合平台的模型清單抓取失敗，沿用現有清單", {
          providerId: provider.providerId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return updated;
  }
}

/** 主機提供給模組與閘道的模型服務；`ModelInvoker` 之外多出狀態查詢。 */
export interface ModelService extends ModelInvoker {
  readonly state: SystemModelsState;
  configured(): boolean;
  role(role: ModelRole): RoleResolution;
  apply(
    input: { readonly providers?: unknown; readonly roles?: unknown },
    actor: string,
  ): Promise<SystemModelsState>;
}

export function readProviders(value: JsonValue | undefined): ModelProviderInfo[] {
  if (!Array.isArray(value)) return [];
  try {
    return normalizeStoredProviders(value);
  } catch {
    return [];
  }
}

export function readRoles(
  value: JsonValue | undefined,
): Map<ModelRole, import("@cardiary/protocol").ModelRoleSelection> {
  const roles = new Map<ModelRole, import("@cardiary/protocol").ModelRoleSelection>();
  if (!Array.isArray(value)) return roles;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.role !== "string" || !MODEL_ROLES.includes(record.role as ModelRole)) {
      continue;
    }
    if (record.mode !== "unset" && record.mode !== "none" && record.mode !== "model") continue;
    if (record.mode === "model") {
      const ref = record.ref;
      if (typeof ref !== "object" || ref === null) continue;
      const providerId = (ref as Record<string, unknown>).providerId;
      const modelId = (ref as Record<string, unknown>).modelId;
      if (typeof providerId !== "string" || typeof modelId !== "string") continue;
      roles.set(record.role as ModelRole, {
        role: record.role as ModelRole,
        mode: "model",
        ref: { providerId, modelId },
      });
      continue;
    }
    roles.set(record.role as ModelRole, {
      role: record.role as ModelRole,
      mode: record.mode,
    });
  }
  return roles;
}

function normalizeStoredProviders(value: readonly JsonValue[]): ModelProviderInfo[] {
  // 已存的資料由同一個模組寫入；這裡只做形狀檢查，壞掉的資料視為沒有設定。
  const providers: ModelProviderInfo[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.providerId !== "string" || typeof record.kind !== "string") continue;
    if (record.kind !== "api-key" && record.kind !== "aggregator" && record.kind !== "local") {
      continue;
    }
    if (typeof record.displayName !== "string" || !Array.isArray(record.models)) continue;
    providers.push(entry as unknown as ModelProviderInfo);
  }
  return providers;
}

function capacityOf(
  providers: readonly ModelProviderInfo[],
  selection: { readonly provider: string; readonly model: string },
): number | undefined {
  return findModel(providers, {
    providerId: selection.provider,
    modelId: selection.model,
  })?.model.maxOutputTokens;
}

function promptOf(request: ModelInvocationRequest): string {
  if (request.attachments === undefined || request.attachments.length === 0) {
    return request.prompt;
  }
  const parts = [request.prompt];
  for (const block of request.attachments) {
    if (block.type !== "text") {
      throw new ModelInvocationError("unsupported", "M1 的背景模型呼叫只接受文字附件。");
    }
    parts.push(block.text);
  }
  return parts.join("\n\n");
}

export { ModelSettingsError, resolveRoles };
