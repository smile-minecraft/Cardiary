/**
 * 模組相依的連帶停用與恢復。
 *
 * cards 是依賴中心：停用它會連帶停用 9 個硬相依的模組；重新啟用時
 * 這些模組要自動回到 active。memory 對 context 只有選用依賴，停用
 * context 不應連帶停用它。
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  CARDS_DEPENDENTS,
  MODULE_IDS,
  createSession,
  ensureAllEnabled,
  expectProbe,
  mapModules,
  requestFrame,
  setEnabled,
  startHarness,
  stopHarness,
  type Harness,
  type ModuleInfo,
} from "./support.js";

const INDEPENDENT_OF_CARDS = [
  "emotion",
  "external-agents",
  "local-tools",
  "mcp",
  "settings",
  "storage",
] as const;

function expectNoFailure(modules: Map<string, ModuleInfo>): void {
  const failed = [...modules.values()].filter((info) => info.state === "failed");
  expect(
    failed.map((info) => `${info.moduleId}: ${info.failure ?? ""}`),
    "不應有模組 failed",
  ).toEqual([]);
}

describe("模組相依的連帶停用與恢復", () => {
  let harness: Harness;
  let sessionId: string;

  beforeAll(async () => {
    harness = await startHarness();
    sessionId = await createSession(harness.client);
  }, 30_000);

  afterEach(async () => {
    if (harness !== undefined) {
      await ensureAllEnabled(harness.client);
    }
  }, 30_000);

  afterAll(async () => {
    await stopHarness(harness);
  });

  it("停用 cards：9 個相依模組連帶停用，重新啟用 cards 後全部自動恢復", async () => {
    const { client } = harness;
    const disabled = await setEnabled(client, "cards", false);
    expect(disabled.enabled).toBe(false);
    expect(disabled.state).toBe("inactive");

    const cascaded = await mapModules(client);
    expect(cascaded.get("cards")).toMatchObject({ enabled: false, state: "inactive" });
    for (const moduleId of CARDS_DEPENDENTS) {
      const info = cascaded.get(moduleId);
      expect(info, `${moduleId} 應出現在 system.modules.get`).toBeDefined();
      expect(info?.enabled, `${moduleId} 不應被改成停用`).toBe(true);
      expect(info?.state, `${moduleId} 應連帶停用`).toBe("inactive");
      expect(info?.failure ?? null, `${moduleId} 不是失敗`).toBeNull();
      expect([...(info?.protocolPrefixes ?? [])], `${moduleId} 停用後不提供協定`).toEqual([]);
    }
    for (const moduleId of INDEPENDENT_OF_CARDS) {
      expect(cascaded.get(moduleId)).toMatchObject({ enabled: true, state: "active" });
    }
    expectNoFailure(cascaded);

    // 相依模組停用時，核心發訊息仍可用：只有發牌服務不在。
    const message = await requestFrame(client, "session.send_message", {
      sessionId,
      text: "cards 停用時的訊息",
      delivery: "queue",
      clientMessageId: `during-${Math.random().toString(36).slice(2)}`,
    });
    expect(message.kind).toBe("response");

    const enabled = await setEnabled(client, "cards", true);
    expect(enabled.enabled).toBe(true);
    expect(enabled.state).toBe("active");

    const restored = await mapModules(client);
    for (const moduleId of MODULE_IDS) {
      const info = restored.get(moduleId);
      expect(info?.enabled, `${moduleId} 應為啟用`).toBe(true);
      expect(info?.state, `${moduleId} 應回到 active`).toBe("active");
      expect(info?.failure ?? null, `${moduleId} 恢復後不應有失敗原因`).toBeNull();
    }
    expectNoFailure(restored);
  }, 40_000);

  it("選用依賴不連帶停用：停用 context 只停用硬相依的 dealing，memory 維持 active", async () => {
    const { client } = harness;
    const baseline = await mapModules(client);
    expect(baseline.get("memory")).toMatchObject({ enabled: true, state: "active" });

    const disabled = await setEnabled(client, "context", false);
    expect(disabled.enabled).toBe(false);
    expect(disabled.state).toBe("inactive");

    const cascaded = await mapModules(client);
    expect(cascaded.get("context")).toMatchObject({ enabled: false, state: "inactive" });
    expect(cascaded.get("dealing"), "dealing 硬相依 context，應連帶停用").toMatchObject({
      enabled: true,
      state: "inactive",
    });
    expect(cascaded.get("memory"), "memory 只選用 context，不應連帶停用").toMatchObject({
      enabled: true,
      state: "active",
    });
    expect(cascaded.get("cards")).toMatchObject({ enabled: true, state: "active" });
    expectNoFailure(cascaded);

    // memory 的功能還在：選用依賴不在，只是少了一層上下文。
    const memory = await requestFrame(client, "module.memory.undo", {
      data: { notificationId: "", itemId: "" },
    });
    expectProbe(memory, { kind: "response" }, "context 停用時的 memory.undo");

    const enabled = await setEnabled(client, "context", true);
    expect(enabled.enabled).toBe(true);
    expect(enabled.state).toBe("active");

    const restored = await mapModules(client);
    expect(restored.get("context")).toMatchObject({ enabled: true, state: "active" });
    expect(restored.get("dealing"), "context 回來後 dealing 應恢復").toMatchObject({
      enabled: true,
      state: "active",
    });
    expect(restored.get("memory")).toMatchObject({ enabled: true, state: "active" });
    expectNoFailure(restored);
  }, 40_000);
});
