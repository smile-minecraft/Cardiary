import type { Database, Queryable } from "./db.js";
import { addDaysIso } from "./util.js";

/** 兩種耐久冪等鍵。 */
export type DedupeKind = "session-create" | "send-message";

/** 請求去重的狀態；`pending` 代表已宣告但還沒完成。 */
export type DedupeState = "pending" | "completed";

export interface DedupeRecord {
  readonly key: string;
  readonly kind: DedupeKind;
  readonly state: DedupeState;
  readonly resourceId: string | null;
  readonly responseJson: string | null;
  readonly claimedAt: string;
  readonly completedAt: string | null;
  readonly expiresAt: string;
}

export interface ClaimResult {
  /** true 代表這次插入成功，呼叫端應該執行；false 代表已有人宣告過。 */
  readonly claimed: boolean;
  readonly record: DedupeRecord;
}

interface DedupeRow {
  readonly key: string;
  readonly kind: string;
  readonly state: string;
  readonly resource_id: string | null;
  readonly response_json: string | null;
  readonly claimed_at: string;
  readonly completed_at: string | null;
  readonly expires_at: string;
}

/** 由 `kind` 與識別碼組成的耐久冪等鍵。 */
export function sessionCreateKey(clientRequestId: string): string {
  return `session-create:${clientRequestId}`;
}

/** `send-message:<sessionId>:<clientMessageId>`。 */
export function sendMessageKey(sessionId: string, clientMessageId: string): string {
  return `send-message:${sessionId}:${clientMessageId}`;
}

/** 從鍵解析出 `send-message` 的會話與訊息識別碼。 */
export function parseSendMessageKey(
  key: string,
): { readonly sessionId: string; readonly clientMessageId: string } | null {
  const parts = key.split(":");
  if (parts.length < 3 || parts[0] !== "send-message") {
    return null;
  }
  const sessionId = parts[1];
  const clientMessageId = parts.slice(2).join(":");
  if (sessionId === undefined || clientMessageId === "") {
    return null;
  }
  return { sessionId, clientMessageId };
}

/** `request_dedupe` 的儲存介面；先宣告、完成才寫回應。 */
export class RequestDedupeStore {
  readonly #db: Database;
  readonly #now: () => Date;

  constructor(db: Database, options: { readonly now?: () => Date } = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * 先宣告；插入成功才執行。
   *
   * `expires_at` 預設 30 天，重送時即使列已過期仍由 `lookup` 判斷；
   * 清理是每日維護的工作，不在請求路徑刪列。
   */
  claim(
    key: string,
    kind: DedupeKind,
    options: { readonly now?: string; readonly retainDays?: number } = {},
  ): ClaimResult {
    const now = options.now ?? this.#now().toISOString();
    const expiresAt = addDaysIso(now, options.retainDays ?? 30);
    const result = this.#db.run(
      `INSERT INTO request_dedupe (key, kind, state, claimed_at, expires_at)
       VALUES (?, ?, 'pending', ?, ?)
       ON CONFLICT (key) DO NOTHING`,
      key,
      kind,
      now,
      expiresAt,
    );
    const record = this.lookup(key);
    if (record === null) {
      throw new Error(`request_dedupe 寫入後找不到 ${key}`);
    }
    return { claimed: result.changes === 1, record };
  }

  /** 效果已生效、回應還沒寫入之前，先記下資源識別碼。 */
  setResource(key: string, resourceId: string): boolean {
    return (
      this.#db.run("UPDATE request_dedupe SET resource_id = ? WHERE key = ?", resourceId, key)
        .changes === 1
    );
  }

  /** 完成才寫回應；只更新仍是 `pending` 的列。 */
  complete(key: string, responseJson: string, now = this.#now().toISOString()): boolean {
    return (
      this.#db.run(
        `UPDATE request_dedupe
         SET state = 'completed', response_json = ?, completed_at = ?
         WHERE key = ? AND state = 'pending'`,
        responseJson,
        now,
        key,
      ).changes === 1
    );
  }

  /** 讀取一列；沒有時回 null。 */
  lookup(key: string): DedupeRecord | null {
    const row = this.#db.get<DedupeRow>("SELECT * FROM request_dedupe WHERE key = ?", key);
    return row === undefined ? null : rowToRecord(row);
  }

  /** 刪除指定的鍵；刪除對話時使用。 */
  deleteKeys(keys: readonly string[], tx?: Queryable): number {
    const target = tx ?? this.#db;
    let deleted = 0;
    for (const key of keys) {
      deleted += target.run("DELETE FROM request_dedupe WHERE key = ?", key).changes;
    }
    return deleted;
  }

  /**
   * 刪除與子樹有關的去重列。
   *
   * - `session-create:<clientRequestId>`：由反向索引取得的鍵。
   * - `send-message:<sessionId>:%`：前綴比對，涵蓋 `resource_id` 仍為 NULL 的 pending 列。
   * - `resource_id` 指向子樹的列。
   */
  deleteForConversations(
    conversationIds: readonly string[],
    clientRequestIds: readonly string[],
    tx?: Queryable,
  ): number {
    const target = tx ?? this.#db;
    let deleted = 0;
    for (const clientRequestId of clientRequestIds) {
      deleted += target.run(
        "DELETE FROM request_dedupe WHERE key = ?",
        sessionCreateKey(clientRequestId),
      ).changes;
    }
    for (const conversationId of conversationIds) {
      deleted += target.run(
        "DELETE FROM request_dedupe WHERE key LIKE ?",
        `send-message:${conversationId}:%`,
      ).changes;
      deleted += target.run(
        "DELETE FROM request_dedupe WHERE resource_id = ?",
        conversationId,
      ).changes;
    }
    return deleted;
  }

  /**
   * 清掉超過保留期限的列；每日維護使用。
   *
   * `expires_at` 在 `claim` 時已設成「宣告時間 + 30 天」，所以門檻直接
   * 比 `expires_at`，不再從 `now` 往前推 30 天（那會變成 60 天）。
   */
  prune(options: { readonly now?: Date } = {}): number {
    const now = options.now ?? this.#now();
    return this.#db.run("DELETE FROM request_dedupe WHERE expires_at < ?", now.toISOString())
      .changes;
  }

  /** 診斷與測試：目前總列數。 */
  count(): number {
    const row = this.#db.get<{ n: number }>("SELECT COUNT(*) AS n FROM request_dedupe");
    return Number(row?.n ?? 0);
  }
}

