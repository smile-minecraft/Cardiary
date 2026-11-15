/**
 * 從引擎的助理訊息讀出這一輪的用量。
 *
 * 引擎沒有「目前上下文佔用」的欄位；`pi.live` 在一般回合是空物件。
 * 每輪助理訊息有 `input`、`output`、`cacheRead`、`cacheWrite`，
 * `request_tokens` 是前三者的加總，代表這一輪送出的前綴大小。
 */

import type { EntryRecord } from "@earendil-works/pi-durable";

/** 一輪回報的用量。 */
export interface ConversationUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** `input + cacheRead + cacheWrite`。 */
  readonly requestTokens: number;
}

/** 助理訊息的用量；不是助理訊息或沒有用量時回 `null`。 */
export function usageOfAssistantEntry(entry: EntryRecord): ConversationUsage | null {
  if (entry.kind !== "pi.assistant") return null;
  const message = entry.model?.[0] as { usage?: Record<string, unknown> } | undefined;
  const usage = message?.usage;
  if (usage === undefined || usage === null) return null;
  const inputTokens = nonNegative(usage["input"]);
  const outputTokens = nonNegative(usage["output"]);
  const cacheReadTokens = nonNegative(usage["cacheRead"]);
  const cacheWriteTokens = nonNegative(usage["cacheWrite"]);
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    requestTokens: inputTokens + cacheReadTokens + cacheWriteTokens,
  };
}

function nonNegative(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.round(value);
}
