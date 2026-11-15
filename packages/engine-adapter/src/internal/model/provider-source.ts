import {
  createModels,
  createProvider,
  type ApiKeyAuth,
  type Model,
  type Provider,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

import type { EngineModelSource } from "../../engine.js";
import type {
  ModelDescriptor,
  ModelProviderConfig,
  ProviderCredential,
  ProviderCredentialSource,
} from "../../model.js";
import { redactingFetch } from "./provider-response.js";

/**
 * 真實供應商的模型來源。
 *
 * 每個供應商都是 OpenAI 相容端點；模型清單由主機決定（聚合平台的動態
 * 清單也由主機先抓好再送進來），所以這裡不需要 `fetchModels`。
 *
 * 金鑰不存進模型集合：供應商的 `auth.apiKey.resolve` 每次請求才向
 * `ProviderCredentialSource` 取一次，值只活在那一則請求的 options 裡。
 * pi-ai 的 `Models.applyAuth` 每個請求都會呼叫 `resolve`，因此同一個
 * 模型集合可以重複使用，而鑰匙圈只被讀取、不被保存。
 */

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

/**
 * `kind: "api-key"` 省略 `baseUrl` 時的端點。
 *
 * 只列 OpenAI 相容的供應商；其他供應商（例如 Anthropic Messages）不是
 * OpenAI 相容端點，設定時必須自己給 `baseUrl`。
 */
const DEFAULT_BASE_URLS: Readonly<Record<string, string>> = {
  openai: "https://api.openai.com/v1",
};

/** `api-key` 沒有 `baseUrl` 時可以用的預設端點；沒有就回 `undefined`。 */
export function defaultBaseUrl(provider: string): string | undefined {
  return DEFAULT_BASE_URLS[provider];
}

/**
 * 這個 `baseUrl` 能不能帶著金鑰送出請求。
 *
 * 只有 https，或是 loopback 位址上的 http。loopback 的流量不出機器，
 * 所以本機 OpenAI 相容端點可以用 http；其他位址用 http 會把授權標頭
 * 以明文送到任意端點，等於把既有的金鑰交給對方。
 */
export function isCredentialSafeBaseUrl(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol === "https:") {
    return true;
  }
  return url.protocol === "http:" && isLoopbackHost(url.hostname);
}

/** `localhost`、`127.0.0.0/8` 與 `::1` 視為 loopback。 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "[::1]") {
    return true;
  }
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}

export interface ProviderModelSourceOptions {
  /** 殼提供的憑證來源；只在請求當下呼叫。 */
  readonly credentials: ProviderCredentialSource;
}

/**
 * 建立 `EngineModelSource`。
 *
 * `open()` 只建模型集合，不碰鑰匙圈；真正取金鑰的時機是每一次模型請求。
 */
export function createProviderModelSource(options: ProviderModelSourceOptions): EngineModelSource {
  return {
    async open(settings): Promise<unknown> {
      const models = createModels();
      for (const provider of settings.providers) {
        const built = buildProvider(provider, options.credentials);
        if (built !== null) {
          models.setProvider(built);
        }
      }
      return models;
    },
    async close(): Promise<void> {
      // 模型集合沒有外部資源；金鑰不在集合裡，沒有需要清除的憑證。
    },
  };
}

/**
 * 給同套件的單次呼叫用的供應商建構器。
 *
 * 回傳型別刻意是 `unknown`：引擎套件的型別不進公開的宣告檔，呼叫端
 * 在轉接層內部自己轉成引擎的 `Provider`。
 */
export function buildProviderForModels(
  provider: ModelProviderConfig,
  credentials: ProviderCredentialSource,
): unknown {
  return buildProvider(provider, credentials);
}

function buildProvider(
  provider: ModelProviderConfig,
  credentials: ProviderCredentialSource,
): Provider<"openai-completions"> | null {
  if (provider.models.length === 0) {
    return null;
  }
  const baseUrl = provider.baseUrl ?? defaultBaseUrl(provider.provider);
  if (baseUrl === undefined) {
    throw new Error(`供應商 ${provider.provider} 需要 baseUrl`);
  }
  if (!isCredentialSafeBaseUrl(baseUrl)) {
    throw new Error(`供應商 ${provider.provider} 的 baseUrl 必須是 https；只有本機端點可以用 http`);
  }
  const name = provider.label ?? provider.provider;
  return createProvider({
    id: provider.provider,
    name,
    baseUrl,
    auth: { apiKey: credentialAuth(provider, credentials) },
    models: provider.models.map((descriptor) => toPiModel(provider, baseUrl, descriptor)),
    api: completionsApi(),
  });
}

