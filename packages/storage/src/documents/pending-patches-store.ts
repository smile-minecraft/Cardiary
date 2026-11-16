/**
 * 待決補丁的儲存。
 *
 * 代理提出的修改先進 `pending_card_patches`（state 區，v7 遷移建立），
 * 正本卡片檔在核准前完全不動。接受時由呼叫端重算 revision 比對
 * `baseRevision`，通過才寫正本；拒絕只是把狀態改成 rejected。
 */

import type { PatchText } from "@cardiary/domain";

import type { Database, Queryable } from "../db.js";
import { newUlid } from "../ids.js";
import { nowIso } from "../util.js";

interface PatchRow {
  readonly patch_id: string;
  readonly card_id: string;
  readonly base_revision: string;
  readonly patch_format: string;
  readonly patch_text: string;
  readonly status: string;
  readonly summary: string | null;
  readonly source_conversation_id: string | null;
  readonly source_turn_id: string | null;
  readonly created_at: string;
  readonly decided_at: string | null;
}

export type PendingPatchStatus = "pending" | "accepted" | "rejected";

export interface PendingCardPatch {
  readonly patchId: string;
  readonly cardId: string;
  readonly baseRevision: string;
  readonly patch: PatchText;
  readonly status: PendingPatchStatus;
  readonly summary?: string;
  readonly sourceConversationId?: string;
  readonly sourceTurnId?: string;
  readonly createdAt: string;
  readonly decidedAt?: string;
}

export interface ProposePendingPatchInput {
  readonly cardId: string;
  readonly baseRevision: string;
  readonly patch: PatchText;
  readonly summary?: string;
  readonly sourceConversationId?: string;
  readonly sourceTurnId?: string;
}

export interface ListPendingPatchesOptions {
  readonly cardId?: string;
  /** 省略時回全部狀態；待決清單傳 "pending"。 */
  readonly status?: PendingPatchStatus;
  readonly limit?: number;
}

function toPatch(row: PatchRow): PendingCardPatch {
  return {
    patchId: row.patch_id,
    cardId: row.card_id,
    baseRevision: row.base_revision,
    patch: { format: row.patch_format as PatchText["format"], text: row.patch_text },
    status: row.status as PendingPatchStatus,
    ...(row.summary === null ? {} : { summary: row.summary }),
    ...(row.source_conversation_id === null
      ? {}
      : { sourceConversationId: row.source_conversation_id }),
    ...(row.source_turn_id === null ? {} : { sourceTurnId: row.source_turn_id }),
    createdAt: row.created_at,
    ...(row.decided_at === null ? {} : { decidedAt: row.decided_at }),
  };
}

/** 待決補丁的讀寫；與版本歷史一樣用同步 API。 */
export class PendingPatchesStore {
  readonly #db: Database;
  readonly #now: () => Date;

  constructor(db: Database, options: { readonly now?: () => Date } = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
  }

  /** 提出一筆待決補丁；一律是 pending，呼叫端不能指定別的狀態。 */
  propose(input: ProposePendingPatchInput): PendingCardPatch {
    return this.#db.transaction((tx) => {
      const createdAt = nowIso(this.#now);
      const patchId = `patch_${newUlid(Date.parse(createdAt) || Date.now())}`;
      tx.run(
        `INSERT INTO pending_card_patches
          (patch_id, card_id, base_revision, patch_format, patch_text, status,
           summary, source_conversation_id, source_turn_id, created_at, decided_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, NULL)`,
        patchId,
        input.cardId,
        input.baseRevision,
        input.patch.format,
        input.patch.text,
        input.summary ?? null,
        input.sourceConversationId ?? null,
        input.sourceTurnId ?? null,
        createdAt,
      );
      return this.#require(tx, patchId);
    });
  }

  list(options: ListPendingPatchesOptions = {}): readonly PendingCardPatch[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.cardId !== undefined) {
      clauses.push("card_id = ?");
      params.push(options.cardId);
    }
    if (options.status !== undefined) {
      clauses.push("status = ?");
      params.push(options.status);
    }
    const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
    const limit = options.limit === undefined ? "" : " LIMIT ?";
    if (options.limit !== undefined) params.push(options.limit);
    return this.#db
      .all<PatchRow>(
        `SELECT * FROM pending_card_patches${where} ORDER BY created_at ASC${limit}`,
        ...params,
      )
      .map(toPatch);
  }

  get(patchId: string): PendingCardPatch | null {
    const row = this.#db.get<PatchRow>(
      "SELECT * FROM pending_card_patches WHERE patch_id = ?",
      patchId,
    );
    return row === undefined ? null : toPatch(row);
  }

  /**
   * 標記決定。只有仍在 pending 的補丁會被改；重複決定回 null，避免覆蓋。
   */
  decide(patchId: string, status: "accepted" | "rejected"): PendingCardPatch | null {
    return this.#db.transaction((tx) => {
      const current = tx.get<PatchRow>(
        "SELECT * FROM pending_card_patches WHERE patch_id = ?",
        patchId,
      );
      if (current === undefined || current.status !== "pending") return null;
      tx.run(
        "UPDATE pending_card_patches SET status = ?, decided_at = ? WHERE patch_id = ?",
        status,
        nowIso(this.#now),
        patchId,
      );
      return this.#require(tx, patchId);
    });
  }

  /** 刪卡時呼叫；回傳刪掉的補丁數。 */
  deleteCard(cardId: string): number {
    return this.#db.transaction((tx) => {
      return tx.run("DELETE FROM pending_card_patches WHERE card_id = ?", cardId).changes;
    });
  }

  countPending(cardId?: string): number {
    const row =
      cardId === undefined
        ? this.#db.get<{ n: number }>(
            "SELECT COUNT(*) AS n FROM pending_card_patches WHERE status = 'pending'",
          )
        : this.#db.get<{ n: number }>(
            "SELECT COUNT(*) AS n FROM pending_card_patches WHERE card_id = ? AND status = 'pending'",
            cardId,
          );
    return row?.n ?? 0;
  }

  #require(db: Queryable, patchId: string): PendingCardPatch {
    const row = db.get<PatchRow>("SELECT * FROM pending_card_patches WHERE patch_id = ?", patchId);
    if (row === undefined) throw new Error(`寫入補丁 ${patchId} 後讀不回來`);
    return toPatch(row);
  }
}
