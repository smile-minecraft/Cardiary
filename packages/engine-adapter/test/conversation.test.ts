import { describe, expect, it } from "vitest";

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { ToolCall } from "@earendil-works/pi-ai";

import { answer, approvalTool, bundleOf, createFixture, waitFor } from "./support.js";

describe("對話生命週期", () => {
  it("建立、送訊息、事件訂閱與分岔", async () => {
    const fixture = await createFixture();
    try {
      const conversation = await fixture.adapter.createConversation({
        title: "第一場",
        model: { provider: "faux", model: "faux-1" },
        systemContext: "你是測試助理",
        toolBundles: [],
      });
      expect(conversation.id).toBeTruthy();
      expect(conversation.state).toBe("idle");

      const subscription = fixture.adapter.subscribe({ conversationId: conversation.id });
      fixture.faux.setResponses(answer("你好，我是助理"));

      const receipt = await fixture.adapter.sendMessage({
        conversationId: conversation.id,
        content: [{ type: "text", text: "哈囉" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
        clientMessageId: "msg-1",
      });
      expect(receipt.turnId).toBe(`turn_${receipt.messageId}`);

      const events: string[] = [];
      const collected = (async () => {
        for await (const event of subscription.events) {
          events.push(event.kind);
          if (event.kind === "turn.completed") {
            return;
          }
        }
      })();
      await collected;

      expect(events).toContain("turn.started");
      expect(events).toContain("message.appended");
      expect(events[events.length - 1]).toBe("turn.completed");

      const history = await fixture.adapter.readConversationHistory({
        conversationId: conversation.id,
      });
      expect(history.messages.length).toBeGreaterThanOrEqual(2);
      const assistant = history.messages.find((message) => message.role === "assistant");
      expect(assistant?.content[0]).toEqual({ type: "text", text: "你好，我是助理" });

      // 同一個 clientMessageId 重送不會新增訊息，回同一個回合。
      const again = await fixture.adapter.findMessageByClientId(conversation.id, "msg-1");
      expect(again?.messageId).toBe(receipt.messageId);
      expect(again?.turnId).toBe(receipt.turnId);

      const firstUser = history.messages.find((message) => message.role === "user");
      expect(firstUser).toBeDefined();
      const fork = await fixture.adapter.forkConversation({
        conversationId: conversation.id,
        at: firstUser?.cursor ?? "1",
        title: "分岔",
      });
      expect(fork.id).not.toBe(conversation.id);
      expect(fork.origin?.kind).toBe("user-fork");
      const forkHistory = await fixture.adapter.readConversationHistory({
        conversationId: fork.id,
      });
      expect(forkHistory.messages.length).toBeLessThan(history.messages.length);
      subscription.close();
    } finally {
      await fixture.cleanup();
    }
  });

  it("用 clientRequestId 建立後重啟仍找得到同一場對話", async () => {
    const fixture = await createFixture();
    const conversation = await fixture.adapter.createConversation({
      model: { provider: "faux", model: "faux-1" },
      systemContext: "前綴",
      toolBundles: [],
      clientRequestId: "req-1",
    });
    await fixture.close();
    const reopened = await createFixture({ root: fixture.root });
    try {
      const found = await reopened.adapter.findConversationByClientRequestId("req-1");
      expect(found?.id).toBe(conversation.id);
      const again = await reopened.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [],
        clientRequestId: "req-1",
      });
      expect(again.id).toBe(conversation.id);
    } finally {
      await reopened.cleanup();
    }
  });

  it("中途插話在下一個模型請求前送達，忙碌時 reject 回 conversation-busy", async () => {
    const fixture = await createFixture();
    try {
      await fixture.adapter.tools.register(
        bundleOf("test.hold", [approvalTool({ name: "hold" })], 1),
      );
      const conversation = await fixture.adapter.createConversation({
        model: { provider: "faux", model: "faux-1" },
        systemContext: "前綴",
        toolBundles: [{ bundleId: "test.hold", generation: 1 }],
      });
      fixture.faux.setResponses([
        fauxAssistantMessage([fauxToolCall("hold", {}) as ToolCall], { stopReason: "toolUse" }),
        fauxAssistantMessage("收到插話"),
      ]);

      const subscription = fixture.adapter.subscribe({ conversationId: conversation.id });
      const first = await fixture.adapter.sendMessage({
        conversationId: conversation.id,
        content: [{ type: "text", text: "開始" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "test" },
      });
      expect(first.delivery).toBe("started");

      await waitFor(
        async () => (await fixture.adapter.approvals.listPending()).length > 0 ? true : undefined,
        "等待審批請求",
      );

      await expect(
        fixture.adapter.sendMessage({
          conversationId: conversation.id,
          content: [{ type: "text", text: "不要排隊" }],
          delivery: "reject",
          sender: { kind: "human", clientId: "test" },
        }),
      ).rejects.toMatchObject({ code: "conversation-busy" });

      const steered = await fixture.adapter.sendMessage({
        conversationId: conversation.id,
        content: [{ type: "text", text: "改用 pnpm，不要用 npm" }],
        delivery: "steer",
        sender: { kind: "human", clientId: "test" },
      });
      expect(steered.delivery).toBe("steered");

      const pending = await fixture.adapter.approvals.listPending();
      const decided = await fixture.adapter.approvals.decide({
        requestId: pending[0]!.id,
        verdict: "approve",
        decidedBy: { kind: "human", clientId: "test" },
      });
      expect(decided.outcome).toBe("accepted");

      const kinds: string[] = [];
      for await (const event of subscription.events) {
        kinds.push(event.kind);
        if (event.kind === "turn.completed") {
          break;
        }
      }
      expect(kinds).toContain("approval.requested");
      expect(kinds).toContain("approval.resolved");

      const history = await fixture.adapter.readConversationHistory({ conversationId: conversation.id });
      const userTexts = history.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content.map((block) => (block.type === "text" ? block.text : "")).join(""));
      expect(userTexts).toContain("改用 pnpm，不要用 npm");
      subscription.close();
    } finally {
      await fixture.cleanup();
    }
  });
});
