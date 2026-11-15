import type { CardLifecycle } from "@cardiary/domain";
import type { Database } from "@cardiary/storage";

/**
 * `state/cardiary.sqlite` 的卡片狀態。
 *
 * 新鮮度、載入紀錄與對話引用都是運行狀態，只存在狀態庫；卡片檔是正本，
 * 這裡的資料不能從檔案重建（見 `docs/design/cards.md` 第 4 節）。
 */

export interface CardStateView {
  readonly freshness: number;
  readonly lifecycle: CardLifecycle;
  readonly pinned: boolean;
  readonly supersededBy?: string;
}

export type CardLoadKind = "deal" | "search" | "flip" | "pin" | "manual";

interface CardStateRow {
  readonly freshness: number;
  readonly lifecycle: string;
  readonly pinned: number;
  readonly superseded_by: string | null;
}

export class CardStateStore {
  readonly #db: () => Database;
  readonly #now: () => Date;

  constructor(options: { readonly db: () => Database; readonly now?: () => Date }) {
    this.#db = options.db;
    this.#now = options.now ?? (() => new Date());
  }

  /** 讀一張卡的狀態；沒有資料列時回預設值（新鮮度 100、live）。 */
  get(cardId: string): CardStateView {
    const row = this.#db().get<CardStateRow>(
      "SELECT freshness, lifecycle, pinned, superseded_by FROM card_state WHERE card_id = ?",
      cardId,
    );
    if (row === undefined) {
      return { freshness: 100, lifecycle: "live", pinned: false };
    }
    return {
      freshness: Number(row.freshness),
      lifecycle: row.lifecycle === "cold" ? "cold" : "live",
      pinned: row.pinned === 1,
      ...(row.superseded_by === null ? {} : { supersededBy: row.superseded_by }),
    };
  }

  /** 建立卡片時補上狀態列；已存在時只更新 persona，不動新鮮度。 */
  ensure(cardId: string, persona: string): void {
    const now = this.#now().toISOString();
    this.#db().run(
      `INSERT INTO card_state (card_id, persona, freshness, freshness_at, lifecycle, updated_at)
       VALUES (?, ?, 100, ?, 'live', ?)
       ON CONFLICT (card_id) DO UPDATE SET persona = excluded.persona, updated_at = excluded.updated_at`,
      cardId,
      persona,
      now,
      now,
    );
  }

  /** 保鮮：新鮮度回滿 100；回傳寫入的值。 */
  refresh(cardId: string, persona = "default"): number {
    this.ensure(cardId, persona);
    const now = this.#now().toISOString();
    this.#db().run(
      `UPDATE card_state SET freshness = 100, freshness_at = ?, updated_at = ? WHERE card_id = ?`,
      now,
      now,
      cardId,
    );
    return 100;
  }

  /** 新卡宣告取代舊卡時，舊卡的狀態列記下 `superseded_by`。 */
  setSupersededBy(oldCardId: string, newCardId: string): void {
    const now = this.#now().toISOString();
    this.#db().run(
      `UPDATE card_state SET superseded_by = ?, updated_at = ? WHERE card_id = ?`,
      newCardId,
      now,
      oldCardId,
    );
  }

  /** 刪卡：狀態列與載入紀錄（外鍵 cascade）一起消失。 */
  remove(cardId: string): void {
    this.#db().run("DELETE FROM card_state WHERE card_id = ?", cardId);
    this.#db().run("DELETE FROM conversation_cards WHERE card_id = ?", cardId);
  }

  /** 對話引用過這張卡；`first_loaded_at` 保留第一次的時間。 */
  recordReference(conversationId: string, cardId: string): void {
    const now = this.#now().toISOString();
    this.#db().run(
      `INSERT INTO conversation_cards (conversation_id, card_id, first_loaded_at, last_loaded_at, load_count)
       VALUES (?, ?, ?, ?, 0)
       ON CONFLICT (conversation_id, card_id) DO UPDATE SET last_loaded_at = excluded.last_loaded_at`,
      conversationId,
      cardId,
      now,
      now,
    );
  }

  /** 記一次載入；同時補上對話引用與 `card_loads`。 */
  recordLoad(
    conversationId: string | null,
    cardId: string,
    kind: CardLoadKind,
    countsAsLoad: boolean,
  ): void {
    this.ensure(cardId, "default");
    const now = this.#now().toISOString();
    if (conversationId !== null) {
      this.#db().run(
        `INSERT INTO conversation_cards (conversation_id, card_id, first_loaded_at, last_loaded_at, load_count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT (conversation_id, card_id) DO UPDATE SET
           last_loaded_at = excluded.last_loaded_at,
           load_count = conversation_cards.load_count + 1`,
        conversationId,
        cardId,
        now,
        now,
      );
    }
    this.#db().run(
      `INSERT INTO card_loads (card_id, conversation_id, kind, counts_as_load, loaded_at)
       VALUES (?, ?, ?, ?, ?)`,
      cardId,
      conversationId,
      kind,
      countsAsLoad ? 1 : 0,
      now,
    );
  }
}
