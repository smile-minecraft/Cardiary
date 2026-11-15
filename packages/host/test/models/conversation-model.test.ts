import { describe, expect, it } from "vitest";

import { ModelRuntime } from "../../src/models/runtime.js";
import {
  credentialsMissing,
  model,
  openEngine,
  provider,
  settingsService,
  MemorySettingsStore,
} from "./support.js";

describe("對話的主模型", () => {
  it("建立對話時固定 main；之後改設定只影響新對話", async () => {
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
            providerId: "vendor",
            kind: "local",
            models: [model("model-a", { maxOutputTokens: 8_192 })],
          }),
        ],
        roles: [
          {
            role: "main",
            mode: "model",
            ref: { providerId: "vendor", modelId: "model-a" },
          },
        ],
      },
      "user:test",
    );
    const firstSettings = await engine.getModelSettings();
    const first = await engine.createConversation({
      model: firstSettings.roles.main,
      systemContext: "",
      toolBundles: [],
    });
    expect(first.model).toEqual({ provider: "vendor", model: "model-a" });

    await runtime.apply(
      {
        providers: [
          provider({
            providerId: "vendor",
            kind: "local",
            models: [model("model-b", { maxOutputTokens: 8_192 })],
          }),
        ],
        roles: [
          {
            role: "main",
            mode: "model",
            ref: { providerId: "vendor", modelId: "model-b" },
          },
        ],
      },
      "user:test",
    );
    const secondSettings = await engine.getModelSettings();
    const second = await engine.createConversation({
      model: secondSettings.roles.main,
      systemContext: "",
      toolBundles: [],
    });
    expect(second.model).toEqual({ provider: "vendor", model: "model-b" });

    // 已經建立的對話仍是原本的模型；設定變更不會回頭改它。
    expect((await engine.getConversation(first.id))?.model).toEqual({
      provider: "vendor",
      model: "model-a",
    });
  });
});
