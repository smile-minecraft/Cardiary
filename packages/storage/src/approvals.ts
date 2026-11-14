import type { Database, Queryable } from "./db.js";
import { StorageError, isBusyError } from "./errors.js";
import { retrySync } from "./util.js";

/** 審批狀態；`pending` 最多一筆（同一個 `approval_key`）。 */
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "withdrawn";

/** M0 只建立工具審批；`task` 供 M1 使用。 */
export type ApprovalScope = "tool" | "task";

/** `approvals` 的一列。JSON 欄位保持文字，寫入者負責序列化。 */
export interface ApprovalRecord {
  readonly id: string;
  readonly approvalKey: string;
  readonly scope: ApprovalScope;
  readonly sessionId: string | null;
  readonly turnId: string | null;
  readonly toolName: string | null;
  readonly subjectId: string | null;
  readonly toolCallId: string | null;
  readonly actionKind: string;
  readonly status: ApprovalStatus;
  readonly requestJson: string;
  readonly decisionJson: string | null;
  readonly requestedAt: string;
  readonly expiresAt: string | null;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
}

export interface RecordApprovalInput {
  readonly id: string;
  readonly approvalKey: string;
  readonly scope?: ApprovalScope;
  readonly sessionId?: string | null;
  readonly turnId?: string | null;
  readonly toolName?: string | null;
  readonly subjectId?: string | null;
  readonly toolCallId?: string | null;
  readonly actionKind: string;
  readonly requestJson: string;
  readonly requestedAt: string;
  readonly expiresAt?: string | null;
}

export type RecordApprovalOutcome =
  | { readonly status: "pending"; readonly record: ApprovalRecord; readonly inserted: boolean }
  | {
      readonly status: "approved" | "denied";
      readonly record: ApprovalRecord;
      readonly inserted: false;
    };

export type CommitDecisionOutcome =
  | { readonly outcome: "committed"; readonly record: ApprovalRecord }
  | { readonly outcome: "already-decided"; readonly record: ApprovalRecord }
  | { readonly outcome: "expired"; readonly record: ApprovalRecord }
  | { readonly outcome: "withdrawn"; readonly record: ApprovalRecord }
  | { readonly outcome: "not-found" };

export interface CommitDecisionInput {
  readonly approvalId: string;
  readonly verdict: "approve" | "deny";
  readonly decidedAt: string;
  readonly decidedBy: string;
  readonly note?: string;
}

export interface ApprovalListFilter {
  /** 只列這個會話的待審批請求；會話快照的 `pendingApproval` 使用。 */
  readonly sessionId?: string;
}

interface ApprovalRow {
  readonly id: string;
  readonly approval_key: string;
  readonly scope: string;
  readonly session_id: string | null;
  readonly turn_id: string | null;
  readonly tool_name: string | null;
  readonly subject_id: string | null;
  readonly tool_call_id: string | null;
  readonly action_kind: string;
  readonly status: string;
  readonly request_json: string;
  readonly decision_json: string | null;
  readonly requested_at: string;
  readonly expires_at: string | null;
  readonly decided_at: string | null;
  readonly decided_by: string | null;
}

const LATEST_ROW_SQL = `
SELECT id, approval_key, scope, session_id, turn_id, tool_name, subject_id, tool_call_id,
       action_kind, status, request_json, decision_json, requested_at, expires_at,
       decided_at, decided_by
FROM approvals
WHERE approval_key = ?
ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, requested_at DESC, rowid DESC
LIMIT 1
`;

/** 審批的唯一權威：`state/cardiary.sqlite` 的 `approvals` 表。 */
export class ApprovalLedger {
  readonly #db: Database;
  readonly #now: () => Date;

