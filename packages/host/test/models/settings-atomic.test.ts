import { afterEach, describe, expect, it } from "vitest";

import { ModelRuntime } from "../../src/models/runtime.js";
import { MODEL_SETTING_KEYS } from "../../src/models/types.js";
import {
  credentialsMissing,
  MemorySettingsStore,
  model,
  openEngine,
  provider,
  settingsService,
} from "./support.js";

/**
 * 模型設定的兩鍵是同一個設定的兩半。
 *
 * `system.models.set` 一次寫供應商與角色；儲存層用同一個交易，任何一筆
 * 失敗都不生效。這裡用注入失敗的記憶體儲存驗證失敗後兩鍵與執行中的
 * 快照都回到上一份。
 */

const engines: Array<Awaited<ReturnType<typeof openEngine>>> = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) {
    await engine.close();
  }
});

async function runtimeWith(store: MemorySettingsStore): Promise<ModelRuntime> {
  const engine = await openEngine();
  engines.push(engine);
  return new ModelRuntime({
    engine,
    settings: settingsService(store),
    credentials: credentialsMissing(),
  });
}

describe("模型設定的原子寫入", () => {
  it("第一次設定失敗時，兩鍵都不留半套", async () => {
    const store = new MemorySettingsStore();
    const runtime = await runtimeWith(store);
    store.failOnKey = MODEL_SETTING_KEYS.providers;

    await expect(
      runtime.apply(
        {
          providers: [
            provider({ providerId: "vendor", kind: "api-key", models: [model("vendor-model")] }),
          ],
          roles: [
            {
              role: "main",
              mode: "model",
              ref: { providerId: "vendor", modelId: "vendor-model" },
            },
          ],
        },
        "user:device-1",
      ),
    ).rejects.toThrow(/注入的設定寫入失敗/);

    expect(store.get(MODEL_SETTING_KEYS.providers)).toBeNull();
    expect(store.get(MODEL_SETTING_KEYS.roles)).toBeNull();
    expect(runtime.state.providers).toEqual([]);
    expect(runtime.state.resolved[0]).toMatchObject({ role: "main", source: "none" });
  });

  it("換設定失敗時，供應商、角色與執行中的模型都維持舊的一份", async () => {
    const store = new MemorySettingsStore();
    const runtime = await runtimeWith(store);
    await runtime.apply(
      {
        providers: [
          provider({ providerId: "first", kind: "api-key", models: [model("first-model")] }),
        ],
        roles: [
          { role: "main", mode: "model", ref: { providerId: "first", modelId: "first-model" } },
        ],
      },
      "user:device-1",
    );
    const providers = store.get(MODEL_SETTING_KEYS.providers)?.value;
    const roles = store.get(MODEL_SETTING_KEYS.roles)?.value;
    const state = runtime.state;

    store.failOnKey = MODEL_SETTING_KEYS.providers;
    await expect(
      runtime.apply(
        {
          providers: [
            provider({ providerId: "second", kind: "api-key", models: [model("second-model")] }),
          ],
          roles: [
            { role: "main", mode: "model", ref: { providerId: "second", modelId: "second-model" } },
          ],
        },
        "user:device-1",
      ),
    ).rejects.toThrow(/注入的設定寫入失敗/);

    expect(store.get(MODEL_SETTING_KEYS.providers)?.value).toBe(providers);
    expect(store.get(MODEL_SETTING_KEYS.roles)?.value).toBe(roles);
    expect(runtime.state).toEqual(state);
    expect(runtime.role("main")).toMatchObject({
      source: "configured",
      ref: { providerId: "first", modelId: "first-model" },
    });
  });
});
