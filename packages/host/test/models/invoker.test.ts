import { afterEach, describe, expect, it } from "vitest";

import { ModelInvocationError } from "../../src/models/index.js";
import { ModelRuntime } from "../../src/models/runtime.js";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import {
  credentialsWith,
  model,
  openEngine,
  provider,
  settingsService,
  MemorySettingsStore,
} from "./support.js";

const SECRET = "{{SECRET_1lvxzrfg}}";
const servers: FakeOpenAI[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }
});

async function fakeServer(
  options: Parameters<typeof startFakeOpenAI>[0] = {},
): Promise<FakeOpenAI> {
  const server = await startFakeOpenAI(options);
  servers.push(server);
  return server;
}

async function runtimeWith(input: {
  readonly server: FakeOpenAI;
  readonly smallMaxOutputTokens?: number;
  readonly mainMaxOutputTokens?: number;
}) {
  const engine = await openEngine();
  const store = new MemorySettingsStore();
  const settings = settingsService(store);
  const runtime = new ModelRuntime({
    engine,
    settings,
    credentials: credentialsWith({
      "cardiary/provider/main": SECRET,
      "cardiary/provider/small": SECRET,
    }),
  });
  const state = await runtime.apply(
    {
      providers: [
        provider({
          providerId: "main",
          kind: "api-key",
          baseUrl: input.server.baseUrl,
          models: [
            model("main-model", {
              maxOutputTokens: input.mainMaxOutputTokens ?? 8_192,
            }),
          ],
        }),
        provider({
          providerId: "small",
          kind: "api-key",
          baseUrl: input.server.baseUrl,
          models: [
            model("small-model", {
              maxOutputTokens: input.smallMaxOutputTokens ?? 4_096,
            }),
          ],
        }),
      ],
      roles: [
        {
          role: "main",
          mode: "model",
          ref: { providerId: "main", modelId: "main-model" },
        },
        {
          role: "small",
          mode: "model",
          ref: { providerId: "small", modelId: "small-model" },
        },
        { role: "system-one", mode: "none" },
      ],
    },
    "user:test",
  );
  return { engine, store, settings, runtime, state };
}

function outputLimitOf(body: Record<string, unknown>): number | undefined {
  const value = body.max_completion_tokens ?? body.max_tokens;
  return typeof value === "number" ? value : undefined;
}

describe("ModelInvoker", () => {
  it("摘要呼叫固定帶 4,096 的輸出上限", async () => {
    const server = await fakeServer({ chat: () => ({ kind: "text", text: "摘要。" }) });
    const { runtime } = await runtimeWith({ server });

    const result = await runtime.invoke({ role: "small", purpose: "摘要", prompt: "整理這段。" });

    expect(result.text).toBe("摘要。");
    expect(outputLimitOf(server.requests[0]?.body ?? {})).toBe(4_096);
    expect(server.requests[0]?.body.model).toBe("small-model");
  });

  it("設定的摘要上限低於 4,096 時仍用 4,096", async () => {
    const server = await fakeServer({ chat: () => ({ kind: "text", text: "摘要。" }) });
    const { runtime, settings } = await runtimeWith({ server });
    settings.set({
      key: "models.summary.maxOutputTokens",
      value: 1_024,
      actor: "user:test",
    });

    await runtime.invoke({ role: "small", purpose: "摘要", prompt: "整理這段。" });

    expect(outputLimitOf(server.requests[0]?.body ?? {})).toBe(4_096);
  });

  it("設定的摘要上限高於 4,096 時照設定使用", async () => {
    const server = await fakeServer({ chat: () => ({ kind: "text", text: "摘要。" }) });
    const { runtime, settings } = await runtimeWith({ server });
    settings.set({
      key: "models.summary.maxOutputTokens",
      value: 8_192,
      actor: "user:test",
    });

    await runtime.invoke({ role: "small", purpose: "摘要", prompt: "整理這段。" });

    expect(outputLimitOf(server.requests[0]?.body ?? {})).toBe(8_192);
  });

  it("小模型輸出上限不足時退回主力模型", async () => {
    const server = await fakeServer({ chat: () => ({ kind: "text", text: "改用主力。" }) });
    const { runtime } = await runtimeWith({ server, smallMaxOutputTokens: 1_024 });

    const result = await runtime.invoke({ role: "small", purpose: "摘要", prompt: "整理這段。" });

    expect(result.text).toBe("改用主力。");
    expect(server.requests[0]?.body.model).toBe("main-model");
    expect(outputLimitOf(server.requests[0]?.body ?? {})).toBe(4_096);
  });

  it("主力也不足以容納摘要上限時，回明確錯誤且不送出請求", async () => {
    const server = await fakeServer({ chat: () => ({ kind: "text", text: "不該出現" }) });
    const { runtime } = await runtimeWith({
      server,
      smallMaxOutputTokens: 1_024,
      mainMaxOutputTokens: 2_048,
    });

    await expect(
      runtime.invoke({ role: "small", purpose: "摘要", prompt: "整理這段。" }),
    ).rejects.toMatchObject({ reason: "output_limit_exceeded" });
    expect(server.requests).toHaveLength(0);
  });

  it("System One 設為無時不呼叫它", async () => {
    const server = await fakeServer({ chat: () => ({ kind: "text", text: "不該出現" }) });
    const { runtime } = await runtimeWith({ server });

    await expect(
      runtime.invoke({ role: "system-one", purpose: "審核", prompt: "判斷。" }),
    ).rejects.toMatchObject({ reason: "model_not_configured" });
    expect(server.requests).toHaveLength(0);
  });

  it("供應商回 401 時，呼叫端拿到 credential_invalid 而不是原文", async () => {
    const server = await fakeServer({
      chat: () => ({
        kind: "status",
        status: 401,
        body: JSON.stringify({ error: { message: `invalid key ${SECRET}` } }),
      }),
    });
    const { runtime } = await runtimeWith({ server });

    const error = await runtime
      .invoke({ role: "small", purpose: "摘要", prompt: "整理這段。" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ModelInvocationError);
    expect((error as ModelInvocationError).reason).toBe("credential_invalid");
    expect((error as ModelInvocationError).message).not.toContain(SECRET);
  });

  it("供應商回 429 並要求等待時，呼叫端拿到 quota_exceeded 與等待時間", async () => {
    const server = await fakeServer({
      chat: () => ({
        kind: "status",
        status: 429,
        body: JSON.stringify({ error: { message: "rate limit reached" } }),
        headers: { "retry-after": "2" },
      }),
    });
    const { runtime } = await runtimeWith({ server });

    const error = await runtime
      .invoke({ role: "small", purpose: "摘要", prompt: "整理這段。" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ModelInvocationError);
    expect(error).toMatchObject({
      reason: "quota_exceeded",
      retryable: true,
      retryAfterMs: 2_000,
    });
  });
});
