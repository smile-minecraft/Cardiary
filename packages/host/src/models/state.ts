import { defaultBaseUrl, isCredentialSafeBaseUrl } from "@cardiary/engine-adapter";
import type { ModelProviderConfig, ModelSelection } from "@cardiary/engine-adapter";
import type {
  ModelInfo,
  ModelInputKind,
  ModelProviderInfo,
  ModelProviderKind,
  ModelRole,
  ModelRoleSelection,
  ModelRef,
  ResolvedModelRole,
  SystemModelsState,
} from "@cardiary/protocol";

import { ModelSettingsError } from "./errors.js";
import {
  MODEL_ROLES,
  type ModelsSnapshot,
  type ResolvedRoles,
  type RoleResolution,
} from "./types.js";

/**
 * 模型設定的驗證、正規化與角色解析。
 *
 * 解析只在主機發生；引擎只拿到「每個角色用哪個模型」。這裡是純函式，
 * 不讀資料庫、不呼叫供應商，方便用單元測試窮舉退回規則。
 */

const PROVIDER_KINDS: readonly ModelProviderKind[] = ["api-key", "aggregator", "local"];
const INPUT_KINDS: readonly ModelInputKind[] = ["text", "image", "audio"];

/** 解析用的佔位模型；沒有設定 main 時引擎仍要有合法的角色值。 */
export const UNCONFIGURED_MODEL: ModelSelection = {
  provider: "unconfigured",
  model: "unconfigured",
};

export interface NormalizedSetInput {
  readonly providers: readonly ModelProviderInfo[];
  readonly roles: ReadonlyMap<ModelRole, ModelRoleSelection>;
}

/**
 * 驗證並正規化一次 `system.models.set`。
 *
 * `providers` 是整份取代；`roles` 只改列出的角色。最後的狀態必須自洽：
 * 角色指到的供應商與模型都要存在，否則回 `ModelSettingsError`。
 */
export function normalizeSetInput(
  input: {
    readonly providers: unknown;
    readonly roles: unknown;
    readonly currentProviders: readonly ModelProviderInfo[];
    readonly currentRoles: ReadonlyMap<ModelRole, ModelRoleSelection>;
  },
  options: { readonly validateReferences?: boolean } = {},
): NormalizedSetInput {
  const providers =
    input.providers === undefined
      ? [...input.currentProviders]
      : normalizeProviders(input.providers);
  const roles = new Map(input.currentRoles);
  if (input.roles !== undefined) {
    for (const selection of normalizeRoleSelections(input.roles)) {
      roles.set(selection.role, selection);
    }
  }
  if (options.validateReferences !== false) {
    validateRoleReferences(providers, roles);
  }
  return { providers, roles };
}

export function normalizeProviders(value: unknown): ModelProviderInfo[] {
  if (!Array.isArray(value)) {
    throw new ModelSettingsError("providers", "providers 必須是陣列。");
  }
  const seen = new Set<string>();
  const providers: ModelProviderInfo[] = [];
  for (const [index, entry] of value.entries()) {
    const field = `providers[${index}]`;
    if (!isRecord(entry)) {
      throw new ModelSettingsError(field, `${field} 必須是物件。`);
    }
    const providerId = requiredString(entry.providerId, `${field}.providerId`);
    if (seen.has(providerId)) {
      throw new ModelSettingsError(`${field}.providerId`, `供應商 ${providerId} 重複。`);
    }
    seen.add(providerId);
    const kind = entry.kind;
    if (typeof kind !== "string" || !PROVIDER_KINDS.includes(kind as ModelProviderKind)) {
      throw new ModelSettingsError(`${field}.kind`, `${field}.kind 不是支援的接入方式。`);
    }
    const displayName = requiredString(entry.displayName, `${field}.displayName`);
    const baseUrl = optionalString(entry.baseUrl, `${field}.baseUrl`);
    if (baseUrl !== undefined) validateBaseUrl(baseUrl, `${field}.baseUrl`);
    if (kind !== "api-key" && baseUrl === undefined) {
      throw new ModelSettingsError(`${field}.baseUrl`, `${kind} 必須提供 baseUrl。`);
    }
    if (kind === "api-key" && baseUrl === undefined && defaultBaseUrl(providerId) === undefined) {
      throw new ModelSettingsError(
        `${field}.baseUrl`,
        `供應商 ${providerId} 沒有預設端點，請提供 baseUrl。`,
      );
    }
    const credentialRef =
      optionalString(entry.credentialRef, `${field}.credentialRef`) ??
      `cardiary/provider/${providerId}`;
    if (kind !== "local" && credentialRef.length === 0) {
      throw new ModelSettingsError(`${field}.credentialRef`, "這個接入方式需要 credentialRef。");
    }
    const models = normalizeModels(entry.models, `${field}.models`);
    if (kind !== "aggregator" && models.length === 0) {
      throw new ModelSettingsError(`${field}.models`, "這個接入方式至少要宣告一個模型。");
    }
    providers.push({
      providerId,
      kind: kind as ModelProviderKind,
      displayName,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      credentialRef,
      models,
    });
  }
  return providers;
}

