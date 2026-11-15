import type { Model, Models } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import type {
  ModelProviderConfig,
  ModelSelection,
  ModelSettings,
  ProviderCredentialSource,
} from "../../src/model.js";
import { classifyModelFailure, createProviderModelSource } from "../../src/index.js";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";

const SECRET = "sk-test-model-source-0123456789";

const servers: FakeOpenAI[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }
});

function selection(provider: string, model: string): ModelSelection {
  return { provider, model };
}

function settingsFor(provider: ModelProviderConfig): ModelSettings {
  const main = selection(provider.provider, provider.models[0]?.id ?? "missing");
  return {
    providers: [provider],
    roles: { main, small: main, writing: main, "system-one": main },
  };
}

function providerAt(
  baseUrl: string,
  kind: "local" | "api-key" | "aggregator" = "local",
): ModelProviderConfig {
  return {
    provider: "fake",
    label: "假供應商",
    baseUrl,
    credentialRef: "cardiary/provider/fake",
    credentialRequired: kind !== "local",
    models: [
      {
        id: "fake-model",
        displayName: "假模型",
        contextWindow: 8_192,
        maxOutputTokens: 4_096,
        input: ["text"],
      },
    ],
  };
}

function credentialSource(secret: string | null): ProviderCredentialSource {
  return {
    async resolve() {
      if (secret === null) {
        throw Object.assign(new Error("鑰匙圈找不到憑證"), { code: "model-unavailable" });
      }
      return { provider: "fake", kind: "api-key", secret };
    },
  };
}

async function openModels(
  source: ReturnType<typeof createProviderModelSource>,
  settings: ModelSettings,
): Promise<Models> {
  return (await source.open(settings)) as Models;
}

function modelOf(models: Models): Model<"openai-completions"> {
  const model = models.getModel("fake", "fake-model");
  expect(model).toBeDefined();
  return model as Model<"openai-completions">;
}

async function complete(models: Models): Promise<{
  readonly text: string;
  readonly stopReason: string;
  readonly errorMessage: string | undefined;
}> {
  const message = await models.complete(
    modelOf(models),
    { messages: [{ role: "user", content: "你好", timestamp: Date.now() }] },
    { maxTokens: 128 },
  );
  return {
    text: message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join(""),
    stopReason: message.stopReason,
    errorMessage: message.errorMessage,
  };
}

