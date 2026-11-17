import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type {
  ProtocolEventEmitter,
  ProtocolRequestContext,
  ProtocolRequestHandler,
} from "@cardiary/module-api";
import type { JsonValue } from "@cardiary/engine-adapter";

import { FolderLayout } from "@cardiary/storage";
import type { ModelInfo } from "@cardiary/protocol";
import { ModelRuntime } from "../../../src/models/runtime.js";
import { registerSettingsProtocol } from "../../../src/modules/settings/protocol.js";
import { ProtocolHandlerError } from "../../../src/modules/contract.js";
import { SettingsGovernance } from "../../../src/settings/governance.js";
import { makeFolder } from "../../helpers.js";
import {
  credentialsMissing,
  openEngine,
  settingsService,
  MemorySettingsStore,
} from "../../models/support.js";

/**
 * 模型設定與批次一般設定的治理路徑。
 *
 * harness 直接呼叫處理器；沒有傳 `actor` 時代表未經閘道的測試呼叫，
 * 會由模組當成人類。要模擬未經閘道的代理，傳 `{ kind: "agent", ... }`。
 * `models.set` 的 actor 必須由閘道指派，模組不得自行從 clientId 推斷。
 */
const NOW = () => new Date("2026-11-15T00:00:00.000Z");

async function harness(fetchModels?: () => Promise<readonly ModelInfo[]>) {
  const engine = await openEngine();
  const store = new MemorySettingsStore(NOW);
  const settings = settingsService(store);
  const runtime = new ModelRuntime({
    engine,
    settings,
    credentials: credentialsMissing(),
    ...(fetchModels === undefined ? {} : { fetchModels }),
  });
  const folder = await makeFolder();
  const layout = new FolderLayout(folder.path);
  const governance = new SettingsGovernance({ settings, layout, now: NOW });
  const handlers = new Map<string, ProtocolRequestHandler>();
  const events: Array<Record<string, unknown>> = [];
  const protocol: ProtocolEventEmitter = {
    emit: (intent) => {
      events.push(intent as unknown as Record<string, unknown>);
    },
    registerNamespace: (key, handler) => {
      handlers.set(key, handler);
      return { dispose: () => handlers.delete(key) };
    },
    registerHttpRoute: () => ({ dispose: () => {} }),
  };
  registerSettingsProtocol({
    runtime,
    settings,
    protocol,
    now: NOW,
    governance,
  });
  const call = async (
    type: string,
    payload: Record<string, unknown>,
    clientId = "device-1",
    actor?: ProtocolRequestContext["actor"],
  ) => {
    const key = type.startsWith("system.models")
      ? "system.models"
      : type.startsWith("system.settings")
        ? "system.settings"
        : "settings";
    const handler = handlers.get(key);
    if (handler === undefined) throw new Error(`沒有 ${key} 處理器`);
    return handler({
      type,
      payload: payload as JsonValue,
      clientId,
      ...(actor === undefined ? {} : { actor }),
    } as ProtocolRequestContext);
  };
  return { call, events, settings, store, governance, folder };
}

const localProvider = {
  providerId: "local",
  kind: "local",
  displayName: "本機",
  baseUrl: "http://127.0.0.1:1/v1",
  models: [{ modelId: "local-model", contextWindow: 32_768, input: ["text"] }],
};

const mainRole = {
  role: "main",
  mode: "model",
  ref: { providerId: "local", modelId: "local-model" },
};

