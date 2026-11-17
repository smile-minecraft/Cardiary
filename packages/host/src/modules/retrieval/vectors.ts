import type { CardKind, CardQuery, CardSearchHit } from "@cardiary/domain";
import {
  CardIndexStore,
  CardVectorStore,
  type CardIndexRow,
  type Database,
} from "@cardiary/storage";
import type { CardLibrary, CardLibraryChange } from "../cards/library.js";
import type { SpawnRegistry } from "../../spawn/wrapper.js";
import type { VectorSource } from "./service.js";
import { LocalEmbedder } from "./embedder.js";
import { EMBEDDING_INDEX_KEY as MODEL } from "./model.js";

const QUERY_PREFIX =
  "Instruct: Given a query about personal notes, retrieve the notes that answer it\nQuery: ";

/** cache/ 裡向量索引的預設容量上限（第 18 章：2 GB）；超過時淘汰最久未用的向量。 */
export const VECTOR_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** 未同意下載模型時的狀態原因碼。 */
export const RETRIEVAL_CONSENT_REASON = "consent-required";

/** 向量索引的可觀察狀態；模組把它送出模組事件。 */
export interface RetrievalStatus {
  readonly state: "disabled" | "building" | "ready" | "degraded";
  /** disabled 時是同意狀態，degraded 時是失敗訊息。 */
  readonly reason?: string;
  readonly phase?: string;
  readonly completed?: number;
  readonly total?: number;
  /** 向量索引不能用時都會退回全文檢索。 */
  readonly fallback?: "fts";
}

/** 進度事件的結構化內容。 */
export interface RetrievalProgress {
  readonly phase: string;
  readonly completed: number;
  readonly total: number;
}

/** 嵌入子行程的最小介面；測試用假實作取代，避免真的下載模型。 */
export interface CardEmbedder {
  embed(text: string): Promise<Float32Array>;
  stop(): void;
  readonly progress?: unknown;
}

export interface CardVectorsOptions {
  readonly library: CardLibrary;
  readonly database: () => Database;
  readonly allowed: () => boolean;
  readonly spawn: SpawnRegistry;
  readonly cache: string;
  readonly warn: (message: string) => void;
  readonly modelKey?: string;
  readonly maxCacheBytes?: number;
  /** 測試用假實作；省略時建立真的嵌入子行程。 */
  readonly embedder?: CardEmbedder;
  readonly onProgress?: (progress: RetrievalProgress) => void;
  readonly onStatus?: (status: RetrievalStatus) => void;
}

const SEARCH_LIMIT = 40;

interface CachedCard {
  readonly row: CardIndexRow;
  readonly tags: readonly string[];
}

interface CachedVector {
  readonly revision: string;
  readonly vector: Float32Array;
}

/**
 * 一次載入的索引快照。
 *
 * 載入之後搜尋只在記憶體裡比對；卡片寫入、模型切換與索引重建透過
 * `cardChanged`／`invalidate` 增量更新或整份重新載入。
 */
interface IndexState {
  readonly db: Database;
  readonly model: string;
  readonly index: CardIndexStore;
  readonly store: CardVectorStore;
  readonly cards: Map<string, CachedCard>;
  readonly vectors: Map<string, CachedVector>;
  /** 目前 revision 被容量淘汰的卡；revision 一變就失效。 */
  evicted: Map<string, string>;
  /** 目的地卡 → 幾張卡宣告取代它；查詢時排除。 */
  readonly supersedes: Map<string, number>;
  /** 還缺目前 revision 向量的卡；不含被容量淘汰的卡。 */
  readonly missing: Set<string>;
}

/** 同意下載後才建立的向量索引；重建與查詢都不能讓全文退路失效。 */
export class CardVectors implements VectorSource {
  readonly #library: CardLibrary;
  readonly #database: () => Database;
  readonly #allowed: () => boolean;
  readonly #spawn: SpawnRegistry;
  readonly #cache: string;
  readonly #warn: (message: string) => void;
  readonly #modelKey: string;
  readonly #maxCacheBytes: number;
  readonly #onProgress: ((progress: RetrievalProgress) => void) | undefined;
  readonly #onStatus: ((status: RetrievalStatus) => void) | undefined;
  readonly #embedder: CardEmbedder;
  #building: Promise<"completed" | "aborted"> | undefined;
  #progress = { completed: 0, total: 0 };
  #lastStatus: string | undefined;
  #state: IndexState | undefined;
  /** 被全文搜尋找到、排回重建的淘汰卡。 */
  readonly #requeued = new Set<string>();
  /** 重建期間有卡片變更；這些卡要在重建結束後接著處理。 */
  readonly #changedDuringBuild = new Set<string>();

