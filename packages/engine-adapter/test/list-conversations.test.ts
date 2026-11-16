import { describe, expect, it } from "vitest";

import { answer, createFixture, waitFor } from "./support.js";

const request = {
  model: { provider: "faux", model: "faux-1" },
  systemContext: "前綴",
  toolBundles: [],
};

describe("列出對話", () => {
  it("空資料庫回傳空清單，關閉引擎後回報錯誤", async () => {
    const fixture = await createFixture();
    try {
      expect(await fixture.adapter.listConversations()).toEqual([]);
      await fixture.close();
      await expect(fixture.adapter.listConversations()).rejects.toMatchObject({
        code: "engine-closed",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("多場對話依最後訊息時間由新到舊排列", async () => {
    const fixture = await createFixture();
    try {
      const first = await fixture.adapter.createConversation({ ...request, title: "較早建立" });
      const second = await fixture.adapter.createConversation({ ...request, title: "較晚建立" });
      for (const [conversation, offset] of [
        [second, 60_000],
        [first, 120_000],
      ] as const) {
        fixture.faux.setResponses(
          answer("收到").map((message) => ({ ...message, timestamp: Date.now() + offset })),
        );
        await fixture.adapter.sendMessage({
          conversationId: conversation.id,
          content: [{ type: "text", text: "你好" }],
          delivery: "queue",
          sender: { kind: "human", clientId: "test" },
        });
        await waitFor(async () => {
          const history = await fixture.adapter.readConversationHistory({
            conversationId: conversation.id,
          });
          return history.messages.some((message) => message.role === "assistant")
            ? true
            : undefined;
        }, "助理訊息");
      }
      const list = await fixture.adapter.listConversations();
      expect(list.map((summary) => summary.id)).toEqual([first.id, second.id]);
      expect(list[0]!.updatedAt! > list[1]!.updatedAt!).toBe(true);
      expect(list.map((summary) => summary.messageCount)).toEqual([2, 2]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("回傳標題、訊息數與最後訊息時間，並在重開後保留", async () => {
    const fixture = await createFixture();
    const first = await fixture.adapter.createConversation({ ...request, title: "旅行" });
    const second = await fixture.adapter.createConversation({ ...request, title: "工作" });
    const emptyList = await fixture.adapter.listConversations();
    expect(emptyList.map((summary) => summary.id)).toEqual([first.id, second.id]);
    expect(emptyList.every((summary) => summary.updatedAt === undefined)).toBe(true);
    fixture.faux.setResponses(answer("已收到"));
    await fixture.adapter.sendMessage({
      conversationId: first.id,
      content: [{ type: "text", text: "整理計畫" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "test" },
    });
    await waitFor(async () => {
      const history = await fixture.adapter.readConversationHistory({ conversationId: first.id });
      return history.messages.some((message) => message.role === "assistant") ? true : undefined;
    }, "助理訊息");
    const history = await fixture.adapter.readConversationHistory({ conversationId: first.id });
    const expectedTime = history.messages
      .map((message) => message.createdAt)
      .sort()
      .at(-1);
    const list = await fixture.adapter.listConversations();
    expect(list.map((summary) => summary.id)).toEqual([first.id, second.id]);
    expect(list[0]).toMatchObject({ title: "旅行", messageCount: 2, updatedAt: expectedTime });
    expect(list[1]).toMatchObject({ title: "工作", messageCount: 0 });
    await fixture.close();
    const reopened = await createFixture({ root: fixture.root });
    try {
      const restored = await reopened.adapter.listConversations();
      expect(restored.find((summary) => summary.id === first.id)).toMatchObject({
        title: "旅行",
        messageCount: 2,
        updatedAt: expectedTime,
      });
    } finally {
      await reopened.cleanup();
    }
  });
});
