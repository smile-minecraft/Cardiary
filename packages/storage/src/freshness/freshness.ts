import { computeFreshness, type FreshnessState } from "@cardiary/domain";

import type { Database } from "../db.js";
import { nowIso } from "../util.js";

/**
 * 卡片新鮮度：讀寫 `card_state` 與 `card_loads`，依規格書第 7 章計算。
 *
 * 卡片檔是正本，新鮮度只存在狀態庫；這裡不碰 `cards/`，所以保鮮、載入
 * 與封存都不會改動卡片檔的位元組。
 *
 * 「孤兒」的判定需要一點歷史：從沒被任何對話引用過的新卡仍照平時衰減，
 * 失去所有引用（`conversation_cards` 被刪）的卡才歸零。兩者都符合「沒有
 * 存活對話引用」的字面條件，但把從未進過對話的卡片立刻歸零會讓手動保鮮
 * 失去意義；M1 以 `card_loads` 是否留有對話載入紀錄區分。
 */

export interface CardFreshnessView {
  readonly cardId: string;
  readonly freshness: number;
  readonly freshnessAt: string;
  readonly pinned: boolean;
  readonly lifecycle: "live" | "cold";
}

export interface FreshnessStoreOptions {
  readonly db: Database;
  readonly now?: () => Date;
  /** 半衰期（天）；可以用 getter 讀設定，呼叫當下才解析。 */
  readonly halfLifeDays?: number | (() => number);
}

export type FreshnessLoadKind = "deal" | "search" | "flip" | "pin" | "manual";

interface CardStateRow {
  readonly freshness: number;
  readonly freshness_at: string;
  readonly pinned: number;
  readonly lifecycle: string;
}

interface RefRow {
  readonly archived_at: string | null;
  readonly purge_at: string | null;
}

interface HistoryRow {
  readonly one: number;
}

interface ContextRow {
  liveConversationCount: number;
  archivedConversationCount: number;
  archivePurgeAt?: string | undefined;
  orphaned: boolean;
}

export class FreshnessStore {
  readonly #db: Database;
  readonly #now: () => Date;
  readonly #halfLifeDays: number | (() => number);

  constructor(options: FreshnessStoreOptions) {
    this.#db = options.db;
    this.#now = options.now ?? (() => new Date());
    this.#halfLifeDays = options.halfLifeDays ?? 30;
  }

