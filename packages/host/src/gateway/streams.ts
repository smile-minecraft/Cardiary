import type { JSONObject } from "@cardiary/protocol";

import type { EventLogStore, StoredEvent } from "../storage/interfaces.js";

export type StreamEventListener = (event: StoredEvent) => void;

/**
 * 串流序號的唯一簽發者。
 *
 * 所有寫入與訂閱都經過同一個佇列：事件先寫進事件日誌（含狀態投影），提交
 * 成功後才廣播；訂閱在同一個佇列裡取邊界、產生快照、補送並登記即時事件，
 * 所以 `seq` 與快照一定是同一個邊界，快照與 delta 也走同一個順序。
 */
export class StreamLog {
  readonly #store: EventLogStore;
  readonly #epoch: string;
  readonly #lastSeq = new Map<string, number>();
  readonly #loaded = new Set<string>();
  readonly #listeners = new Set<StreamEventListener>();
  #tail: Promise<void> = Promise.resolve();

  constructor(store: EventLogStore, epoch: string) {
    this.#store = store;
    this.#epoch = epoch;
  }

  get epoch(): string {
    return this.#epoch;
  }

  /** 在單一寫入佇列裡執行；任何會改動序號或讀邊界的工作都要經過這裡。 */
  runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(work, work);
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #ensure(stream: string): Promise<number> {
    if (this.#loaded.has(stream)) return this.#lastSeq.get(stream) ?? 0;
    const last = await this.#store.lastSeq(stream, this.#epoch);
    this.#lastSeq.set(stream, last);
    this.#loaded.add(stream);
    return last;
  }

  /** 目前已提交的耐久邊界；非耐久事件（文字增量）用它填 `seq`。 */
  boundary(stream: string): number {
    return this.#lastSeq.get(stream) ?? 0;
  }

  /** 只可在 `runExclusive` 內呼叫；直接讀取目前邊界。 */
  boundaryAsync(stream: string): Promise<number> {
    return this.#ensure(stream);
  }

  async append(
    entry: {
      readonly stream: string;
      readonly kind: string;
      readonly payload: JSONObject;
      readonly at: string;
    },
    projection?: () => void | Promise<void>,
  ): Promise<StoredEvent> {
    return this.runExclusive(async () => {
      const current = await this.#ensure(entry.stream);
      const stored = await this.#store.append({ ...entry, epoch: this.#epoch }, projection);
      // 事件日誌可能由別的行程寫入；以實際簽發的序號為準。
      this.#lastSeq.set(entry.stream, Math.max(current, stored.seq));
      this.#loaded.add(entry.stream);
      for (const listener of this.#listeners) listener(stored);
      return stored;
    });
  }

  /**
   * 讀取補送範圍；超出保留範圍時回 `null`，呼叫端改送快照。
   *
   * 只可在 `runExclusive` 內呼叫，確保邊界與補送出自同一個佇列位置。
   */
  async readReplay(stream: string, fromSeq: number, toSeq: number): Promise<StoredEvent[] | null> {
    const boundary = await this.#ensure(stream);
    if (toSeq > boundary) return null;
    if (fromSeq > toSeq) return [];
    const oldest = await this.#store.oldestSeq(stream, this.#epoch);
    if (oldest !== null && fromSeq < oldest) return null;
    return this.#store.readRange(stream, this.#epoch, fromSeq, toSeq);
  }

  subscribe(listener: StreamEventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** 刪除一場會話的所有事件；刪除對話時使用。 */
  async deleteStream(stream: string): Promise<void> {
    await this.runExclusive(async () => {
      await this.#store.deleteStream(stream);
      this.#lastSeq.set(stream, 0);
      this.#loaded.add(stream);
    });
  }

  async pruneOtherEpochs(): Promise<void> {
    await this.runExclusive(async () => {
      await this.#store.pruneOtherEpochs(this.#epoch);
    });
  }
}

export type { StoredEvent };
