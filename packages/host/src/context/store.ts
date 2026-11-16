/**
 * 上下文的狀態庫：`conversation_context`、`context_entries` 與
 * `conversation_usage` 的讀寫。
 *
 * 這一層只做資料列的映射，不決定什麼時候變動；組裝、壓縮與協定的規則
 * 在 `assembler.ts`、`compactor.ts` 與 `service.ts`。
 */

import type {
  ContextDealSource,
  ContextEntry,
  ContextLayer,
  ContextEntryState,
} from "@cardiary/domain";
import type { Database } from "@cardiary/storage";

interface DealFields {
  readonly dealProbability?: number;
  readonly dealSource?: ContextDealSource;
}

/** `conversation_context` 的一列。 */
export interface ContextRecord {
  readonly conversationId: string;
  readonly version: number;
  readonly usedTokens: number;
  readonly budgetTokens: number;
  readonly contextWindow: number;
  readonly compactionThreshold: number;
  readonly reserveTokens: number;
  readonly compactionInProgress: boolean;
  readonly lastCompactedAt?: string;
}

/** 建立或更新 `conversation_context` 的預設值。 */
export interface ContextDefaults {
  readonly contextWindow: number;
  readonly budgetTokens: number;
  readonly compactionThreshold: number;
  readonly reserveTokens: number;
}

/** 一次寫入的用量。 */
export interface UsageRecord {
  readonly conversationId: string;
  readonly turnId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly requestTokens: number;
  readonly recordedAt: string;
}

interface ContextRow {
  readonly conversation_id: string;
  readonly version: number;
  readonly used_tokens: number;
  readonly budget_tokens: number;
  readonly context_window: number;
  readonly compaction_threshold: number;
  readonly reserve_tokens: number;
  readonly compaction_in_progress: number;
  readonly last_compacted_at: string | null;
}

interface EntryRow {
  readonly entry_id: string;
  readonly conversation_id: string;
  readonly layer: string;
  readonly card_id: string | null;
  readonly title: string;
  readonly token_estimate: number;
  readonly state: string;
  readonly position: number;
  readonly added_at: string;
}

interface UsageRow {
  readonly conversation_id: string;
  readonly turn_id: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_read_tokens: number;
  readonly cache_write_tokens: number;
  readonly request_tokens: number;
  readonly recorded_at: string;
}

/** 狀態庫的存取；呼叫端負責開連線與關連線。 */
export class ContextStore {
  readonly #db: Database;
  readonly #now: () => Date;
  /**
   * 發牌欄位的行程內覆蓋層。v3 遷移（已合併）沒有加這兩欄，所以真實的
   * `context_entries` 還沒有 deal_probability / deal_source。在遷移補上之前，
   * 用這層讓同一個行程內的視圖（含開局當下與後續 assemble）帶得到機率；
   * 重開行程後這層消失，所以在 PR 標明「機率不跨重啟」。
   */
  readonly #dealOverlay = new Map<string, DealFields>();

  constructor(db: Database, options: { readonly now?: () => Date } = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
  }

