import type {
  ApprovalDecision,
  ApprovalListFilter,
  ApprovalLedger,
  ApprovalRequest,
} from "@cardiary/engine-adapter";
import type { JSONValue } from "@cardiary/protocol";

import { ulid } from "../ids.js";
import type {
  ClaimResult,
  DedupeKind,
  DedupeRecord,
  DeletionIntentStore,
  EventLogEntry,
  EventLogStore,
  RequestDedupeStore,
  RuntimeStateSnapshot,
  RuntimeStateStore,
  StoredEvent,
  TurnIndexStore,
} from "./interfaces.js";

/** 儲存已停止寫入或關閉。 */
export class StorageFailure extends Error {
  readonly code = "storage-unavailable";

  constructor(message: string) {
    super(message);
    this.name = "StorageFailure";
  }
}

export interface MemoryStoreOptions {
  readonly now?: () => Date;
  /** 測試用：指定初始 epoch 與上次是否正常關閉。 */
  readonly epoch?: string;
  readonly cleanShutdown?: boolean;
  readonly startedAt?: string;
  readonly deletionIntents?: readonly string[];
  /** 診斷用：把儲存操作記到同一條時間軸，測試可以驗先後順序。 */
  readonly trace?: (entry: string) => void;
}

function nowIso(options: MemoryStoreOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}

/**
 * 記憶體事件日誌。
 *
 * 正式版本是 `state/cardiary.sqlite` 的 `event_log`；這個替身保留相同的介面
 * 與「同一交易寫入事件與狀態投影」的順序，讓閘道與測試不必先等儲存套件。
 */
export class MemoryEventLog implements EventLogStore {
  readonly calls: string[] = [];
  readonly #events: StoredEvent[] = [];
  readonly #options: MemoryStoreOptions;
  #closed = false;

  constructor(options: MemoryStoreOptions = {}) {
    this.#options = options;
  }

  #assertOpen(): void {
    if (this.#closed) throw new StorageFailure("事件日誌已關閉");
  }

  async append(
    entry: EventLogEntry,
    projection?: () => void | Promise<void>,
  ): Promise<StoredEvent> {
    this.#assertOpen();
    this.calls.push(`events.append:${entry.stream}:${entry.kind}`);
    this.#options.trace?.(`events.append:${entry.stream}:${entry.kind}`);
    if (projection) await projection();
    const seq = await this.lastSeq(entry.stream, entry.epoch);
    const stored: StoredEvent = { ...entry, seq: seq + 1 };
    this.#events.push(stored);
    this.calls.push(`events.committed:${entry.stream}:${stored.seq}`);
    this.#options.trace?.(`events.committed:${entry.stream}:${stored.seq}`);
    return stored;
  }

  async lastSeq(stream: string, epoch: string): Promise<number> {
    let last = 0;
    for (const event of this.#events) {
      if (event.stream === stream && event.epoch === epoch && event.seq > last) {
        last = event.seq;
      }
    }
    return last;
  }

  async oldestSeq(stream: string, epoch: string): Promise<number | null> {
    let oldest: number | null = null;
    for (const event of this.#events) {
      if (event.stream === stream && event.epoch === epoch) {
        if (oldest === null || event.seq < oldest) oldest = event.seq;
      }
    }
    return oldest;
  }

  async readRange(stream: string, epoch: string, from: number, to: number): Promise<StoredEvent[]> {
    return this.#events
      .filter(
        (event) =>
          event.stream === stream && event.epoch === epoch && event.seq >= from && event.seq <= to,
      )
      .sort((left, right) => left.seq - right.seq);
  }

  async reopen(): Promise<void> {
    this.calls.push("events.reopen");
    this.#closed = false;
  }

