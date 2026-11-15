import type { ProviderCredentialSource } from "@cardiary/engine-adapter";
import type { ModelInfo, ModelInputKind, ModelProviderInfo } from "@cardiary/protocol";

/**
 * 聚合平台的模型清單。
 *
 * 端點是 OpenAI 相容的 `GET <baseUrl>/models`；回應的欄位各家不同，這裡
 * 只取模型識別碼、顯示名稱、上下文與輸出上限、輸入種類，缺的用保守
 * 預設值。抓不到時由呼叫端決定用上次成功的清單或靜態宣告。
 */

export interface FetchModelsOptions {
  readonly credentials: ProviderCredentialSource;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface FetchedModels {
  readonly models: readonly ModelInfo[];
}

export class ModelListFetchError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ModelListFetchError";
    this.status = status;
  }
}

export async function fetchProviderModels(
  provider: ModelProviderInfo,
  options: FetchModelsOptions,
): Promise<readonly ModelInfo[]> {
  if (provider.kind !== "aggregator") {
    return provider.models;
  }
  const baseUrl = provider.baseUrl;
  if (baseUrl === undefined) {
    throw new ModelListFetchError("聚合平台需要 baseUrl");
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (provider.credentialRef !== undefined) {
    try {
      const credential = await options.credentials.resolve(provider.credentialRef);
      if (credential.kind !== "none" && credential.secret.length > 0) {
        headers.authorization = `Bearer ${credential.secret}`;
      }
    } catch {
      throw new ModelListFetchError("讀不到聚合平台的憑證");
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  timer.unref?.();
  try {
    const response = await (options.fetchImpl ?? fetch)(`${baseUrl.replace(/\/+$/, "")}/models`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ModelListFetchError("聚合平台回報錯誤", response.status);
    }
    const body = (await response.json()) as unknown;
    return parseModelList(body);
  } catch (error) {
    if (error instanceof ModelListFetchError) throw error;
    throw new ModelListFetchError(
      controller.signal.aborted ? "讀取模型清單逾時" : "連不上聚合平台",
    );
  } finally {
    clearTimeout(timer);
  }
}

export function parseModelList(body: unknown): ModelInfo[] {
  const data = isRecord(body) && Array.isArray(body.data) ? body.data : null;
  if (data === null) {
    throw new ModelListFetchError("模型清單的回應沒有 data 陣列");
  }
  const models: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    const modelId = typeof entry.id === "string" ? entry.id : undefined;
    if (modelId === undefined || modelId.length === 0 || seen.has(modelId)) continue;
    seen.add(modelId);
    const displayName = displayNameOf(entry);
    const maxOutputTokens = maxOutputTokensOf(entry);
    const model: ModelInfo = {
      modelId,
      ...(displayName === undefined ? {} : { displayName }),
      contextWindow: contextWindowOf(entry),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      input: inputKindsOf(entry),
    };
    models.push(model);
  }
  return models;
}

function displayNameOf(entry: Record<string, unknown>): string | undefined {
  for (const key of ["name", "display_name", "displayName"]) {
    const value = entry[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function contextWindowOf(entry: Record<string, unknown>): number {
  for (const key of ["context_window", "context_length", "max_context_length", "contextWindow"]) {
    const value = entry[key];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  }
  return 8_192;
}

function maxOutputTokensOf(entry: Record<string, unknown>): number | undefined {
  for (const key of ["max_output_tokens", "max_completion_tokens", "maxOutputTokens"]) {
    const value = entry[key];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  }
  return undefined;
}

function inputKindsOf(entry: Record<string, unknown>): ModelInputKind[] {
  const raw = Array.isArray(entry.input)
    ? entry.input
    : isRecord(entry.architecture) && Array.isArray(entry.architecture.input_modalities)
      ? entry.architecture.input_modalities
      : null;
  if (raw === null) return ["text"];
  const kinds: ModelInputKind[] = [];
  for (const value of raw) {
    if (value === "image" || value === "audio" || value === "text") {
      if (!kinds.includes(value)) kinds.push(value);
    }
  }
  return kinds.length === 0 ? ["text"] : kinds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
