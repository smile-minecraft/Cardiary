/**
 * 第 8 層：每次模型請求尾端追加的 `user` 訊息。
 *
 * 固定前綴（第 1 到 6 層）與逐字稿（第 7 層）都不動；尾端訊息只用在
 * 這一次請求，不寫進逐字稿。不能用 `system` 角色：尾端的 system 訊息
 * 會被折回最前面的 system 內容，整段前綴失效（`docs/spikes/model-access.md`
 * 第 3 項）。格式由規格書第 9 章固定，與領域層的 `volatileStateText` 相同。
 */

import { GenerationTask, defineExtension, hook } from "@earendil-works/pi-durable";

import type { Clock } from "../../runtime.js";

/** 上下文擴充在引擎註冊表裡的名字。 */
export const CONTEXT_EXTENSION_NAME = "cardiary.context";

/** 尾端訊息的內容；同一時刻一定得到同一段位元組。 */
export function volatileStateText(now: Date, timeZone: string): string {
  return `目前時間：${now.toISOString()}（${timeZone}）`;
}

export interface ContextExtensionOptions {
  readonly clock: Clock;
  /** IANA 時區名稱；預設用系統時區。 */
  readonly timeZone?: string;
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
  return defineExtension({
    name: CONTEXT_EXTENSION_NAME,
    hooks: [
      hook(GenerationTask, {
        beforeRequest: (request) => ({
          messages: [
            ...request.messages,
            {
              role: "user" as const,
              content: [
                { type: "text" as const, text: volatileStateText(options.clock.now(), timeZone) },
              ],
              timestamp: options.clock.now().getTime(),
            },
          ],
        }),
      }),
    ],
  });
}
