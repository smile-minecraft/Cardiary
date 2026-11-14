import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { ToolCall } from "@earendil-works/pi-ai";

import {
  answer,
  approvalTool,
  bundleOf,
  createFixture,
  gateWith,
  toolThenAnswer,
} from "./support.js";
import type { EngineAdapter, ToolDefinition } from "../src/index.js";

const echo: ToolDefinition = {
  name: "echo",
  description: "回傳文字",
  replay: "safe",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    return { ok: true, content: [{ type: "text", text: "echo" }] };
  },
};

async function idle(adapter: EngineAdapter, conversationId: string): Promise<void> {
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

describe("子代理", () => {
  it("同步等待、繼承工具與權限、結果卡形狀與下一輪注入", async () => {
    const fixture = await createFixture({ gate: gateWith({ kind: "allow" }) });
    try {
      await fixture.adapter.tools.register(bundleOf("test.sub", [echo], 1));
      const parent = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.sub", generation: 1 }],
      });
      fixture.faux.setResponses(toolThenAnswer("echo", {}, "主線答案"));
      await fixture.adapter.sendMessage({
        conversationId: parent.id,
        content: [{ type: "text", text: "第一輪" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      await idle(fixture.adapter, parent.id);
      const history = await fixture.adapter.readConversationHistory({ conversationId: parent.id });
      const cursor = history.messages[0]?.cursor ?? "1";

      fixture.faux.setResponses([
        fauxAssistantMessage([fauxToolCall("echo", {}) as ToolCall], { stopReason: "toolUse" }),
        fauxAssistantMessage("支線結論：可以"),
      ]);
      const handle = await fixture.adapter.spawnSubagent({
        parentConversationId: parent.id,
        at: cursor,
        depth: 1,
        waiting: "blocking",
        instruction: "研究一下",
        title: "研究支線",
      });
      expect(handle.status).toBe("completed");
      expect(handle.depth).toBe(1);
      expect(handle.resultCard?.cardKind).toBe("subagent-summary");
      expect(handle.resultCard?.scope).toBe("conversation");
      expect(handle.resultCard?.conclusion).toContain("支線結論");
      expect(handle.resultCard?.branchConversationId).toBe(handle.subagentConversationId);
      expect(handle.resultCard?.references[0]?.kind).toBe("branch-entry");

      const subagentHistory = await fixture.adapter.readConversationHistory({
        conversationId: handle.subagentConversationId,
      });
      expect(subagentHistory.messages.some((message) => message.role === "tool")).toBe(true);

      const parentAfter = await fixture.adapter.readConversationHistory({
        conversationId: parent.id,
      });
      expect(parentAfter.messages).toHaveLength(history.messages.length);

      const listed = await fixture.adapter.listSubagents(parent.id);
      expect(listed.map((entry) => entry.subagentConversationId)).toContain(
        handle.subagentConversationId,
      );

      // 子代理不能再開子代理。
      await expect(
        fixture.adapter.spawnSubagent({
          parentConversationId: handle.subagentConversationId,
          at: cursor,
          depth: 1,
          waiting: "blocking",
          instruction: "再一層",
        }),
      ).rejects.toMatchObject({ code: "subagent-depth-exceeded" });

      const injection = await fixture.adapter.queueNextTurnInjection({
        conversationId: parent.id,
        source: "subagent-result-card",
        text: "結果卡",
        cardIds: [],
      });
      expect(["queued", "unsupported"]).toContain(injection.outcome);
    } finally {
      await fixture.cleanup();
    }
  }, 30000);

  it("同一個主對話同時最多 4 個子代理", async () => {
    const fixture = await createFixture();
    try {
      await fixture.adapter.tools.register(
        bundleOf("test.hold", [approvalTool({ name: "hold" })], 1),
      );
      const parent = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.hold", generation: 1 }],
      });
      fixture.faux.setResponses(answer("先跑一輪"));
      await fixture.adapter.sendMessage({
        conversationId: parent.id,
        content: [{ type: "text", text: "暖身" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      await idle(fixture.adapter, parent.id);
      const history = await fixture.adapter.readConversationHistory({ conversationId: parent.id });
      const cursor = history.messages[0]?.cursor ?? "1";

      fixture.faux.setResponses(
        Array.from({ length: 4 }, () =>
          fauxAssistantMessage([fauxToolCall("hold", {}) as ToolCall], { stopReason: "toolUse" }),
        ),
      );
      for (let index = 0; index < 4; index += 1) {
        const handle = await fixture.adapter.spawnSubagent({
          parentConversationId: parent.id,
          at: cursor,
          depth: 1,
          waiting: "background",
          instruction: `背景 ${index}`,
        });
        expect(handle.status).toBe("running");
      }
      await expect(
        fixture.adapter.spawnSubagent({
          parentConversationId: parent.id,
          at: cursor,
          depth: 1,
          waiting: "background",
          instruction: "第五個",
        }),
      ).rejects.toMatchObject({ code: "subagent-limit-reached" });
    } finally {
      await fixture.cleanup();
    }
  }, 30000);
});