function normalizeModels(value: unknown, field: string): ModelInfo[] {
  if (!Array.isArray(value)) {
    throw new ModelSettingsError(field, `${field} 必須是陣列。`);
  }
  const seen = new Set<string>();
  const models: ModelInfo[] = [];
  for (const [index, entry] of value.entries()) {
    const itemField = `${field}[${index}]`;
    if (!isRecord(entry)) {
      throw new ModelSettingsError(itemField, `${itemField} 必須是物件。`);
    }
    const modelId = requiredString(entry.modelId, `${itemField}.modelId`);
    if (seen.has(modelId)) {
      throw new ModelSettingsError(`${itemField}.modelId`, `模型 ${modelId} 重複。`);
    }
    seen.add(modelId);
    const contextWindow = requiredPositiveInteger(
      entry.contextWindow,
      `${itemField}.contextWindow`,
    );
    const maxOutputTokens =
      entry.maxOutputTokens === undefined
        ? undefined
        : requiredPositiveInteger(entry.maxOutputTokens, `${itemField}.maxOutputTokens`);
    const displayName = optionalString(entry.displayName, `${itemField}.displayName`);
    const input = normalizeInput(entry.input, `${itemField}.input`);
    models.push({
      modelId,
      ...(displayName === undefined ? {} : { displayName }),
      contextWindow,
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      input,
    });
  }
  return models;
}

function normalizeInput(value: unknown, field: string): ModelInputKind[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ModelSettingsError(field, `${field} 必須是非空陣列。`);
  }
  const kinds: ModelInputKind[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || !INPUT_KINDS.includes(entry as ModelInputKind)) {
      throw new ModelSettingsError(`${field}[${index}]`, `${field} 含不支援的輸入種類。`);
    }
    if (!kinds.includes(entry as ModelInputKind)) {
      kinds.push(entry as ModelInputKind);
    }
  }
  return kinds;
}

