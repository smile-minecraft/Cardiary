/**
 * 排程與排程執行紀錄的儲存；正本就是這些表。
 *
 * 時間一律由呼叫端注入（ISO 字串）。所有多步驟變更都在單一交易內完成。
 * `claimDue` 是「到時間執行一次」與「錯過只補跑一次」的核心：
 *
 * 1. `enabled = 1` 且 `next_run_at <= now` 的排程，依觸發時間排序，搶到一筆就把
 *    下一次觸發推到未來（`once` 直接關閉）——不管錯過幾次，只執行一次。
 * 2. claim 在同一個 `BEGIN IMMEDIATE` 交易裡完成；同毫秒並行時只有一個會成功。
 * 3. 執行紀錄在任務結束時寫入（`schedule_runs` 的 CHECK 不允許 pending），
 *    寫入與 `schedules.last_*` 的更新同一個交易。
 *
 * `once` 在 claim 時就關閉：執行失敗也不自動重試（排程任務不是可安全重入的）。
 */

export type { ScheduleRecord, ScheduleRunRecord } from "@cardiary/domain";
import {
  computeNextRunAfter,
  parseScheduleKind,
  parseScheduleSpec,
  parseScheduleTask,
  specToJson,
  taskToJson,
  type ScheduleRecord,
  type ScheduleRunRecord,
  type ScheduleRunStatus,
} from "@cardiary/domain";
import { newUlid } from "../ids.js";
import { StorageError } from "../errors.js";
import { nowIso } from "../util.js";
import type { Database } from "../db.js";

export interface ScheduleStoreOptions {
  readonly now?: () => Date;
}

export interface CreateScheduleInput {
  readonly name: string;
  readonly kind: string;
  readonly rawSpec: unknown;
  readonly rawTask: unknown;
  readonly createdBy: "user" | "agent";
  readonly persona?: string | undefined;
  readonly enabled?: boolean | undefined;
  readonly sourceConversationId?: string | undefined;
  readonly nextRunAt: string;
  readonly id?: string | undefined;
}

export interface UpdateScheduleInput {
  readonly name?: string | undefined;
  readonly rawSpec?: unknown;
  readonly rawTask?: unknown;
  /** 傳入時重新計算 `next_run_at` 為現在之後的下一次。 */
  readonly rescheduleFromSpec?: boolean | undefined;
}

interface ScheduleRow {
  readonly schedule_id: string;
  readonly persona: string;
  readonly name: string;
  readonly kind: string;
  readonly spec_json: string;
  readonly task_json: string;
  readonly enabled: number;
  readonly created_by: string;
  readonly source_conversation_id: string | null;
  readonly next_run_at: string;
  readonly last_run_at: string | null;
  readonly last_status: string | null;
  readonly last_error: string | null;
  readonly run_count: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ScheduleRunRow {
  readonly run_id: string;
  readonly schedule_id: string;
  readonly conversation_id: string | null;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly status: string;
  readonly error: string | null;
}

export interface ScheduleClaim {
  readonly schedule: ScheduleRecord;
  readonly runId: string;
  readonly claimedAt: string;
  readonly spec: import("@cardiary/domain").ScheduleSpec;
  readonly task: import("@cardiary/domain").ScheduleTask;
}

/** claimDue 的結果；`corrupt` 代表規格損毀，已停用並記下原因。 */
export type ScheduleClaimResult =
  | { readonly kind: "claimed"; readonly claim: ScheduleClaim }
  | { readonly kind: "corrupt"; readonly schedule: ScheduleRecord };

export class ScheduleStore {
  readonly #db: Database;
  readonly #now: () => Date;

  constructor(db: Database, options: ScheduleStoreOptions = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
  }

