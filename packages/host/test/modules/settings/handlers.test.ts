import { describe, expect, it } from "vitest";
import type {
  ProtocolEventEmitter,
  ProtocolRequestContext,
  ProtocolRequestHandler,
} from "@cardiary/module-api";
import type { JsonValue } from "@cardiary/engine-adapter";

import { ModelRuntime } from "../../../src/models/runtime.js";
import { registerSettingsProtocol } from "../../../src/modules/settings/protocol.js";
import { ProtocolHandlerError } from "../../../src/modules/contract.js";
import {
  credentialsMissing,
  openEngine,
  settingsService,
  MemorySettingsStore,
} from "../../models/support.js";

/** 直接呼叫模組處理器，驗證協定錯誤的欄位與事件內容。 */
async function harness() {
  const engine = await openEngine();
  const store = new MemorySettingsStore();
  const settings = settingsService(store);
  const runtime = new ModelRuntime({
    engine,
    settings,
    credentials: credentialsMissing(),
  });
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
    now: () => new Date("2026-11-15T00:00:00.000Z"),
  });
  const call = async (type: string, payload: Record<string, unknown>) => {
    const key = type.startsWith("system.models") ? "system.models" : "system.settings";
    const handler = handlers.get(key);
    if (handler === undefined) throw new Error(`沒有 ${key} 處理器`);
    return handler({
      type,
      payload: payload as JsonValue,
      clientId: "device-1",
    } as ProtocolRequestContext);
  };
  return { call, events, settings, store };
}

describe("設定模組的協定錯誤", () => {
  it("角色指到不存在的模型時回 invalid_message 與 details.field = roles", async () => {
    const { call } = await harness();
    const error = await call("system.models.set", {
      providers: [
        {
          providerId: "local",
          kind: "local",
          displayName: "本機",
          baseUrl: "http://127.0.0.1:1/v1",
          models: [{ modelId: "local-model", contextWindow: 32_768, input: ["text"] }],
        },
      ],
      roles: [
        {
          role: "main",
          mode: "model",
          ref: { providerId: "local", modelId: "missing" },
        },
      ],
      clientRequestId: "set-bad",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProtocolHandlerError);
    expect(error).toMatchObject({
      code: "invalid_message",
      details: { field: "roles" },
    });
  });

  it("一般設定不能修改模型供應商或角色", async () => {
    const { call } = await harness();
    const error = await call("system.settings.set", {
      changes: [{ key: "models.providers", value: [] }],
      clientRequestId: "settings-bad",
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "invalid_message",
      details: { field: "changes[0].key" },
    });
  });

  it("一般設定寫入後送出 settings-changed，內容只有設定值", async () => {
    const { call, events } = await harness();
    const result = (await call("system.settings.set", {
      changes: [{ key: "models.summary.maxOutputTokens", value: 8_192 }],
      clientRequestId: "settings-ok",
    })) as {
      applied: Array<{ key: string; value: unknown; level: string }>;
      requiresApproval: boolean;
    };
    expect(result.requiresApproval).toBe(false);
    expect(result.applied[0]).toMatchObject({
      key: "models.summary.maxOutputTokens",
      value: 8_192,
      level: "free",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "settings-changed",
      payload: {
        changedBy: "user:device-1",
        changes: [{ key: "models.summary.maxOutputTokens", value: 8_192 }],
      },
    });
  });

  it("模型設定不合法時不會寫入設定", async () => {
    const { call, store } = await harness();
    await call("system.models.set", {
      providers: [
        {
          providerId: "local",
          kind: "local",
          displayName: "本機",
          baseUrl: "not-a-url",
          models: [{ modelId: "local-model", contextWindow: 32_768, input: ["text"] }],
        },
      ],
      roles: [],
      clientRequestId: "set-bad-2",
    }).catch(() => undefined);
    expect(store.rows.size).toBe(0);
  });
});
