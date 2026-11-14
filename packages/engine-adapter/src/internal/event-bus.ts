import type {
  EngineEvent,
  EngineSubscription,
  SubscribeOptions,
  SubscriptionReplay,
} from "../events.js";
import type { ConversationId, EventSeq } from "../ids.js";

/** 事件草稿：和 `EngineEvent` 一樣，但 `seq` 由匯流排簽發。 */
export type EngineEventDraft = EngineEvent extends infer Event
  ? Event extends EngineEvent
    ? Omit<Event, "seq">
    : never
  : never;

interface Subscriber {
  readonly push: (event: EngineEvent) => void;
  readonly close: () => void;
}

/**
 * 對話事件的行程內匯流排。
 *
 * 序號由轉接層簽發，每場對話從 1 開始嚴格遞增；批次提交會展開成逐筆事件。
 * 緩衝只存在記憶體，保留最近 `bufferSize` 筆供斷線補送；要求更舊的序號
 * 時回報 `gap`。這是主機內部的排序，不落地，也不給客戶端。
 */
export class EventBus {
  readonly #bufferSize: number;
  readonly #seq = new Map<ConversationId, EventSeq>();
  readonly #buffers = new Map<ConversationId, EngineEvent[]>();
  readonly #subscribers = new Map<ConversationId, Set<Subscriber>>();

  constructor(options?: { readonly bufferSize?: number }) {
    this.#bufferSize = Math.max(1, options?.bufferSize ?? 256);
  }

  /** 目前簽發到的最新序號；沒有事件時是 0。 */
  latestSeq(conversationId: ConversationId): EventSeq {
    return this.#seq.get(conversationId) ?? 0;
  }

  publish(draft: EngineEventDraft): EngineEvent {
    const conversationId = draft.conversationId;
    const seq = this.latestSeq(conversationId) + 1;
    this.#seq.set(conversationId, seq);
    const event = { ...draft, seq } as EngineEvent;
    const buffer = this.#buffers.get(conversationId) ?? [];
    buffer.push(event);
    if (buffer.length > this.#bufferSize) {
      buffer.splice(0, buffer.length - this.#bufferSize);
    }
    this.#buffers.set(conversationId, buffer);
    for (const subscriber of this.#subscribers.get(conversationId) ?? []) {
      subscriber.push(event);
    }
    return event;
  }

  subscribe(options: SubscribeOptions): EngineSubscription {
    const { conversationId } = options;
    const buffer = this.#buffers.get(conversationId) ?? [];
    const requestedAfter = options.afterSeq ?? null;
    const firstSeq = buffer.length === 0 ? null : (buffer[0]?.seq ?? null);
    const gap = requestedAfter !== null && firstSeq !== null && requestedAfter + 1 < firstSeq;

    const queue: EngineEvent[] = [];
    let closed = false;
    let wake: (() => void) | null = null;
    const flush = (): void => {
      const notify = wake;
      wake = null;
      notify?.();
    };

    if (requestedAfter !== null) {
      for (const event of buffer) {
        if (event.seq > requestedAfter) {
          queue.push(event);
        }
      }
    }

    const subscriber: Subscriber = {
      push: (event) => {
        if (closed) {
          return;
        }
        queue.push(event);
        flush();
      },
      close: () => {
        closed = true;
        flush();
      },
    };
    const subscribers = this.#subscribers.get(conversationId) ?? new Set<Subscriber>();
    subscribers.add(subscriber);
    this.#subscribers.set(conversationId, subscribers);

    const replay: SubscriptionReplay = { requestedAfter, firstSeq, gap };

    async function* iterate(): AsyncIterableIterator<EngineEvent> {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift() as EngineEvent;
          continue;
        }
        if (closed) {
          return;
        }
        await new Promise<void>((resolveNext) => {
          wake = resolveNext;
        });
      }
    }

    return {
      conversationId,
      replay,
      events: iterate(),
      close: () => {
        subscribers.delete(subscriber);
        if (subscribers.size === 0) {
          this.#subscribers.delete(conversationId);
        }
        subscriber.close();
      },
    };
  }
}
