import { newCardId } from "@cardiary/domain";
import type { Database } from "@cardiary/storage";

import type { ImportCategory, ImportSourceKind } from "./types.js";

/**
 * `import_jobs` 與 `import_items` 的存取（`storage.md` 第 12.4 節）。
 *
 * 兩張表在 M1 的 schema 已經建好，匯入模組只寫資料列。內容本身不進資料庫：
 * 寫入時重新掃描來源，`import_items` 只記識別碼、雜湊與結果，所以使用者的
 * 記憶與對話不會多留一份在狀態庫。
 */

export type ImportJobStatus = "preview" | "running" | "completed" | "failed" | "cancelled";
export type ImportItemStatus = "pending" | "written" | "skipped" | "failed";

export interface ImportJob {
  readonly jobId: string;
  readonly sourceKind: ImportSourceKind;
  readonly sourcePath: string;
  readonly status: ImportJobStatus;
  readonly rangeStart?: string;
  readonly rangeEnd?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly reportJson?: string;
}

export interface ImportItem {
  readonly itemKey: string;
  readonly category: ImportCategory;
  readonly contentHash: string;
  readonly cardId?: string;
  readonly status: ImportItemStatus;
  readonly reason?: string;
}

interface JobRow {
  readonly id: string;
  readonly source_kind: string;
  readonly source_path: string;
  readonly status: string;
  readonly range_start: string | null;
  readonly range_end: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly report_json: string | null;
}

interface ItemRow {
  readonly item_key: string;
  readonly category: string;
  readonly content_hash: string;
  readonly card_id: string | null;
  readonly status: string;
  readonly reason: string | null;
}

export class ImportJobStore {
  readonly #db: Database;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(options: {
    readonly db: Database;
    readonly now?: () => Date;
    readonly newId?: () => string;
  }) {
    this.#db = options.db;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? newCardId;
  }

  /** 建立一筆預覽工作；同一個來源可以有很多筆，歷史是使用者的正本。 */
  create(input: {
    readonly sourceKind: ImportSourceKind;
    readonly sourcePath: string;
    readonly rangeStart?: string;
    readonly rangeEnd?: string;
  }): string {
    const jobId = this.#newId();
    const now = this.#now().toISOString();
    this.#db.run(
      `INSERT INTO import_jobs
         (id, source_kind, source_path, status, range_start, range_end, created_at, updated_at)
       VALUES (?, ?, ?, 'preview', ?, ?, ?, ?)`,
      jobId,
      input.sourceKind,
      input.sourcePath,
      input.rangeStart ?? null,
      input.rangeEnd ?? null,
      now,
      now,
    );
    return jobId;
  }

  /** 預覽時重寫這一筆工作的項目清單。 */
  replaceItems(
    jobId: string,
    items: readonly {
      readonly key: string;
      readonly category: ImportCategory;
      readonly contentHash: string;
    }[],
  ): void {
    this.#db.run("DELETE FROM import_items WHERE job_id = ?", jobId);
    for (const item of items) {
      this.#db.run(
        `INSERT INTO import_items (job_id, item_key, content_hash, category, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        jobId,
        item.key,
        item.contentHash,
        item.category,
      );
    }
    this.#touch(jobId);
  }

  /**
   * 預覽當下才有的輸入（例如使用者貼上的人格）。
   *
   * 借用 `report_json` 欄位存到寫入為止，完成時換成結果報告；內容只有
   * 使用者自己在預覽畫面輸入的文字，不含來源資料。
   */
  setPreviewState(jobId: string, state: Record<string, unknown>): void {
    this.#db.run(
      "UPDATE import_jobs SET report_json = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(state),
      this.#now().toISOString(),
      jobId,
    );
  }

  previewState(jobId: string): Record<string, unknown> | undefined {
    const job = this.get(jobId);
    if (job?.reportJson === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(job.reportJson);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  setStatus(jobId: string, status: ImportJobStatus, reportJson?: string): void {
    this.#db.run(
      "UPDATE import_jobs SET status = ?, report_json = COALESCE(?, report_json), updated_at = ? WHERE id = ?",
      status,
      reportJson ?? null,
      this.#now().toISOString(),
      jobId,
    );
  }

  get(jobId: string): ImportJob | undefined {
    const row = this.#db.get<JobRow>("SELECT * FROM import_jobs WHERE id = ?", jobId);
    return row === undefined ? undefined : jobOf(row);
  }

  itemsOf(jobId: string): ImportItem[] {
    return this.#db
      .all<ItemRow>(
        "SELECT item_key, category, content_hash, card_id, status, reason FROM import_items WHERE job_id = ? ORDER BY item_key",
        jobId,
      )
      .map((row) => ({
        itemKey: row.item_key,
        category: row.category as ImportCategory,
        contentHash: row.content_hash,
        ...(row.card_id === null ? {} : { cardId: row.card_id }),
        status: row.status as ImportItemStatus,
        ...(row.reason === null ? {} : { reason: row.reason }),
      }));
  }

  markItem(
    jobId: string,
    itemKey: string,
    result: {
      readonly status: Exclude<ImportItemStatus, "pending">;
      readonly cardId?: string;
      readonly reason?: string;
    },
  ): void {
    this.#db.run(
      `UPDATE import_items SET status = ?, card_id = COALESCE(?, card_id), reason = ?
       WHERE job_id = ? AND item_key = ?`,
      result.status,
      result.cardId ?? null,
      result.reason ?? null,
      jobId,
      itemKey,
    );
  }

  /**
   * 過去任何一筆工作裡寫入過、內容雜湊相同的卡片識別碼（不只一筆，呼叫端要
   * 自己確認卡片檔還在）。使用者刪卡之後這些列仍然留在原本的工作裡，那是
   * 那次匯入的歷史，不該被改寫。
   */
  writtenCardIdsForHash(hash: string): string[] {
    return this.#db
      .all<{ card_id: string | null }>(
        `SELECT DISTINCT card_id FROM import_items
         WHERE content_hash = ? AND status = 'written' AND card_id IS NOT NULL`,
        hash,
      )
      .flatMap((row) => (row.card_id === null ? [] : [row.card_id]));
  }

  /** 使用者刪除匯入紀錄；卡片不動。 */
  delete(jobId: string): void {
    this.#db.run("DELETE FROM import_items WHERE job_id = ?", jobId);
    this.#db.run("DELETE FROM import_jobs WHERE id = ?", jobId);
  }

  #touch(jobId: string): void {
    this.#db.run(
      "UPDATE import_jobs SET updated_at = ? WHERE id = ?",
      this.#now().toISOString(),
      jobId,
    );
  }
}

function jobOf(row: JobRow): ImportJob {
  return {
    jobId: row.id,
    sourceKind: row.source_kind as ImportSourceKind,
    sourcePath: row.source_path,
    status: row.status as ImportJobStatus,
    ...(row.range_start === null ? {} : { rangeStart: row.range_start }),
    ...(row.range_end === null ? {} : { rangeEnd: row.range_end }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.report_json === null ? {} : { reportJson: row.report_json }),
  };
}