  constructor(db: Database, options: { readonly now?: () => Date } = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * 先讀最新列，再決定要不要插入。
   *
   * 整段在 `BEGIN IMMEDIATE` 交易內；partial unique index 是最後的並行權威。
   * `approved`／`denied` 直接回、不插入；`pending` 未過期接上；`pending`
   * 已過期先標成 `expired` 再插入；沒有列或 `expired`／`withdrawn` 才插入。
   */
  record(input: RecordApprovalInput): RecordApprovalOutcome {
    const now = this.#now().toISOString();
    return retrySync(
      () =>
        this.#db.transaction((tx) => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const latest = this.latestFor(input.approvalKey, tx);
            if (latest === null) {
              const inserted = this.insertPending(input, tx);
              if (inserted.inserted) {
                return inserted;
              }
              continue;
            }
            if (latest.status === "approved" || latest.status === "denied") {
              return { status: latest.status, record: latest, inserted: false };
            }
            if (latest.status === "pending") {
              if (latest.expiresAt !== null && latest.expiresAt <= now) {
                const expired = tx.run(
                  "UPDATE approvals SET status = 'expired', decided_at = ? WHERE id = ? AND status = 'pending'",
                  now,
                  latest.id,
                );
                if (expired.changes === 0) {
                  continue;
                }
                const inserted = this.insertPending(input, tx);
                if (inserted.inserted) {
                  return inserted;
                }
                continue;
              }
              return { status: "pending", record: latest, inserted: false };
            }
            // expired 或 withdrawn：可以重新詢問。
            const inserted = this.insertPending(input, tx);
            if (inserted.inserted) {
              return inserted;
            }
          }
          throw new StorageError("busy", "審批請求在重試後仍無法收斂", {
            approvalKey: input.approvalKey,
          });
        }),
      isBusyError,
    );
  }

  /** `pending` 優先；沒有 pending 才取最新的一列。 */
  findByApprovalKey(approvalKey: string): ApprovalRecord | null {
    return this.latestFor(approvalKey, this.#db);
  }

  /** 用 Cardiary 簽發的 id 查詢。 */
  get(approvalId: string): ApprovalRecord | null {
    const row = this.#db.get<ApprovalRow>("SELECT * FROM approvals WHERE id = ?", approvalId);
    return row === undefined ? null : rowToRecord(row);
  }

  /** 會話快照的 `pendingApproval`：每個會話最多一筆。 */
  pendingForSession(sessionId: string): ApprovalRecord | null {
    const row = this.#db.get<ApprovalRow>(
      `SELECT * FROM approvals
       WHERE session_id = ? AND status = 'pending'
       ORDER BY requested_at DESC, rowid DESC
       LIMIT 1`,
      sessionId,
    );
    return row === undefined ? null : rowToRecord(row);
  }

  /** 列出待審批請求；M0 只有會話內的工具審批。 */
  listPending(filter: ApprovalListFilter = {}): ApprovalRecord[] {
    const rows =
      filter.sessionId === undefined
        ? this.#db.all<ApprovalRow>(
            "SELECT * FROM approvals WHERE status = 'pending' ORDER BY requested_at DESC, rowid DESC",
          )
        : this.#db.all<ApprovalRow>(
            `SELECT * FROM approvals
             WHERE session_id = ? AND status = 'pending'
             ORDER BY requested_at DESC, rowid DESC`,
            filter.sessionId,
          );
    return rows.map(rowToRecord);
  }

  /** 寫入決定；`UPDATE ... WHERE status = 'pending'` 保證先寫入者勝出。 */
  commitDecision(input: CommitDecisionInput): CommitDecisionOutcome {
    const status = input.verdict === "approve" ? "approved" : "denied";
    const decisionJson = JSON.stringify({
      verdict: input.verdict,
      decidedAt: input.decidedAt,
      decidedBy: input.decidedBy,
      ...(input.note === undefined ? {} : { note: input.note }),
    });
    return this.#db.transaction((tx) => {
      const changed = tx.run(
        `UPDATE approvals
         SET status = ?, decision_json = ?, decided_at = ?, decided_by = ?
         WHERE id = ? AND status = 'pending'`,
        status,
        decisionJson,
        input.decidedAt,
        input.decidedBy,
        input.approvalId,
      );
      if (changed.changes === 1) {
        const record = this.get(input.approvalId);
        if (record === null) {
          throw new StorageError("approval-not-found", "剛寫入的審批列不見了");
        }
        return { outcome: "committed", record } satisfies CommitDecisionOutcome;
      }
      const existing = this.get(input.approvalId);
      if (existing === null) {
        return { outcome: "not-found" } satisfies CommitDecisionOutcome;
      }
      if (existing.status === "expired" || existing.status === "withdrawn") {
        return { outcome: existing.status, record: existing } satisfies CommitDecisionOutcome;
      }
      return { outcome: "already-decided", record: existing } satisfies CommitDecisionOutcome;
    });
  }

  /** 把一筆仍是 `pending` 的請求標成 `expired`；已決定或已撤回時不動。 */
  expireOne(approvalId: string, now: string = this.#now().toISOString()): ApprovalRecord | null {
    this.#db.run(
      "UPDATE approvals SET status = 'expired', decided_at = ? WHERE id = ? AND status = 'pending'",
      now,
      approvalId,
    );
    return this.get(approvalId);
  }

  /** 把逾時的 `pending` 標成 `expired`；回傳變更筆數。 */
  expirePending(now: string = this.#now().toISOString()): number {    return this.#db.run(
      "UPDATE approvals SET status = 'expired', decided_at = ? WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?",
      now,
      now,
    ).changes;
  }

  /** 撤回尚未決定的請求。 */
  withdraw(approvalId: string, now: string = this.#now().toISOString()): ApprovalRecord | null {
    const changed = this.#db.run(
      "UPDATE approvals SET status = 'withdrawn', decided_at = ? WHERE id = ? AND status = 'pending'",
      now,
      approvalId,
    );
    if (changed.changes === 0) {
      return this.get(approvalId);
    }
    return this.get(approvalId);
  }

  /** 30 天保留只套用已決定的列；對話刪除時另行立即刪除。 */
  prune(options: { readonly now?: Date; readonly retainDays?: number } = {}): number {
    const now = options.now ?? this.#now();
    const cutoff = new Date(
      now.getTime() - (options.retainDays ?? 30) * 24 * 60 * 60 * 1000,
    ).toISOString();
    return this.#db.run(
      "DELETE FROM approvals WHERE status <> 'pending' AND decided_at IS NOT NULL AND decided_at < ?",
      cutoff,
    ).changes;
  }

  /** 刪除子樹的審批列（所有狀態）；刪除對話時使用。 */
  deleteForSessions(sessionIds: readonly string[], tx?: Queryable): number {
    const target = tx ?? this.#db;
    let deleted = 0;
    for (const sessionId of sessionIds) {
      deleted += target.run("DELETE FROM approvals WHERE session_id = ?", sessionId).changes;
    }
    return deleted;
  }

  /** 診斷：某個鍵的 pending 筆數；正常是 0 或 1。 */
  countPendingForKey(approvalKey: string): number {
    const row = this.#db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM approvals WHERE approval_key = ? AND status = 'pending'",
      approvalKey,
    );
    return Number(row?.n ?? 0);
  }

  private latestFor(approvalKey: string, tx: Queryable): ApprovalRecord | null {
    const row = tx.get<ApprovalRow>(LATEST_ROW_SQL, approvalKey);
    return row === undefined ? null : rowToRecord(row);
  }

  private insertPending(input: RecordApprovalInput, tx: Queryable): RecordApprovalOutcome {
    const result = tx.run(
      `INSERT INTO approvals (
         id, approval_key, scope, session_id, turn_id, tool_name, subject_id, tool_call_id,
         action_kind, status, request_json, requested_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
       ON CONFLICT DO NOTHING`,
      input.id,
      input.approvalKey,
      input.scope ?? "tool",
      input.sessionId ?? null,
      input.turnId ?? null,
      input.toolName ?? null,
      input.subjectId ?? null,
      input.toolCallId ?? null,
      input.actionKind,
      input.requestJson,
      input.requestedAt,
      input.expiresAt ?? null,
    );
    if (result.changes === 1) {
      const record = this.get(input.id);
      if (record === null) {
        throw new StorageError("approval-not-found", "剛插入的審批列不見了");
      }
      return { status: "pending", record, inserted: true };
    }
    return {
      status: "pending",
      record: this.latestForOrThrow(input.approvalKey, tx),
      inserted: false,
    };
  }

  private latestForOrThrow(approvalKey: string, tx: Queryable): ApprovalRecord {
    const record = this.latestFor(approvalKey, tx);
    if (record === null) {
      throw new StorageError("busy", "審批插入衝突後讀不到最新列", { approvalKey });
    }
    return record;
  }
}

