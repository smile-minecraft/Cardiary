import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FolderLayout } from "@cardiary/storage";
import { describe, expect, it } from "vitest";

import { SettingsGovernance, SettingsGovernanceError } from "../../src/settings/governance.js";
import { HUMAN_ONLY_SETTING_KEYS, SETTING_DEFINITIONS } from "../../src/settings/catalog.js";
import { settingsService, MemorySettingsStore } from "../models/support.js";
import { makeFolder } from "../helpers.js";

const NOW = () => new Date("2026-11-15T00:00:00.000Z");

async function harness() {
  const folder = await makeFolder();
  const store = new MemorySettingsStore(NOW);
  const settings = settingsService(store);
  const layout = new FolderLayout(folder.path);
  const governance = new SettingsGovernance({ settings, layout, now: NOW });
  return { folder, store, settings, layout, governance };
}

function audit(folder: { readonly path: string }): Array<Record<string, unknown>> {
  const raw = readFileSync(join(folder.path, "state", "settings-audit.jsonl"), "utf8");
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("設定分級治理", () => {
  it("代理改 free 立即生效，稽核只記動作不記值", async () => {
    const { folder, store, governance } = await harness();
    const result = governance.change({
      key: "models.summary.maxOutputTokens",
      value: 8_192,
      actor: { kind: "agent", id: "conversation-1" },
    });
    expect(result.applied).toBe(true);
    expect(store.get("models.summary.maxOutputTokens")?.value).toBe("8192");
    expect(result.change).toMatchObject({
      tier: "free",
      status: "applied",
      proposedBy: "agent:conversation-1",
    });
    const lines = audit(folder);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      actor: "agent:conversation-1",
      action: "change",
      tier: "free",
      outcome: "applied",
    });
    expect(JSON.stringify(lines)).not.toContain("8192");
  });

  it("approval 先待決，核准前值不變，核准後才寫入", async () => {
    const { store, governance } = await harness();
    const result = governance.change({
      key: "models.providers",
      value: [{ providerId: "local" }],
      actor: { kind: "agent", id: "conversation-1" },
    });
    expect(result.applied).toBe(false);
    expect(result.change.status).toBe("pending");
    expect(store.get("models.providers")).toBeNull();
    expect(governance.changesFor("agent")).toEqual([result.change]);

    const applied = governance.decide(result.change.changeId, "approve", {
      kind: "human",
      id: "device-1",
    });
    expect(applied.status).toBe("applied");
    expect(store.get("models.providers")?.value).toBe('[{"providerId":"local"}]');
    expect(store.get("models.providers")?.updatedBy).toBe("user:device-1");
  });

  it("拒絕提議後值不變，且不能重複決定", async () => {
    const { store, governance } = await harness();
    const result = governance.change({
      key: "models.providers",
      value: [],
      actor: { kind: "agent", id: "conversation-1" },
    });
    governance.decide(result.change.changeId, "reject", { kind: "human", id: "device-1" });
    expect(store.get("models.providers")).toBeNull();
    expect(() =>
      governance.decide(result.change.changeId, "approve", { kind: "human", id: "device-1" }),
    ).toThrow(SettingsGovernanceError);
  });

  // 所有 human-only 鍵逐項檢查：代理看不到、讀不到，也提議不了，錯誤訊息不含鍵名。
  const HUMAN_ONLY_DEFINITIONS = SETTING_DEFINITIONS.filter(
    (definition) => definition.level === "human-only",
  );
  it.each(HUMAN_ONLY_DEFINITIONS.map((definition) => [definition.key] as const))(
    "human-only 鍵 %s 對代理完全不可見且拒絕變更",
    async (key) => {
      const { governance } = await harness();
      expect(governance.listFor("agent").map((item) => item.key)).not.toContain(key);
      expect(governance.listFor("human").map((item) => item.key)).toContain(key);
      expect(governance.readFor(key, "agent")).toBeUndefined();

      const error = (() => {
        try {
          governance.change({ key, value: true, actor: { kind: "agent", id: "conversation-1" } });
        } catch (caught) {
          return caught;
        }
        return null;
      })();
      expect(error).toBeInstanceOf(SettingsGovernanceError);
      expect((error as Error).message).not.toContain(key);
      expect((error as SettingsGovernanceError).code).toBe("permission_denied");
      // human-only 的紀錄會對代理隱藏，所以 agent 的空清單不足以證明沒有寫入；
      // 人類看得到完整紀錄，拒絕後人類也應該看到零筆。
      expect(governance.changesFor("agent")).toEqual([]);
      expect(governance.changesFor("human")).toEqual([]);
    },
  );

  it("HUMAN_ONLY_SETTING_KEYS 與設定目錄中的 human-only 鍵完全相等", () => {
    const fromDefinitions = SETTING_DEFINITIONS.filter(
      (definition) => definition.level === "human-only",
    ).map((definition) => definition.key);
    expect([...HUMAN_ONLY_SETTING_KEYS].sort()).toEqual([...fromDefinitions].sort());
  });

  it("代理看不到 human-only，也提議不了，錯誤訊息不含鍵名", async () => {
    const { governance } = await harness();
    expect(governance.listFor("agent").map((item) => item.key)).not.toContain("permissions.mode");
    expect(governance.listFor("human").map((item) => item.key)).toContain("permissions.mode");
    expect(governance.readFor("permissions.mode", "agent")).toBeUndefined();

    for (const key of ["permissions.mode", "permissions.unknown"]) {
      const error = (() => {
        try {
          governance.change({ key, value: true, actor: { kind: "agent", id: "conversation-1" } });
        } catch (caught) {
          return caught;
        }
        return null;
      })();
      expect(error).toBeInstanceOf(SettingsGovernanceError);
      expect((error as Error).message).not.toContain(key);
      expect((error as SettingsGovernanceError).code).toBe("permission_denied");
    }

    expect(governance.changesFor("agent")).toEqual([]);
    expect(governance.changesFor("human")).toEqual([]);
  });

  it("待決提議寫進 state 正本，重啟後仍然存在", async () => {
    const { folder, settings, layout, governance } = await harness();
    const result = governance.change({
      key: "models.roles",
      value: [],
      actor: { kind: "agent", id: "conversation-1" },
    });
    const restarted = new SettingsGovernance({ settings, layout, now: NOW });
    expect(restarted.changesFor("human")).toEqual([result.change]);
    expect(
      JSON.parse(readFileSync(join(folder.path, "state", "settings-changes.json"), "utf8")),
    ).toEqual([result.change]);
  });
});
