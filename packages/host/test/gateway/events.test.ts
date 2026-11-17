/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { mapEventIntent, validateEventPayload } from "../../src/gateway/events.js";

/**
 * 閘道的事件驗證要跟正式 schema 對得上：這裡用 Ajv 讀
 * `packages/protocol/schema/protocol.schema.json`，逐型別比對我們的檢查器
 * 與 schema 的判斷。樣本刻意涵蓋每個事件的必填欄位與嵌套結構。
 */

const schemaPath = fileURLToPath(
  new URL("../../../protocol/schema/protocol.schema.json", import.meta.url),
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as any;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(schema);

const contextView = {
  sessionId: "s1",
  version: 3,
  entries: [
    {
      entryId: "e1",
      layer: "core-memory",
      cardId: "c1",
      title: "核心記憶",
      tokenEstimate: 120,
      state: "active",
      position: 0,
    },
    {
      entryId: "e2",
      layer: "working-context",
      title: "工作上下文",
      tokenEstimate: 40,
      state: "pending-removal",
      position: 1,
    },
  ],
  usedTokens: 160,
  budgetTokens: 8000,
  contextWindow: 10000,
  compactionThreshold: 0.75,
  lastCompactedAt: "2026-11-15T04:00:00.000Z",
};

const moduleInfo = {
  moduleId: "cards",
  name: "卡片庫",
  version: "1.0.0",
  enabled: true,
  state: "active",
  protocolPrefixes: ["card"],
  settings: [{ key: "mode", title: "模式", kind: "string", level: "free" }],
};

const mcpServerInfo = {
  serverId: "srv-1",
  name: "本機工具",
  transport: "stdio",
  command: "node",
  args: ["server.mjs"],
  allowedHosts: ["example.test"],
  enabled: true,
  state: "ready",
  createdAt: "2026-11-15T04:00:00.000Z",
};

const samples: Record<string, unknown> = {
  "card.changed": { cardId: "c1", change: "updated", revision: "r2", freshness: 80 },
  "context.changed": { sessionId: "s1", context: contextView },
  "context.compacted": {
    sessionId: "s1",
    summaryCardId: "c9",
    beforeTokens: 900,
    afterTokens: 200,
    compactedAt: "2026-11-15T04:00:00.000Z",
  },
  "session.archived": {
    sessionId: "s1",
    archive: { archivedAt: "2026-11-15T04:00:00.000Z", purgeAt: "2026-11-22T04:00:00.000Z" },
  },
  "session.unarchived": { sessionId: "s1" },
  "session.deleted": {
    sessionId: "s1",
    deletedSessionIds: ["s1", "s2"],
    deletedCards: 2,
    deletedAssets: 1,
  },
  "system.settings.changed": {
    changes: [
      {
        key: "freshness.halfLifeDays",
        value: 30,
        level: "free",
        title: "半衰期",
        updatedAt: "2026-11-15T04:00:00.000Z",
      },
    ],
    changedBy: "user:mac",
    changedAt: "2026-11-15T04:00:00.000Z",
  },
  "system.models.changed": {
    providers: [
      {
        providerId: "openai",
        kind: "api-key",
        displayName: "OpenAI",
        models: [
          {
            modelId: "gpt-x",
            displayName: "GPT X",
            contextWindow: 128000,
            maxOutputTokens: 4096,
            input: ["text", "image"],
          },
        ],
      },
    ],
    roles: [{ role: "main", mode: "model", ref: { providerId: "openai", modelId: "gpt-x" } }],
    resolved: [
      {
        role: "main",
        source: "configured",
        ref: { providerId: "openai", modelId: "gpt-x" },
      },
    ],
  },
  "system.modules.changed": { module: moduleInfo },
  "mcp.servers_changed": { server: mcpServerInfo, removed: false },
  "module.demo.changed": { data: { value: 1 }, schemaVersion: "1" },
};

const payloadDefinitions: Record<string, string> = {
  "card.changed": "CardChangedEventPayload",
  "context.changed": "ContextChangedEventPayload",
  "context.compacted": "ContextCompactedEventPayload",
  "session.archived": "SessionArchivedEventPayload",
  "session.unarchived": "SessionUnarchivedEventPayload",
  "session.deleted": "SessionDeletedEventPayload",
  "system.settings.changed": "SystemSettingsChangedEventPayload",
  "system.models.changed": "SystemModelsState",
  "system.modules.changed": "SystemModulesChangedEventPayload",
  "mcp.servers_changed": "McpServersChangedEventPayload",
  "module.demo.changed": "ModuleEventPayload",
};

function schemaAccepts(type: string, payload: unknown): boolean {
  const definition = payloadDefinitions[type];
  if (definition === undefined) throw new Error(`沒有 ${type} 的對照定義`);
  const validate = ajv.compile({ $ref: `${schema.$id}#/$defs/${definition}` }) as (
    data: unknown,
  ) => boolean;
  return validate(payload);
}

function firstRequiredKey(definition: string): string {
  return (schema.$defs[definition].required as string[])[0] ?? "";
}

describe("事件 payload 與 schema 一致", () => {
  it("每個支援的事件型別都有樣本，我們的檢查器與 Ajv 都接受", () => {
    for (const [type, payload] of Object.entries(samples)) {
      expect(validateEventPayload(type, payload), `${type} 被我們的檢查器拒絕`).toBeNull();
      expect(schemaAccepts(type, payload), `${type} 被 schema 拒絕`).toBe(true);
    }
  });

  it("缺少必填、型別錯、未知欄位：兩邊都拒絕", () => {
    for (const [type, payload] of Object.entries(samples)) {
      const definition = payloadDefinitions[type] ?? "";
      const required = firstRequiredKey(definition);
      const record = payload as Record<string, unknown>;
      const mutations: [string, unknown][] = [
        [
          "缺少必填",
          Object.fromEntries(Object.entries(record).filter(([key]) => key !== required)),
        ],
        ["型別錯", { ...record, [required]: 12345 }],
        ["未知欄位", { ...record, __unexpected: true }],
      ];
      for (const [name, mutated] of mutations) {
        expect(
          validateEventPayload(type, mutated),
          `${type} ${name} 被我們的檢查器接受`,
        ).not.toBeNull();
        expect(schemaAccepts(type, mutated), `${type} ${name} 被 schema 接受`).toBe(false);
      }
    }
  });

  it("不支援的型別一律拒絕", () => {
    expect(validateEventPayload("notification.created", { title: "t" })).not.toBeNull();
    expect(validateEventPayload("module.", { data: {} })).not.toBeNull();
    expect(validateEventPayload("module.demo.changed", { data: [] })).not.toBeNull();
  });
});

describe("事件意圖對照", () => {
  it("卡片、設定、模組與模組事件掛在 system 串流", () => {
    expect(mapEventIntent({ kind: "card-changed", cardId: "c1", change: "created" })).toEqual({
      events: [
        { stream: "system", type: "card.changed", payload: { cardId: "c1", change: "created" } },
      ],
    });
    expect(mapEventIntent({ kind: "settings-changed", payload: { changes: [] } })).toEqual({
      events: [{ stream: "system", type: "system.settings.changed", payload: { changes: [] } }],
    });
    expect(mapEventIntent({ kind: "module-changed", payload: { module: moduleInfo } })).toEqual({
      events: [
        { stream: "system", type: "system.modules.changed", payload: { module: moduleInfo } },
      ],
    });
    expect(
      mapEventIntent({
        kind: "mcp-servers-changed",
        payload: { server: mcpServerInfo, removed: true },
      }),
    ).toEqual({
      events: [
        {
          stream: "system",
          type: "mcp.servers_changed",
          payload: { server: mcpServerInfo, removed: true },
        },
      ],
    });
    expect(
      mapEventIntent({ kind: "module-event", type: "module.demo.changed", payload: { value: 1 } }),
    ).toEqual({
      events: [{ stream: "system", type: "module.demo.changed", payload: { data: { value: 1 } } }],
    });
  });

  it("會話事件同時掛在 system 與 session:<id>", () => {
    const mapping = mapEventIntent({
      kind: "session-lifecycle",
      conversationId: "s1",
      event: "deleted",
      payload: { sessionId: "s1", deletedSessionIds: ["s1"], deletedCards: 0, deletedAssets: 0 },
    });
    if ("error" in mapping) throw new Error(mapping.error);
    expect(mapping.events.map((event) => event.stream)).toEqual(["system", "session:s1"]);
    expect(mapping.events.map((event) => event.type)).toEqual([
      "session.deleted",
      "session.deleted",
    ]);
  });

  it("會話不一致、未知意圖與非法模組事件型別都回錯誤", () => {
    expect(
      mapEventIntent({
        kind: "context-compacted",
        conversationId: "s1",
        payload: { sessionId: "s2" },
      }),
    ).toHaveProperty("error");
    expect(mapEventIntent({ kind: "notification", title: "t", body: "b" })).toHaveProperty("error");
    expect(
      mapEventIntent({ kind: "module-event", type: "Module.Bad", payload: {} }),
    ).toHaveProperty("error");
  });
});
