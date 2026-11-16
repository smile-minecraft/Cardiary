/**
 * 每日蒸餾的持久化存取；正本是 `state/cardiary.sqlite` 的 v4 表。
 *
 * 這一層只做 SQL 與資料列映射，不呼叫模型、不讀寫卡片檔；領域規則在
 * `@cardiary/domain` 的 distillation，編排在主機的 memory 模組。
 *
 * 所有時間由呼叫端注入；同一次蒸餾的多步驟變更在同一交易內完成，讓中斷
 * 後續跑收斂到同一個結果。
 */

import { newUlid } from "../ids.js";
import { nowIso } from "../util.js";
import type { Database, Queryable } from "../db.js";

/** run 的狀態；與 `distillation_runs.status` 對齊。 */
export type DistillationRunStatus = "running" | "completed" | "partial" | "failed";

/** 一筆蒸餾執行紀錄。 */
export interface DistillationRunRecord {
  readonly runId: string;
  readonly persona: string;
  readonly day: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly status: DistillationRunStatus;
  readonly statsJson: string | null;
}

/** 建立 run 的輸入；`runId`／`startedAt` 省略時由儲存層產生。 */
export interface CreateDistillationRunInput {
  readonly persona: string;
  readonly day: string;
  readonly runId?: string;
  readonly startedAt?: string;
}

/** 蒸餾單元的 phase；與 `distillation_items.phase` 對齊。 */
export type DistillationItemPhase = "extract" | "merge" | "archive" | "core" | "notify";

/** 蒸餾單元的寫入狀態。 */
export type DistillationItemStatus = "pending" | "done" | "failed";

/** 一筆持久保存的蒸餾單元。 */
export interface DistillationItemRecord {
  readonly runId: string;
  readonly itemKey: string;
  readonly batchId: string;
  readonly persona: string;
  readonly sourceCardId: string;
  readonly contentHash: string | null;
  readonly outputCardId: string | null;
  readonly phase: DistillationItemPhase;
  readonly status: DistillationItemStatus;
  readonly detailJson: string | null;
  readonly undone: boolean;
  readonly updatedAt: string;
}

/** upsert 一筆單元的輸入。 */
export interface UpsertDistillationItemInput {
  readonly runId: string;
  readonly itemKey: string;
  readonly batchId: string;
  readonly persona: string;
  readonly sourceCardId: string;
  readonly phase: DistillationItemPhase;
  readonly status: DistillationItemStatus;
  readonly contentHash?: string | null;
  readonly outputCardId?: string | null;
  readonly detailJson?: string | null;
  readonly undone?: boolean;
  readonly updatedAt?: string;
}

interface RunRow {
  readonly run_id: string;
  readonly persona: string;
  readonly day: string;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly status: string;
  readonly stats_json: string | null;
}

interface ItemRow {
  readonly run_id: string;
  readonly item_key: string;
  readonly batch_id: string;
  readonly persona: string;
  readonly source_card_id: string;
  readonly content_hash: string | null;
  readonly output_card_id: string | null;
  readonly phase: string;
  readonly status: string;
  readonly detail_json: string | null;
  readonly undone: number;
  readonly updated_at: string;
}

/** 中斷判斷：running 超過這個時間視為中斷（設計 §1、§4）。 */
export const INTERRUPTION_THRESHOLD_MS = 30 * 60 * 1000;

export interface DistillationStoreOptions {
  readonly now?: () => Date;
}

/**
 * 蒸餾 run 與單元的存取。
 *
 * 一天一個 run（UNIQUE persona, day）。`createRun` 遇到同一天已有 run 時回傳
 * 既有紀錄（`null` 語意交給 `findRunByDay`），不另開；續跑由呼叫端決定。
 */
export class DistillationStore {
  readonly #db: Database;
  readonly #now: () => Date;

  constructor(db: Database, options: DistillationStoreOptions = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
  }

  // ---- runs ----