/** 「一律允許」白名單。M0 只讀，不提供寫入路徑。 */
export interface ApprovalAllowlistEntry {
  readonly id: string;
  readonly toolName: string;
  readonly scopeKey: string;
  readonly actionKind: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

interface AllowlistRow {
  readonly id: string;
  readonly tool_name: string;
  readonly scope_key: string;
  readonly action_kind: string;
  readonly created_at: string;
  readonly created_by: string;
}

/**
 * `approval_allowlist` 的唯讀介面。
 *
 * 它是設定，不是審批紀錄：不過期、不隨對話刪除、不受 30 天保留影響。
 * M0 的權限閘道固定回 `ask-human`，所以 M0 不寫入；寫入屬於 M1 的
 * `ApprovalService.commitDecision`（人類按下「一律允許」）。
 */
export class ApprovalAllowlist {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** 命中就代表可以跳過人工審批。 */
  find(toolName: string, scopeKey: string): ApprovalAllowlistEntry | null {
    const row = this.#db.get<AllowlistRow>(
      "SELECT * FROM approval_allowlist WHERE tool_name = ? AND scope_key = ?",
      toolName,
      scopeKey,
    );
    return row === undefined
      ? null
      : {
          id: row.id,
          toolName: row.tool_name,
          scopeKey: row.scope_key,
          actionKind: row.action_kind,
          createdAt: row.created_at,
          createdBy: row.created_by,
        };
  }

  list(): ApprovalAllowlistEntry[] {
    return this.#db
      .all<AllowlistRow>("SELECT * FROM approval_allowlist ORDER BY created_at")
      .map((row) => ({
        id: row.id,
        toolName: row.tool_name,
        scopeKey: row.scope_key,
        actionKind: row.action_kind,
        createdAt: row.created_at,
        createdBy: row.created_by,
      }));
  }
}

function rowToRecord(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    approvalKey: row.approval_key,
    scope: row.scope as ApprovalScope,
    sessionId: row.session_id,
    turnId: row.turn_id,
    toolName: row.tool_name,
    subjectId: row.subject_id,
    toolCallId: row.tool_call_id,
    actionKind: row.action_kind,
    status: row.status as ApprovalStatus,
    requestJson: row.request_json,
    decisionJson: row.decision_json,
    requestedAt: row.requested_at,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
  };
}
