import type { Database, Queryable } from "../db.js";
import { nowIso } from "../util.js";

/**
 * `state/cardiary.sqlite` 的對話與封存狀態。
 *
 * `conversations` 是可重建的附屬資料（引擎的對話紀錄是正本），但封存狀態
 * 不能從引擎重建，所以放在狀態庫。這裡只讀寫自己的表，不碰引擎。
 */

export interface ConversationRecord {
  readonly conversationId: string;
  readonly title: string;
  readonly persona: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastActivityAt: string;
  readonly archivedAt?: string;
  readonly purgeAt?: string;
  readonly archivedBy?: string;
  readonly archiveSummaryCardId?: string;
  readonly pinned: boolean;
}

export interface EnsureConversationInput {
  readonly conversationId: string;
  readonly title?: string;
  readonly persona?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly lastActivityAt?: string;
}

export interface ArchiveConversationInput {
  readonly conversationId: string;
  readonly archivedAt: string;
  readonly purgeAt: string;
  readonly archivedBy?: string;
}

interface ConversationRow {
  readonly conversation_id: string;
  readonly title: string | null;
  readonly persona: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_activity_at: string;
  readonly archived_at: string | null;
  readonly purge_at: string | null;
  readonly archived_by: string | null;
  readonly archive_summary_card_id: string | null;
  readonly pinned: number;
}

interface RefRow {
  readonly conversation_id: string;
}

interface CountRow {
  readonly n: number;
}

/**
 * 對話的封存狀態、對話引用過的卡片與刪除用的列。
 *
 * 「專屬卡片」的判定看這裡：只被指定對話集合引用、且沒有釘在白板。
 * `conversation_cards` 沒有外鍵，所以查詢一律容忍指向不存在對話的列。
 */
export class ConversationStore {
  readonly #db: Database;
  readonly #now: () => Date;

  constructor(options: { readonly db: Database; readonly now?: () => Date }) {
    this.#db = options.db;
    this.#now = options.now ?? (() => new Date());
  }

  /** 建立或更新對話的基本資料；已存在時不覆寫封存欄位。 */
  ensure(input: EnsureConversationInput): ConversationRecord {
    const now = nowIso(this.#now);
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? createdAt;
    const lastActivityAt = input.lastActivityAt ?? updatedAt;
    this.#db.run(
      `INSERT INTO conversations
         (conversation_id, title, persona, created_at, updated_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (conversation_id) DO UPDATE SET
         title = COALESCE(excluded.title, conversations.title),
         updated_at = excluded.updated_at,
         last_activity_at = excluded.last_activity_at`,
      input.conversationId,
      input.title ?? null,
      input.persona ?? "default",
      createdAt,
      updatedAt,
      lastActivityAt,
    );
    return this.get(input.conversationId) as ConversationRecord;
  }

