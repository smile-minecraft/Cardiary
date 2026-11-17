import {
  Storage,
  type ApprovalRecord,
  type ConversationDeletionIntent,
  type DeletionPhase,
  type RecordApprovalOutcome,
} from "@cardiary/storage";
import type {
  ApprovalDecision,
  ApprovalLedger,
  ApprovalListFilter,
  ApprovalRecordOutcome,
  ApprovalRequest,
  ConversationDataPurger,
  DeletionIntent as EngineDeletionIntent,
  JsonValue,
} from "@cardiary/engine-adapter";
import type { JSONValue } from "@cardiary/protocol";

import type {
  ClaimResult,
  DedupeKind,
  DedupeRecord,
  DeletionIntentStore,
  EventLogEntry,
  EventLogStore,
  FolderIdentity,
  RequestDedupeStore,
  RuntimeStateSnapshot,
  RuntimeStateStore,
  StorageBundle,
  StoredEvent,
  TurnIndexStore,
} from "./interfaces.js";

/** 儲存層已停止寫入或已關閉。 */
export class PersistentStorageFailure extends Error {
  readonly code = "storage-unavailable";

  constructor(message: string) {
    super(message);
    this.name = "PersistentStorageFailure";
  }
}

export interface PersistentStorageOptions {
  readonly path: string;
  /** 空資料夾時允許初始化 `state/folder.json` 與三個資料庫。 */
  readonly initialize?: boolean;
  readonly expectedFolderId?: string;
  readonly appVersion?: string;
  readonly now?: () => Date;
  readonly trace?: (operation: string) => void;
  /** 主線判斷；`rootConversationId` 篩選審批時使用。 */
  readonly isInRoot?: (conversationId: string, rootConversationId: string) => boolean;
}

/**
 * 把 `@cardiary/storage` 接到主機服務的儲存介面。
 *
 * 主機只認得 `StorageBundle` 這一組介面；正式產品由這個類別提供實作，
 * 測試用記憶體替身。兩個資料庫的生命週期由儲存套件擁有，這裡只轉接。
 */
export class PersistentStorage implements StorageBundle {
  readonly storage: Storage;
  readonly folder: FolderIdentity;
  readonly events: EventLogStore;
  readonly runtime: RuntimeStateStore;
  readonly dedupe: RequestDedupeStore;
  readonly approvals: ApprovalLedger;
  readonly turnIndex: TurnIndexStore;
  readonly deletions: DeletionIntentStore;

  private constructor(storage: Storage, options: PersistentStorageOptions) {
    this.storage = storage;
    this.folder = {
      path: storage.layout.root,
      folderId: storage.folderId ?? "",
      displayName: storage.layout.displayName,
      writable: storage.folderState === "ready",
    };
    this.events = new PersistentEventLog(storage);
    this.runtime = new PersistentRuntimeState(storage);
    this.dedupe = new PersistentRequestDedupe(storage);
    this.approvals = new PersistentApprovalLedger(storage, options);
    this.turnIndex = new PersistentTurnIndex(storage, options);
    this.deletions = new PersistentDeletionIntents(storage);
  }

  /** 開啟資料夾；不可用時丟 `PersistentStorageFailure`，呼叫端不啟動服務。 */
  static open(options: PersistentStorageOptions): PersistentStorage {
    const storage = Storage.open({
      path: options.path,
      ...(options.initialize === undefined ? {} : { initialize: options.initialize }),
      ...(options.expectedFolderId === undefined
        ? {}
        : { expectedFolderId: options.expectedFolderId }),
      ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.trace === undefined ? {} : { trace: options.trace }),
    });
    return new PersistentStorage(storage, options);
  }

  /**
   * 正常關閉：標記 `clean_shutdown`、checkpoint、關閉三條連線並釋放資料夾鎖。
   *
   * 由主機服務在關閉流程的最後呼叫；第二次呼叫是安全的。
   */
  shutdown(): void {
    this.storage.shutdown();
  }

  /**
   * 暫停時關掉儲存層還在開著的連線。
   *
   * 狀態庫由 `runtime.checkpointAndClose()` 關、轉接層的 Harness 由
   * `engine.suspend()` 關；這裡負責快取與儲存層自己的引擎連線
   * （刪除與每日維護用的那一條）。
   */
  pauseDatabases(): void {
    this.storage.closeCache();
    this.storage.closeEngine();
  }

  /** 恢復時重開暫停關掉的連線；epoch 對得上才呼叫。 */
  resumeDatabases(): void {
    this.storage.reopenEngine();
    this.storage.reopenCache();
  }

  /** 只釋放資源，不標記正常關閉；測試與異常結束使用。 */
  close(): void {
    this.storage.close();
  }
}

