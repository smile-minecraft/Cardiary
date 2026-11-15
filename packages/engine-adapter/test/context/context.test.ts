import { describe, expect, it } from "vitest";

import type { Message } from "@earendil-works/pi-ai";

import { waitFor } from "../support.js";
import {
  createContextFixture,
  isBytePrefix,
  messageText,
  waitUntilIdle,
  withoutVolatileTail,
} from "./support.js";

const MODEL = { provider: "faux", model: "faux-1" } as const;

async function startConversation(
  context: Awaited<ReturnType<typeof createContextFixture>>,
  systemContext: string,
): Promise<string> {
  const conversation = await context.fixture.adapter.createConversation({
    model: MODEL,
    systemContext,
    toolBundles: [],
  });
  return conversation.id;
}

async function send(
  context: Awaited<ReturnType<typeof createContextFixture>>,
  conversationId: string,
  text: string,
): Promise<void> {
  await context.fixture.adapter.sendMessage({
    conversationId,
    content: [{ type: "text", text }],
    delivery: "queue",
    sender: { kind: "human", clientId: "test" },
  });
  await waitUntilIdle(context.fixture, conversationId);
}

/**
 * 模擬引擎把尾端的 system 訊息折回最前面的 system 內容。
 *
 * 這是 `docs/spikes/model-access.md` 第 4 項的實測行為；測試用它證明
 * 「用 system 角色送第 8 層」會被前綴檢查抓到。
 */
function foldTrailingSystem(messages: readonly Message[]): Message[] {
  const trailing = messages.filter((message) => message.role === "system");
  const rest = messages.filter((message) => message.role !== "system");
  if (trailing.length === 0) return [...messages];
  const merged = trailing.map((message) => messageText(message)).join("\n");
  return [{ role: "system", content: merged, timestamp: 0 } as Message, ...rest];
}

describe("第 8 層的尾端訊息", () => {
  it("是 user 角色的尾端訊息，內容是目前時間", async () => {
    const context = await createContextFixture();
    try {
      const conversationId = await startConversation(context, "前綴");
      context.recorder.answer("收到");
      await send(context, conversationId, "你好");

      const request = context.recorder.requests[0] ?? [];
      const tail = request.at(-1);
      expect(tail?.role).toBe("user");
      expect(messageText(tail as Message)).toMatch(/^目前時間：.+（.+）$/);
    } finally {
      await context.fixture.cleanup();
    }
  });

  it("不寫進逐字稿；每一輪重算", async () => {
    const context = await createContextFixture();
    try {
      const conversationId = await startConversation(context, "前綴");
      context.recorder.answer("第一輪");
      await send(context, conversationId, "第一則");
      context.recorder.answer("第二輪");
      await send(context, conversationId, "第二則");

      const history = await context.fixture.adapter.readConversationHistory({ conversationId });
      expect(
        history.messages.some((message) =>
          message.content.some(
            (block) => block.type === "text" && block.text.startsWith("目前時間："),
          ),
        ),
      ).toBe(false);
      const firstTail = context.recorder.requests[0]?.at(-1);
      const secondTail = context.recorder.requests[1]?.at(-1);
      expect(messageText(firstTail as Message)).not.toBe(messageText(secondTail as Message));
    } finally {
      await context.fixture.cleanup();
    }
  });

  it("連續多輪之間，前一輪（不含尾端）是下一輪的位元組前綴", async () => {
    const context = await createContextFixture();
    try {
      const conversationId = await startConversation(context, "固定前綴");
      for (let index = 1; index <= 3; index += 1) {
        context.recorder.answer(`回應 ${index}`);
        await send(context, conversationId, `訊息 ${index}`);
      }

      const requests = context.recorder.requests;
      expect(requests).toHaveLength(3);
      for (let index = 1; index < requests.length; index += 1) {
        const previous = withoutVolatileTail(requests[index - 1] ?? []);
        const next = withoutVolatileTail(requests[index] ?? []);
        expect(previous.length).toBeGreaterThan(0);
        expect(isBytePrefix(previous, next)).toBe(true);
      }
    } finally {
      await context.fixture.cleanup();
    }
  });

  it("用 system 角色送尾端時，前綴檢查會失敗", async () => {
    const context = await createContextFixture();
    try {
      const conversationId = await startConversation(context, "固定前綴");
      context.recorder.answer("回應 1");
      await send(context, conversationId, "訊息 1");
      context.recorder.answer("回應 2");
      await send(context, conversationId, "訊息 2");

      const first = context.recorder.requests[0] ?? [];
      const second = foldTrailingSystem(context.recorder.requests[1] ?? []);
      const wrongFirst = foldTrailingSystem(
        first.map((message) =>
          message.role === "user" && messageText(message).startsWith("目前時間：")
            ? ({ role: "system", content: messageText(message), timestamp: 0 } as Message)
            : message,
        ),
      );
      const wrongSecond = foldTrailingSystem(
        second.map((message) =>
          message.role === "user" && messageText(message).startsWith("目前時間：")
            ? ({ role: "system", content: messageText(message), timestamp: 0 } as Message)
            : message,
        ),
      );

      expect(isBytePrefix(wrongFirst, wrongSecond)).toBe(false);
      // 同一組訊息用 user 尾端時，前綴成立。
      expect(isBytePrefix(withoutVolatileTail(first), withoutVolatileTail(second))).toBe(true);
    } finally {
      await context.fixture.cleanup();
    }
  });
});

