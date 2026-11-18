/**
 * 停用狀態跨重啟的契約。
 *
 * 停用模組後重啟：停用狀態保留，相依模組停在 inactive，不會被誤判成
 * failed 而鎖死；重新啟用被依賴的模組後，它們要能回到 active，原本的
 * 資料也還在。
 */

import { describe, expect, it } from "vitest";

import {
  CARDS_DEPENDENTS,
  MODULE_IDS,
  createNoteCard,
  expectProbe,
  mapModules,
  requestFrame,
  restartHarness,
  setEnabled,
  startHarness,
  stopHarness,
  type ModuleInfo,
} from "./support.js";

function expectNoLockedFailure(modules: Map<string, ModuleInfo>): void {
  // 「enabled 為真卻 failed」是重啟後最糟的狀態：使用者沒有把它關掉，
  // 也不能用「再啟用一次」恢復。這裡直接禁止。
  const locked = [...modules.values()].filter((info) => info.enabled && info.state === "failed");
  expect(
    locked.map((info) => `${info.moduleId}: ${info.failure ?? ""}`),
    "不應留下 enabled 為真卻 failed 的模組",
  ).toEqual([]);
}

describe("模組停用狀態跨重啟", () => {
  it("停用 cards 後重啟：相依模組維持 inactive、不以 failed 收場；恢復 cards 後回 active 且卡片還在", async () => {
    let harness = await startHarness();
    try {
      const title = `重啟後仍要存在的卡片 ${Date.now()}`;
      const cardId = await createNoteCard(harness.client, title);

      const disabled = await setEnabled(harness.client, "cards", false);
      expect(disabled.enabled).toBe(false);
      expect(disabled.state).toBe("inactive");

      harness = await restartHarness(harness);
      const modules = await mapModules(harness.client);
      expect(modules.get("cards")).toMatchObject({ enabled: false, state: "inactive" });
      for (const moduleId of CARDS_DEPENDENTS) {
        const info = modules.get(moduleId);
        expect(info, `${moduleId} 應出現在 system.modules.get`).toBeDefined();
        expect(info?.enabled, `${moduleId} 的停用不是使用者設定的`).toBe(true);
        expect(info?.state, `${moduleId} 重啟後應維持 inactive`).toBe("inactive");
        expect(info?.failure ?? null, `${moduleId} 不應被誤判成失敗`).toBeNull();
      }
      expectNoLockedFailure(modules);

      const blocked = await requestFrame(harness.client, "card.list", {});
      expectProbe(blocked, { kind: "error", code: "unsupported" }, "重啟後的 card.list");

      const enabled = await setEnabled(harness.client, "cards", true);
      expect(enabled.enabled).toBe(true);
      expect(enabled.state).toBe("active");

      const restored = await mapModules(harness.client);
      for (const moduleId of MODULE_IDS) {
        const info = restored.get(moduleId);
        expect(info?.enabled, `${moduleId} 應為啟用`).toBe(true);
        expect(info?.state, `${moduleId} 恢復 cards 後應回到 active`).toBe("active");
        expect(info?.failure ?? null, `${moduleId} 恢復後不應有失敗原因`).toBeNull();
      }
      expectNoLockedFailure(restored);

      const listed = await requestFrame(harness.client, "card.list", {});
      expect(listed.kind).toBe("response");
      const cards = (listed.payload as { cards?: Array<{ cardId?: string }> } | undefined)?.cards;
      expect(Array.isArray(cards)).toBe(true);
      expect((cards ?? []).map((card) => card.cardId)).toContain(cardId);
    } finally {
      await stopHarness(harness);
    }
  }, 60_000);

  it("停用獨立模組 mcp 後重啟：只有 mcp 維持停用，其他模組照常運作", async () => {
    let harness = await startHarness();
    try {
      const disabled = await setEnabled(harness.client, "mcp", false);
      expect(disabled.enabled).toBe(false);
      expect(disabled.state).toBe("inactive");

      harness = await restartHarness(harness);
      const modules = await mapModules(harness.client);
      expect(modules.get("mcp")).toMatchObject({ enabled: false, state: "inactive" });
      for (const moduleId of MODULE_IDS) {
        if (moduleId === "mcp") continue;
        const info = modules.get(moduleId);
        expect(info?.enabled, `${moduleId} 應為啟用`).toBe(true);
        expect(info?.state, `${moduleId} 重啟後應為 active`).toBe("active");
        expect(info?.failure ?? null, `${moduleId} 不應有失敗原因`).toBeNull();
      }
      expectNoLockedFailure(modules);

      expectProbe(
        await requestFrame(harness.client, "mcp.servers.list", {}),
        { kind: "error", code: "unsupported" },
        "重啟後的 mcp.servers.list",
      );
      expect((await requestFrame(harness.client, "card.list", {})).kind).toBe("response");

      const enabled = await setEnabled(harness.client, "mcp", true);
      expect(enabled.enabled).toBe(true);
      expect(enabled.state).toBe("active");
      expectProbe(
        await requestFrame(harness.client, "mcp.servers.list", {}),
        { kind: "response" },
        "重新啟用後的 mcp.servers.list",
      );
    } finally {
      await stopHarness(harness);
    }
  }, 60_000);
});
