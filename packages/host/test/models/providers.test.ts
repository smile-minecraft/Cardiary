import { afterEach, describe, expect, it } from "vitest";

import { ModelRuntime } from "../../src/models/runtime.js";
import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";
import {
  credentialsMissing,
  credentialsWith,
  model,
  openEngine,
  provider,
  settingsService,
  MemorySettingsStore,
} from "./support.js";

const SECRET = "sk-test-providers-0001";
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

describe("三種接入方式", () => {
  it("API 金鑰：每次請求向殼要金鑰，設定裡不留值", async () => {
    const server = await fakeServer({ chat: () => ({ kind: "text", text: "好" }) });
    const engine = await openEngine();
    const store = new MemorySettingsStore();
    const runtime = new ModelRuntime({
      engine,
      settings: settingsService(store),
      credentials: credentialsWith({ "cardiary/provider/vendor": SECRET }),
    });

    await runtime.apply(
      {
        providers: [
          provider({
            providerId: "vendor",
            kind: "api-key",
            baseUrl: server.baseUrl,
            models: [model("vendor-model", { maxOutputTokens: 16_384 })],
          }),
        ],
        roles: [
          {
            role: "main",
            mode: "model",
            ref: { providerId: "vendor", modelId: "vendor-model" },
          },
        ],
      },
      "user:test",
    );

    const result = await runtime.invoke({
      role: "main",
      purpose: "測試",
      prompt: "你好",
      maxOutputTokens: 16,
    });

    expect(result.text).toBe("好");
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET}`);
    for (const change of store.changes) {
      expect(change.newValue).not.toContain(SECRET);
      expect(change.oldValue ?? "").not.toContain(SECRET);
    }
    expect(JSON.stringify(runtime.state)).not.toContain(SECRET);
  });

  it("聚合平台：從 /v1/models 動態取得清單，清單裡的模型可以直接用", async () => {
    const server = await fakeServer({
      models: [
        {
          id: "group/free",
          name: "免費模型",
          context_window: 1_048_576,
          max_output_tokens: 921_600,
          input: ["text", "image"],
        },
        {
          id: "group/another",
          context_length: 131_072,
          input: ["text"],
        },
      ],
      chat: () => ({ kind: "text", text: "聚合平台回覆" }),
    });
    const engine = await openEngine();
    const store = new MemorySettingsStore();
    const runtime = new ModelRuntime({
      engine,
      settings: settingsService(store),
      credentials: credentialsWith({ "cardiary/provider/aggregator": SECRET }),
    });

    const state = await runtime.apply(
      {
        providers: [
          provider({
            providerId: "aggregator",
            kind: "aggregator",
            baseUrl: server.baseUrl,
            credentialRef: "cardiary/provider/aggregator",
            models: [],
          }),
        ],
        roles: [
          {
            role: "main",
            mode: "model",
            ref: { providerId: "aggregator", modelId: "group/free" },
          },
        ],
      },
      "user:test",
    );

    expect(state.providers[0]?.models.map((entry) => entry.modelId)).toEqual([
      "group/free",
      "group/another",
    ]);
    expect(state.providers[0]?.models[0]).toMatchObject({
      contextWindow: 1_048_576,
      maxOutputTokens: 921_600,
      input: ["text", "image"],
    });
    expect(server.requests[0]?.method).toBe("GET");
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET}`);

    const result = await runtime.invoke({
      role: "main",
      purpose: "測試",
      prompt: "你好",
      maxOutputTokens: 16,
    });
    expect(result.text).toBe("聚合平台回覆");
    expect(server.requests.at(-1)?.body.model).toBe("group/free");
  });

  it("聚合平台抓不到清單時沿用靜態宣告，不假裝有模型", async () => {
    const server = await fakeServer({
      modelsStatus: 500,
      chat: () => ({ kind: "text", text: "靜態" }),
    });
    const engine = await openEngine();
    const runtime = new ModelRuntime({
      engine,
      settings: settingsService(new MemorySettingsStore()),
      credentials: credentialsWith({ "cardiary/provider/aggregator": SECRET }),
      warn: () => {},
    });

    const state = await runtime.apply(
      {
        providers: [
          provider({
            providerId: "aggregator",
            kind: "aggregator",
            baseUrl: server.baseUrl,
            credentialRef: "cardiary/provider/aggregator",
            models: [model("static-model", { maxOutputTokens: 8_192 })],
          }),
        ],
        roles: [
          {
            role: "main",
            mode: "model",
            ref: { providerId: "aggregator", modelId: "static-model" },
          },
        ],
      },
      "user:test",
    );

    expect(state.providers[0]?.models.map((entry) => entry.modelId)).toEqual(["static-model"]);
  });

  it("本機端點不需要金鑰，沒有殼也能呼叫", async () => {
    const server = await fakeServer({ chat: () => ({ kind: "text", text: "本機" }) });
    const engine = await openEngine();
    const runtime = new ModelRuntime({
      engine,
      settings: settingsService(new MemorySettingsStore()),
      credentials: credentialsMissing(),
    });

    await runtime.apply(
      {
        providers: [
          provider({
            providerId: "local",
            kind: "local",
            baseUrl: server.baseUrl,
            models: [model("local-model", { maxOutputTokens: 8_192 })],
          }),
        ],
        roles: [
          {
            role: "main",
            mode: "model",
            ref: { providerId: "local", modelId: "local-model" },
          },
        ],
      },
      "user:test",
    );

    const result = await runtime.invoke({
      role: "main",
      purpose: "測試",
      prompt: "你好",
      maxOutputTokens: 16,
    });

    expect(result.text).toBe("本機");
    expect(server.requests[0]?.headers.authorization).toBe("Bearer cardiary-local-no-key");
  });

  it.skipIf(process.env.CARDIARY_TEST_OPENAI_API_KEY === undefined)(
    "真實 API 供應商（沒有 CARDIARY_TEST_OPENAI_API_KEY 時略過，未驗證）",
    async () => {
      const engine = await openEngine();
      const runtime = new ModelRuntime({
        engine,
        settings: settingsService(new MemorySettingsStore()),
        credentials: credentialsWith({
          "cardiary/provider/openai": process.env.CARDIARY_TEST_OPENAI_API_KEY ?? "",
        }),
      });

      await runtime.apply(
        {
          providers: [
            provider({
              providerId: "openai",
              kind: "api-key",
              models: [model("gpt-4o-mini", { maxOutputTokens: 16_384 })],
            }),
          ],
          roles: [
            {
              role: "main",
              mode: "model",
              ref: { providerId: "openai", modelId: "gpt-4o-mini" },
            },
          ],
        },
        "user:test",
      );

      const result = await runtime.invoke({
        role: "main",
        purpose: "測試",
        prompt: "只回好。",
        maxOutputTokens: 4,
      });
      expect(result.text.length).toBeGreaterThan(0);
    },
  );
});