  create(input: CreateScheduleInput): ScheduleRecord {
    const kind = parseScheduleKind(input.kind);
    const spec = parseScheduleSpec(kind, input.rawSpec);
    const task = parseScheduleTask(input.rawTask);
    const name = input.name.trim();
    if (name.length === 0) {
      throw new StorageError("invalid-input", "排程名稱不能是空的");
    }
    const now = nowIso(this.#now);
    const id = input.id ?? `sch_${newUlid(Date.parse(now) || Date.now())}`;
    this.#db.run(
      `INSERT INTO schedules (schedule_id, persona, name, kind, spec_json, task_json, enabled,
                              created_by, source_conversation_id, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.persona ?? "default",
      name,
      kind,
      specToJson(spec),
      taskToJson(task),
      input.enabled === false ? 0 : 1,
      input.createdBy,
      input.sourceConversationId ?? null,
      input.nextRunAt,
      now,
      now,
    );
    const created = this.get(id);
    if (created === null) {
      throw new StorageError("storage-failed", "排程建立後讀不到，資料庫不一致");
    }
    return created;
  }

  get(scheduleId: string): ScheduleRecord | null {
    const row = this.#db.get<ScheduleRow>(
      "SELECT * FROM schedules WHERE schedule_id = ?",
      scheduleId,
    );
    return row === undefined ? null : toRecord(row);
  }

  list(): ScheduleRecord[] {
    const rows = this.#db.all<ScheduleRow>(
      "SELECT * FROM schedules ORDER BY enabled DESC, next_run_at ASC, schedule_id ASC",
    );
    return rows.map(toRecord);
  }

  /** 列出到期的排程（不 claim）；除錯與測試用。 */
  listDue(nowIsoText: string): ScheduleRecord[] {
    const rows = this.#db.all<ScheduleRow>(
      "SELECT * FROM schedules WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC, schedule_id ASC",
      nowIsoText,
    );
    return rows.map(toRecord);
  }

  /**
   * 搶下一筆到期的排程：推到未來、計數加一、`once` 關閉。
   * 回傳 `null` 代表沒有到期排程。搶到的排程由呼叫端執行後呼叫 `finishRun`。
   */
  claimDue(nowIsoText: string): ScheduleClaimResult | null {
    return this.#db.transaction((tx) => {
      const row = tx.get<ScheduleRow>(
        `SELECT * FROM schedules
          WHERE enabled = 1 AND next_run_at <= ?
          ORDER BY next_run_at ASC, schedule_id ASC
          LIMIT 1`,
        nowIsoText,
      );
      if (row === undefined) {
        return null;
      }
      const kind = parseScheduleKind(row.kind);
      let spec;
      let task;
      try {
        spec = parseScheduleSpec(kind, JSON.parse(row.spec_json));
        task = parseScheduleTask(JSON.parse(row.task_json));
      } catch (error) {
        // 規格損毀的排程不能一直搶：停用並記下原因，等人工修。
        const message = error instanceof Error ? error.message : String(error);
        const now = nowIso(this.#now);
        tx.run(
          `UPDATE schedules
             SET enabled = 0, last_status = 'error', last_error = ?, updated_at = ?
           WHERE schedule_id = ?`,
          sanitizeError(message),
          now,
          row.schedule_id,
        );
        return {
          kind: "corrupt" as const,
          schedule: toRecord({
            ...row,
            enabled: 0,
            last_status: "error",
            last_error: sanitizeError(message),
            updated_at: now,
          }),
        };
      }
      const future = computeNextRunAfter(spec, nowIsoText);
      const nextRunAt = future ?? row.next_run_at;
      const nextEnabled = kind === "once" ? 0 : row.enabled;
      const runId = `run_${newUlid(Date.parse(nowIsoText) || Date.now())}`;
      const changed = tx.run(
        `UPDATE schedules
            SET next_run_at = ?, enabled = ?, run_count = run_count + 1, last_run_at = ?, updated_at = ?
          WHERE schedule_id = ? AND enabled = 1 AND next_run_at <= ?`,
        nextRunAt,
        nextEnabled,
        nowIsoText,
        nowIsoText,
        row.schedule_id,
        nowIsoText,
      ).changes;
      if (changed !== 1) {
        return null;
      }
      const claimed: ScheduleClaim = {
        schedule: toRecord({
          ...row,
          enabled: nextEnabled,
          next_run_at: nextRunAt,
          run_count: row.run_count + 1,
          last_run_at: nowIsoText,
          updated_at: nowIsoText,
        }),
        runId,
        claimedAt: nowIsoText,
        spec,
        task,
      };
      return { kind: "claimed" as const, claim: claimed };
    });
  }

  /**
   * 寫入執行紀錄並更新 `schedules.last_*`；同一個交易。
   */
  finishRun(input: {
    readonly runId: string;
    readonly scheduleId: string;
    readonly conversationId: string | null;
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly status: ScheduleRunStatus;
    readonly error?: string | null;
  }): void {
    this.#db.transaction((tx) => {
      tx.run(
        `INSERT INTO schedule_runs (run_id, schedule_id, conversation_id, started_at, finished_at, status, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        input.runId,
        input.scheduleId,
        input.conversationId,
        input.startedAt,
        input.finishedAt,
        input.status,
        input.error ?? null,
      );
      const lastStatus =
        input.status === "cancelled"
          ? "error"
          : (input.status as "ok" | "silent" | "notify" | "error");
      tx.run(
        `UPDATE schedules
            SET last_status = ?, last_error = ?, updated_at = ?
          WHERE schedule_id = ?`,
        lastStatus,
        input.error ?? null,
        input.finishedAt,
        input.scheduleId,
      );
    });
  }

