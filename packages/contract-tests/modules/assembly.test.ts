/**
 * 第一方模組正式組裝的契約。
 *
 * 驗的是真的主機行程：16 個模組全部載入並啟用，每個有協定入口的模組
 * 都能從外部呼叫；模組資訊以前綴與狀態呈現，不看內部資料結構。
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  EXPECTED_PROTOCOL_PREFIXES,
  MODULE_IDS,
  PROBE_CASES,
  createSession,
  expectProbe,
  mapModules,
  requestFrame,
  startHarness,
  stopHarness,
  type Harness,
} from "./support.js";

describe("第一方模組的正式組裝", () => {
  let harness: Harness;
  let sessionId: string;

  beforeAll(async () => {
    harness = await startHarness();
    sessionId = await createSession(harness.client);
  }, 30_000);

  afterAll(async () => {
    await stopHarness(harness);
  });

  it("16 個模組全部 active，協定前綴與宣告一致", async () => {
    const modules = await mapModules(harness.client);
    expect([...modules.keys()].sort()).toEqual([...(MODULE_IDS as readonly string[])]);

    for (const moduleId of MODULE_IDS) {
      const info = modules.get(moduleId);
      expect(info, `${moduleId} 應出現在 system.modules.get`).toBeDefined();
      if (info === undefined) continue;
      expect(info.enabled, `${moduleId} 應為啟用`).toBe(true);
      expect(info.state, `${moduleId} 應為 active`).toBe("active");
      expect(info.failure ?? null, `${moduleId} 不應有失敗原因`).toBeNull();
      expect([...info.protocolPrefixes], `${moduleId} 的協定前綴`).toEqual([
        ...(EXPECTED_PROTOCOL_PREFIXES[moduleId] ?? []),
      ]);
    }
  }, 20_000);

  it.each(PROBE_CASES)(
    "$moduleId：$title",
    async (probeCase) => {
      const reply = await requestFrame(
        harness.client,
        probeCase.type,
        probeCase.payload(sessionId),
      );
      expectProbe(reply, probeCase.active, `${probeCase.moduleId} 的 ${probeCase.type}`);
    },
    20_000,
  );
});
