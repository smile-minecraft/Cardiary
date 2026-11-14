import type { StreamingMessage } from "@cardiary/protocol";

interface Entry {
  readonly sessionId: string;
  readonly messageId: string;
  readonly turnId: string;
  readonly startedAt: string;
  text: string;
  bytes: number;
  truncated: boolean;
}

/**
 * 進行中文字的有界緩衝（每則訊息 256 KiB）。
 *
 * 只存在記憶體，不落地、不佔序號；重啟後消失，恢復以引擎的最終訊息為準。
 */
export class StreamingBuffer {
  readonly #limitBytes: number;
  readonly #entries = new Map<string, Entry>();
  readonly #order = new Map<string, string[]>();

  constructor(limitBytes: number) {
    this.#limitBytes = limitBytes;
  }

  append(input: {
    readonly sessionId: string;
    readonly messageId: string;
    readonly turnId: string;
    readonly startedAt: string;
    readonly delta: string;
  }): void {
    let entry = this.#entries.get(input.messageId);
    if (!entry) {
      entry = {
        sessionId: input.sessionId,
        messageId: input.messageId,
        turnId: input.turnId,
        startedAt: input.startedAt,
        text: "",
        bytes: 0,
        truncated: false,
      };
      this.#entries.set(input.messageId, entry);
      const order = this.#order.get(input.sessionId) ?? [];
      order.push(input.messageId);
      this.#order.set(input.sessionId, order);
    }
    if (entry.truncated) return;
    const deltaBytes = Buffer.byteLength(input.delta, "utf8");
    if (entry.bytes + deltaBytes > this.#limitBytes) {
      entry.truncated = true;
      return;
    }
    entry.text += input.delta;
    entry.bytes += deltaBytes;
  }

  /** 目前的進行中訊息；沒有就回 `null`。 */
  current(sessionId: string): StreamingMessage | null {
    const order = this.#order.get(sessionId);
    if (!order || order.length === 0) return null;
    const messageId = order[order.length - 1];
    if (!messageId) return null;
    const entry = this.#entries.get(messageId);
    if (!entry) return null;
    return {
      messageId: entry.messageId,
      turnId: entry.turnId,
      text: entry.text,
      startedAt: entry.startedAt,
      ...(entry.truncated ? { truncated: true } : {}),
    };
  }

  clear(sessionId: string): void {
    for (const messageId of this.#order.get(sessionId) ?? []) {
      this.#entries.delete(messageId);
    }
    this.#order.delete(sessionId);
  }

  clearMessage(messageId: string): void {
    const entry = this.#entries.get(messageId);
    if (!entry) return;
    this.#entries.delete(messageId);
    const order = this.#order.get(entry.sessionId);
    if (order) {
      const index = order.indexOf(messageId);
      if (index >= 0) order.splice(index, 1);
    }
  }
}