/** `event_log` 的轉接；序號、epoch 與交易都由儲存套件決定。 */
class PersistentEventLog implements EventLogStore {
  readonly #storage: Storage;
  #closed = false;

  constructor(storage: Storage) {
    this.#storage = storage;
  }

  #assertOpen(): void {
    if (this.#closed) throw new PersistentStorageFailure("事件日誌已關閉");
    if (this.#storage.state.isClosed) {
      throw new PersistentStorageFailure("狀態資料庫已關閉");
    }
  }

  async append(entry: EventLogEntry, projection?: () => void): Promise<StoredEvent> {
    this.#assertOpen();
    const record = this.#storage.events.appendWithState(
      {
        stream: entry.stream as "system" | `session:${string}`,
        epoch: entry.epoch,
        kind: entry.kind,
        payload: entry.payload as JsonValue,
        createdAt: entry.at,
      },
      () => {
        projection?.();
      },
    );
    return {
      stream: record.stream,
      epoch: record.epoch,
      seq: record.streamSeq,
      kind: record.kind,
      payload: record.payload as never,
      at: record.createdAt,
    };
  }

  async lastSeq(stream: string, epoch: string): Promise<number> {
    return this.#storage.events.maxSeq(stream as "system" | `session:${string}`, epoch);
  }

  async oldestSeq(stream: string, epoch: string): Promise<number | null> {
    const first = this.#storage.events.read(stream as "system" | `session:${string}`, epoch, 0, 1);
    return first[0]?.streamSeq ?? null;
  }

  async readRange(stream: string, epoch: string, from: number, to: number): Promise<StoredEvent[]> {
    if (to < from) return [];
    const records = this.#storage.events.read(
      stream as "system" | `session:${string}`,
      epoch,
      from - 1,
      to - from + 1,
    );
    return records
      .filter((record) => record.streamSeq <= to)
      .map((record) => ({
        stream: record.stream,
        epoch: record.epoch,
        seq: record.streamSeq,
        kind: record.kind,
        payload: record.payload as never,
        at: record.createdAt,
      }));
  }

  async reopen(): Promise<void> {
    // 狀態資料庫由 `RuntimeStateStore.reopen()` 重開；這裡只恢復可寫狀態。
    this.#closed = false;
  }

  async deleteStream(stream: string): Promise<void> {
    this.#storage.events.deleteStream(stream as "system" | `session:${string}`);
  }

  async pruneOtherEpochs(epoch: string): Promise<void> {
    const records = this.#storage.events.readAll("system");
    for (const record of records) {
      if (record.epoch !== epoch) {
        this.#storage.events.deleteEpoch(record.epoch);
      }
    }
  }

  async flush(): Promise<void> {
    // WAL 的提交是同步的；實際的 checkpoint 在暫停與關閉時執行。
  }

  async close(): Promise<void> {
    this.#closed = true;
  }
}

/** `runtime_state` 的轉接；epoch 與 `clean_shutdown` 的唯一權威。 */
class PersistentRuntimeState implements RuntimeStateStore {
  readonly #storage: Storage;
  #opened = false;
  /**
   * 最近一次讀到的快照。
   *
   * `control.health` 在暫停後（狀態庫已關閉）仍要回答 epoch，所以記憶體裡
   * 留一份；資料庫開著時以資料庫為準。
   */
  #snapshot: RuntimeStateSnapshot | null = null;

