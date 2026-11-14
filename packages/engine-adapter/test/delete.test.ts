import { join } from "node:path";

import { openNodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";
import { describe, expect, it } from "vitest";

import {
  answer,
  bundleOf,
  createFixture,
  gateWith,
  toolThenAnswer,
} from "./support.js";
import type { DeletionIntent, EngineAdapter, ToolDefinition } from "../src/index.js";

const echo: ToolDefinition = {
  name: "echo",
  description: "回傳文字",
  replay: "safe",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    return { ok: true, content: [{ type: "text", text: "done" }] };
  },
};

async function runTurn(adapter: EngineAdapter, conversationId: string): Promise<void> {
  await adapter.sendMessage({
    conversationId,
    content: [{ type: "text", text: "跑" }],
    delivery: "queue",
    sender: { kind: "human", clientId: "test" },
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const conversation = await adapter.getConversation(conversationId);
    if (conversation?.state === "idle") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("等待回合結束逾時");
}

async function counts(stateDir: string): Promise<Record<string, number>> {
  const database = await openNodeSqliteDatabase(join(stateDir, "engine.sqlite"));
  try {
    const tables = ["conversations", "entries", "tasks", "submissions", "record_ids"];
    const result: Record<string, number> = {};
    for (const table of tables) {
      const row = await database.get<{ count: number }>(`SELECT count(*) AS count FROM ${table}`);
      result[table] = Number(row?.count ?? 0);
    }
    const nonDocument = await database.get<{ count: number }>(
      "SELECT count(*) AS count FROM record_ids WHERE record_type <> 'document'",
    );
    result.recordIdsNonDocument = Number(nonDocument?.count ?? 0);
    const scoped = await database.get<{ count: number }>(
      `SELECT count(*) AS count FROM documents
       WHERE scope_kind = 'conversation' OR (scope_kind = 'task' AND owner_id NOT IN (SELECT id FROM tasks))`,
    );
    result.scopedDocuments = Number(scoped?.count ?? 0);
    return result;
  } finally {
    await database.close();
  }
}

describe("刪除對話", () => {
  it("刪主線連同支線：五張表與 record_ids 清空，支線回 not_found", async () => {
    const fixture = await createFixture({ gate: gateWith({ kind: "allow" }) });
    try {
      await fixture.adapter.tools.register(bundleOf("test.delete", [echo], 1));
      const root = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.delete", generation: 1 }],
      });
      fixture.faux.setResponses(toolThenAnswer("echo", {}, "好"));
      await fixture.adapter.sendMessage({
        conversationId: root.id,
        content: [{ type: "text", text: "第一輪" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      const history = await fixture.adapter.readConversationHistory({ conversationId: root.id });
      const first = history.messages[0];
      const branch = await fixture.adapter.forkConversation({
        conversationId: root.id,
        at: first?.cursor ?? "1",
      });
      fixture.faux.setResponses(answer("支線回答"));
      await runTurn(fixture.adapter, branch.id);

      const before = await counts(fixture.environment.stateDir);
      expect(before.conversations).toBeGreaterThanOrEqual(2);

      await fixture.adapter.deleteConversation(root.id);

      expect(await fixture.adapter.getConversation(root.id)).toBeNull();
      expect(await fixture.adapter.getConversation(branch.id)).toBeNull();
      await expect(
        fixture.adapter.readConversationHistory({ conversationId: branch.id }),
      ).rejects.toMatchObject({ code: "conversation-not-found" });

      const after = await counts(fixture.environment.stateDir);
      expect(after).toEqual({
        conversations: 0,
        entries: 0,
        tasks: 0,
        submissions: 0,
        // 只剩 Cardiary 自己的對話目錄文件（session 範圍）的 record id。
        record_ids: 1,
        recordIdsNonDocument: 0,
        scopedDocuments: 0,
      });

      // 冪等：再刪一次不拋錯。
      await fixture.adapter.deleteConversation(root.id);
      await fixture.adapter.deleteConversation(branch.id);
    } finally {
      await fixture.cleanup();
    }
  }, 30000);

  it("刪除後同一個 clientRequestId 可以建立新對話，不會回已刪除的資源", async () => {
    const fixture = await createFixture();
    try {
      const first = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [],
        clientRequestId: "req-delete",
      });
      await fixture.adapter.deleteConversation(first.id);
      expect(await fixture.adapter.findConversationByClientRequestId("req-delete")).toBeNull();
      const second = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [],
        clientRequestId: "req-delete",
      });
      expect(second.id).not.toBe(first.id);
    } finally {
      await fixture.cleanup();
    }
  });

  it("啟動時先完成 conversation_deletions 意圖，再建立 Harness", async () => {
    const fixture = await createFixture();
    const conversation = await fixture.adapter.createConversation({
      model: { provider: "faux", model: "faux-1" },
      systemContext: "前綴",
      toolBundles: [],
    });
    await fixture.close();

    const calls: string[] = [];
    const intents: DeletionIntent[] = [
      {
        rootConversationId: conversation.id,
        conversationIds: [conversation.id],
        clientRequestIds: [],
        phase: "rows",
      },
    ];
    const purger = {
      async putIntent(intent: DeletionIntent) {
        intents.push(intent);
      },
      async listIntents() {
        calls.push("list");
        return [...intents];
      },
      async setIntentPhase() {
        calls.push("phase");
      },
      async removeIntent(rootId: string) {
        calls.push("remove");
        const index = intents.findIndex((intent) => intent.rootConversationId === rootId);
        if (index >= 0) {
          intents.splice(index, 1);
        }
      },
      async purge() {
        calls.push("purge");
      },
    };
    const reopened = await createFixture({ root: fixture.root, purger });
    try {
      expect(calls).toEqual(["list", "purge", "phase", "remove"]);
      const after = await counts(reopened.environment.stateDir);
      expect(after.conversations).toBe(0);
      expect(await reopened.adapter.getConversation(conversation.id)).toBeNull();
    } finally {
      await reopened.cleanup();
    }
  }, 30000);
});
