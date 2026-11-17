import type { CardQuery, CardSearchHit } from "@cardiary/domain";
import { CardIndexStore, CardVectorStore, type Database } from "@cardiary/storage";
import type { CardLibrary } from "../cards/library.js";
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

interface ScanResult {
  readonly index: CardIndexStore;
  readonly store: CardVectorStore;
  readonly rows: ReturnType<CardIndexStore["all"]>;
  readonly stored: ReturnType<CardVectorStore["all"]>;
  readonly missing: ReturnType<CardIndexStore["all"]>;
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
  }

  /** 目前的索引狀態；未同意時不開資料庫。 */
  status(): RetrievalStatus {
    if (!this.#allowed()) {
      return { state: "disabled", reason: RETRIEVAL_CONSENT_REASON, fallback: "fts" };
    }
    const scan = this.#scan(this.#database());
    if (scan.missing.length === 0) return { state: "ready" };
    return {
      state: "building",
      phase: "index",
      completed: this.#progress.completed,
      total: scan.missing.length,
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
    const db = this.#database();
    const scan = this.#scan(db);
    if (scan.missing.length > 0 && this.#building === undefined) {
      this.#startRebuild(scan, db);
      return;
    }
    if (scan.missing.length === 0) this.#emitStatus({ state: "ready" });
  }

  async search(query: CardQuery): Promise<readonly CardSearchHit[]> {
    if (!this.#allowed()) {
      this.stop();
      this.#emitStatus({ state: "disabled", reason: RETRIEVAL_CONSENT_REASON, fallback: "fts" });
      return [];
    }
    const db = this.#database();
    const scan = this.#scan(db);
    if (scan.missing.length > 0 && this.#building === undefined) {
      this.#startRebuild(scan, db);
    }
    if (scan.rows.length === 0) return [];
    // 重建期間仍供出 revision 相符的新向量；不相符的卡由全文索引覆蓋。
    return this.#search(db, scan.index, scan.store, query, scan.stored);
  }

  async #search(
    db: Database,
    index: CardIndexStore,
    store: CardVectorStore,
    query: CardQuery,
    stored: ReturnType<CardVectorStore["all"]>,
  ): Promise<readonly CardSearchHit[]> {
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
    const hits: CardSearchHit[] = [];
    for (const storedRow of stored) {
      const row = index.get(storedRow.cardId);
      if (
        row === undefined ||
        row.broken ||
        row.revision !== storedRow.revision ||
        index.supersededBy(row.cardId) !== undefined
      ) {
        continue;
      }
      const summary = this.#library.summaryOf(row);
      if (
        query.kinds !== undefined &&
        query.kinds.length > 0 &&
        !query.kinds.includes(summary.kind)
      ) {
        continue;
      }
      if (query.tags !== undefined && !query.tags.every((tag) => summary.tags.includes(tag))) {
        continue;
      }
      if (storedRow.vector.length !== queryVector.length) continue;
      let score = 0;
      for (let i = 0; i < storedRow.vector.length; i += 1) {
        score += storedRow.vector[i]! * queryVector[i]!;
      }
      hits.push({ card: summary, score, snippet: summary.summary ?? summary.title });
    }
    const ranked = hits
      .sort((a, b) => b.score - a.score || a.card.cardId.localeCompare(b.card.cardId))
      .slice(0, SEARCH_LIMIT);
    // 進結果的卡才更新最近使用時間；淘汰以「最近真的有用」為準。
    store.touch(ranked.map((hit) => hit.card.cardId));
    return ranked;
  }

  #scan(db: Database): ScanResult {
    const index = new CardIndexStore({ db });
    const store = new CardVectorStore(db);
    // 模型不符時會整批刪除舊向量；重建由呼叫端啟動。
    store.selectModel(this.#modelKey);
    const rows = index.all().filter((row) => !row.broken);
    const stored = store.all(this.#modelKey);
    const evicted = store.evictedRevisions();
    const byId = new Map(stored.map((row) => [row.cardId, row]));
    const missing = rows.filter(
      (row) =>
        byId.get(row.cardId)?.revision !== row.revision &&
        evicted.get(row.cardId) !== row.revision,
    );
    return { index, store, rows, stored, missing };
  }

  #startRebuild(scan: ScanResult, db: Database): void {
    const rows = scan.missing;
    this.#progress = { completed: 0, total: rows.length };
    this.#emitStatus({
      state: "building",
      phase: "index",
      completed: 0,
      total: rows.length,
      fallback: "fts",
    });
    const build = this.#rebuild(rows, db);
    this.#building = build;
    void build
      .then((result) => {
        if (this.#building !== build) return;
        if (result === "completed") this.#emitStatus({ state: "ready" });
      })
      .catch((error: unknown) => {
        if (this.#building !== build) return;
        const reason = error instanceof Error ? error.message : String(error);
        this.#warn(reason);
        this.#emitStatus({ state: "degraded", reason, fallback: "fts" });
      })
      .finally(() => {
        // 重建結束後把向量快取壓回容量上限；被淘汰的卡由全文索引覆蓋。
        try {
          new CardVectorStore(db).evictToFit(this.#maxCacheBytes);
        } catch (error) {
          this.#warn(error instanceof Error ? error.message : String(error));
        }
        if (this.#building === build) this.#building = undefined;
      });
  }

  async #rebuild(
    rows: ReturnType<CardIndexStore["all"]>,
    db: Database,
  ): Promise<"completed" | "aborted"> {
    const store = new CardVectorStore(db);
    const index = new CardIndexStore({ db });
    for (const row of rows) {
      if (!this.#allowed() || this.#database() !== db) return "aborted";
      const card = await this.#library.get(row.cardId);
      if (card === null || card.revision !== row.revision) continue;
      const vector = await this.#embedder.embed(
        [
          card.frontmatter.title,
          card.frontmatter.summary ?? "",
          card.body,
          card.frontmatter.tags.join(" "),
        ].join("\n"),
      );
      if (!this.#allowed() || this.#database() !== db) return "aborted";
      if (index.get(row.cardId)?.revision === row.revision) {
        store.put(row.cardId, row.revision, this.#modelKey, vector);
      }
      this.#progress = { ...this.#progress, completed: this.#progress.completed + 1 };
      this.#onProgress?.({ phase: "index", ...this.#progress });
    }
    return "completed";
  }

  #onEmbedderProgress(progress: unknown): void {
    if (typeof progress !== "object" || progress === null) return;
    const record = progress as Record<string, unknown>;
    const loaded = typeof record.loaded === "number" ? record.loaded : undefined;
    const total = typeof record.total === "number" ? record.total : undefined;
    if (loaded === undefined || total === undefined || total <= 0) return;
    this.#onProgress?.({ phase: "download", completed: Math.floor(loaded), total: Math.floor(total) });
  }

  #emitStatus(status: RetrievalStatus): void {
    const key = JSON.stringify(status);
    if (this.#lastStatus === key) return;
    this.#lastStatus = key;
    this.#onStatus?.(status);
  }
}