  /** 目前的狀態列；沒有資料列時是新卡（100、live）。 */
  get(cardId: string): CardFreshnessView {
    const row = this.#row(cardId);
    if (row === undefined) {
      return {
        cardId,
        freshness: 100,
        freshnessAt: nowIso(this.#now),
        pinned: false,
        lifecycle: "live",
      };
    }
    return {
      cardId,
      freshness: Number(row.freshness),
      freshnessAt: row.freshness_at,
      pinned: row.pinned === 1,
      lifecycle: row.lifecycle === "cold" ? "cold" : "live",
    };
  }

  /** 依目前的引用與封存狀態算出數值；不寫入。 */
  compute(cardId: string, at: string = nowIso(this.#now)): number {
    const row = this.#row(cardId);
    if (row === undefined) {
      return 100;
    }
    return computeFreshness({
      state: stateOf(cardId, row),
      now: at,
      halfLifeDays: this.#halfLife(),
      ...this.#context(cardId),
    });
  }

  /** 算出並寫回；卡片沒有狀態列時不建立，回 100。 */
  recompute(cardId: string, at: string = nowIso(this.#now)): number {
    const row = this.#row(cardId);
    if (row === undefined) {
      return 100;
    }
    const value = this.compute(cardId, at);
    this.#write(cardId, value, at);
    return value;
  }

  /** 全部重新計算一次；啟動與封存狀態變動後呼叫。回傳處理的卡片數。 */
  recomputeAll(at: string = nowIso(this.#now)): number {
    const rows = this.#db.all<{ card_id: string }>(
      "SELECT card_id FROM card_state ORDER BY card_id",
    );
    for (const row of rows) {
      this.recompute(row.card_id, at);
    }
    return rows.length;
  }

  /**
   * 記一次載入；`countsAsLoad` 為真時回滿 100。
   *
   * 搜尋預覽只記引用與載入紀錄，不回滿（規格書第 7 章）。加入引用之前
   * 先留下當下的有效值，避免從線性下降切回平時衰減時回春。
   */
  recordLoad(input: {
    readonly conversationId: string | null;
    readonly cardId: string;
    readonly kind: FreshnessLoadKind;
    readonly countsAsLoad: boolean;
  }): number {
    this.ensure(input.cardId);
    const now = nowIso(this.#now);
    if (input.conversationId !== null) {
      this.anchorBeforeLiveReference(input.cardId, now);
      this.#db.run(
        `INSERT INTO conversation_cards
           (conversation_id, card_id, first_loaded_at, last_loaded_at, load_count)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (conversation_id, card_id) DO UPDATE SET
           last_loaded_at = excluded.last_loaded_at,
           load_count = conversation_cards.load_count + excluded.load_count`,
        input.conversationId,
        input.cardId,
        now,
        now,
        input.countsAsLoad ? 1 : 0,
      );
    }
    this.#db.run(
      `INSERT INTO card_loads (card_id, conversation_id, kind, counts_as_load, loaded_at)
       VALUES (?, ?, ?, ?, ?)`,
      input.cardId,
      input.conversationId,
      input.kind,
      input.countsAsLoad ? 1 : 0,
      now,
    );
    if (input.countsAsLoad) {
      this.#write(input.cardId, 100, now);
      return 100;
    }
    return this.compute(input.cardId, now);
  }

  /** 使用者按「保鮮」：回滿 100。 */
  refresh(cardId: string): number {
    this.ensure(cardId);
    this.#write(cardId, 100, nowIso(this.#now));
    return 100;
  }

  /** 建立卡片時補狀態列；已存在時不動新鮮度。 */
  ensure(cardId: string, persona = "default"): void {
    const now = nowIso(this.#now);
    this.#db.run(
      `INSERT INTO card_state (card_id, persona, freshness, freshness_at, lifecycle, updated_at)
       VALUES (?, ?, 100, ?, 'live', ?)
       ON CONFLICT (card_id) DO NOTHING`,
      cardId,
      persona,
      now,
      now,
    );
  }

  /**
   * 對話封存前，以封存當下的有效值為卡片留下新的錨點。
   *
   * 呼叫端必須在寫入封存狀態**之前**呼叫：那時這張卡的引用規則還是封存前
   * 的樣子，`compute` 算出來的就是使用者當下看到的值。之後 `compute` 看到
   * 封存中的引用就會從這個錨點改走線性下降。
   *
   * 不能用平時衰減直接從舊的錨點重算：卡片可能已經在另一場封存對話的線性
   * 下降中，那樣會把先前的下降還回去，數值看起來回春。
   */
  anchorAfterArchive(cardIds: readonly string[], archivedAt: string): number {
    let changed = 0;
    for (const cardId of cardIds) {
      const row = this.#row(cardId);
      if (row === undefined || row.pinned === 1 || row.lifecycle === "cold") continue;
      const value = this.compute(cardId, archivedAt);
      this.#write(cardId, value, archivedAt);
      changed += 1;
    }
    return changed;
  }

  /**
   * 新的未封存對話開始引用這張卡之前，先把當下的有效值寫成錨點。
   *
   * 卡片只被封存中的對話引用時是線性下降；再加入一個未封存的引用會切回
   * 平時衰減。沒有先留下錨點的話，`compute` 會從上一次寫入的舊值重算，
   * 把線性下降期間掉下來的值還回去，看起來像回春。規則切換只改變之後的
   * 衰減方式，不該改寫已經發生的過去。
   *
   * 已經有未封存引用、或完全沒有封存引用時規則沒有切換，直接回目前值。
   * 呼叫端要在寫入 `conversation_cards` 之前呼叫。
   */
  anchorBeforeLiveReference(cardId: string, at: string = nowIso(this.#now)): number {
    const row = this.#row(cardId);
    if (row === undefined) return 100;
    const value = Number(row.freshness);
    if (row.pinned === 1 || row.lifecycle === "cold") return value;
    const context = this.#context(cardId);
    if (context.liveConversationCount > 0 || context.archivedConversationCount === 0) {
      return value;
    }
    const effective = this.compute(cardId, at);
    this.#write(cardId, effective, at);
    return effective;
  }

  /**
   * 取消封存後，把取消當下的有效值留下來，再回到一般規則。
   *
   * 呼叫端要在清除 `archived_at` **之前**先算好每張卡的值；直接從舊的
   * `freshness_at` 重算會把倒數期間的下降退回去，看起來像瞬間回春。
   */
  resumeAfterUnarchive(
    cards: readonly { readonly cardId: string; readonly value: number }[],
    at: string,
  ): number {
    let changed = 0;
    for (const card of cards) {
      if (this.#row(card.cardId) === undefined) continue;
      this.#write(card.cardId, card.value, at);
      changed += 1;
    }
    return changed;
  }

  /**
   * 倒數結束、對話紀錄刪除後：失去所有引用的卡歸零，其他卡回到一般規則。
   *
   * 釘在白板的卡維持 100；冷封存的卡不動。
   */
  zeroUnreferenced(cardIds: readonly string[], at: string): number {
    let zeroed = 0;
    for (const cardId of cardIds) {
      const row = this.#row(cardId);
      if (row === undefined || row.pinned === 1 || row.lifecycle === "cold") continue;
      const context = this.#context(cardId);
      if (context.liveConversationCount === 0 && context.archivedConversationCount === 0) {
        this.#write(cardId, 0, at);
        zeroed += 1;
      } else {
        this.recompute(cardId, at);
      }
    }
    return zeroed;
  }

  /** 這張卡目前沒有任何對話引用。 */
  isUnreferenced(cardId: string): boolean {
    const context = this.#context(cardId);
    return context.liveConversationCount === 0 && context.archivedConversationCount === 0;
  }

  #row(cardId: string): CardStateRow | undefined {
    return this.#db.get<CardStateRow>(
      "SELECT freshness, freshness_at, pinned, lifecycle FROM card_state WHERE card_id = ?",
      cardId,
    );
  }

  #write(cardId: string, value: number, at: string): void {
    this.#db.run(
      "UPDATE card_state SET freshness = ?, freshness_at = ?, updated_at = ? WHERE card_id = ?",
      value,
      at,
      nowIso(this.#now),
      cardId,
    );
  }

  #context(cardId: string): ContextRow {
    const refs = this.#db.all<RefRow>(
      `SELECT c.archived_at, c.purge_at
       FROM conversation_cards cc
       LEFT JOIN conversations c ON c.conversation_id = cc.conversation_id
       WHERE cc.card_id = ?`,
      cardId,
    );
    let liveConversationCount = 0;
    let archivedConversationCount = 0;
    let archivePurgeAt: string | undefined;
    for (const ref of refs) {
      if (ref.archived_at === null) {
        liveConversationCount += 1;
        continue;
      }
      archivedConversationCount += 1;
      if (ref.purge_at !== null) {
        archivePurgeAt =
          archivePurgeAt === undefined || ref.purge_at < archivePurgeAt
            ? ref.purge_at
            : archivePurgeAt;
      }
    }
    const orphaned =
      liveConversationCount === 0 &&
      archivedConversationCount === 0 &&
      this.#hasConversationHistory(cardId);
    return {
      liveConversationCount,
      archivedConversationCount,
      ...(archivePurgeAt === undefined ? {} : { archivePurgeAt }),
      orphaned,
    };
  }

  /** 有沒有被任何對話載入過；用來區分「新卡」與「失去所有引用的卡」。 */
  #hasConversationHistory(cardId: string): boolean {
    return (
      this.#db.get<HistoryRow>(
        `SELECT 1 AS one FROM card_loads
         WHERE card_id = ? AND conversation_id IS NOT NULL LIMIT 1`,
        cardId,
      ) !== undefined
    );
  }

  #halfLife(): number {
    const value =
      typeof this.#halfLifeDays === "function" ? this.#halfLifeDays() : this.#halfLifeDays;
    return Number.isFinite(value) && value > 0 ? value : 30;
  }
}

function stateOf(cardId: string, row: CardStateRow): FreshnessState {
  return {
    value: Number(row.freshness),
    at: row.freshness_at,
    pinned: row.pinned === 1,
    lifecycle: row.lifecycle === "cold" ? "cold" : "live",
  };
}