  constructor(storage: Storage) {
    this.#storage = storage;
  }

  get opened(): boolean {
    return this.#opened;
  }

  async open(): Promise<RuntimeStateSnapshot> {
    this.#opened = true;
    this.#snapshot = snapshotOf(this.#storage.runtime.open());
    return this.#snapshot;
  }

  async reopen(): Promise<RuntimeStateSnapshot> {
    const snapshot = snapshotOf(this.#storage.runtime.reopen());
    this.#opened = true;
    this.#snapshot = snapshot;
    return snapshot;
  }

  current(): RuntimeStateSnapshot | null {
    if (!this.#storage.state.isClosed) {
      try {
        const snapshot = this.#storage.runtime.read();
        if (snapshot !== null) {
          this.#snapshot = snapshotOf(snapshot);
          return this.#snapshot;
        }
      } catch {
        // 讀不到就用最後一次的快照；健康檢查不能因此失敗。
      }
    }
    return this.#snapshot;
  }

  async markCleanShutdown(reason: string): Promise<void> {
    this.#snapshot = snapshotOf(this.#storage.runtime.markCleanShutdown(reason));
  }

  async checkpointAndClose(): Promise<void> {
    this.#opened = false;
    this.#storage.runtime.checkpointAndClose();
  }

  async close(): Promise<void> {
    this.#opened = false;
    if (!this.#storage.state.isClosed) {
      this.#storage.state.close();
    }
  }
}

function snapshotOf(snapshot: {
  readonly epoch: string;
  readonly cleanShutdown: boolean;
  readonly startedAt: string;
}): RuntimeStateSnapshot {
  return {
    epoch: snapshot.epoch,
    cleanShutdown: snapshot.cleanShutdown,
    startedAt: snapshot.startedAt,
  };
}

/** `request_dedupe` 的轉接；鍵與狀態由儲存套件決定。 */
class PersistentRequestDedupe implements RequestDedupeStore {
  readonly #storage: Storage;

  constructor(storage: Storage) {
    this.#storage = storage;
  }

  async claim(key: string, kind: DedupeKind): Promise<ClaimResult> {
    const result = this.#storage.dedupe.claim(key, kind);
    return result.claimed
      ? { outcome: "claimed" }
      : { outcome: "existing", record: dedupeRecordOf(result.record) };
  }

  async setResource(key: string, resourceId: string): Promise<void> {
    if (!this.#storage.dedupe.setResource(key, resourceId)) {
      throw new PersistentStorageFailure(`去重列不存在：${key}`);
    }
  }

  async complete(key: string, response: JsonValue): Promise<void> {
    if (!this.#storage.dedupe.complete(key, JSON.stringify(response))) {
      throw new PersistentStorageFailure(`去重列不存在：${key}`);
    }
  }

  async lookup(key: string): Promise<DedupeRecord | null> {
    const record = this.#storage.dedupe.lookup(key);
    return record === null ? null : dedupeRecordOf(record);
  }

  async deleteByKey(key: string): Promise<void> {
    this.#storage.dedupe.deleteKeys([key]);
  }
}

function dedupeRecordOf(record: {
  readonly key: string;
  readonly kind: DedupeKind;
  readonly state: "pending" | "completed";
  readonly resourceId: string | null;
  readonly responseJson: string | null;
  readonly claimedAt: string;
  readonly completedAt: string | null;
}): DedupeRecord {
  return {
    key: record.key,
    kind: record.kind,
    state: record.state,
    resourceId: record.resourceId,
    response: record.responseJson === null ? null : (JSON.parse(record.responseJson) as JSONValue),
    claimedAt: record.claimedAt,
    completedAt: record.completedAt,
  };
}

/** `turn_index` 的轉接；回合開始時寫入，回合結束後仍查得到。 */
class PersistentTurnIndex implements TurnIndexStore {
  readonly #storage: Storage;
  readonly #now: () => Date;

  constructor(storage: Storage, options: PersistentStorageOptions) {
    this.#storage = storage;
    this.#now = options.now ?? (() => new Date());
  }

