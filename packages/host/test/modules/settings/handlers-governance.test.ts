import { describe, expect, it } from "vitest";
import type {
  ProtocolEventEmitter,
  ProtocolRequestContext,
  ProtocolRequestHandler,
} from "@cardiary/module-api";
import type { JsonValue } from "@cardiary/engine-adapter";

import { FolderLayout } from "@cardiary/storage";
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
 * harness 直接呼叫處理器；`clientId` 以 `agent:` 開頭代表代理，其餘視為人。
 * `models.set` 的 actor 不再固定 `user:<clientId>`，必須跟著來源走。
 */
const NOW = () => new Date("2026-11-15T00:00:00.000Z");

async function harness() {
  const engine = await openEngine();
  const store = new MemorySettingsStore(NOW);
  const settings = settingsService(store);
  const runtime = new ModelRuntime({
    engine,
    settings,
    credentials: credentialsMissing(),
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
  const call = async (type: string, payload: Record<string, unknown>, clientId = "device-1") => {
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
    } as ProtocolRequestContext);
  };
  return { call, events, settings, store, governance };
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
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProtocolHandlerError);
    expect(error).toMatchObject({ code: "permission_denied" });
    expect(store.rows.size).toBe(0);
    expect(settings.get("models.providers")).toEqual([]);
    expect(governance.changesFor("human")).toEqual([]);
    expect(governance.changesFor("agent")).toEqual([]);
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