  createRun(input: CreateDistillationRunInput): DistillationRunRecord {
    const startedAt = input.startedAt ?? nowIso(this.#now);
    const runId = input.runId ?? `dst_${newUlid(Date.parse(startedAt) || Date.now())}`;
    this.#db.run(
      `INSERT OR IGNORE INTO distillation_runs (run_id, persona, day, started_at, status)
       VALUES (?, ?, ?, ?, 'running')`,
      runId,
      input.persona,
      input.day,
      startedAt,
    );
    const existing = this.findRunByDay(input.persona, input.day);
    if (existing === null) {
      throw new Error("建立蒸餾 run 後讀不到，資料庫不一致");
    }
    return existing;
  }

  getRun(runId: string): DistillationRunRecord | null {
    const row = this.#db.get<RunRow>("SELECT * FROM distillation_runs WHERE run_id = ?", runId);
    return row === undefined ? null : toRun(row);
  }

  findRunByDay(persona: string, day: string): DistillationRunRecord | null {
    const row = this.#db.get<RunRow>(
      "SELECT * FROM distillation_runs WHERE persona = ? AND day = ?",
      persona,
      day,
    );
    return row === undefined ? null : toRun(row);
  }

  /**
   * 找需要續跑的 run：`status = 'running'` 且開始時間早於 `beforeIso`。
   * 呼叫端傳入「現在 − 30 分鐘」，避免Store 自己依賴時區。
   */
  findInterruptedRuns(beforeIso: string): DistillationRunRecord[] {
    const rows = this.#db.all<RunRow>(
      "SELECT * FROM distillation_runs WHERE status = 'running' AND started_at < ? ORDER BY started_at ASC, run_id ASC",
      beforeIso,
    );
    return rows.map(toRun);
  }

  /** 完成一筆 run；兒完成全部的單元要不要算 partial 由呼叫端判斷。 */
  finishRun(input: {
    readonly runId: string;
    readonly status: Exclude<DistillationRunStatus, "running">;
    readonly statsJson?: string | null;
    readonly finishedAt?: string;
  }): void {
    this.#db.run(
      `UPDATE distillation_runs
          SET status = ?, stats_json = ?, finished_at = ?
        WHERE run_id = ? AND status = 'running'`,
      input.status,
      input.statsJson ?? null,
      input.finishedAt ?? nowIso(this.#now),
      input.runId,
    );
  }

  // ---- items ----

  upsertItem(input: UpsertDistillationItemInput): DistillationItemRecord {
    const updatedAt = input.updatedAt ?? nowIso(this.#now);
    this.#db.run(
      `INSERT INTO distillation_items
         (run_id, item_key, batch_id, persona, source_card_id, content_hash, output_card_id,
          phase, status, detail_json, undone, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (run_id, item_key) DO UPDATE SET
         batch_id = excluded.batch_id,
         content_hash = COALESCE(excluded.content_hash, distillation_items.content_hash),
         output_card_id = COALESCE(excluded.output_card_id, distillation_items.output_card_id),
         phase = excluded.phase,
         status = excluded.status,
         detail_json = COALESCE(excluded.detail_json, distillation_items.detail_json),
         undone = excluded.undone,
         updated_at = excluded.updated_at`,
      input.runId,
      input.itemKey,
      input.batchId,
      input.persona,
      input.sourceCardId,
      input.contentHash ?? null,
      input.outputCardId ?? null,
      input.phase,
      input.status,
      input.detailJson ?? null,
      input.undone === true ? 1 : 0,
      updatedAt,
    );
    const item = this.getItem(input.runId, input.itemKey);
    if (item === null) {
      throw new Error("寫入蒸餾單元後讀不到，資料庫不一致");
    }
    return item;
  }

  getItem(runId: string, itemKey: string): DistillationItemRecord | null {
    const row = this.#db.get<ItemRow>(
      "SELECT * FROM distillation_items WHERE run_id = ? AND item_key = ?",
      runId,
      itemKey,
    );
    return row === undefined ? null : toItem(row);
  }

  listItems(runId: string): DistillationItemRecord[] {
    return this.#db
      .all<ItemRow>(
        "SELECT * FROM distillation_items WHERE run_id = ? ORDER BY item_key ASC",
        runId,
      )
      .map(toItem);
  }

  listBatchItems(persona: string, batchId: string): DistillationItemRecord[] {
    return this.#db
      .all<ItemRow>(
        "SELECT * FROM distillation_items WHERE persona = ? AND batch_id = ? ORDER BY item_key ASC",
        persona,
        batchId,
      )
      .map(toItem);
  }

  /** 同批次找同一個單元（續跑用）。 */
  findBatchItem(persona: string, batchId: string, itemKey: string): DistillationItemRecord | null {
    const row = this.#db.get<ItemRow>(
      "SELECT * FROM distillation_items WHERE persona = ? AND batch_id = ? AND item_key = ?",
      persona,
      batchId,
      itemKey,
    );
    return row === undefined ? null : toItem(row);
  }

  /**
   * 跨批次找相同內容的已完成產物（去重用）。
   *
   * 排除同一批次、已復原（`undone = 1`）、失敗與沒有輸出卡的紀錄；
   * 以 `output_card_id` 字典序最小者為決定性結果。
   */
  findCrossBatchMatch(input: {
    readonly persona: string;
    readonly contentHash: string;
    readonly excludeBatchId?: string;
  }): DistillationItemRecord | null {
    const row = this.#db.get<ItemRow>(
      `SELECT * FROM distillation_items
        WHERE persona = ? AND content_hash = ? AND status = 'done'
          AND output_card_id IS NOT NULL AND undone = 0
          AND batch_id <> ?
        ORDER BY output_card_id ASC LIMIT 1`,
      input.persona,
      input.contentHash,
      input.excludeBatchId ?? "",
    );
    return row === undefined ? null : toItem(row);
  }

  /** 找出已標記復原的輸出卡；復原後續跑不得重建（設計 §4.4）。 */
  listUndoneOutputs(persona: string): string[] {
    return this.#db
      .all<{ output_card_id: string }>(
        `SELECT output_card_id FROM distillation_items
          WHERE persona = ? AND undone = 1 AND output_card_id IS NOT NULL
          GROUP BY output_card_id`,
        persona,
      )
      .map((row) => row.output_card_id);
  }

  /** 標記某項已復原；復原後續跑不得重建（設計 §4.4）。 */
  markUndone(runId: string, itemKey: string, at?: string): void {
    this.#db.transaction((tx) => this.#markUndoneOn(tx, runId, itemKey, at));
  }

  /** 在既有交易上標記已復原；供復原流程與 run 更新同一交易。 */
  markUndoneIn(tx: Queryable, runId: string, itemKey: string, at?: string): void {
    this.#markUndoneOn(tx, runId, itemKey, at);
  }

  #markUndoneOn(tx: Queryable, runId: string, itemKey: string, at?: string): void {
    tx.run(
      "UPDATE distillation_items SET undone = 1, updated_at = ? WHERE run_id = ? AND item_key = ?",
      at ?? nowIso(this.#now),
      runId,
      itemKey,
    );
  }
}

function toRun(row: RunRow): DistillationRunRecord {
  return {
    runId: row.run_id,
    persona: row.persona,
    day: row.day,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as DistillationRunStatus,
    statsJson: row.stats_json,
  };
}

function toItem(row: ItemRow): DistillationItemRecord {
  return {
    runId: row.run_id,
    itemKey: row.item_key,
    batchId: row.batch_id,
    persona: row.persona,
    sourceCardId: row.source_card_id,
    contentHash: row.content_hash,
    outputCardId: row.output_card_id,
    phase: row.phase as DistillationItemPhase,
    status: row.status as DistillationItemStatus,
    detailJson: row.detail_json,
    undone: row.undone === 1,
    updatedAt: row.updated_at,
  };
}