describe("模型設定的治理", () => {
  it("代理不能直接套用模型設定；設定與變更紀錄都不變", async () => {
    const { call, store, settings, governance } = await harness();
    const error = await call(
      "system.models.set",
      { providers: [localProvider], clientRequestId: "agent-set" },
      "agent:agent-1",
      { kind: "agent", id: "agent-1" },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProtocolHandlerError);
    expect(error).toMatchObject({ code: "permission_denied" });
    expect(store.rows.size).toBe(0);
    expect(settings.get("models.providers")).toEqual([]);
    expect(governance.changesFor("human")).toEqual([]);
    expect(governance.changesFor("agent")).toEqual([]);
  });

  it("身分只認 actor：clientId 沒有 agent: 前綴，代理一樣被拒", async () => {
    const { call, settings, governance } = await harness();
    const error = await call(
      "system.models.set",
      { providers: [localProvider], clientRequestId: "agent-plain-client" },
      "device-1",
      { kind: "agent", id: "agent-1" },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProtocolHandlerError);
    expect(error).toMatchObject({ code: "permission_denied" });
    expect(settings.get("models.providers")).toEqual([]);
    expect(governance.changesFor("human")).toEqual([]);
    // 代理看不到 human-only 的鍵。
    const listed = (await call("settings.list", {}, "device-1", {
      kind: "agent",
      id: "agent-1",
    })) as { settings: Array<{ key: string }> };
    expect(listed.settings.map((entry) => entry.key)).not.toContain("permissions.mode");
  });

  it("沒有 actor 的 context 視為人類：clientId 的 agent: 前綴不構成代理", async () => {
    const { call, governance } = await harness();
    // 這個情境只會出現在單元測試直接呼叫處理器時；production 的 context
    // 一律由閘道指派 actor。
    const result = (await call(
      "system.models.set",
      { providers: [localProvider], clientRequestId: "prefix-is-not-identity" },
      "agent:evil",
    )) as { providers: Array<{ providerId: string }> };
    expect(result.providers.map((entry) => entry.providerId)).toEqual(["local"]);
    expect(governance.changesFor("human")[0]).toMatchObject({
      key: "models.providers",
      proposedBy: "user:agent:evil",
    });
    const listed = (await call("settings.list", {}, "agent:evil")) as {
      settings: Array<{ key: string }>;
    };
    expect(listed.settings.map((entry) => entry.key)).toContain("permissions.mode");
  });

  it("人類直接設定模型仍可生效，並留下治理紀錄", async () => {
    const { call, store, governance } = await harness();
    const result = (await call("system.models.set", {
      providers: [localProvider],
      clientRequestId: "human-set",
    })) as { providers: Array<{ providerId: string }> };
    expect(result.providers.map((entry) => entry.providerId)).toEqual(["local"]);
    expect(store.rows.get("models.providers")?.updatedBy).toBe("user:device-1");
    const records = governance.changesFor("human");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      key: "models.providers",
      status: "applied",
      proposedBy: "user:device-1",
    });
  });

  it("代理提議的模型角色，核准前不生效，核准後才生效", async () => {
    const { call, settings, governance } = await harness();
    await call("system.models.set", {
      providers: [localProvider],
      clientRequestId: "seed-providers",
    });
    expect(settings.get("models.roles")).toEqual([]);

    const proposal = (await call(
      "settings.propose_change",
      { key: "models.roles", value: [mainRole], clientRequestId: "prop-1" },
      "agent:agent-1",
      { kind: "agent", id: "agent-1" },
    )) as { change: { changeId: string; status: string } };
    expect(proposal.change.status).toBe("pending");

    const before = (await call("system.models.get", {})) as {
      resolved: Array<{ role: string; source: string }>;
    };
    expect(before.resolved.find((entry) => entry.role === "main")).toMatchObject({
      source: "none",
    });
    expect(settings.get("models.roles")).toEqual([]);

    const decided = (await call("settings.change.decide", {
      changeId: proposal.change.changeId,
      decision: "approve",
    })) as { change: { status: string } };
    expect(decided.change.status).toBe("applied");

    const after = (await call("system.models.get", {})) as {
      resolved: Array<{ role: string; source: string; ref?: unknown }>;
    };
    expect(after.resolved.find((entry) => entry.role === "main")).toMatchObject({
      source: "configured",
      ref: { providerId: "local", modelId: "local-model" },
    });
    expect(settings.get("models.roles")).toEqual([mainRole]);
    const decidedRecord = governance
      .changesFor("human")
      .find((entry) => entry.key === "models.roles");
    expect(decidedRecord).toMatchObject({ status: "applied", decidedAt: expect.any(String) });
  });
});

