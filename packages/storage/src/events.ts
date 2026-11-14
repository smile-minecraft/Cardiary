import type { Database, Queryable } from "./db.js";
import { StorageError } from "./errors.js";
import type { JsonValue } from "./json.js";
import { nowIso, retrySync } from "./util.js";
import { isBusyError } from "./errors.js";

/** 事件串流：`system` 或 `session:<conversationId>`。 */
export type EventStream = "system" | `session:${string}`;

/** `event_log` 的一列；`id` 不對外，客戶端只看 `streamSeq`。 */
export interface EventRecord {
  readonly stream: EventStream;
  readonly epoch: string;
  readonly streamSeq: number;
  readonly kind: string;
  readonly payload: JsonValue;
  readonly createdAt: string;
}

export interface AppendEventInput {
  readonly stream: EventStream;
  readonly kind: string;
  readonly payload: JsonValue;
  /** 省略時讀 `runtime_state` 目前的 epoch。 */
  readonly epoch?: string;
  readonly createdAt?: string;
}

interface EventRow {
  readonly stream: string;
  readonly epoch: string;
  readonly stream_seq: number;
  readonly kind: string;
  readonly payload: string;
  readonly created_at: string;
}

export interface EventLogOptions {
  readonly now?: () => Date;
}

/** 非耐久事件；不落地、不佔序號、不算保留額度。 */
export const NON_DURABLE_EVENT_KINDS: readonly string[] = ["stream.text_delta"];

/** 由協定閘道寫入的事件日誌；寫入與狀態變更可以在同一個交易。 */
export class EventLog {
  readonly #db: Database;
  readonly #now: () => Date;

  constructor(db: Database, options: EventLogOptions = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
  }

  /** 目前事件 epoch；`runtime_state` 還沒 open() 時丟錯。 */
  currentEpoch(): string {
    const row = this.#db.get<{ epoch: string }>("SELECT epoch FROM runtime_state WHERE id = 1");
    if (row === undefined) {
      throw new StorageError("runtime-state-missing", "事件日誌需要先呼叫 runtime.open()");
    }
    return row.epoch;
  }

  /** 附加一則耐久事件；序號由這裡簽發。 */
  append(input: AppendEventInput): EventRecord {
    return this.appendWithState(input, () => {
      // 沒有額外狀態變更。
    });
  }