  async deleteStream(stream: string): Promise<void> {
    this.#assertOpen();
    this.calls.push(`events.deleteStream:${stream}`);
    for (let index = this.#events.length - 1; index >= 0; index -= 1) {
      if (this.#events[index]?.stream === stream) this.#events.splice(index, 1);
    }
  }

  async pruneOtherEpochs(epoch: string): Promise<void> {
    this.#assertOpen();
    this.calls.push(`events.pruneOtherEpochs:${epoch}`);
    for (let index = this.#events.length - 1; index >= 0; index -= 1) {
      const event = this.#events[index];
      if (event && event.epoch !== epoch) this.#events.splice(index, 1);
    }
  }

  async flush(): Promise<void> {
    this.calls.push("events.flush");
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.calls.push("events.close");
    this.#options.trace?.("events.close");
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** 測試用：目前所有事件的快照。 */
  snapshot(): readonly StoredEvent[] {
    return [...this.#events];
  }

  /** 測試用：模擬重啟後事件日誌仍在（同一個 epoch）。 */
  static restore(events: readonly StoredEvent[], options: MemoryStoreOptions = {}): MemoryEventLog {
    const log = new MemoryEventLog(options);
    log.#events.push(...events);
    return log;
  }
}

/** 記憶體執行期狀態；`open()` 依 clean_shutdown 決定是否換 epoch。 */
export class MemoryRuntimeState implements RuntimeStateStore {
  readonly calls: string[] = [];
  readonly #options: MemoryStoreOptions;
  #snapshot: RuntimeStateSnapshot | null = null;
  #opened = false;

  constructor(options: MemoryStoreOptions = {}) {
    this.#options = options;
  }

  get opened(): boolean {
    return this.#opened;
  }

  current(): RuntimeStateSnapshot | null {
    return this.#snapshot;
  }

  async open(): Promise<RuntimeStateSnapshot> {
    this.calls.push("runtime.open");
    this.#options.trace?.("runtime.open");
    const now = nowIso(this.#options);
    if (this.#snapshot === null) {
      this.#snapshot = {
        epoch: this.#options.epoch ?? ulid(),
        cleanShutdown: this.#options.cleanShutdown ?? false,
        startedAt: this.#options.startedAt ?? now,
      };
    } else if (this.#snapshot.cleanShutdown) {
      this.#snapshot = { epoch: this.#snapshot.epoch, cleanShutdown: false, startedAt: now };
    } else {
      this.#snapshot = { epoch: ulid(), cleanShutdown: false, startedAt: now };
    }
    this.#opened = true;
    return this.#snapshot;
  }

  async reopen(): Promise<RuntimeStateSnapshot> {
    this.calls.push("runtime.reopen");
    this.#options.trace?.("runtime.reopen");
    if (!this.#snapshot) throw new StorageFailure("狀態庫沒有可重開的資料");
    this.#opened = true;
    return this.#snapshot;
  }

  async markCleanShutdown(reason: string): Promise<void> {
    this.calls.push(`runtime.markCleanShutdown:${reason}`);
    this.#options.trace?.(`runtime.markCleanShutdown:${reason}`);
    if (!this.#opened || !this.#snapshot) throw new StorageFailure("狀態庫未開啟");
    this.#snapshot = { ...this.#snapshot, cleanShutdown: true };
  }

  async checkpointAndClose(): Promise<void> {
    this.calls.push("runtime.checkpointAndClose");
    this.#options.trace?.("runtime.checkpointAndClose");
    this.#opened = false;
  }

  async close(): Promise<void> {
    this.calls.push("runtime.close");
    this.#options.trace?.("runtime.close");
    this.#opened = false;
  }

  /** 測試用：重啟後的新行程看到的狀態。 */
  static restored(
    snapshot: RuntimeStateSnapshot,
    options: MemoryStoreOptions = {},
  ): MemoryRuntimeState {
    const store = new MemoryRuntimeState(options);
    (store.#snapshot as RuntimeStateSnapshot | null) = snapshot;
    return store;
  }
}

/** 記憶體請求去重。 */
export class MemoryRequestDedupe implements RequestDedupeStore {
  readonly #records = new Map<string, DedupeRecord>();
  readonly #options: MemoryStoreOptions;

  constructor(options: MemoryStoreOptions = {}) {
    this.#options = options;
  }

  seed(record: DedupeRecord): void {
    this.#records.set(record.key, record);
  }

  async claim(key: string, kind: DedupeKind): Promise<ClaimResult> {
    const existing = this.#records.get(key);
    if (existing) return { outcome: "existing", record: existing };
    this.#records.set(key, {
      key,
      kind,
      state: "pending",
      resourceId: null,
      response: null,
      claimedAt: nowIso(this.#options),
      completedAt: null,
    });
    return { outcome: "claimed" };
  }

  async setResource(key: string, resourceId: string): Promise<void> {
    const record = this.#records.get(key);
    if (!record) throw new StorageFailure(`去重列不存在：${key}`);
    this.#records.set(key, { ...record, resourceId });
  }

  async complete(key: string, response: JSONValue): Promise<void> {
    const record = this.#records.get(key);
    if (!record) throw new StorageFailure(`去重列不存在：${key}`);
    if (record.state !== "pending") return;
    this.#records.set(key, {
      ...record,
      state: "completed",
      response,
      completedAt: nowIso(this.#options),
    });
  }

  async lookup(key: string): Promise<DedupeRecord | null> {
    return this.#records.get(key) ?? null;
  }

  async deleteByKey(key: string): Promise<void> {
    this.#records.delete(key);
  }

  snapshot(): readonly DedupeRecord[] {
    return [...this.#records.values()];
  }
}

/** 記憶體回合對照表。 */
export class MemoryTurnIndex implements TurnIndexStore {
  readonly #entries = new Map<string, string>();

  async record(conversationId: string, userMessageId: string, turnId: string): Promise<void> {
    this.#entries.set(`${conversationId}:${userMessageId}`, turnId);
  }

  async get(conversationId: string, userMessageId: string): Promise<string | null> {
    return this.#entries.get(`${conversationId}:${userMessageId}`) ?? null;
  }
}

/** 記憶體刪除意圖。 */
export class MemoryDeletionIntents implements DeletionIntentStore {
  readonly #pending: Set<string>;

  constructor(intents: readonly string[] = []) {
    this.#pending = new Set(intents);
  }

  async pending(): Promise<readonly string[]> {
    return [...this.#pending];
  }

  async remove(conversationId: string): Promise<void> {
    this.#pending.delete(conversationId);
  }

  add(conversationId: string): void {
    this.#pending.add(conversationId);
  }
}

/** 記憶體審批 ledger；記錄每一次寫入，測試可以驗順序。 */
export class MemoryApprovalLedger implements ApprovalLedger {
  readonly calls: string[] = [];
  readonly #records = new Map<string, ApprovalRequest>();
  readonly #decisions = new Map<string, ApprovalDecision>();

  async record(request: ApprovalRequest): Promise<void> {
    this.calls.push(`approval.record:${request.id}`);
    this.#records.set(request.id, request);
  }

  async update(request: ApprovalRequest): Promise<void> {
    this.calls.push(`approval.update:${request.id}:${request.status}`);
    this.#records.set(request.id, request);
  }

  async get(requestId: string): Promise<ApprovalRequest | null> {
    return this.#records.get(requestId) ?? null;
  }

  async listPending(filter?: ApprovalListFilter): Promise<readonly ApprovalRequest[]> {
    const pending = [...this.#records.values()].filter((request) => request.status === "pending");
    return pending.filter((request) => {
      if (!filter) return true;
      if (filter.conversationId !== undefined) {
        return request.draft.conversationId === filter.conversationId;
      }
      if (filter.rootConversationId !== undefined) {
        return request.draft.conversationId === filter.rootConversationId;
      }
      return true;
    });
  }

  async commitDecision(decision: ApprovalDecision): Promise<"committed" | "already-decided"> {
    this.calls.push(`approval.commitDecision:${decision.requestId}:${decision.verdict}`);
    const request = this.#records.get(decision.requestId);
    if (!request) return "already-decided";
    if (request.status === "approved" || request.status === "denied") {
      return "already-decided";
    }
    this.#decisions.set(decision.requestId, decision);
    this.#records.set(request.id, {
      ...request,
      status: decision.verdict === "approve" ? "approved" : "denied",
    });
    return "committed";
  }

  /** 測試用：預置一筆已決定的審批。 */
  seedDecision(request: ApprovalRequest, decision: ApprovalDecision): void {
    this.#records.set(request.id, {
      ...request,
      status: decision.verdict === "approve" ? "approved" : "denied",
    });
    this.#decisions.set(request.id, decision);
  }

  /** 測試用：直接讀取一筆。 */
  peek(requestId: string): ApprovalRequest | null {
    return this.#records.get(requestId) ?? null;
  }
}