type CompletionsApi = ReturnType<typeof openAICompletionsApi>;

/**
 * 供應商請求的邊界：每個請求都帶上這次金鑰的清洗。
 *
 * `options.apiKey` 是 pi-ai 從 `credentialAuth` 取到的值，也就是這一則
 * 請求實際送出的金鑰；包好的 fetch 在錯誤回應回到 pi-ai 之前就把它換掉。
 * 本機端點的佔位字串不是憑證，不需要清洗。
 */
function completionsApi(): CompletionsApi {
  const api = openAICompletionsApi();
  return {
    stream: (model, context, options) => api.stream(model, context, withErrorRedaction(options)),
    streamSimple: (model, context, options) =>
      api.streamSimple(model, context, withErrorRedaction(options)),
  };
}

function withErrorRedaction(options: StreamOptions | undefined): StreamOptions {
  const secret = options?.apiKey;
  if (secret === undefined || secret.length === 0 || secret === NO_KEY_PLACEHOLDER) {
    return options ?? {};
  }
  return { ...options, fetch: redactingFetch(options?.fetch, secret) };
}

function credentialAuth(
  provider: ModelProviderConfig,
  credentials: ProviderCredentialSource,
): ApiKeyAuth {
  return {
    name: `Cardiary ${provider.provider}`,
    resolve: async () => ({ auth: { apiKey: await apiKeyFor(provider, credentials) } }),
  };
}

/**
 * 取這一則請求要用的金鑰。
 *
 * 本機端點允許沒有金鑰：讀不到憑證時送空字串，讓請求照常打到端點；
 * 端點若要求認證會回 401，回合以 `credential_invalid` 結束。其他接入
 * 方式沒有金鑰就直接回報 `credential_missing`，不送出請求。
 */
/**
 * 本機端點沒有金鑰時送出的佔位字串。
 *
 * 不是憑證，也沒有任何祕密內容；OpenAI 相容用戶端要求 `apiKey` 非空，
 * 才不會在送出請求前就失敗。端點若真的要求認證，會回 401，回合以
 * `credential_invalid` 結束。
 */
const NO_KEY_PLACEHOLDER = "cardiary-local-no-key";

async function apiKeyFor(
  provider: ModelProviderConfig,
  credentials: ProviderCredentialSource,
): Promise<string> {
  let credential: ProviderCredential;
  try {
    credential = await credentials.resolve(provider.credentialRef);
  } catch {
    if (!requiresCredential(provider)) {
      return NO_KEY_PLACEHOLDER;
    }
    throw missingCredential(provider);
  }
  if (credential.kind === "none") {
    if (requiresCredential(provider)) {
      throw missingCredential(provider);
    }
    return NO_KEY_PLACEHOLDER;
  }
  if (credential.secret.length === 0) {
    if (!requiresCredential(provider)) {
      return NO_KEY_PLACEHOLDER;
    }
    throw missingCredential(provider);
  }
  return credential.secret;
}

function requiresCredential(provider: ModelProviderConfig): boolean {
  return provider.credentialRequired !== false;
}

function missingCredential(provider: ModelProviderConfig): Error {
  return new Error(`供應商 ${provider.provider} 的憑證不存在或讀不到（credential_missing）`);
}

function toPiModel(
  provider: ModelProviderConfig,
  baseUrl: string,
  descriptor: ModelDescriptor,
): Model<"openai-completions"> {
  return {
    id: descriptor.id,
    name: descriptor.displayName ?? descriptor.id,
    api: "openai-completions",
    provider: provider.provider,
    baseUrl,
    input: descriptor.input.includes("image") ? ["text", "image"] : ["text"],
    reasoning: false,
    contextWindow: descriptor.contextWindow,
    maxTokens: descriptor.maxOutputTokens ?? Math.min(descriptor.contextWindow, 4_096),
    cost: ZERO_COST,
    // 本機與聚合端點的相容性未知；只開串流用量，其餘照 OpenAI 預設。
    compat: { supportsStore: false, supportsUsageInStreaming: true },
  };
}