  /**
   * 在同一個交易裡寫事件與狀態變更。
   *
   * `applyState` 丟錯時事件一起回滾，客戶端不會看到不存在的狀態。
   */
  appendWithState(input: AppendEventInput, applyState: (tx: Queryable) => void): EventRecord {
    this.assertDurable(input);
    const createdAt = input.createdAt ?? nowIso(this.#now);
    return retrySync(
      () =>
        this.#db.transaction((tx) => {
          const epoch = input.epoch ?? this.readEpoch(tx);
          const streamSeq = this.maxSeqIn(input.stream, epoch, tx) + 1;
          tx.run(
            "INSERT INTO event_log (stream, epoch, stream_seq, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            input.stream,
            epoch,
            streamSeq,
            input.kind,
            JSON.stringify(input.payload),
            createdAt,
          );
          applyState(tx);
          return {
            stream: input.stream,
            epoch,
            streamSeq,
            kind: input.kind,
            payload: input.payload,
            createdAt,
          } satisfies EventRecord;
        }),
      isBusyError,
    );
  }

  /** 目前 epoch 中某個串流的最大序號；沒有資料時回 0。 */
  maxSeq(stream: EventStream, epoch = this.currentEpoch()): number {
    return this.maxSeqIn(stream, epoch, this.#db);
  }

  /** 依序讀取 `afterSeq` 之後的耐久事件。 */
  read(stream: EventStream, epoch: string, afterSeq: number, limit = 1000): EventRecord[] {
    const rows = this.#db.all<EventRow>(
      `SELECT stream, epoch, stream_seq, kind, payload, created_at
       FROM event_log
       WHERE stream = ? AND epoch = ? AND stream_seq > ?
       ORDER BY stream_seq ASC
       LIMIT ?`,
      stream,
      epoch,
      afterSeq,
      limit,
    );
    return rows.map((row) => this.rowToRecord(row));
  }

  /** 讀取整個串流（所有 epoch），供診斷與測試使用。 */
  readAll(stream: EventStream): EventRecord[] {
    return this.#db
      .all<EventRow>(
        "SELECT stream, epoch, stream_seq, kind, payload, created_at FROM event_log WHERE stream = ? ORDER BY id",
        stream,
      )
      .map((row) => this.rowToRecord(row));
  }

  /** 刪除整個串流的所有 epoch；刪除對話時使用。 */
  deleteStream(stream: EventStream, tx?: Queryable): number {
    return this.runDelete("DELETE FROM event_log WHERE stream = ?", [stream], tx);
  }

  /** 一次刪除多個串流。 */
  deleteStreams(streams: readonly EventStream[], tx?: Queryable): number {
    let deleted = 0;
    for (const stream of streams) {
      deleted += this.deleteStream(stream, tx);
    }
    return deleted;
  }

  /** 換 epoch 後可以整批刪除舊 epoch 的資料列。 */
  deleteEpoch(epoch: string, tx?: Queryable): number {
    return this.runDelete("DELETE FROM event_log WHERE epoch = ?", [epoch], tx);
  }

  /**
   * 套用保留策略：30 天或每個串流 100,000 筆耐久事件，先到者為準。
   *
   * 只處理耐久事件；`stream.text_delta` 從未進表。
   */
  prune(
    options: {
      readonly now?: Date;
      readonly retainDays?: number;
      readonly perStreamLimit?: number;
    } = {},
  ): number {
    const now = options.now ?? this.#now();
    const retainDays = options.retainDays ?? 30;
    const perStreamLimit = options.perStreamLimit ?? 100_000;
    const cutoff = new Date(now.getTime() - retainDays * 24 * 60 * 60 * 1000).toISOString();
    return this.#db.transaction((tx) => {
      const expired = tx.run("DELETE FROM event_log WHERE created_at < ?", cutoff).changes;
      const excess = tx.run(
        `DELETE FROM event_log WHERE id IN (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (
               PARTITION BY stream, epoch ORDER BY stream_seq DESC
             ) AS row_number
             FROM event_log
           ) WHERE row_number > ?
         )`,
        perStreamLimit,
      ).changes;
      return expired + excess;
    });
  }

  /** 某個串流的耐久事件數；測試與保留策略使用。 */
  count(stream?: EventStream): number {
    const row =
      stream === undefined
        ? this.#db.get<{ n: number }>("SELECT COUNT(*) AS n FROM event_log")
        : this.#db.get<{ n: number }>(
            "SELECT COUNT(*) AS n FROM event_log WHERE stream = ?",
            stream,
          );
    return Number(row?.n ?? 0);
  }

  private readEpoch(tx: Queryable): string {
    const row = tx.get<{ epoch: string }>("SELECT epoch FROM runtime_state WHERE id = 1");
    if (row === undefined) {
      throw new StorageError("runtime-state-missing", "事件日誌需要先呼叫 runtime.open()");
    }
    return row.epoch;
  }

  private maxSeqIn(stream: string, epoch: string, tx: Queryable): number {
    const row = tx.get<{ max_seq: number | null }>(
      "SELECT MAX(stream_seq) AS max_seq FROM event_log WHERE stream = ? AND epoch = ?",
      stream,
      epoch,
    );
    return Number(row?.max_seq ?? 0);
  }

  private assertDurable(input: AppendEventInput): void {
    if (NON_DURABLE_EVENT_KINDS.includes(input.kind)) {
      throw new StorageError("invalid-event-kind", "非耐久事件不能寫入 event_log", {
        kind: input.kind,
      });
    }
    if (input.stream !== "system" && !input.stream.startsWith("session:")) {
      throw new StorageError("invalid-event-kind", "未知的事件串流", { stream: input.stream });
    }
    if (input.stream === "session:") {
      throw new StorageError("invalid-event-kind", "session 串流需要會話識別碼");
    }
  }

  private runDelete(sql: string, params: readonly unknown[], tx?: Queryable): number {
    return (tx ?? this.#db).run(sql, ...params).changes;
  }

  private rowToRecord(row: EventRow): EventRecord {
    return {
      stream: row.stream as EventStream,
      epoch: row.epoch,
      streamSeq: Number(row.stream_seq),
      kind: row.kind,
      payload: JSON.parse(row.payload) as JsonValue,
      createdAt: row.created_at,
    };
  }
}