  /** 確保這一場對話有上下文列；回傳目前的列。 */
  ensure(conversationId: string, defaults: ContextDefaults): ContextRecord {
    const now = this.#now().toISOString();
    this.#db.run(
      `INSERT INTO conversation_context (
         conversation_id, version, used_tokens, budget_tokens, context_window,
         compaction_threshold, reserve_tokens, compaction_in_progress, updated_at
       ) VALUES (?, 0, 0, ?, ?, ?, ?, 0, ?)
       ON CONFLICT (conversation_id) DO NOTHING`,
      conversationId,
      defaults.budgetTokens,
      defaults.contextWindow,
      defaults.compactionThreshold,
      defaults.reserveTokens,
      now,
    );
    const row = this.#db.get<ContextRow>(
      "SELECT * FROM conversation_context WHERE conversation_id = ?",
      conversationId,
    );
    if (row === undefined) {
      throw new Error(`建立上下文列失敗：${conversationId}`);
    }
    return recordOf(row);
  }

  /** 讀取上下文列；不存在時回 `null`。 */
  read(conversationId: string): ContextRecord | null {
    const row = this.#db.get<ContextRow>(
      "SELECT * FROM conversation_context WHERE conversation_id = ?",
      conversationId,
    );
    return row === undefined ? null : recordOf(row);
  }

  /** 列出中斷的壓縮；啟動時補做或放棄。 */
  interrupted(): readonly string[] {
    return this.#db
      .all<{ readonly conversation_id: string }>(
        "SELECT conversation_id FROM conversation_context WHERE compaction_in_progress = 1",
      )
      .map((row) => row.conversation_id);
  }

  /** 更新用量與視圖的欄位；`version` 只在呼叫端要加時才傳。 */
  updateMetrics(
    conversationId: string,
    input: {
      readonly version?: number;
      readonly usedTokens: number;
      readonly budgetTokens: number;
      readonly contextWindow: number;
      readonly compactionThreshold: number;
      readonly reserveTokens: number;
      readonly lastCompactedAt?: string | null;
    },
  ): void {
    const row = this.read(conversationId);
    if (row === null) return;
    this.#db.run(
      `UPDATE conversation_context SET
         version = ?, used_tokens = ?, budget_tokens = ?, context_window = ?,
         compaction_threshold = ?, reserve_tokens = ?, last_compacted_at = ?, updated_at = ?
       WHERE conversation_id = ?`,
      input.version ?? row.version,
      input.usedTokens,
      input.budgetTokens,
      input.contextWindow,
      input.compactionThreshold,
      input.reserveTokens,
      input.lastCompactedAt === undefined ? (row.lastCompactedAt ?? null) : input.lastCompactedAt,
      this.#now().toISOString(),
      conversationId,
    );
  }

  /** 標記或清除「壓縮進行中」。 */
  setCompactionInProgress(conversationId: string, inProgress: boolean): void {
    this.#db.run(
      "UPDATE conversation_context SET compaction_in_progress = ?, updated_at = ? WHERE conversation_id = ?",
      inProgress ? 1 : 0,
      this.#now().toISOString(),
      conversationId,
    );
  }

  /** 這一場對話的項目，依層與順序排列。 */
  entries(conversationId: string): ContextEntry[] {
    return this.#db
      .all<EntryRow>(
        "SELECT * FROM context_entries WHERE conversation_id = ? ORDER BY position",
        conversationId,
      )
      .map((row) => this.#withDeal(entryOf(row)));
  }

  /** 加入一個項目；重複的 `entryId` 直接覆蓋。 */
  addEntry(conversationId: string, entry: ContextEntry): void {
    const deal: DealFields = {
      ...(entry.dealProbability === undefined ? {} : { dealProbability: entry.dealProbability }),
      ...(entry.dealSource === undefined ? {} : { dealSource: entry.dealSource }),
    };
    if (deal.dealProbability !== undefined || deal.dealSource !== undefined) {
      this.#dealOverlay.set(entry.entryId, deal);
    } else {
      this.#dealOverlay.delete(entry.entryId);
    }
    this.#db.run(
      `INSERT INTO context_entries (
         entry_id, conversation_id, layer, card_id, title, token_estimate, state, position, added_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (entry_id) DO UPDATE SET
         layer = excluded.layer,
         card_id = excluded.card_id,
         title = excluded.title,
         token_estimate = excluded.token_estimate,
         state = excluded.state,
         position = excluded.position`,
      entry.entryId,
      conversationId,
      entry.layer,
      entry.cardId ?? null,
      entry.title,
      entry.tokenEstimate,
      entry.state,
      entry.position,
      this.#now().toISOString(),
    );
  }

  /** 改項目的估算與狀態。 */
  updateEntry(
    entryId: string,
    input: {
      readonly tokenEstimate?: number;
      readonly state?: ContextEntryState;
      readonly title?: string;
      readonly position?: number;
    },
  ): void {
    const row = this.#db.get<EntryRow>("SELECT * FROM context_entries WHERE entry_id = ?", entryId);
    if (row === undefined) return;
    this.#db.run(
      `UPDATE context_entries SET token_estimate = ?, state = ?, title = ?, position = ? WHERE entry_id = ?`,
      input.tokenEstimate ?? row.token_estimate,
      input.state ?? row.state,
      input.title ?? row.title,
      input.position ?? row.position,
      entryId,
    );
  }

  /** 標記移除；下一次壓縮才真的刪除。 */
  markPendingRemoval(entryId: string, at: string): void {
    this.#db.run(
      "UPDATE context_entries SET state = 'pending-removal', removed_requested_at = ? WHERE entry_id = ?",
      at,
      entryId,
    );
  }

  /** 刪掉所有已標記移除的項目；回傳刪除數量。 */
  deletePendingRemovals(conversationId: string): number {
    const result = this.#db.run(
      "DELETE FROM context_entries WHERE conversation_id = ? AND state = 'pending-removal'",
      conversationId,
    );
    return Number(result.changes);
  }

  /** 刪掉一個項目；卡片被刪除時使用。 */
  deleteEntry(entryId: string): void {
    this.#dealOverlay.delete(entryId);
    this.#db.run("DELETE FROM context_entries WHERE entry_id = ?", entryId);
  }

  /** 一張卡在這場對話的項目。 */
  entryOfCard(conversationId: string, cardId: string): ContextEntry | null {
    const row = this.#db.get<EntryRow>(
      "SELECT * FROM context_entries WHERE conversation_id = ? AND card_id = ? LIMIT 1",
      conversationId,
      cardId,
    );
    return row === undefined ? null : this.#withDeal(entryOf(row));
  }

  /** 某一層的項目。 */
  entriesOfLayer(conversationId: string, layer: ContextLayer): ContextEntry[] {
    return this.entries(conversationId).filter((entry) => entry.layer === layer);
  }

  /** 記一輪用量；同一場對話的同一個回合只留一筆。 */
  recordUsage(usage: UsageRecord): void {
    this.#db.run(
      `INSERT INTO conversation_usage (
         conversation_id, turn_id, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, request_tokens, recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (conversation_id, turn_id) DO UPDATE SET
         input_tokens = excluded.input_tokens,
         output_tokens = excluded.output_tokens,
         cache_read_tokens = excluded.cache_read_tokens,
         cache_write_tokens = excluded.cache_write_tokens,
         request_tokens = excluded.request_tokens,
         recorded_at = excluded.recorded_at`,
      usage.conversationId,
      usage.turnId,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadTokens,
      usage.cacheWriteTokens,
      usage.requestTokens,
      usage.recordedAt,
    );
  }

  /** 最近一輪的用量；沒有時回 `null`。 */
  latestUsage(conversationId: string): UsageRecord | null {
    const row = this.#db.get<UsageRow>(
      `SELECT * FROM conversation_usage WHERE conversation_id = ?
       ORDER BY recorded_at DESC, id DESC LIMIT 1`,
      conversationId,
    );
    if (row === undefined) return null;
    return {
      conversationId: row.conversation_id,
      turnId: row.turn_id,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      requestTokens: row.request_tokens,
      recordedAt: row.recorded_at,
    };
  }

  /** 讀取時補上進程內的發牌欄位；pagination 的每一列都走這裡。 */
  #withDeal(entry: ContextEntry): ContextEntry {
    const deal = this.#dealOverlay.get(entry.entryId);
    if (deal === undefined) return entry;
    return {
      ...entry,
      ...(deal.dealProbability === undefined ? {} : { dealProbability: deal.dealProbability }),
      ...(deal.dealSource === undefined ? {} : { dealSource: deal.dealSource }),
    };
  }
}

function recordOf(row: ContextRow): ContextRecord {
  return {
    conversationId: row.conversation_id,
    version: row.version,
    usedTokens: row.used_tokens,
    budgetTokens: row.budget_tokens,
    contextWindow: row.context_window,
    compactionThreshold: row.compaction_threshold,
    reserveTokens: row.reserve_tokens,
    compactionInProgress: row.compaction_in_progress === 1,
    ...(row.last_compacted_at === null ? {} : { lastCompactedAt: row.last_compacted_at }),
  };
}

function entryOf(row: EntryRow): ContextEntry {
  return {
    entryId: row.entry_id,
    layer: row.layer as ContextLayer,
    ...(row.card_id === null ? {} : { cardId: row.card_id }),
    title: row.title,
    tokenEstimate: row.token_estimate,
    state: row.state as ContextEntryState,
    position: row.position,
  };
}