describe("真實供應商的模型來源", () => {
  it("每次請求向憑證來源取一次金鑰，串流回覆進模型集合", async () => {
    const server = await startFakeOpenAI({ chat: () => ({ kind: "text", text: "你好" }) });
    servers.push(server);
    let resolves = 0;
    const credentials: ProviderCredentialSource = {
      async resolve(ref) {
        resolves += 1;
        expect(ref).toBe("cardiary/provider/fake");
        return { provider: "fake", kind: "api-key", secret: SECRET };
      },
    };
    const source = createProviderModelSource({ credentials });
    const settings = settingsFor(providerAt(server.baseUrl, "api-key"));
    const models = await openModels(source, settings);

    // 開模型集合不能先讀金鑰。
    expect(resolves).toBe(0);
    expect(JSON.stringify(settings).includes(SECRET)).toBe(false);

    const first = await complete(models);
    const second = await complete(models);
    expect(first.stopReason).toBe("stop");
    expect(second.stopReason).toBe("stop");
    expect(first.text).toBe("你好");
    expect(second.text).toBe("你好");
    // 每次請求各取一次，沒有把值留在模型集合裡。
    expect(resolves).toBe(2);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(server.requests[0]?.body.model).toBe("fake-model");
    expect(JSON.stringify(models.getProviders()).includes(SECRET)).toBe(false);
  });

  it("沒有金鑰就不送出請求，回 credential_missing", async () => {
    const server = await startFakeOpenAI({ chat: () => ({ kind: "text", text: "不該出現" }) });
    servers.push(server);
    const source = createProviderModelSource({ credentials: credentialSource(null) });
    const models = await openModels(source, settingsFor(providerAt(server.baseUrl, "api-key")));

    const reply = await complete(models);
    expect(reply.stopReason).toBe("error");
    expect(reply.errorMessage).toContain("credential_missing");
    expect(server.requests).toHaveLength(0);
  });

  it("本機端點沒有金鑰仍照常送出，不假裝有憑證", async () => {
    const server = await startFakeOpenAI({ chat: () => ({ kind: "text", text: "本機" }) });
    servers.push(server);
    const source = createProviderModelSource({ credentials: credentialSource(null) });
    const models = await openModels(source, settingsFor(providerAt(server.baseUrl, "local")));

    const reply = await complete(models);
    expect(reply).toEqual({ text: "本機", stopReason: "stop", errorMessage: undefined });
    expect(server.requests).toHaveLength(1);
    // 佔位字串不是憑證；端點若要求認證會自己拒絕。
    expect(server.requests[0]?.headers.authorization).toBe("Bearer cardiary-local-no-key");
    expect(server.requests[0]?.headers.authorization?.includes(SECRET)).toBe(false);
  });

  it("供應商回 401 時，錯誤文字可以分類成金鑰無效", async () => {
    const server = await startFakeOpenAI({
      chat: () => ({
        kind: "status",
        status: 401,
        body: JSON.stringify({ error: { message: "Incorrect API key provided" } }),
      }),
    });
    servers.push(server);
    const source = createProviderModelSource({ credentials: credentialSource(SECRET) });
    const models = await openModels(source, settingsFor(providerAt(server.baseUrl, "api-key")));

    const reply = await complete(models);
    expect(reply.stopReason).toBe("error");
    expect(classifyModelFailure(reply.errorMessage).reason).toBe("credential_invalid");
  });

  it("非本機的 http 端點會在建立供應商時被拒絕", async () => {
    const source = createProviderModelSource({ credentials: credentialSource(SECRET) });
    await expect(
      source.open(settingsFor(providerAt("http://api.example.com/v1", "api-key"))),
    ).rejects.toThrow(/https/);
    // https 的非本機端點可以建立；這裡只驗證設定，不會真的送出請求。
    await expect(
      source.open(settingsFor(providerAt("https://api.example.com/v1", "api-key"))),
    ).resolves.toBeDefined();
  });

  it("供應商回 429 時分類成額度用盡，並標成可重試", () => {
    const failure = classifyModelFailure("429 Too Many Requests: rate limit reached");
    expect(failure.reason).toBe("quota_exceeded");
    expect(failure.retryable).toBe(true);
    expect(failure.message).not.toContain("429");
  });

  it("供應商帶 Retry-After 時，分類結果帶著等待時間", async () => {
    const server = await startFakeOpenAI({
      chat: () => ({
        kind: "status",
        status: 429,
        body: JSON.stringify({ error: { message: "rate limit reached" } }),
        headers: { "retry-after": "2" },
      }),
    });
    servers.push(server);
    const source = createProviderModelSource({ credentials: credentialSource(SECRET) });
    const models = await openModels(source, settingsFor(providerAt(server.baseUrl, "api-key")));

    const reply = await complete(models);
    expect(reply.stopReason).toBe("error");
    const failure = classifyModelFailure(reply.errorMessage);
    expect(failure.reason).toBe("quota_exceeded");
    expect(failure.retryAfterMs).toBe(2_000);
  });

  it("逾時與斷線分開分類，不把原文往外送", () => {
    expect(classifyModelFailure("ETIMEDOUT: connect timed out").reason).toBe("provider_timeout");
    expect(classifyModelFailure("TypeError: fetch failed: connect ECONNREFUSED").reason).toBe(
      "connection_failed",
    );
    const failure = classifyModelFailure("boom: sk-should-not-leak");
    expect(failure.message.includes("sk-should-not-leak")).toBe(false);
    expect(failure.reason).toBe("provider_error");
  });
});