export function normalizeRoleSelections(value: unknown): ModelRoleSelection[] {
  if (!Array.isArray(value)) {
    throw new ModelSettingsError("roles", "roles 必須是陣列。");
  }
  const seen = new Set<ModelRole>();
  const selections: ModelRoleSelection[] = [];
  for (const [index, entry] of value.entries()) {
    const field = `roles[${index}]`;
    if (!isRecord(entry)) {
      throw new ModelSettingsError(field, `${field} 必須是物件。`);
    }
    const role = entry.role;
    if (typeof role !== "string" || !MODEL_ROLES.includes(role as ModelRole)) {
      throw new ModelSettingsError(`${field}.role`, `${field}.role 不是支援的角色。`);
    }
    if (seen.has(role as ModelRole)) {
      throw new ModelSettingsError(`${field}.role`, `角色 ${role} 重複。`);
    }
    seen.add(role as ModelRole);
    const mode = entry.mode;
    if (mode !== "unset" && mode !== "none" && mode !== "model") {
      throw new ModelSettingsError(`${field}.mode`, `${field}.mode 不是支援的值。`);
    }
    if (role === "main" && mode !== "model") {
      throw new ModelSettingsError(`${field}.mode`, "主力模型一定要指定模型。");
    }
    if (mode !== "model") {
      if (entry.ref !== undefined) {
        throw new ModelSettingsError(`${field}.ref`, "未設定或設為無時不能帶 ref。");
      }
      // 小模型與寫作沒有「無」；明確設為無等於走退回規則。
      const normalizedMode = mode === "none" && role !== "system-one" ? "unset" : mode;
      selections.push({ role: role as ModelRole, mode: normalizedMode });
      continue;
    }
    if (!isRecord(entry.ref)) {
      throw new ModelSettingsError(`${field}.ref`, "指定模型時要帶 ref。");
    }
    const providerId = requiredString(entry.ref.providerId, `${field}.ref.providerId`);
    const modelId = requiredString(entry.ref.modelId, `${field}.ref.modelId`);
    selections.push({
      role: role as ModelRole,
      mode: "model",
      ref: { providerId, modelId },
    });
  }
  return selections;
}

export function validateRoleReferences(
  providers: readonly ModelProviderInfo[],
  roles: ReadonlyMap<ModelRole, ModelRoleSelection>,
): void {
  for (const role of MODEL_ROLES) {
    const selection = roles.get(role);
    if (selection === undefined || selection.mode !== "model" || selection.ref === undefined) {
      continue;
    }
    if (findModel(providers, selection.ref) === undefined) {
      throw new ModelSettingsError(
        "roles",
        `角色 ${role} 指定的模型不在供應商清單：${selection.ref.providerId}/${selection.ref.modelId}`,
      );
    }
  }
}

export function findModel(
  providers: readonly ModelProviderInfo[],
  ref: ModelRef,
): { readonly provider: ModelProviderInfo; readonly model: ModelInfo } | undefined {
  const provider = providers.find((entry) => entry.providerId === ref.providerId);
  const model = provider?.models.find((entry) => entry.modelId === ref.modelId);
  if (provider === undefined || model === undefined) {
    return undefined;
  }
  return { provider, model };
}

/**
 * 套用退回規則。
 *
 * `main` 沒有設定就沒有主力，其他角色也跟著沒有；`system-one` 明確設為
 * 「無」時不啟用，未設定才退回小模型（小模型可能再退回主力）。
 */
export function resolveRoles(
  providers: readonly ModelProviderInfo[],
  roles: ReadonlyMap<ModelRole, ModelRoleSelection>,
): ResolvedRoles {
  const main = resolveConfigured(providers, roles.get("main")) ?? none("main");
  const smallConfigured = resolveConfigured(providers, roles.get("small"));
  const small = smallConfigured ?? fallback("small", "fallback-main", main) ?? none("small");
  const writing =
    resolveConfigured(providers, roles.get("writing")) ??
    fallback("writing", "fallback-main", main) ??
    none("writing");
  const systemOneSelection = roles.get("system-one");
  let systemOne: RoleResolution;
  if (systemOneSelection?.mode === "none") {
    systemOne = none("system-one");
  } else {
    systemOne =
      resolveConfigured(providers, systemOneSelection) ??
      fallback("system-one", "fallback-small", small) ??
      none("system-one");
  }
  return {
    main,
    small,
    writing,
    "system-one": systemOne,
    list: [main, small, writing, systemOne],
  };
}

/** 退回另一個角色時建立新的解析結果，來源要標成退回，不能沿用對方那一筆。 */
function fallback(
  role: ModelRole,
  source: ResolvedModelRole["source"],
  from: RoleResolution,
): RoleResolution | null {
  if (from.selection === null) {
    return null;
  }
  return { role, source, selection: from.selection, ref: from.ref };
}

