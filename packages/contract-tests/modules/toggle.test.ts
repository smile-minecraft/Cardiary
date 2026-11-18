/**
 * 模組停用與重新啟用的契約。
 *
 * 對每個有協定入口的模組各跑一次：停用後它的入口消失，其他功能照常；
 * 重新啟用後回到 active、協定前綴全部回來。停用只抽走服務，不刪資料。
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  CARDS_DEPENDENTS,
  EXPECTED_PROTOCOL_PREFIXES,
  MODULE_IDS,
  PROBE_CASES,
  createSession,
  ensureAllEnabled,
  expectProbe,
  infoOf,
  mapModules,
  requestFrame,
  setEnabled,
  startHarness,
  stopHarness,
  type Harness,
  type ModuleInfo,
} from "./support.js";

/**
 * 停用某個模組時，用來確認「其他功能照常」的探針。
 *
 * 卡片模組自己是被停用的對象，改用 MCP 伺服器清單；其他模組停用時
 * 卡片列表不受影響。
 */
async function unrelatedProbe(harness: Harness, disabledModuleId: string): Promise<string> {
  const type = disabledModuleId === "cards" ? "mcp.servers.list" : "card.list";
  const reply = await requestFrame(harness.client, type, {});
  return reply.kind as string;
}

function expectNoFailure(modules: Map<string, ModuleInfo>): void {
  const failed = [...modules.values()].filter((info) => info.state === "failed");
  expect(
    failed.map((info) => `${info.moduleId}: ${info.failure ?? ""}`),
    "不應有模組 failed",
  ).toEqual([]);
}

describe("模組停用與重新啟用", () => {
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

  it.each(PROBE_CASES)(
    "$moduleId：$title",
    async (probeCase) => {
      const { client } = harness;
      const before = await infoOf(client, probeCase.moduleId);
      expect(before.enabled).toBe(true);
      expect(before.state).toBe("active");

      const activeReply = await requestFrame(client, probeCase.type, probeCase.payload(sessionId));
      expectProbe(activeReply, probeCase.active, `${probeCase.moduleId} 啟用時`);
      expect(await unrelatedProbe(harness, probeCase.moduleId), "停用前的無關功能").toBe(
        "response",
      );

      const disabled = await setEnabled(client, probeCase.moduleId, false);
      expect(disabled.enabled, `${probeCase.moduleId} 停用後 enabled`).toBe(false);
      expect(disabled.state, `${probeCase.moduleId} 停用後狀態`).toBe("inactive");
      expect([...disabled.protocolPrefixes], `${probeCase.moduleId} 停用後前綴`).toEqual([]);
      expect(disabled.failure ?? null, `${probeCase.moduleId} 停用不是失敗`).toBeNull();

      const disabledReply = await requestFrame(
        client,
        probeCase.type,
        probeCase.payload(sessionId),
      );
      expectProbe(disabledReply, probeCase.disabled, `${probeCase.moduleId} 停用時`);
      expect(await unrelatedProbe(harness, probeCase.moduleId), "停用時的無關功能").toBe(
        "response",
      );

      const enabled = await setEnabled(client, probeCase.moduleId, true);
      expect(enabled.enabled, `${probeCase.moduleId} 重新啟用後 enabled`).toBe(true);
      expect(enabled.state, `${probeCase.moduleId} 重新啟用後狀態`).toBe("active");
      expect(enabled.failure ?? null, `${probeCase.moduleId} 重新啟用後無失敗`).toBeNull();
      expect([...enabled.protocolPrefixes], `${probeCase.moduleId} 重新啟用後前綴`).toEqual([
        ...(EXPECTED_PROTOCOL_PREFIXES[probeCase.moduleId] ?? []),
      ]);

      const enabledReply = await requestFrame(client, probeCase.type, probeCase.payload(sessionId));
      expectProbe(enabledReply, probeCase.active, `${probeCase.moduleId} 重新啟用後`);

      const modules = await mapModules(client);
      expectNoFailure(modules);
      if (probeCase.moduleId === "cards") {
        // 停用 cards 會連帶停用相依模組；重新啟用 cards 時它們要一起回來，
        // 不需要手動先關再開。
        for (const moduleId of CARDS_DEPENDENTS) {
          const info = modules.get(moduleId);
          expect(info?.enabled, `${moduleId} 應維持啟用`).toBe(true);
          expect(info?.state, `${moduleId} 應隨 cards 恢復`).toBe("active");
        }
      }
      for (const moduleId of MODULE_IDS) {
        expect(modules.get(moduleId)?.state, `${moduleId} 應回到 active`).toBe("active");
      }
    },
    30_000,
  );
});
