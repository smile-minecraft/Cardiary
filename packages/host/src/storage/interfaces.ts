import type {
  ApprovalListFilter,
  ApprovalLedger,
  ApprovalRequest,
  ApprovalDecision,
} from "@cardiary/engine-adapter";
import type { JSONObject, JSONValue } from "@cardiary/protocol";

/** event_log 的一列；`seq` 是客戶端看到的串流序號。 */
export interface StoredEvent {
  readonly stream: string;
  readonly epoch: string;
  readonly seq: number;
  readonly kind: string;
  readonly payload: JSONObject;
  readonly at: string;
}

export interface EventLogEntry {
  readonly stream: string;
  readonly epoch: string;
  readonly kind: string;
  readonly payload: JSONObject;
  readonly at: string;
}

/**
 * 事件日誌：由協定閘道單獨寫入。
 *
 * `projection` 在同一個交易裡執行（狀態投影）；提交成功後才把事件送給客戶端。
 */
export interface EventLogStore {
  append(entry: EventLogEntry, projection?: () => void | Promise<void>): Promise<StoredEvent>;
  lastSeq(stream: string, epoch: string): Promise<number>;
  oldestSeq(stream: string, epoch: string): Promise<number | null>;
  readRange(stream: string, epoch: string, from: number, to: number): Promise<StoredEvent[]>;
  /** 重開連線（resume 用）；不換 epoch、不重建資料。 */
  reopen(): Promise<void>;
  deleteStream(stream: string): Promise<void>;
  pruneOtherEpochs(epoch: string): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface RuntimeStateSnapshot {
  readonly epoch: string;
  readonly cleanShutdown: boolean;
  readonly startedAt: string;
}

/**
 * 執行期狀態與事件 epoch 的權威（`state/cardiary.sqlite` 的 `runtime_state`）。
 *
 * `open()` 只在行程啟動呼叫一次，必要時換 epoch；`reopen()` 給 resume 與
 * 暫停中關閉使用，只重開連線、不換 epoch、不寫 `clean_shutdown`。
 */
export interface RuntimeStateStore {
  open(): Promise<RuntimeStateSnapshot>;
  reopen(): Promise<RuntimeStateSnapshot>;
  current(): RuntimeStateSnapshot | null;
  markCleanShutdown(reason: string): Promise<void>;
  checkpointAndClose(): Promise<void>;
  readonly opened: boolean;
}

export type DedupeKind = "session-create" | "send-message";

export interface DedupeRecord {
  readonly key: string;
  readonly kind: DedupeKind;
  readonly state: "pending" | "completed";
  readonly resourceId: string | null;
  readonly response: JSONValue | null;
  readonly claimedAt: string;
  readonly completedAt: string | null;
}

export type ClaimResult =
  { readonly outcome: "claimed" } | { readonly outcome: "existing"; readonly record: DedupeRecord };

/** 請求去重：先宣告、記資源、完成才寫回應。 */
export interface RequestDedupeStore {
  claim(key: string, kind: DedupeKind): Promise<ClaimResult>;
  setResource(key: string, resourceId: string): Promise<void>;
  complete(key: string, response: JSONValue): Promise<void>;
  lookup(key: string): Promise<DedupeRecord | null>;
  deleteByKey(key: string): Promise<void>;
}

/** 回合對照：`userMessageId → turnId`，回合開始時寫入。 */
export interface TurnIndexStore {
  record(conversationId: string, userMessageId: string, turnId: string): Promise<void>;
  get(conversationId: string, userMessageId: string): Promise<string | null>;
}

/** 刪除意圖：跨兩個資料庫的恢復依據。 */
export interface DeletionIntentStore {
  pending(): Promise<readonly string[]>;
  remove(conversationId: string): Promise<void>;
}

export interface FolderIdentity {
  readonly path: string;
  readonly folderId: string;
  readonly displayName: string;
  readonly writable: boolean;
  readonly reason?: string;
}

/** 主機服務用到的儲存介面；正式實作在 `@cardiary/storage`。 */
export interface StorageBundle {
  readonly events: EventLogStore;
  readonly runtime: RuntimeStateStore;
  readonly dedupe: RequestDedupeStore;
  readonly approvals: ApprovalLedger;
  readonly turnIndex: TurnIndexStore;
  readonly deletions: DeletionIntentStore;
  readonly folder: FolderIdentity;
}

export type { ApprovalListFilter, ApprovalLedger, ApprovalRequest, ApprovalDecision };