describe("主機算好的壓縮", () => {
  it("重送同一筆壓縮：不會多寫一筆壓縮 entry，摘要只出現一次", async () => {
    const context = await createContextFixture();
    try {
      const conversationId = await startConversation(context, "固定前綴");
      context.recorder.answer("第一輪");
      await send(context, conversationId, "開始");

      const history = await context.fixture.adapter.readConversationHistory({
        conversationId,
      });
      const keep = history.messages.at(-1);
      const request = {
        summary: "重送也只會有一筆的摘要",
        keepFromCursor: keep?.cursor ?? "",
        beforeTokens: 100,
        afterTokens: 40,
      };
      await context.fixture.adapter.compactConversation(conversationId, request);
      // 中斷後補做帶著同一份摘要與同一個游標重送；不要再寫一筆。
      await context.fixture.adapter.compactConversation(conversationId, request);

      const after = await context.fixture.adapter.readConversationHistory({ conversationId });
      const occurrences = after.messages.filter((message) =>
        messageText(message).includes("重送也只會有一筆的摘要"),
      ).length;
      expect(occurrences).toBe(1);
    } finally {
      await context.fixture.cleanup();
    }
  });

  it("丟棄保留範圍之前的逐字稿，歷史仍讀得到", async () => {
    const context = await createContextFixture();
    try {
      const conversationId = await startConversation(context, "固定前綴");
      for (let index = 1; index <= 4; index += 1) {
        context.recorder.answer(`回應 ${index}`);
        await send(context, conversationId, `訊息 ${index}`);
      }
      const history = await context.fixture.adapter.readConversationHistory({ conversationId });
      const keep = history.messages.find(
        (message) =>
          message.role === "user" &&
          message.content.some((block) => block.type === "text" && block.text === "訊息 3"),
      );
      expect(keep).toBeDefined();

      await context.fixture.adapter.compactConversation(conversationId, {
        summary: "前面在處理測試與檔案",
        keepFromCursor: keep?.cursor ?? "",
        beforeTokens: 900,
        afterTokens: 120,
      });

      const afterHistory = await context.fixture.adapter.readConversationHistory({
        conversationId,
      });
      // 壓縮只改變模型看得到的第 7 層；歷史仍保留被摘要的訊息。
      const afterTexts = afterHistory.messages.map((message) => messageText(message));
      expect(afterTexts.some((text) => text.includes("訊息 1"))).toBe(true);
      expect(afterTexts.some((text) => text.includes("前面在處理測試與檔案"))).toBe(true);

      context.recorder.answer("壓縮後的回應");
      await send(context, conversationId, "繼續");
      const request = context.recorder.requests.at(-1) ?? [];
      const texts = request.map((message) => messageText(message));
      expect(texts.some((text) => text.includes("前面在處理測試與檔案"))).toBe(true);
      expect(texts.some((text) => text.includes("訊息 1"))).toBe(false);
      expect(texts.some((text) => text.includes("訊息 3"))).toBe(true);
    } finally {
      await context.fixture.cleanup();
    }
  });

  it("等待中的工具組換版在同一步套用，事件標記 appliedUpdate", async () => {
    const context = await createContextFixture();
    try {
      const conversationId = await startConversation(context, "固定前綴");
      context.recorder.answer("第一輪");
      await send(context, conversationId, "開始");

      const events: unknown[] = [];
      const subscription = context.fixture.adapter.subscribe({ conversationId });
      void (async () => {
        for await (const event of subscription.events) {
          events.push(event);
        }
      })();

      await context.fixture.adapter.stageConversationUpdate(conversationId, {
        reason: "module-reload",
        systemContext: "新的固定前綴",
      });
      const before = await context.fixture.adapter.readConversationHistory({ conversationId });
      const keep = before.messages.at(-1);
      await context.fixture.adapter.compactConversation(conversationId, {
        summary: "摘要",
        keepFromCursor: keep?.cursor ?? "",
        beforeTokens: 100,
        afterTokens: 40,
      });
      const compacted = await waitFor(
        () =>
          events.find((event) => (event as { kind?: string }).kind === "conversation.compacted") as
            { appliedUpdate?: boolean } | undefined,
        "壓縮事件",
      );
      expect(compacted.appliedUpdate).toBe(true);
      subscription.close();
    } finally {
      await context.fixture.cleanup();
    }
  });

  it("讀得到最近一輪的用量，request_tokens 是 input 加兩個快取", async () => {
    const context = await createContextFixture();
    try {
      const conversationId = await startConversation(context, "固定前綴");
      context.recorder.answer("收到");
      await send(context, conversationId, "你好");

      const usage = await (
        context.fixture.adapter as unknown as {
          readConversationUsage(id: string): Promise<{
            inputTokens: number;
            cacheReadTokens: number;
            cacheWriteTokens: number;
            requestTokens: number;
          } | null>;
        }
      ).readConversationUsage(conversationId);
      expect(usage).not.toBeNull();
      expect(usage?.requestTokens).toBe(
        (usage?.inputTokens ?? 0) + (usage?.cacheReadTokens ?? 0) + (usage?.cacheWriteTokens ?? 0),
      );
    } finally {
      await context.fixture.cleanup();
    }
  });
});