  constructor(options: CardVectorsOptions) {
    this.#library = options.library;
    this.#database = options.database;
    this.#allowed = options.allowed;
    this.#spawn = options.spawn;
    this.#cache = options.cache;
    this.#warn = options.warn;
    this.#modelKey = options.modelKey ?? MODEL;
    this.#maxCacheBytes = options.maxCacheBytes ?? VECTOR_CACHE_MAX_BYTES;
    this.#onProgress = options.onProgress;
    this.#onStatus = options.onStatus;
    this.#embedder =
      options.embedder ??
      new LocalEmbedder(this.#spawn, this.#cache, (progress) => {
        this.#onEmbedderProgress(progress);
      });
  }

  stop(): void {
    this.#embedder.stop();
    this.#building = undefined;
    this.#state = undefined;
    this.#requeued.clear();
  }

  /**
   * 卡片寫入後增量更新快照。
   *
   * 索引列已由卡片模組寫好，這裡只重讀這一張卡的列與標籤，不碰其他卡。
   */
  cardChanged(change: CardLibraryChange): void {
    const state = this.#state;
    if (state === undefined) return;
    if (this.#database() !== state.db) {
      this.invalidate();
      return;
    }
    if (change.change === "deleted") {
      this.#forgetCard(state, change.cardId);
      return;
    }
    this.#changedDuringBuild.add(change.cardId);
    const row = state.index.get(change.cardId);
    if (row === undefined) {
      this.#forgetCard(state, change.cardId);
      return;
    }
    const previous = state.cards.get(change.cardId);
    this.#detachSupersedes(state, previous);
    state.cards.set(change.cardId, { row, tags: state.index.tagsOf(change.cardId) });
    if (row.supersedes !== undefined) {
      state.supersedes.set(row.supersedes, (state.supersedes.get(row.supersedes) ?? 0) + 1);
    }
    this.#reconcileVector(state, change.cardId);
    if (state.missing.has(change.cardId)) this.#ensureRebuild(state);
    else this.#emitReadyIfComplete(state);
  }

  /** 索引整份重建後丟掉快照；下一次查詢重新載入。 */
  invalidate(): void {
    this.#state = undefined;
    this.#requeued.clear();
    this.#changedDuringBuild.clear();
    this.#building = undefined;
  }

  /**
   * 全文搜尋找到的卡。
   *
   * 被容量淘汰的卡原本永遠不再重建；只要它還被搜尋到、而且目前允許使用
   * 向量，就排回重建，讓淘汰不等於永久消失。
   */
  noteFullTextHits(cardIds: readonly string[]): void {
    if (!this.#allowed()) return;
    const state = this.#state;
    if (state === undefined) return;
    for (const cardId of cardIds) {
      const record = state.cards.get(cardId);
      if (record === undefined || record.row.broken) continue;
      if (state.vectors.has(cardId)) continue;
      if (state.evicted.get(cardId) !== record.row.revision) continue;
      this.#requeued.add(cardId);
    }
  }

  /** 目前的索引狀態；未同意時不開資料庫。 */
  status(): RetrievalStatus {
    if (!this.#allowed()) {
      return { state: "disabled", reason: RETRIEVAL_CONSENT_REASON, fallback: "fts" };
    }
    const state = this.#ensureLoaded(this.#database());
    if (this.#building !== undefined) {
      return {
        state: "building",
        phase: "index",
        completed: this.#progress.completed,
        total: this.#progress.total,
        fallback: "fts",
      };
    }
    const pending = state.missing.size + this.#requeued.size;
    if (pending === 0) return { state: "ready" };
    return {
      state: "building",
      phase: "index",
      completed: this.#progress.completed,
      total: pending,
      fallback: "fts",
    };
  }

  /**
   * 重新檢查同意狀態與索引完整度，必要時啟動重建並通知狀態。
   *
   * 未同意時只停下來並回報 `disabled`，不會開資料庫或啟動子行程。
   * 模組在啟用時與同意狀態翻轉時呼叫。
   */
  refresh(): void {
    if (!this.#allowed()) {
      this.stop();
      this.#emitStatus({ state: "disabled", reason: RETRIEVAL_CONSENT_REASON, fallback: "fts" });
      return;
    }
    const state = this.#ensureLoaded(this.#database());
    this.#ensureRebuild(state);
    this.#emitReadyIfComplete(state);
  }

  async search(query: CardQuery): Promise<readonly CardSearchHit[]> {
    if (!this.#allowed()) {
      this.stop();
      this.#emitStatus({ state: "disabled", reason: RETRIEVAL_CONSENT_REASON, fallback: "fts" });
      return [];
    }
    const db = this.#database();
    const state = this.#ensureLoaded(db);
    this.#ensureRebuild(state);
    if (state.cards.size === 0) return [];
    // 重建期間仍供出 revision 相符的向量；不相符的卡由全文索引覆蓋。
    let queryVector: Float32Array;
    try {
      queryVector = await this.#embedder.embed(QUERY_PREFIX + (query.query ?? ""));
    } catch (error) {
      this.#warn(error instanceof Error ? error.message : String(error));
      return [];
    }
    if (!this.#allowed() || this.#database() !== db) {
      this.stop();
      return [];
    }
    if (this.#state !== state) return [];
    return this.#rank(state, query, queryVector);
  }

  #rank(state: IndexState, query: CardQuery, queryVector: Float32Array): readonly CardSearchHit[] {
    const hits: Array<{ readonly row: CardIndexRow; readonly score: number }> = [];
    for (const [cardId, record] of state.cards) {
      if (record.row.broken) continue;
      if ((state.supersedes.get(cardId) ?? 0) > 0) continue;
      const cached = state.vectors.get(cardId);
      if (cached === undefined || cached.revision !== record.row.revision) continue;
      if (
        query.kinds !== undefined &&
        query.kinds.length > 0 &&
        !query.kinds.includes(record.row.kind as CardKind)
      ) {
        continue;
      }
      if (query.tags !== undefined && !query.tags.every((tag) => record.tags.includes(tag))) {
        continue;
      }
      if (cached.vector.length !== queryVector.length) continue;
      let score = 0;
      for (let index = 0; index < cached.vector.length; index += 1) {
        score += cached.vector[index]! * queryVector[index]!;
      }
      hits.push({ row: record.row, score });
    }
    const ranked = hits
      .sort((a, b) => b.score - a.score || a.row.cardId.localeCompare(b.row.cardId))
      .slice(0, SEARCH_LIMIT)
      .map((hit) => {
        const summary = this.#library.summaryOf(hit.row);
        return {
          card: summary,
          score: hit.score,
          snippet: summary.summary ?? summary.title,
        };
      });
    // 進結果的卡才更新最近使用時間；淘汰以「最近真的有用」為準。
    state.store.touch(ranked.map((hit) => hit.card.cardId));
    return ranked;
  }

  #ensureLoaded(db: Database): IndexState {
    const existing = this.#state;
    if (existing !== undefined && existing.db === db && existing.model === this.#modelKey) {
      return existing;
    }
    // 連線或模型換了：舊重建若還在跑，讓它在下一個檢查點自行結束。
    if (existing !== undefined) this.#building = undefined;
    this.#requeued.clear();
    const state = this.#load(db);
    this.#state = state;
    return state;
  }

  #load(db: Database): IndexState {
    const index = new CardIndexStore({ db });
    const store = new CardVectorStore(db);
    // 模型不符時會整批刪除舊向量；重建由呼叫端啟動。
    store.selectModel(this.#modelKey);
    const tags = index.tagsByCard();
    const cards = new Map<string, CachedCard>();
    const supersedes = new Map<string, number>();
    for (const row of index.all()) {
      cards.set(row.cardId, { row, tags: tags.get(row.cardId) ?? [] });
      if (row.supersedes !== undefined) {
        supersedes.set(row.supersedes, (supersedes.get(row.supersedes) ?? 0) + 1);
      }
    }
    const vectors = new Map<string, CachedVector>();
    for (const stored of store.all(this.#modelKey)) {
      vectors.set(stored.cardId, { revision: stored.revision, vector: stored.vector });
    }
    const state: IndexState = {
      db,
      model: this.#modelKey,
      index,
      store,
      cards,
      vectors,
      evicted: store.evictedRevisions(),
      supersedes,
      missing: new Set<string>(),
    };
    for (const cardId of cards.keys()) this.#reconcileVector(state, cardId);
    return state;
  }

  /** 用目前 revision 與 evicted 標記決定這張卡還缺不缺向量。 */
  #reconcileVector(state: IndexState, cardId: string): void {
    const record = state.cards.get(cardId);
    if (record === undefined || record.row.broken) {
      state.missing.delete(cardId);
      return;
    }
    const revision = record.row.revision;
    const cached = state.vectors.get(cardId);
    if (cached !== undefined && cached.revision === revision) {
      state.missing.delete(cardId);
      return;
    }
    if (cached !== undefined) state.vectors.delete(cardId);
    if (state.evicted.get(cardId) === revision) state.missing.delete(cardId);
    else state.missing.add(cardId);
  }

  #forgetCard(state: IndexState, cardId: string): void {
    const previous = state.cards.get(cardId);
    this.#detachSupersedes(state, previous);
    state.cards.delete(cardId);
    state.vectors.delete(cardId);
    state.missing.delete(cardId);
    state.evicted.delete(cardId);
    this.#requeued.delete(cardId);
  }

  #detachSupersedes(state: IndexState, previous: CachedCard | undefined): void {
    const target = previous?.row.supersedes;
    if (target === undefined) return;
    const count = (state.supersedes.get(target) ?? 0) - 1;
    if (count > 0) state.supersedes.set(target, count);
    else state.supersedes.delete(target);
  }

  #ensureRebuild(state: IndexState): void {
    if (this.#building !== undefined) return;
    const cards = new Set<string>();
    for (const cardId of state.missing) {
      if (state.cards.has(cardId)) cards.add(cardId);
    }
    for (const cardId of this.#requeued) {
      if (state.cards.has(cardId)) cards.add(cardId);
    }
    if (cards.size === 0) return;
    this.#requeued.clear();
    this.#startRebuild(state, [...cards]);
  }

  #startRebuild(state: IndexState, cardIds: readonly string[]): void {
    this.#progress = { completed: 0, total: cardIds.length };
    this.#emitStatus({
      state: "building",
      phase: "index",
      completed: 0,
      total: cardIds.length,
      fallback: "fts",
    });
    const build = this.#rebuild(state, cardIds);
    this.#building = build;
    void build
      .then((result) => {
        if (this.#building !== build) return;
        if (result === "completed") this.#emitReadyIfComplete(state);
      })
      .catch((error: unknown) => {
        if (this.#building !== build) return;
        if (this.#state !== state) return;
        const reason = error instanceof Error ? error.message : String(error);
        this.#warn(reason);
        this.#emitStatus({ state: "degraded", reason, fallback: "fts" });
      })
      .finally(() => {
        // 重建結束後把向量快取壓回容量上限；被淘汰的卡由全文索引覆蓋。
        try {
          state.store.evictToFit(this.#maxCacheBytes);
          this.#syncEvicted(state);
        } catch (error) {
          this.#warn(error instanceof Error ? error.message : String(error));
        }
        if (this.#building !== build) return;
        this.#building = undefined;
        if (this.#state !== state) return;
        // 只自動接著處理重建期間到的變更；失敗的卡留到下一次查詢再試，
        // 不要在失敗後無限重建。
        const changed = [...this.#changedDuringBuild];
        this.#changedDuringBuild.clear();
        if (changed.length > 0) this.#ensureRebuild(state);
        this.#emitReadyIfComplete(state);
      });
  }

  async #rebuild(state: IndexState, cardIds: readonly string[]): Promise<"completed" | "aborted"> {
    for (const cardId of cardIds) {
      if (!this.#allowed() || this.#database() !== state.db || this.#state !== state) {
        return "aborted";
      }
      const record = state.cards.get(cardId);
      if (record === undefined || record.row.broken) continue;
      const card = await this.#library.get(cardId);
      if (card === null || card.revision !== record.row.revision) continue;
      const vector = await this.#embedder.embed(
        [
          card.frontmatter.title,
          card.frontmatter.summary ?? "",
          card.body,
          card.frontmatter.tags.join(" "),
        ].join("\n"),
      );
      if (!this.#allowed() || this.#database() !== state.db || this.#state !== state) {
        return "aborted";
      }
      const current = state.cards.get(cardId);
      if (current !== undefined && current.row.revision === card.revision) {
        state.store.put(cardId, card.revision, this.#modelKey, vector);
        state.vectors.set(cardId, { revision: card.revision, vector });
        state.missing.delete(cardId);
        this.#requeued.delete(cardId);
      }
      this.#progress = { ...this.#progress, completed: this.#progress.completed + 1 };
      this.#onProgress?.({ phase: "index", ...this.#progress });
    }
    return "completed";
  }

  /** 淘汰後讓記憶體快照與資料庫一致。 */
  #syncEvicted(state: IndexState): void {
    state.evicted = state.store.evictedRevisions();
    for (const [cardId, revision] of state.evicted) {
      const cached = state.vectors.get(cardId);
      if (cached !== undefined && cached.revision === revision) state.vectors.delete(cardId);
    }
    for (const cardId of state.cards.keys()) this.#reconcileVector(state, cardId);
  }

  #emitReadyIfComplete(state: IndexState): void {
    if (this.#state !== state || this.#building !== undefined) return;
    if (state.missing.size === 0 && this.#requeued.size === 0) {
      this.#emitStatus({ state: "ready" });
    }
  }

  #onEmbedderProgress(progress: unknown): void {
    if (typeof progress !== "object" || progress === null) return;
    const record = progress as Record<string, unknown>;
    const loaded = typeof record.loaded === "number" ? record.loaded : undefined;
    const total = typeof record.total === "number" ? record.total : undefined;
    if (loaded === undefined || total === undefined || total <= 0) return;
    this.#onProgress?.({
      phase: "download",
      completed: Math.floor(loaded),
      total: Math.floor(total),
    });
  }

  #emitStatus(status: RetrievalStatus): void {
    const key = JSON.stringify(status);
    if (this.#lastStatus === key) return;
    this.#lastStatus = key;
    this.#onStatus?.(status);
  }
}