describe("批次一般設定的全有全無", () => {
  it("代理的批次含 human-only 時整批拒絕，一筆都不生效", async () => {
    const { call, store, governance } = await harness();
    const error = await call(
      "system.settings.set",
      {
        changes: [
          { key: "notifications.systemCenter", value: false },
          { key: "permissions.mode", value: "ask" },
        ],
        clientRequestId: "batch-agent",
      },
      "agent:agent-1",
      { kind: "agent", id: "agent-1" },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProtocolHandlerError);
    expect(error).toMatchObject({ code: "permission_denied" });
    expect(store.rows.size).toBe(0);
    expect(governance.changesFor("human")).toEqual([]);
    expect(governance.changesFor("agent")).toEqual([]);
  });

  it("後面的項目驗證失敗時，前面已驗證通過的項目也不生效", async () => {
    const { call, store, settings } = await harness();
    const error = await call("system.settings.set", {
      changes: [
        { key: "notifications.systemCenter", value: false },
        { key: "models.summary.maxOutputTokens", value: -1 },
      ],
      clientRequestId: "batch-invalid",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProtocolHandlerError);
    expect(error).toMatchObject({
      code: "invalid_message",
      details: { field: "changes[1].value" },
    });
    expect(store.rows.size).toBe(0);
    expect(settings.get("notifications.systemCenter")).toBe(true);
  });

  it("批次含模型供應商時拒絕，前面已驗證通過的項目也不生效", async () => {
    const { call, store, settings } = await harness();
    const error = await call("system.settings.set", {
      changes: [
        { key: "notifications.systemCenter", value: false },
        { key: "models.providers", value: [] },
      ],
      clientRequestId: "batch-model-key",
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "invalid_message",
      details: { field: "changes[1].key" },
    });
    expect(store.rows.size).toBe(0);
    expect(settings.get("notifications.systemCenter")).toBe(true);
  });
});

describe("治理紀錄與套用結果的一致性", () => {
  it("核准後引擎不採用時，不留下假的 applied 紀錄，設定也不生效", async () => {
    const { call, settings, governance } = await harness();
    await call("system.models.set", {
      providers: [localProvider],
      clientRequestId: "seed-providers",
    });
    const proposal = (await call(
      "settings.propose_change",
      {
        key: "models.roles",
        value: [{ ...mainRole, ref: { providerId: "local", modelId: "missing-model" } }],
        clientRequestId: "prop-dangling",
      },
      "agent:agent-1",
      { kind: "agent", id: "agent-1" },
    )) as { change: { changeId: string } };

    const error = await call("settings.change.decide", {
      changeId: proposal.change.changeId,
      decision: "approve",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProtocolHandlerError);
    expect(error).toMatchObject({ code: "invalid_message" });
    expect(settings.get("models.roles")).toEqual([]);
    const record = governance
      .changesFor("human")
      .find((entry) => entry.changeId === proposal.change.changeId);
    expect(record).toMatchObject({ status: "pending" });
  });

  it("核准後稽核寫入失敗時，紀錄維持 applied 與實際設定一致", async () => {
    const { call, settings, governance, folder } = await harness();
    await call("system.models.set", {
      providers: [localProvider],
      clientRequestId: "seed-providers",
    });
    const proposal = (await call(
      "settings.propose_change",
      { key: "models.roles", value: [mainRole], clientRequestId: "prop-audit-fail" },
      "agent:agent-1",
      { kind: "agent", id: "agent-1" },
    )) as { change: { changeId: string } };
    // 讓稽核檔變成目錄，appendFileSync 會擲出 EISDIR。
    // 提議階段可能已寫過稽核行，先清掉再把路徑換成目錄。
    await rm(join(folder.path, "state", "settings-audit.jsonl"), { force: true });
    await mkdir(join(folder.path, "state", "settings-audit.jsonl"));

    const error = await call("settings.change.decide", {
      changeId: proposal.change.changeId,
      decision: "approve",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProtocolHandlerError);
    expect(error).toMatchObject({ code: "conflict" });
    // 已套用的模型設定維持生效，紀錄維持 applied，兩者不會謊稱退回。
    expect(settings.get("models.roles")).toEqual([mainRole]);
    const record = governance
      .changesFor("human")
      .find((entry) => entry.changeId === proposal.change.changeId);
    expect(record).toMatchObject({ status: "applied" });
  });

  it("第二次變更的變更紀錄寫入失敗時，模型退回本次之前的值，舊紀錄不作數", async () => {
    const { call, settings, governance, folder } = await harness();
    // 先成功寫入一筆：這個鍵已經有一筆 applied 紀錄，
    // 舊的 applied 紀錄不是這次寫入的證明。
    await call("system.models.set", {
      providers: [localProvider],
      clientRequestId: "seed-providers",
    });
    expect(settings.get("models.providers")).toMatchObject([localProvider]);

    // 讓變更紀錄檔變成目錄，writeFileAtomic 的 rename 會擲出 EISDIR。
    await rm(join(folder.path, "state", "settings-changes.json"));
    await mkdir(join(folder.path, "state", "settings-changes.json"), { recursive: true });

    const changedProvider = { ...localProvider, displayName: "本機（第二次）" };
    const error = await call("system.models.set", {
      providers: [changedProvider],
      clientRequestId: "journal-fail-second",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProtocolHandlerError);
    expect(error).toMatchObject({ code: "conflict" });
    // 本次沒有新落盤的紀錄，模型退回呼叫前的值，不能保留新值。
    expect(settings.get("models.providers")).toMatchObject([localProvider]);
    // 變更紀錄維持呼叫前的那一筆，journal 不變。
    const records = governance.changesFor("human");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      key: "models.providers",
      status: "applied",
      value: [localProvider],
    });
    const state = (await call("system.models.get", {})) as {
      providers: Array<{ displayName: string }>;
    };
    expect(state.providers[0]?.displayName).toBe("本機");
  });

  it("批次第二次變更的變更紀錄寫入失敗時，整批退回且 journal 不變", async () => {
    const { call, settings, governance, folder } = await harness();
    // 先成功寫入一筆：notifications.systemCenter 已有一筆 applied 紀錄。
    await call("system.settings.set", {
      changes: [{ key: "notifications.systemCenter", value: false }],
      clientRequestId: "seed-setting",
    });
    expect(settings.get("notifications.systemCenter")).toBe(false);

    // 讓變更紀錄檔變成目錄，writeFileAtomic 的 rename 會擲出 EISDIR。
    await rm(join(folder.path, "state", "settings-changes.json"));
    await mkdir(join(folder.path, "state", "settings-changes.json"), { recursive: true });

    const error = await call("system.settings.set", {
      changes: [
        { key: "notifications.systemCenter", value: true },
        { key: "context.reserveTokens", value: 10_000 },
      ],
      clientRequestId: "batch-journal-fail-second",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProtocolHandlerError);
    expect(error).toMatchObject({ code: "conflict" });
    // 本次沒有新落盤的紀錄：含已有 applied 紀錄的鍵在內，整批退回。
    expect(settings.get("notifications.systemCenter")).toBe(false);
    expect(settings.get("context.reserveTokens")).toBe(8_192);
    const records = governance.changesFor("human");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      key: "notifications.systemCenter",
      status: "applied",
      value: false,
    });
  });

  it("治理紀錄寫入失敗時，模型退回原設定且不留變更紀錄", async () => {
    const { call, settings, governance, folder } = await harness();
    // 讓變更紀錄檔變成目錄，writeFileAtomic 的 rename 會擲出 EISDIR。
    await mkdir(join(folder.path, "state", "settings-changes.json"), { recursive: true });

    const error = await call("system.models.set", {
      providers: [localProvider],
      clientRequestId: "journal-fail",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProtocolHandlerError);
    expect(error).toMatchObject({ code: "conflict" });
    expect(settings.get("models.providers")).toEqual([]);
    expect(governance.changesFor("human")).toEqual([]);
    const state = (await call("system.models.get", {})) as {
      resolved: Array<{ role: string; source: string }>;
    };
    expect(state.resolved.find((entry) => entry.role === "main")).toMatchObject({
      source: "none",
    });
  });

  it("治理稽核寫入失敗時，模型維持套用且紀錄維持 applied", async () => {
    const { call, settings, governance, folder } = await harness();
    await rm(join(folder.path, "state", "settings-audit.jsonl"), { force: true });
    await mkdir(join(folder.path, "state", "settings-audit.jsonl"));

    const error = await call("system.models.set", {
      providers: [localProvider],
      clientRequestId: "audit-fail",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProtocolHandlerError);
    expect(error).toMatchObject({ code: "conflict" });
    expect(settings.get("models.providers")).toMatchObject([localProvider]);
    expect(governance.changesFor("human")).toMatchObject([
      { key: "models.providers", status: "applied" },
    ]);
  });

  it("稽核寫入失敗後重送同一個 clientRequestId 不會留下重複紀錄", async () => {
    const { call, governance, settings, folder } = await harness();
    const auditPath = join(folder.path, "state", "settings-audit.jsonl");
    await rm(auditPath, { force: true });
    await mkdir(auditPath);

    const first = await call("system.models.set", {
      providers: [localProvider],
      clientRequestId: "audit-fail-replay",
    }).catch((caught: unknown) => caught);
    expect(first).toBeInstanceOf(ProtocolHandlerError);
    expect(first).toMatchObject({ code: "conflict" });
    expect(governance.changesFor("human")).toHaveLength(1);

    // 稽核檔修好後重送：冪等鍵在紀錄落盤時已登記，重送只回放既有紀錄。
    await rm(auditPath, { recursive: true, force: true });
    await call("system.models.set", {
      providers: [localProvider],
      clientRequestId: "audit-fail-replay",
    });
    const records = governance
      .changesFor("human")
      .filter((entry) => entry.key === "models.providers");
    expect(records).toHaveLength(1);
    expect(settings.get("models.providers")).toMatchObject([localProvider]);
  });

  it("批次稽核寫入失敗後重送同一個 clientRequestId 不會留下重複紀錄", async () => {
    const { call, governance, settings, folder } = await harness();
    const auditPath = join(folder.path, "state", "settings-audit.jsonl");
    await rm(auditPath, { force: true });
    await mkdir(auditPath);

    const first = await call("system.settings.set", {
      changes: [{ key: "context.reserveTokens", value: 10_000 }],
      clientRequestId: "batch-audit-fail-replay",
    }).catch((caught: unknown) => caught);
    expect(first).toBeInstanceOf(ProtocolHandlerError);
    expect(first).toMatchObject({ code: "conflict" });
    expect(governance.changesFor("human")).toHaveLength(1);

    await rm(auditPath, { recursive: true, force: true });
    await call("system.settings.set", {
      changes: [{ key: "context.reserveTokens", value: 10_000 }],
      clientRequestId: "batch-audit-fail-replay",
    });
    const records = governance
      .changesFor("human")
      .filter((entry) => entry.key === "context.reserveTokens");
    expect(records).toHaveLength(1);
    expect(settings.get("context.reserveTokens")).toBe(10_000);
  });

  it("批次套用時變更紀錄寫入失敗，整批退回原值且一筆都不生效", async () => {
    const { call, settings, governance, folder } = await harness();
    await mkdir(join(folder.path, "state", "settings-changes.json"), { recursive: true });

    const error = await call("system.settings.set", {
      changes: [
        { key: "context.reserveTokens", value: 10_000 },
        { key: "models.summary.maxOutputTokens", value: 8_000 },
      ],
      clientRequestId: "batch-journal-fail",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProtocolHandlerError);
    expect(error).toMatchObject({ code: "conflict" });
    expect(settings.get("context.reserveTokens")).toBe(8_192);
    expect(settings.get("models.summary.maxOutputTokens")).toBe(4_096);
    expect(governance.changesFor("human")).toEqual([]);
  });

  it("同一 clientRequestId 重放模型設定不會留下重複紀錄", async () => {
    const { call, governance } = await harness();
    await call("system.models.set", {
      providers: [localProvider],
      clientRequestId: "replay",
    });
    await call("system.models.set", {
      providers: [localProvider],
      clientRequestId: "replay",
    });
    const records = governance
      .changesFor("human")
      .filter((entry) => entry.key === "models.providers");
    expect(records).toHaveLength(1);
  });

  it("核准 models 留空的聚合供應商提議後，重建 ModelRuntime 仍已設定", async () => {
    const fetchedModels: ModelInfo[] = [
      { modelId: "agg-model", contextWindow: 32_768, input: ["text"] },
    ];
    const aggregator = {
      providerId: "agg",
      kind: "aggregator",
      displayName: "聚合",
      baseUrl: "https://agg.invalid/v1",
      models: fetchedModels,
    };
    const mainModelRole = {
      role: "main",
      mode: "model",
      ref: { providerId: "agg", modelId: "agg-model" },
    };
    const { call, settings, governance } = await harness(async () => fetchedModels);
    await call("system.models.set", {
      providers: [aggregator],
      roles: [mainModelRole],
      clientRequestId: "seed",
    });
    // 代理提議同一個供應商，只改顯示名稱、models 留空（等主機重新抓）。
    await call(
      "settings.propose_change",
      {
        key: "models.providers",
        value: [{ ...aggregator, displayName: "聚合改", models: [] }],
        clientRequestId: "propose-display",
      },
      "agent:agent-1",
      { kind: "agent", id: "agent-1" },
    );
    const pending = governance
      .changesFor("human")
      .find((entry) => entry.key === "models.providers" && entry.status === "pending");
    if (pending === undefined) throw new Error("找不到待決提議");
    await call("settings.change.decide", {
      changeId: pending.changeId,
      decision: "approve",
    });
    // 紀錄與儲存區以正規化後的值為準，不再留下 models: []。
    const stored = settings.get("models.providers") as Array<{
      displayName?: string;
      models: unknown;
      credentialRef?: string;
    }>;
    expect(stored[0]).toMatchObject({
      displayName: "聚合改",
      models: fetchedModels,
      credentialRef: "cardiary/provider/agg",
    });
    // 用同一份儲存區重建 ModelRuntime：configured() 仍為 true，main 解析得到模型。
    const restarted = new ModelRuntime({
      engine: await openEngine(),
      settings,
      credentials: credentialsMissing(),
      fetchModels: async () => fetchedModels,
    });
    await restarted.initialize();
    expect(restarted.configured()).toBe(true);
    expect(restarted.role("main").ref).toEqual({
      providerId: "agg",
      modelId: "agg-model",
    });
  });

  it("代理被拒的模型設定留下一行稽核拒絕紀錄", async () => {
    const { call, folder } = await harness();
    await call(
      "system.models.set",
      { providers: [localProvider], clientRequestId: "agent-denied" },
      "agent:agent-1",
      { kind: "agent", id: "agent-1" },
    ).catch((caught: unknown) => caught);
    const lines = await readFile(join(folder.path, "state", "settings-audit.jsonl"), "utf8").catch(
      () => "",
    );
    const denied = lines
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { outcome: string; actor: string });
    expect(denied).toContainEqual(
      expect.objectContaining({ actor: "agent:agent-1", outcome: "denied" }),
    );
  });
});
