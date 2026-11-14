import { describe, expect, it } from "vitest";

import { bundleOf, createFixture, gateWith, toolThenAnswer } from "./support.js";
import type { EngineEvent, ToolDefinition } from "../src/index.js";

function echoTool(version: string): ToolDefinition {
  return {
    name: "echo",
    description: version,
    replay: "safe",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      return { ok: true, content: [{ type: "text", text: version }] };
    },
  };
}

describe("壓縮時換版", () => {
  it("預告的工具組變更在下一次壓縮套用，之後的回合用新版", async () => {
    const fixture = await createFixture({ gate: gateWith({ kind: "allow" }) });
    try {
      await fixture.adapter.tools.register(bundleOf("test.compact", [echoTool("v1")], 1));
      const conversation = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.compact", generation: 1 }],
      });
      fixture.faux.setResponses(toolThenAnswer("echo", {}, "第一輪"));
      await fixture.adapter.sendMessage({
        conversationId: conversation.id,
        content: [{ type: "text", text: "先用舊版" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const current = await fixture.adapter.getConversation(conversation.id);
        if (current?.state === "idle") {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      await fixture.adapter.tools.register(bundleOf("test.compact", [echoTool("v2")], 2));
      const events: EngineEvent[] = [];
      const subscription = fixture.adapter.subscribe({ conversationId: conversation.id });
      void (async () => {
        for await (const event of subscription.events) {
          events.push(event);
        }
      })();
      await fixture.adapter.stageConversationUpdate(conversation.id, {
        reason: "module-reload",
        toolBundles: [{ bundleId: "test.compact", generation: 2 }],
      });

      // 進行中的對話仍是釘選的舊版。
      const before = await fixture.adapter.getConversation(conversation.id);
      expect(before?.toolBundles[0]?.generation).toBe(1);

      await (
        fixture.adapter as unknown as { debugAppendCompaction(id: string): Promise<void> }
      ).debugAppendCompaction(conversation.id);
      await waitUntil(async () => {
        const catalog = await (
          fixture.adapter as unknown as {
            describeCatalog(): Promise<{
              conversations: Record<string, { toolBundles: readonly { generation: number }[] }>;
            }>;
          }
        ).describeCatalog();
        return catalog.conversations[conversation.id]?.toolBundles[0]?.generation === 2;
      }, "壓縮後套用新版本");

      const compacted = events.find((event) => event.kind === "conversation.compacted");
      expect(compacted?.kind === "conversation.compacted" ? compacted.appliedUpdate : null).toBe(
        true,
      );

      fixture.faux.setResponses(toolThenAnswer("echo", {}, "第二輪"));
      await fixture.adapter.sendMessage({
        conversationId: conversation.id,
        content: [{ type: "text", text: "換版後再跑" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      await new Promise((r) => setTimeout(r, 500));
      console.log(
        "DEBUG entries",
        JSON.stringify(
          await (
            fixture.adapter as unknown as { debugEntries(id: string): Promise<unknown> }
          ).debugEntries(conversation.id),
        ).slice(0, 1500),
      );
      await waitUntil(async () => {
        const history = await fixture.adapter.readConversationHistory({
          conversationId: conversation.id,
        });
        return history.messages.some(
          (message) =>
            message.role === "tool" &&
            message.content.some((block) => block.type === "text" && block.text.includes("v2")),
        );
      }, "換版後用新版工具");
      subscription.close();
    } finally {
      await fixture.cleanup();
    }
  }, 40000);
});

async function waitUntil(
  check: () => Promise<boolean | undefined>,
  label: string,
  timeoutMs = 10000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await check()) === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`等待逾時：${label}`);
}