  record(conversationId: string, userMessageId: string, turnId: string): void {
    this.#storage.turns.record({
      turnId,
      conversationId,
      triggerMessageId: userMessageId,
      startedAt: this.#now().toISOString(),
    });
  }

  async get(conversationId: string, userMessageId: string): Promise<string | null> {
    return this.#storage.turns.findByMessage(conversationId, userMessageId)?.turnId ?? null;
  }
}

/** `conversation_deletions` 的轉接；啟動時先完成未結束的刪除。 */
class PersistentDeletionIntents implements DeletionIntentStore {
  readonly #storage: Storage;

  constructor(storage: Storage) {
    this.#storage = storage;
  }

  async pending(): Promise<readonly string[]> {
    return this.#storage.deletions.listPendingDeletions().map((intent) => intent.rootId);
  }

  async remove(conversationId: string): Promise<void> {
    this.#storage.deletions.removeIntent(conversationId);
  }
}

/**
 * 審批 ledger 的轉接。
 *
 * `approvals` 表是唯一權威：`request_json` 保存完整的請求，`status` 與
 * `decision_json` 由表自己維護，讀回時以資料列為準，避免兩份狀態各說各話。
 */
export class PersistentApprovalLedger implements ApprovalLedger {
  readonly #storage: Storage;
  readonly #isInRoot: (conversationId: string, rootConversationId: string) => boolean;

  constructor(storage: Storage, options: PersistentStorageOptions = { path: "" }) {
    this.#storage = storage;
    this.#isInRoot =
      options.isInRoot ??
      ((conversationId, rootConversationId) => conversationId === rootConversationId);
  }

  async record(request: ApprovalRequest): Promise<ApprovalRecordOutcome> {
    const outcome: RecordApprovalOutcome = this.#storage.approvals.record({
      id: request.id,
      approvalKey: request.approvalKey,
      scope: request.draft.action.kind === "tool-execution" ? "tool" : "task",
      sessionId: request.draft.conversationId ?? null,
      turnId: request.draft.turnId ?? null,
      toolName: request.draft.action.toolName ?? null,
      // `task` 列要求 subject_id 非空（storage 3.6）；宿主審批的請求識別碼作為主體。
      subjectId: request.draft.hostApproval?.requestId ?? null,
      toolCallId: request.draft.toolCallId ?? null,
      actionKind: request.draft.action.kind,
      requestJson: JSON.stringify(request),
      requestedAt: request.requestedAt,
      expiresAt: request.expiresAt,
    });
    const stored = requestOf(outcome.record) ?? request;
    if (outcome.status === "approved" || outcome.status === "denied") {
      return {
        kind: "decided",
        request: { ...stored, status: outcome.status, decision: decisionOf(outcome.record) },
      };
    }
    return outcome.inserted
      ? { kind: "created", request: stored }
      : { kind: "existing", request: stored };
  }

  async update(request: ApprovalRequest): Promise<void> {
    if (request.status === "withdrawn") {
      this.#storage.approvals.withdraw(request.id);
      return;
    }
    if (request.status === "expired") {
      this.#storage.approvals.expireOne(request.id);
      return;
    }
    // `pending`、`approved`、`denied` 由 `record` 與 `commitDecision` 負責；
    // 其他呼叫路徑不該改狀態。
  }

  async get(requestId: string): Promise<ApprovalRequest | null> {
    const record = this.#storage.approvals.get(requestId);
    return record === null ? null : requestOf(record);
  }

  async findByApprovalKey(approvalKey: string): Promise<ApprovalRequest | null> {
    const record = this.#storage.approvals.findByApprovalKey(approvalKey);
    return record === null ? null : requestOf(record);
  }

  async listPending(filter?: ApprovalListFilter): Promise<readonly ApprovalRequest[]> {
    const records = this.#storage.approvals.listPending(
      filter?.conversationId === undefined ? {} : { sessionId: filter.conversationId },
    );
    const pending = records
      .map(requestOf)
      .filter((request): request is ApprovalRequest => request !== null);
    if (filter?.rootConversationId === undefined) return pending;
    const root = filter.rootConversationId;
    return pending.filter((request) => {
      const conversationId = request.draft.conversationId;
      if (conversationId === undefined) return false;
      return this.#isInRoot(conversationId, root);
    });
  }

  async commitDecision(decision: ApprovalDecision): Promise<"committed" | "already-decided"> {
    const outcome = this.#storage.approvals.commitDecision({
      approvalId: decision.requestId,
      verdict: decision.verdict,
      decidedAt: decision.decidedAt,
      decidedBy: JSON.stringify(decision.decidedBy),
      ...(decision.note === undefined ? {} : { note: decision.note }),
    });
    return outcome.outcome === "committed" ? "committed" : "already-decided";
  }
}