  get(conversationId: string): ConversationRecord | undefined {
    const row = this.#db.get<ConversationRow>(
      "SELECT * FROM conversations WHERE conversation_id = ?",
      conversationId,
    );
    return row === undefined ? undefined : rowToRecord(row);
  }

  /** 所有已到期的封存；依 `purge_at` 由舊到新。 */
  due(now: string): ConversationRecord[] {
    return this.#db
      .all<ConversationRow>(
        `SELECT * FROM conversations
         WHERE archived_at IS NOT NULL AND purge_at IS NOT NULL AND purge_at <= ?
         ORDER BY purge_at, conversation_id`,
        now,
      )
      .map(rowToRecord);
  }

  /** 開始倒數；重複封存同一個對話時更新 `purge_at`，`archived_at` 保留第一次。 */
  archive(input: ArchiveConversationInput): ConversationRecord {
    const now = nowIso(this.#now);
    this.#db.run(
      `INSERT INTO conversations
         (conversation_id, persona, created_at, updated_at, last_activity_at,
          archived_at, purge_at, archived_by)
       VALUES (?, 'default', ?, ?, ?, ?, ?, ?)
       ON CONFLICT (conversation_id) DO UPDATE SET
         archived_at = COALESCE(conversations.archived_at, excluded.archived_at),
         purge_at = excluded.purge_at,
         archived_by = excluded.archived_by,
         updated_at = excluded.updated_at`,
      input.conversationId,
      now,
      now,
      now,
      input.archivedAt,
      input.purgeAt,
      input.archivedBy ?? null,
    );
    return this.get(input.conversationId) as ConversationRecord;
  }

  /** 取消封存；沒有封存時回 false。 */
  unarchive(conversationId: string): boolean {
    const now = nowIso(this.#now);
    const changes = this.#db.run(
      `UPDATE conversations
       SET archived_at = NULL, purge_at = NULL, archived_by = NULL, updated_at = ?
       WHERE conversation_id = ? AND archived_at IS NOT NULL`,
      now,
      conversationId,
    ).changes;
    return changes > 0;
  }

  /** 記下倒數結束時產生的摘要卡；重試時用它避免重複摘要。 */
  setSummaryCard(conversationId: string, cardId: string): void {
    this.#db.run(
      "UPDATE conversations SET archive_summary_card_id = ?, updated_at = ? WHERE conversation_id = ?",
      cardId,
      nowIso(this.#now),
      conversationId,
    );
  }

  /** 對話引用過的所有卡片；含支線以外的所有引用。 */
  referencedCardIds(conversationIds: readonly string[]): string[] {
    if (conversationIds.length === 0) return [];
    const wanted = new Set(conversationIds);
    const rows = this.#db.all<{ card_id: string; conversation_id: string }>(
      "SELECT card_id, conversation_id FROM conversation_cards",
    );
    const cards = new Set<string>();
    for (const row of rows) {
      if (wanted.has(row.conversation_id)) cards.add(row.card_id);
    }
    return [...cards].sort();
  }

  /** 這一組對話的專屬卡片：集合外沒有任何引用，而且沒釘在白板。 */
  exclusiveCardIds(conversationIds: readonly string[]): string[] {
    const wanted = new Set(conversationIds);
    return this.referencedCardIds(conversationIds).filter((cardId) =>
      this.#isExclusive(cardId, wanted),
    );
  }

  /** 同一組對話引用、但不會跟著刪除的卡片（被其他對話引用或釘選）。 */
  sharedCardIds(conversationIds: readonly string[]): string[] {
    const wanted = new Set(conversationIds);
    return this.referencedCardIds(conversationIds).filter(
      (cardId) => !this.#isExclusive(cardId, wanted),
    );
  }

  /** 把所有引用都拿掉之後，這張卡是否只剩這組對話引用。 */
  isExclusiveAfter(cardIds: readonly string[], removedConversations: readonly string[]): string[] {
    const removed = new Set(removedConversations);
    return cardIds.filter((cardId) => this.#isExclusive(cardId, removed));
  }

  /** 這張卡是否只被 `removed` 這組對話引用、且沒釘選。 */
  #isExclusive(cardId: string, removed: ReadonlySet<string>): boolean {
    const refs = this.#db.all<RefRow>(
      "SELECT conversation_id FROM conversation_cards WHERE card_id = ?",
      cardId,
    );
    if (refs.some((row) => !removed.has(row.conversation_id))) {
      return false;
    }
    const state = this.#db.get<{ pinned: number }>(
      "SELECT pinned FROM card_state WHERE card_id = ?",
      cardId,
    );
    return (state?.pinned ?? 0) === 0;
  }

  /**
   * 只拿掉這組對話引用過的卡片列；對話本身保留。
   *
   * 封存倒數結束時用：要讓專屬卡片失去引用並歸零，但對話列必須留到
   * 引擎刪除成功，否則中斷後沒有重試的起點。
   */
  removeCardReferences(conversationIds: readonly string[]): string[] {
    if (conversationIds.length === 0) return [];
    const wanted = new Set(conversationIds);
    const rows = this.#db.all<{ card_id: string; conversation_id: string }>(
      "SELECT card_id, conversation_id FROM conversation_cards",
    );
    const affected = new Set<string>();
    for (const row of rows) {
      if (wanted.has(row.conversation_id)) affected.add(row.card_id);
    }
    for (const conversationId of conversationIds) {
      this.#db.run("DELETE FROM conversation_cards WHERE conversation_id = ?", conversationId);
    }
    return [...affected].sort();
  }

  /**
   * 刪掉這些對話的所有 Cardiary 列；卡片本身不在這裡處理。
   *
   * 順序固定：先刪子表、再刪 `conversations`。回傳刪掉的對話列數。
   */
  deleteConversations(conversationIds: readonly string[], tx?: Queryable): number {
    if (conversationIds.length === 0) return 0;
    const deleteAll = (target: Queryable): number =>
      deleteConversationRows(target, conversationIds).conversations;
    return tx === undefined ? this.#db.transaction(deleteAll) : deleteAll(tx);
  }

  /** 卡片有卡片檔但沒有狀態列時補一列；`CardLibrary` 建立卡片時已會做。 */
  ensureCardState(cardId: string, persona = "default"): void {
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

  /** 這張卡目前的引用數（不管封存狀態）；診斷與測試用。 */
  referenceCount(cardId: string): number {
    const row = this.#db.get<CountRow>(
      "SELECT COUNT(*) AS n FROM conversation_cards WHERE card_id = ?",
      cardId,
    );
    return Number(row?.n ?? 0);
  }
}

/** 一次刪除對話相關列的結果；`deletions.ts` 用它回報實際刪除數。 */
export interface DeletedConversationRows {
  readonly conversations: number;
  readonly conversationCards: number;
  readonly context: number;
  readonly contextEntries: number;
  readonly usage: number;
}

/**
 * 在同一個交易裡刪掉對話、引用、上下文與用量列。
 *
 * 這是刪除意圖的 Cardiary 交易的一部分；呼叫端負責交易與卡片本身。
 */
export function deleteConversationRows(
  target: Queryable,
  conversationIds: readonly string[],
): DeletedConversationRows {
  let conversations = 0;
  let conversationCards = 0;
  let context = 0;
  let contextEntries = 0;
  let usage = 0;
  for (const conversationId of conversationIds) {
    usage += target.run(
      "DELETE FROM conversation_usage WHERE conversation_id = ?",
      conversationId,
    ).changes;
    contextEntries += target.run(
      "DELETE FROM context_entries WHERE conversation_id = ?",
      conversationId,
    ).changes;
    context += target.run(
      "DELETE FROM conversation_context WHERE conversation_id = ?",
      conversationId,
    ).changes;
    conversationCards += target.run(
      "DELETE FROM conversation_cards WHERE conversation_id = ?",
      conversationId,
    ).changes;
    conversations += target.run(
      "DELETE FROM conversations WHERE conversation_id = ?",
      conversationId,
    ).changes;
  }
  return { conversations, conversationCards, context, contextEntries, usage };
}

function rowToRecord(row: ConversationRow): ConversationRecord {
  return {
    conversationId: row.conversation_id,
    title: row.title ?? "",
    persona: row.persona,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
    ...(row.archived_at === null ? {} : { archivedAt: row.archived_at }),
    ...(row.purge_at === null ? {} : { purgeAt: row.purge_at }),
    ...(row.archived_by === null ? {} : { archivedBy: row.archived_by }),
    ...(row.archive_summary_card_id === null
      ? {}
      : { archiveSummaryCardId: row.archive_summary_card_id }),
    pinned: row.pinned === 1,
  };
}