function resolveConfigured(
  providers: readonly ModelProviderInfo[],
  selection: ModelRoleSelection | undefined,
): RoleResolution | null {
  if (selection?.mode !== "model" || selection.ref === undefined) {
    return null;
  }
  if (findModel(providers, selection.ref) === undefined) {
    return null;
  }
  return {
    role: selection.role,
    source: "configured",
    selection: {
      provider: selection.ref.providerId,
      model: selection.ref.modelId,
    },
    ref: selection.ref,
  };
}

function none(role: ModelRole): RoleResolution {
  return { role, source: "none", selection: null, ref: null };
}

/** 解析結果轉成引擎要的角色設定；沒有解析到模型的角色用佔位值。 */
export function engineRolesOf(
  resolved: ResolvedRoles,
): Readonly<Record<ModelRole, ModelSelection>> {
  const of = (role: RoleResolution): ModelSelection => role.selection ?? UNCONFIGURED_MODEL;
  return {
    main: of(resolved.main),
    small: of(resolved.small),
    writing: of(resolved.writing),
    "system-one": of(resolved["system-one"]),
  };
}

/** 建立主機內部的快照；`state` 與協定 `system.models.*` 同形。 */
export function snapshotOf(
  providers: readonly ModelProviderInfo[],
  roles: ReadonlyMap<ModelRole, ModelRoleSelection>,
): ModelsSnapshot {
  const resolved = resolveRoles(providers, roles);
  return {
    providers: [...providers],
    roles: new Map(roles),
    resolved,
    engineRoles: engineRolesOf(resolved),
  };
}

export function modelsStateOf(snapshot: ModelsSnapshot): SystemModelsState {
  return {
    providers: snapshot.providers.map((provider) => ({
      ...provider,
      models: provider.models.map((model) => ({ ...model })),
    })),
    roles: MODEL_ROLES.map(
      (role): ModelRoleSelection => snapshot.roles.get(role) ?? { role, mode: "unset" },
    ),
    resolved: snapshot.resolved.list.map((entry) => ({
      role: entry.role,
      source: entry.source,
      ...(entry.ref === null ? {} : { ref: entry.ref }),
    })),
  };
}

/** 協定的供應商設定轉成引擎轉接層的形狀；金鑰只留 `credentialRef`。 */
export function toEngineProvider(provider: ModelProviderInfo): ModelProviderConfig {
  return {
    provider: provider.providerId,
    label: provider.displayName,
    ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
    credentialRef: provider.credentialRef ?? `cardiary/provider/${provider.providerId}`,
    credentialRequired: provider.kind !== "local",
    models: provider.models.map((model) => ({
      id: model.modelId,
      displayName: model.displayName ?? model.modelId,
      contextWindow: model.contextWindow,
      ...(model.maxOutputTokens === undefined ? {} : { maxOutputTokens: model.maxOutputTokens }),
      input: [...model.input],
    })),
  };
}

export function modelSettingsOf(snapshot: ModelsSnapshot): {
  readonly providers: ModelProviderConfig[];
  readonly roles: Readonly<Record<ModelRole, ModelSelection>>;
} {
  return {
    providers: snapshot.providers.map(toEngineProvider),
    roles: snapshot.engineRoles,
  };
}

// ---- 輸入檢查 -----------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  const text = optionalString(value, field);
  if (text === undefined || text.trim().length === 0) {
    throw new ModelSettingsError(field, `${field} 必須是非空字串。`);
  }
  return text;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ModelSettingsError(field, `${field} 必須是字串。`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ModelSettingsError(field, `${field} 必須是正整數。`);
  }
  return value;
}

function validateBaseUrl(value: string, field: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ModelSettingsError(field, `${field} 不是合法的網址。`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ModelSettingsError(field, `${field} 必須是 http 或 https。`);
  }
  // 金鑰會跟著請求送到這個端點：不是本機位址就只能用 https。
  if (!isCredentialSafeBaseUrl(value)) {
    throw new ModelSettingsError(field, `${field} 必須是 https；只有本機端點可以用 http。`);
  }
}
