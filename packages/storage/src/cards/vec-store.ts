import type { Database } from "../db.js";

export interface StoredVector {
  readonly cardId: string;
  readonly revision: string;
  readonly vector: Float32Array;
}

export interface EvictionResult {
  readonly removed: number;
  readonly freedBytes: number;
}

/** sqlite 每筆記錄標頭的估算開銷，用於位元組估算。 */
const ROW_HEADER_BYTES = 30;

/**
 * 向量快取（`cache/index.sqlite` 的 `vec_cards`）與它的兩張附屬表。
 *
 * - `vec_cards_usage`：每張卡最後一次「被用來回答查詢」的時間，用來做
 *   容量淘汰（LRU）。只有進入回傳結果的卡才更新，避免每次查詢把全部
 *   向量都標記成最近使用。
 * - `vec_cards_evicted`：被容量淘汰的卡記錄下來，避免下一次查詢把它
 *   當成「索引缺這張卡」整批重建。記錄帶 `revision`：卡片被編輯後，
 *   標記自動失效，這張卡重新進入缺索引的集合。
 */
export class CardVectorStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS vec_cards (
      card_id TEXT PRIMARY KEY, model TEXT NOT NULL, revision TEXT NOT NULL,
      vector BLOB NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS vec_cards_usage (
      card_id TEXT PRIMARY KEY, last_used_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS vec_cards_evicted (
      card_id TEXT PRIMARY KEY, revision TEXT NOT NULL, evicted_at INTEGER NOT NULL
    ) STRICT;`);
  }

  selectModel(model: string): void {
    this.db.transaction((tx) => {
      const previous = tx.get<{ value: string }>(
        "SELECT value FROM card_index_meta WHERE key = ?",
        "embedding.model",
      );
      if (previous?.value !== model) {
        tx.run("DELETE FROM vec_cards");
        tx.run("DELETE FROM vec_cards_usage");
        tx.run("DELETE FROM vec_cards_evicted");
        tx.run(
          "INSERT INTO card_index_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
          "embedding.model",
          model,
        );
      }
    });
  }

  put(
    cardId: string,
    revision: string,
    model: string,
    vector: Float32Array,
    now: number = this.now(),
  ): void {
    this.db.transaction((tx) => {
      tx.run(
        "INSERT INTO vec_cards (card_id, model, revision, vector) VALUES (?, ?, ?, ?) ON CONFLICT(card_id) DO UPDATE SET model=excluded.model, revision=excluded.revision, vector=excluded.vector",
        cardId,
        model,
        revision,
        Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
      );
      tx.run("DELETE FROM vec_cards_evicted WHERE card_id = ?", cardId);
      tx.run(
        "INSERT INTO vec_cards_usage (card_id, last_used_at) VALUES (?, ?) ON CONFLICT (card_id) DO UPDATE SET last_used_at = excluded.last_used_at",
        cardId,
        now,
      );
    });
  }

  all(model: string): StoredVector[] {
    return this.db
      .all<{ card_id: string; revision: string; vector: Uint8Array }>(
        "SELECT card_id, revision, vector FROM vec_cards WHERE model = ? ORDER BY card_id",
        model,
      )
      .map((row) => ({
        cardId: row.card_id,
        revision: row.revision,
        vector: new Float32Array(
          row.vector.buffer.slice(
            row.vector.byteOffset,
            row.vector.byteOffset + row.vector.byteLength,
          ),
        ),
      }));
  }

  /** 目前向量列佔用的估算位元組數（向量本身 + 文字欄位 + 記錄標頭）。 */
  estimateBytes(): number {
    const row = this.db.get<{ bytes: number | null }>(
      `SELECT COALESCE(SUM(
         LENGTH(vector) + LENGTH(card_id) + LENGTH(model) + LENGTH(revision) + ${ROW_HEADER_BYTES}
       ), 0) AS bytes FROM vec_cards`,
    );
    return Number(row?.bytes ?? 0);
  }

  /** 被淘汰卡的 `revision`；`search` 用它避開整批重建，卡片被編輯時標記失效。 */
  evictedRevisions(): Map<string, string> {
    const rows = this.db.all<{ card_id: string; revision: string }>(
      "SELECT card_id, revision FROM vec_cards_evicted",
    );
    return new Map(rows.map((row) => [row.card_id, row.revision]));
  }

  /** 把一批卡標記為最近使用；進回傳結果的卡才呼叫，不更新未用到的列。 */
  touch(cardIds: readonly string[], now: number = this.now()): void {
    if (cardIds.length === 0) return;
    this.db.transaction((tx) => {
      for (const cardId of cardIds) {
        tx.run(
          "INSERT INTO vec_cards_usage (card_id, last_used_at) VALUES (?, ?) ON CONFLICT (card_id) DO UPDATE SET last_used_at = excluded.last_used_at",
          cardId,
          now,
        );
      }
    });
  }

  /**
   * 淘汰最久未使用的向量，直到估算位元組數不超過 `maxBytes`。
   *
   * 一次列出待刪的卡與它們的位元組估算、交易內逐批刪除；被刪的卡寫入
   * `vec_cards_evicted` 標記，全文索引仍覆蓋它們。
   */
  evictToFit(maxBytes: number, now: number = this.now()): EvictionResult {
    let removed = 0;
    let freedBytes = 0;
    for (;;) {
      const current = this.estimateBytes();
      const excess = current - maxBytes;
      if (excess <= 0) break;
      const candidates = this.db.all<{ card_id: string; revision: string; bytes: number }>(
        `SELECT v.card_id AS card_id, v.revision AS revision,
                LENGTH(v.vector) + LENGTH(v.card_id) + LENGTH(v.model) + LENGTH(v.revision) + ${ROW_HEADER_BYTES} AS bytes
           FROM vec_cards v
           LEFT JOIN vec_cards_usage u ON u.card_id = v.card_id
          ORDER BY COALESCE(u.last_used_at, 0) ASC`,
      );
      if (candidates.length === 0) break;
      const victims: typeof candidates = [];
      let batchBytes = 0;
      for (const candidate of candidates) {
        victims.push(candidate);
        batchBytes += candidate.bytes;
        if (batchBytes >= excess) break;
      }
      this.db.transaction((tx) => {
        for (const victim of victims) {
          tx.run("DELETE FROM vec_cards WHERE card_id = ?", victim.card_id);
          tx.run(
            "INSERT INTO vec_cards_evicted (card_id, revision, evicted_at) VALUES (?, ?, ?) ON CONFLICT (card_id) DO UPDATE SET revision = excluded.revision, evicted_at = excluded.evicted_at",
            victim.card_id,
            victim.revision,
            now,
          );
          tx.run("DELETE FROM vec_cards_usage WHERE card_id = ?", victim.card_id);
        }
      });
      removed += victims.length;
      freedBytes += victims.reduce((sum, victim) => sum + victim.bytes, 0);
    }
    return { removed, freedBytes };
  }
}
