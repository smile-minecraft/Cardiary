import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { Message } from "@earendil-works/pi-ai";

import { createFixture, type Fixture } from "../support.js";

/**
 * 記下每一次送到供應商的訊息。
 *
 * `fauxProvider` 的回應工廠會拿到 `TranscriptContext`，那就是引擎實際
 * 送出的訊息（含第 8 層）；測試不需要另外攔截網路。
 */
export interface RequestRecorder {
  /** 每次請求的訊息，依送出順序。 */
  readonly requests: Message[][];
  /** 排一則文字回應，順便記下這次請求。 */
  answer(text: string): void;
  close(): void;
}

export interface ContextFixture {
  readonly fixture: Fixture;
  readonly recorder: RequestRecorder;
}

/** 建一個會記錄請求的引擎夾具；模型是假的，引擎是真的。 */
export async function createContextFixture(): Promise<ContextFixture> {
  const faux = fauxProvider();
  const requests: Message[][] = [];
  const fixture = await createFixture({ faux });
  return {
    fixture,
    recorder: {
      requests,
      answer(text: string): void {
        faux.appendResponses([
          (context) => {
            requests.push([...context.messages]);
            return fauxAssistantMessage(text);
          },
        ]);
      },
      close(): void {
        // 假供應商沒有需要釋放的資源。
      },
    },
  };
}

/** 把訊息排成可比較的字串；`user` 與 `assistant` 的內容都是文字。 */
export function messageText(message: Message): string {
  const content = message.content;
  if (typeof content === "string") return content;
  return content.map((block) => (block.type === "text" ? block.text : `[${block.type}]`)).join("");
}

/** 去掉尾端的第 8 層訊息；其餘部分才會在連續多輪之間保持前綴關係。 */
export function withoutVolatileTail(messages: readonly Message[]): readonly Message[] {
  const last = messages.at(-1);
  if (last === undefined || last.role !== "user") return messages;
  if (!messageText(last).startsWith("目前時間：")) return messages;
  return messages.slice(0, -1);
}

/** 前一輪（不含尾端）是不是下一輪的前綴。 */
export function isBytePrefix(previous: readonly Message[], next: readonly Message[]): boolean {
  if (previous.length > next.length) return false;
  return previous.every((message, index) => {
    const other = next[index];
    if (other === undefined) return false;
    return message.role === other.role && messageText(message) === messageText(other);
  });
}

/** 等到對話回到 idle；回合結束才讀得到的資料要這樣等。 */
export async function waitUntilIdle(
  fixture: Fixture,
  conversationId: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const conversation = await fixture.adapter.getConversation(conversationId);
    if (conversation?.state === "idle") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("等待對話回到 idle 逾時");
}