  /** 標記排程的背景對話來源；寫在建立對話之後。 */
  markConversationOrigin(conversationId: string, origin: "user" | "schedule"): void {
    this.#db.run(
      "UPDATE conversations SET origin = ? WHERE conversation_id = ?",
      origin,
      conversationId,
    );
  }

  pause(scheduleId: string): boolean {
    const now = nowIso(this.#now);
    return (
      this.#db.run(
        "UPDATE schedules SET enabled = 0, updated_at = ? WHERE schedule_id = ?",
        now,
        scheduleId,
      ).changes > 0
    );
  }

  /** 恢復；若下次觸發已經過期，推到現在之後（`once` 例外：保留過去的時間，下一個 tick 補跑）。 */
  resume(scheduleId: string): ScheduleRecord | null {
    const now = nowIso(this.#now);
    return this.#db.transaction((tx) => {
      const row = tx.get<ScheduleRow>("SELECT * FROM schedules WHERE schedule_id = ?", scheduleId);
      if (row === undefined) {
        return null;
      }
      const kind = parseScheduleKind(row.kind);
      let nextRunAt = row.next_run_at;
      if (kind !== "once" && Date.parse(nextRunAt) <= Date.parse(now)) {
        const spec = parseScheduleSpec(kind, JSON.parse(row.spec_json));
        nextRunAt = computeNextRunAfter(spec, now) ?? nextRunAt;
      }
      tx.run(
        "UPDATE schedules SET enabled = 1, next_run_at = ?, updated_at = ? WHERE schedule_id = ?",
        nextRunAt,
        now,
        scheduleId,
      );
      const updated = tx.get<ScheduleRow>(
        "SELECT * FROM schedules WHERE schedule_id = ?",
        scheduleId,
      );
      return updated === undefined ? null : toRecord(updated);
    });
  }

  update(scheduleId: string, input: UpdateScheduleInput): ScheduleRecord | null {
    const now = nowIso(this.#now);
    return this.#db.transaction((tx) => {
      const row = tx.get<ScheduleRow>("SELECT * FROM schedules WHERE schedule_id = ?", scheduleId);
      if (row === undefined) {
        return null;
      }
      const name = input.name === undefined ? row.name : input.name.trim();
      if (name.length === 0) {
        throw new StorageError("invalid-input", "排程名稱不能是空的");
      }
      const kind = parseScheduleKind(row.kind);
      let specJson = row.spec_json;
      let reschedule = false;
      if (input.rawSpec !== undefined) {
        const spec = parseScheduleSpec(kind, input.rawSpec);
        specJson = specToJson(spec);
        reschedule = true;
      }
      const taskJson =
        input.rawTask === undefined ? row.task_json : taskToJson(parseScheduleTask(input.rawTask));
      let nextRunAt = row.next_run_at;
      if (reschedule || input.rescheduleFromSpec === true) {
        const spec = parseScheduleSpec(kind, JSON.parse(specJson));
        nextRunAt = computeNextRunAfter(spec, now) ?? specJson;
        if (spec.kind === "once") {
          nextRunAt = spec.at;
        }
      }
      tx.run(
        `UPDATE schedules
            SET name = ?, spec_json = ?, task_json = ?, next_run_at = ?, updated_at = ?
          WHERE schedule_id = ?`,
        name,
        specJson,
        taskJson,
        nextRunAt,
        now,
        scheduleId,
      );
      const updated = tx.get<ScheduleRow>(
        "SELECT * FROM schedules WHERE schedule_id = ?",
        scheduleId,
      );
      return updated === undefined ? null : toRecord(updated);
    });
  }

  delete(scheduleId: string): boolean {
    return this.#db.run("DELETE FROM schedules WHERE schedule_id = ?", scheduleId).changes > 0;
  }

  listRuns(scheduleId: string, limit = 50): ScheduleRunRecord[] {
    const rows = this.#db.all<ScheduleRunRow>(
      `SELECT * FROM schedule_runs
        WHERE schedule_id = ?
        ORDER BY started_at DESC, run_id DESC
        LIMIT ?`,
      scheduleId,
      Math.max(1, Math.min(200, limit)),
    );
    return rows.map(toRunRecord);
  }

  /** 90 天保留：清掉早於 `beforeIso` 的執行紀錄；回傳刪除的筆數。 */
  deleteOldRuns(beforeIso: string): number {
    return this.#db.run("DELETE FROM schedule_runs WHERE started_at < ?", beforeIso).changes;
  }
}

function toRecord(row: ScheduleRow): ScheduleRecord {
  return {
    scheduleId: row.schedule_id,
    persona: row.persona,
    name: row.name,
    kind: row.kind as ScheduleRecord["kind"],
    spec: row.spec_json,
    task: row.task_json,
    enabled: row.enabled === 1,
    createdBy: row.created_by as ScheduleRecord["createdBy"],
    sourceConversationId: row.source_conversation_id,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastStatus: (row.last_status as ScheduleRecord["lastStatus"]) ?? null,
    lastError: row.last_error,
    runCount: row.run_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRunRecord(row: ScheduleRunRow): ScheduleRunRecord {
  return {
    runId: row.run_id,
    scheduleId: row.schedule_id,
    conversationId: row.conversation_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as ScheduleRunRecord["status"],
    error: row.error,
  };
}

function sanitizeError(message: string): string {
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}
