/**
 * 假引擎看到的「一次模型請求」。
 *
 * 真正的引擎由轉接層的 `beforeRequest` 掛鉤追加第 8 層；假引擎用同樣的
 * 形狀留下每次請求的快照，讓測試能驗八層順序、前綴與尾端訊息。
 */

/** 請求中的一則逐字稿訊息。 */
export interface FakePromptMessage {
  readonly cursor: string;
  readonly role: "user" | "assistant" | "tool";
  readonly text: string;
}

/**
 * 一次模型請求的快照。
 *
 * `systemContext` 是第 1 到 6 層的固定前綴，`messages` 是第 7 層（壓縮後
 * 從 `contextStart` 開始），`volatileTail` 是第 8 層的尾端訊息；尾端不寫進
 * 逐字稿，所以不在 `messages` 裡。
 */
export interface FakePromptSnapshot {
  readonly at: string;
  readonly turnId: string;
  readonly systemContext: string;
  readonly messages: readonly FakePromptMessage[];
  readonly volatileTail: string | null;
}

/** 一輪回報的用量；形狀對齊助理訊息的 `usage`。 */
export interface FakeConversationUsage {
  readonly turnId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** `input + cacheRead + cacheWrite`。 */
  readonly requestTokens: number;
}

/** 與領域層相同的粗略換算；假引擎用它產生可重現的用量。 */
export function estimatePromptTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / 2.5);
}

/**
 * 請求的位元組內容（不含第 8 層）。
 *
 * 連續多輪之間，前一輪的結果必須是下一輪的前綴；測試直接比這個字串。
 */
export function promptTextWithoutTail(snapshot: FakePromptSnapshot): string {
  const parts = [snapshot.systemContext];
  for (const message of snapshot.messages) {
    parts.push(`${message.role}:${message.text}`);
  }
  return parts.join("\n");
}

/** 主機要求假引擎套用的壓縮。 */
export interface FakeCompactionRequest {
  /** 摘要卡的內文；這是模型看得見的摘要。 */
  readonly summary: string;
  /** 第一則保留的訊息游標；它前面的訊息不再進模型請求。 */
  readonly keepFromCursor: string;
  readonly beforeTokens: number;
  readonly afterTokens: number;
}