function requestOf(record: ApprovalRecord): ApprovalRequest | null {
  let parsed: ApprovalRequest;
  try {
    parsed = JSON.parse(record.requestJson) as ApprovalRequest;
  } catch {
    return null;
  }
  const decision = decisionOf(record);
  const status =
    record.status === "pending" ||
    record.status === "approved" ||
    record.status === "denied" ||
    record.status === "expired" ||
    record.status === "withdrawn"
      ? record.status
      : parsed.status;
  return {
    ...parsed,
    id: record.id,
    approvalKey: record.approvalKey,
    status,
    ...(decision === null ? {} : { decision }),
  };
}

function decisionOf(record: ApprovalRecord): ApprovalDecision | null {
  if (record.decisionJson === null) return null;
  try {
    const parsed = JSON.parse(record.decisionJson) as {
      readonly verdict: "approve" | "deny";
      readonly decidedAt: string;
      readonly decidedBy:
        | { readonly kind: "human"; readonly clientId: string; readonly deviceName?: string }
        | string;
      readonly note?: string;
    };
    const decidedBy =
      typeof parsed.decidedBy === "string"
        ? { kind: "human" as const, clientId: parsed.decidedBy }
        : parsed.decidedBy;
    return {
      requestId: record.id,
      verdict: parsed.verdict,
      decidedAt: parsed.decidedAt,
      decidedBy,
      ...(parsed.note === undefined ? {} : { note: parsed.note }),
    };
  } catch {
    return null;
  }
}

/**
 * 刪除的 Cardiary 那一半；引擎轉接層的 `purger` 接縫。
 *
 * 引擎的列與 Harness 由轉接層自己處理；這裡只清 Cardiary 的資料庫，
 * 兩邊共用同一份 `conversation_deletions` 意圖，重啟後才能收斂。
 */
export class PersistentPurger implements ConversationDataPurger {
  readonly #storage: Storage;

  constructor(storage: Storage) {
    this.#storage = storage;
  }

  async putIntent(intent: EngineDeletionIntent): Promise<void> {
    this.#storage.deletions.putIntent({
      rootId: intent.rootConversationId,
      conversationIds: intent.conversationIds,
      clientRequestIds: intent.clientRequestIds,
      phase: intent.phase,
      requestedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async listIntents(): Promise<readonly EngineDeletionIntent[]> {
    return this.#storage.deletions.listPendingDeletions().map((intent) => ({
      rootConversationId: intent.rootId,
      conversationIds: intent.conversationIds,
      clientRequestIds: intent.clientRequestIds,
      phase: intent.phase,
    }));
  }

  async setIntentPhase(rootConversationId: string, phase: DeletionPhase): Promise<void> {
    this.#storage.deletions.setIntentPhase(rootConversationId, phase);
  }

  async removeIntent(rootConversationId: string): Promise<void> {
    this.#storage.deletions.removeIntent(rootConversationId);
  }

  async purge(intent: EngineDeletionIntent): Promise<void> {
    this.#storage.deletions.purgeCardiaryRows({
      rootId: intent.rootConversationId,
      conversationIds: intent.conversationIds,
      clientRequestIds: intent.clientRequestIds,
    });
  }
}

export type { ConversationDeletionIntent, DeletionPhase };
