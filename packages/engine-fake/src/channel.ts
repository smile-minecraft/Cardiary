import type { EngineEvent, EngineSubscription, SubscriptionReplay } from "@cardiary/engine-adapter";

interface Waiter {
  resolve: (result: IteratorResult<EngineEvent>) => void;
}

class EventStream implements AsyncIterableIterator<EngineEvent> {
  readonly #queue: EngineEvent[] = [];
  readonly #waiters: Waiter[] = [];
  #closed = false;

  push(event: EngineEvent): void {
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter.resolve({ value: event, done: false });
      return;
    }
    this.#queue.push(event);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter.resolve({ value: undefined, done: true });
    }
  }

  next(): Promise<IteratorResult<EngineEvent>> {
    const event = this.#queue.shift();
    if (event) return Promise.resolve({ value: event, done: false });
    if (this.#closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise<IteratorResult<EngineEvent>>((resolve) => {
      this.#waiters.push({ resolve });
    });
  }

  return(): Promise<IteratorResult<EngineEvent>> {
    this.close();
    return Promise.resolve({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<EngineEvent> {
    return this;
  }
}

/**
 * 一場對話的事件通道：簽發內部序號、保留補送緩衝、支援多訂閱者。
 *
 * 這個序號只是主機內部的對話內排序，不落地、不進協定；協定的串流序號由
 * 閘道另外簽發。
 */
export class EventChannel {
  readonly #bufferSize: number;
  readonly #buffer: EngineEvent[] = [];
  readonly #streams = new Set<EventStream>();
  #seq = 0;
  #closed = false;

  constructor(bufferSize: number) {
    this.#bufferSize = Math.max(1, bufferSize);
  }

  get lastSeq(): number {
    return this.#seq;
  }

  publish(make: (seq: number) => EngineEvent): EngineEvent {
    if (this.#closed) {
      // 對話已刪除或引擎已關閉：事件直接丟棄，不再改動序號。
      return make(this.#seq);
    }
    this.#seq += 1;
    const event = make(this.#seq);
    this.#buffer.push(event);
    if (this.#buffer.length > this.#bufferSize) {
      this.#buffer.shift();
    }
    for (const stream of this.#streams) {
      stream.push(event);
    }
    return event;
  }

  /** 模擬行程重啟後序號重來；事件歷史不再保留。 */
  reset(): void {
    this.#seq = 0;
    this.#buffer.length = 0;
  }

  close(): void {
    this.#closed = true;
    for (const stream of this.#streams) {
      stream.close();
    }
    this.#streams.clear();
  }

  subscribe(afterSeq?: number): EngineSubscription {
    const firstSeq = this.#buffer[0]?.seq ?? null;
    const requestedAfter = afterSeq ?? null;
    let gap = false;
    if (requestedAfter !== null) {
      if (firstSeq === null) {
        gap = requestedAfter < this.#seq;
      } else {
        gap = requestedAfter < firstSeq - 1;
      }
    }
    const replay: SubscriptionReplay = { requestedAfter, firstSeq, gap };
    const stream = new EventStream();
    if (!gap && requestedAfter !== null) {
      for (const event of this.#buffer) {
        if (event.seq > requestedAfter) stream.push(event);
      }
    }
    this.#streams.add(stream);
    return {
      conversationId: "",
      replay,
      events: stream,
      close: () => {
        stream.close();
        this.#streams.delete(stream);
      },
    } as EngineSubscription;
  }
}