/** 已生效資源的回查能力；由轉接層提供，storage 只呼叫。 */
export interface RequestRecoveryProbes {
  readonly conversationExists: (conversationId: string) => boolean;
  readonly findConversationByClientRequestId: (clientRequestId: string) => string | null;
  readonly messageExists: (conversationId: string, messageId: string) => boolean;
  readonly findMessageByClientId: (
    conversationId: string,
    clientMessageId: string,
  ) => string | null;
  /** 用資源識別碼組出原本的回應 JSON。 */
  readonly buildResponse: (resourceId: string) => string;
}

export type DedupeRecoveryOutcome =
  | {
      readonly outcome: "completed";
      readonly record: DedupeRecord;
      readonly resourceId: string;
      readonly responseJson: string;
    }
  | { readonly outcome: "pending"; readonly record: DedupeRecord }
  | { readonly outcome: "result_unknown"; readonly record: DedupeRecord }
  | { readonly outcome: "missing" };

export interface RecoverPendingOptions {
  readonly now?: Date;
  readonly pendingTimeoutMs?: number;
  readonly probes: RequestRecoveryProbes;
}

/**
 * 重送 `pending` 請求時的恢復流程（`storage` 第 3.7 節）。
 *
 * 先用 `resource_id`，再用冪等鍵回查；判斷不了時，期限內回 `pending`，
 * 超過期限回 `result_unknown`，不要當成成功，也不要重做。
 */
export function recoverPendingRequest(
  store: RequestDedupeStore,
  key: string,
  options: RecoverPendingOptions,
): DedupeRecoveryOutcome {
  const record = store.lookup(key);
  if (record === null) {
    return { outcome: "missing" };
  }
  if (record.state === "completed") {
    return {
      outcome: "completed",
      record,
      resourceId: record.resourceId ?? "",
      responseJson: record.responseJson ?? "",
    };
  }

  if (record.resourceId !== null) {
    const effective = isResourceEffective(record, record.resourceId, options.probes);
    if (effective) {
      return completeWith(store, record, record.resourceId, options);
    }
  }

  const found = findByIdempotencyKey(record, options.probes);
  if (found !== null) {
    store.setResource(record.key, found);
    const updated = store.lookup(record.key);
    if (updated !== null) {
      return completeWith(store, updated, found, options);
    }
  }

  const now = options.now ?? new Date();
  const timeout = options.pendingTimeoutMs ?? 60_000;
  const claimedAt = Date.parse(record.claimedAt);
  if (Number.isFinite(claimedAt) && now.getTime() - claimedAt <= timeout) {
    return { outcome: "pending", record };
  }
  return { outcome: "result_unknown", record };
}

function isResourceEffective(
  record: DedupeRecord,
  resourceId: string,
  probes: RequestRecoveryProbes,
): boolean {
  if (record.kind === "session-create") {
    return probes.conversationExists(resourceId);
  }
  const parsed = parseSendMessageKey(record.key);
  if (parsed === null) {
    return false;
  }
  return probes.messageExists(parsed.sessionId, resourceId);
}

function findByIdempotencyKey(record: DedupeRecord, probes: RequestRecoveryProbes): string | null {
  if (record.kind === "session-create") {
    const clientRequestId = record.key.slice("session-create:".length);
    if (clientRequestId === "") {
      return null;
    }
    return probes.findConversationByClientRequestId(clientRequestId);
  }
  const parsed = parseSendMessageKey(record.key);
  if (parsed === null) {
    return null;
  }
  return probes.findMessageByClientId(parsed.sessionId, parsed.clientMessageId);
}

function completeWith(
  store: RequestDedupeStore,
  record: DedupeRecord,
  resourceId: string,
  options: RecoverPendingOptions,
): DedupeRecoveryOutcome {
  const responseJson = options.probes.buildResponse(resourceId);
  store.complete(record.key, responseJson, (options.now ?? new Date()).toISOString());
  const updated = store.lookup(record.key);
  if (updated === null) {
    throw new Error(`request_dedupe 完成後找不到 ${record.key}`);
  }
  return { outcome: "completed", record: updated, resourceId, responseJson };
}

function rowToRecord(row: DedupeRow): DedupeRecord {
  return {
    key: row.key,
    kind: row.kind as DedupeKind,
    state: row.state as DedupeState,
    resourceId: row.resource_id,
    responseJson: row.response_json,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
  };
}
