/**
 * 第 8 層：每次模型請求尾端追加的 `user` 訊息。
 *
 * 固定前綴（第 1 到 6 層）與逐字稿（第 7 層）都不動；尾端訊息只用在
 * 這一次請求，不寫進逐字稿。不能用 `system` 角色：尾端的 system 訊息
 * 會被折回最前面的 system 內容，整段前綴失效（`docs/spikes/model-access.md`
 * 第 3 項）。格式由規格書第 9 章固定，與領域層的 `volatileStateText` 相同。
 *
 * 訊息可以帶著一段只屬於它自己的尾端上下文（例如情緒狀態快照）：送出
 * 訊息的一方把它掛在訊息自己的 entry 上，這裡在請求建立的當下把對應的
 * 那一行接在時間之後。排隊的訊息各自帶著自己的快照，不會被後面送出的
 * 訊息覆寫。
 */

import { GenerationTask, defineExtension, hook } from "@earendil-works/pi-durable";
import type { EntryRecord } from "@earendil-works/pi-durable";
import type { Message } from "@earendil-works/pi-ai";

import type { Clock } from "../../runtime.js";

/** 上下文擴充在引擎註冊表裡的名字。 */
export const CONTEXT_EXTENSION_NAME = "cardiary.context";

/** 帶著尾端上下文的訊息 entry 種類。 */
export const MESSAGE_TRAILING_CONTEXT_ENTRY_KIND = "cardiary.userMessage";

/** 尾端訊息的內容；同一時刻一定得到同一段位元組。 */
export function volatileStateText(now: Date, timeZone: string, trailingContext?: string): string {
  const time = `目前時間：${now.toISOString()}（${timeZone}）`;
  const trailing = trailingContext?.trim();
  return trailing === undefined || trailing.length === 0 ? time : `${time}\n${trailing}`;
}

/**
 * 找出與模型請求最後一則使用者訊息同一則的快照。
 *
 * 快照只掛在訊息自己的 entry 上，因此排隊的訊息、同一回合的工具回合、
 * 以及改為插隊（steer）的訊息，各自帶著自己的內容；找不到就不注入。
 */
export function trailingContextOf(
  entries: readonly EntryRecord[],
  messages: readonly Message[],
): string | undefined {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const timestamp = lastUser?.timestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return undefined;
  }
  for (const entry of entries) {
    if (entry.kind !== MESSAGE_TRAILING_CONTEXT_ENTRY_KIND) continue;
    if (entry.model?.[0]?.timestamp !== timestamp) continue;
    const data = entry.data;
    if (data === null || typeof data !== "object" || Array.isArray(data)) return undefined;
    const trailing = (data as { readonly trailingContext?: unknown }).trailingContext;
    return typeof trailing === "string" && trailing.trim().length > 0 ? trailing : undefined;
  }
  return undefined;
}

export interface ContextExtensionOptions {
  readonly clock: Clock;
  /** IANA 時區名稱；預設用系統時區。 */
  readonly timeZone?: string;
  /** 讀取最近已提交 entry 的上限；預設 200。 */
  readonly historyLimit?: number;
}

/**
 * 建立上下文擴充。
 *
 * 這個擴充只有一個 `beforeRequest` 掛鉤：每次請求都把目前的時間接在
 * 訊息尾端。其他層由呼叫端組好後交給引擎，轉接層不拆解內容。
 */
export function createContextExtension(
  options: ContextExtensionOptions,
): ReturnType<typeof defineExtension> {
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const historyLimit = options.historyLimit ?? 200;
  return defineExtension({
    name: CONTEXT_EXTENSION_NAME,
    hooks: [
      hook(GenerationTask, {
        beforeRequest: async (request, api, context) => {
          const page = await api.entries({ order: "descending" }, historyLimit, undefined, context);
          const now = options.clock.now();
          return {
            messages: [
              ...request.messages,
              {
                role: "user" as const,
                content: [
                  {
                    type: "text" as const,
                    text: volatileStateText(
                      now,
                      timeZone,
                      trailingContextOf(page.items, request.messages),
                    ),
                  },
                ],
                timestamp: now.getTime(),
              },
            ],
          };
        },
      }),
    ],
  });
}
