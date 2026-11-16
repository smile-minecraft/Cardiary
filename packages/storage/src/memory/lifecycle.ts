/**
 * 卡片生命週期的封存切換；正本是 `card_state.lifecycle`。
 *
 * 蒸餾只做 `live → cold`（原卡永不刪除）；復原冷封存做 `cold → live`。
 * 卡片檔本身不改任何字元——存活對話已載入的內容位元組不變（驗收條件）。
 */

import { nowIso } from "../util.js";
import type { Database, Queryable } from "../db.js";

export interface CardLifecycleStoreOptions {
  readonly now?: () => Date;
}

export class CardLifecycleStore {
  readonly #db: Database;
  readonly #now: () => Date;

  constructor(db: Database, options: CardLifecycleStoreOptions = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
  }

  /** 回傳成功轉為 `cold` 的卡數（只處理目前是 `live` 的）。 */
  cold(cardIds: readonly string[], at?: string): number {
    if (cardIds.length === 0) return 0;
    const now = at ?? nowIso(this.#now);
    let changed = 0;
    this.#db.transaction((tx) => {
      changed = this.#setLifecycle(tx, cardIds, "cold", now);
    });
    return changed;
  }

  /** 復原冷封存：`cold → live`；回傳成功數。 */
  live(cardIds: readonly string[], at?: string): number {
    if (cardIds.length === 0) return 0;
    const now = at ?? nowIso(this.#now);
    let changed = 0;
    this.#db.transaction((tx) => {
      changed = this.#setLifecycle(tx, cardIds, "live", now);
    });
    return changed;
  }

  #setLifecycle(
    tx: Queryable,
    cardIds: readonly string[],
    lifecycle: "cold" | "live",
    now: string,
  ): number {
    let changed = 0;
    for (const cardId of cardIds) {
      changed += tx.run(
        "UPDATE card_state SET lifecycle = ?, updated_at = ? WHERE card_id = ? AND lifecycle = ?",
        lifecycle,
        now,
        cardId,
        lifecycle === "cold" ? "live" : "cold",
      ).changes;
    }
    return changed;
  }

  getLifecycle(cardId: string): "live" | "cold" | null {
    const row = this.#db.get<{ lifecycle: string }>(
      "SELECT lifecycle FROM card_state WHERE card_id = ?",
      cardId,
    );
    if (row === undefined) return null;
    return row.lifecycle === "cold" ? "cold" : "live";
  }

  /**
   * 挑選蒸餾候選：`live` 且新鮮度歸零的卡，回傳基本欄位給領域層過濾。
   *
   * 格式錯誤、被取代與核心組成員的過濾由領域層與呼叫端完成（這裡不知道核心組，
   * 但可以先過掉 `superseded_by` 與 `persona`）。排除基岩／人格卡由呼叫端用
   * `card_index` 的 kind 處理。
   */
  listFreshnessZeroCandidates(persona: string): ReadonlyArray<{
    readonly cardId: string;
    readonly persona: string;
    readonly freshness: number;
    readonly lifecycle: "live" | "cold";
    readonly supersededBy: string | null;
  }> {
    return this.#db
      .all<{
        card_id: string;
        persona: string;
        freshness: number;
        lifecycle: string;
        superseded_by: string | null;
      }>(
        `SELECT card_id, persona, freshness, lifecycle, superseded_by
           FROM card_state
          WHERE persona = ? AND lifecycle = 'live' AND freshness <= 0
            AND superseded_by IS NULL
          ORDER BY card_id ASC`,
        persona,
      )
      .map((row) => ({
        cardId: row.card_id,
        persona: row.persona,
        freshness: Number(row.freshness),
        lifecycle: row.lifecycle === "cold" ? "cold" : "live",
        supersededBy: row.superseded_by,
      }));
  }
}
