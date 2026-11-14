import { describe, expect, it } from "vitest";

import { answer, createFixture } from "./support.js";

describe("暫停與恢復", () => {
  it("suspend 關閉引擎、resume 重開後仍能跑完一個新回合，secure_delete 兩次都成立", async () => {
    const fixture = await createFixture();
    try {
      const adapter = fixture.adapter as unknown as {
        debugPragma(name: string): Promise<number>;
      };
      const conversation = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [],
      });
      expect(await adapter.debugPragma("secure_delete")).toBe(1);

      await fixture.adapter.suspend();
      expect(fixture.adapter.getStatus().state).toBe("paused");

      await fixture.adapter.resume();
      expect(fixture.adapter.getStatus().state).toBe("running");
      expect(await adapter.debugPragma("secure_delete")).toBe(1);

      fixture.faux.setResponses(answer("恢復後的回答"));
      await fixture.adapter.sendMessage({
        conversationId: conversation.id,
        content: [{ type: "text", text: "還在嗎" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      const deadline = Date.now() + 10000;
      let text = "";
      while (Date.now() < deadline) {
        const history = await fixture.adapter.readConversationHistory({ conversationId: conversation.id });
        const assistant = [...history.messages].reverse().find((message) => message.role === "assistant");
        text = (assistant?.content ?? [])
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("");
        if (text.includes("恢復後的回答")) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(text).toContain("恢復後的回答");
      await fixture.adapter.suspend();
      expect(fixture.adapter.getStatus().state).toBe("paused");
    } finally {
      await fixture.cleanup();
    }
  }, 30000);
});
