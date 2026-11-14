import { describe, expect, it } from "vitest";

import { answer, bundleOf, createFixture, gateWith, toolThenAnswer } from "./support.js";
import type { ToolDefinition } from "../src/index.js";

function echoTool(version: string): ToolDefinition {
  return {
    name: "echo",
    description: `回傳 ${version}`,
    replay: "safe",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      return { ok: true, content: [{ type: "text", text: version }] };
    },
  };
}

describe("工具組 generation 釘選", () => {
  it("新對話用新版、已釘選的對話用舊版、停用回 tool-unavailable、重新啟用恢復", async () => {
    const fixture = await createFixture({ gate: gateWith({ kind: "allow" }) });
    try {
      await fixture.adapter.tools.register(bundleOf("test.echo", [echoTool("v1")], 1));
      const first = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.echo", generation: 1 }],
      });
      await fixture.adapter.tools.register(bundleOf("test.echo", [echoTool("v2")], 2));
      const second = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.echo", generation: 2 }],
      });

      const runEcho = async (conversationId: string): Promise<string> => {
        fixture.faux.setResponses(toolThenAnswer("echo", {}, "好"));
        await fixture.adapter.sendMessage({
          conversationId,
          content: [{ type: "text", text: "跑" }],
          delivery: "queue",
          sender: { kind: "human", clientId: "test" },
        });
        const history = await waitForHistory(fixture.adapter, conversationId, "v");
        return history;
      };

      expect(await runEcho(first.id)).toContain("v1");
      expect(await runEcho(second.id)).toContain("v2");

      const states = fixture.adapter.tools.list();
      const state = await states;
      expect(state.find((entry) => entry.bundleId === "test.echo" && entry.generation === 1)?.pinnedByConversations).toBe(1);

      // 停用（退役）舊版：已釘選的對話失去工具。
      await fixture.adapter.tools.retire("test.echo", 1);
      fixture.faux.setResponses(answer("沒有工具"));
      await fixture.adapter.sendMessage({
        conversationId: first.id,
        content: [{ type: "text", text: "再跑" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      const unavailable = await waitForLastAssistant(fixture.adapter, first.id);
      expect(unavailable).not.toContain("v1");

      // 重新註冊同一個版本：恢復。
      await fixture.adapter.tools.register(bundleOf("test.echo", [echoTool("v1")], 1));
      expect(await runEcho(first.id)).toContain("v1");
    } finally {
      await fixture.cleanup();
    }
  }, 30000);
});

async function waitForHistory(
  adapter: import("../src/index.js").EngineAdapter,
  conversationId: string,
  contains: string,
): Promise<string> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const history = await adapter.readConversationHistory({ conversationId });
    const text = history.messages
      .filter((message) => message.role === "tool")
      .map((message) => message.content.map((block) => (block.type === "text" ? block.text : "")).join(""))
      .join("\n");
    if (text.includes(contains)) {
      return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("等待工具結果逾時");
}

async function waitForLastAssistant(
  adapter: import("../src/index.js").EngineAdapter,
  conversationId: string,
): Promise<string> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const conversation = await adapter.getConversation(conversationId);
    if (conversation?.state === "idle") {
      const history = await adapter.readConversationHistory({ conversationId });
      const assistant = [...history.messages].reverse().find((message) => message.role === "assistant");
      return assistant?.content.map((block) => (block.type === "text" ? block.text : "")).join("") ?? "";
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("等待回合結束逾時");
}
