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

/** 嵌入子行程的最小介面；測試用假實作取代，避免真的下載模型。 */
export interface CardEmbedder {
  embed(text: string): Promise<Float32Array>;
  stop(): void;
  readonly progress?: unknown;
}

const SEARCH_LIMIT = 40;

/** 同意下載後才建立的向量索引；重建與查詢都不能讓全文退路失效。 */
export class CardVectors implements VectorSource {
  readonly #embedder: CardEmbedder;
  #building: Promise<void> | undefined;
  progress = { completed: 0, total: 0 };

  constructor(
    private readonly library: CardLibrary,
    private readonly database: () => Database,
    private readonly allowed: () => boolean,
    spawn: SpawnRegistry,
    cache: string,
    private readonly warn: (message: string) => void,
    private readonly onProgress?: (progress: unknown) => void,
    private readonly modelKey: string = MODEL,
    private readonly maxCacheBytes: number = VECTOR_CACHE_MAX_BYTES,
    embedder?: CardEmbedder,
  ) {
    this.#embedder = embedder ?? new LocalEmbedder(spawn, cache, onProgress);
  }

  stop(): void {
    this.#embedder.stop();
    this.#building = undefined;
  }

  async search(query: CardQuery): Promise<readonly CardSearchHit[]> {
    if (!this.allowed()) {
      this.stop();
      return [];
    }
    const db = this.database();
    const index = new CardIndexStore({ db });
    const store = new CardVectorStore(db);
    store.selectModel(this.modelKey);
    const rows = index.all().filter((row) => !row.broken);
    const stored = store.all(this.modelKey);
    const evicted = store.evictedRevisions();
    const byId = new Map(stored.map((row) => [row.cardId, row]));
    const missing = rows.filter(
      (row) =>
        byId.get(row.cardId)?.revision !== row.revision &&
        evicted.get(row.cardId) !== row.revision,
    );
    if (missing.length > 0 && this.#building === undefined) {
      this.progress = { completed: 0, total: missing.length };
      this.#building = this.#rebuild(missing, db)
        .catch((error: unknown) => {
          this.warn(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          // 重建結束後把向量快取壓回容量上限；被淘汰的卡由全文索引覆蓋。
          try {
            new CardVectorStore(db).evictToFit(this.maxCacheBytes);
          } catch (error) {
            this.warn(error instanceof Error ? error.message : String(error));
          }
          if (this.database() === db) {
            this.#building = undefined;
          }
        });
    }
    if (rows.length === 0) return [];
    // 重建期間仍供出 revision 相符的新向量；不相符的卡由全文索引覆蓋。
    return this.#search(db, index, store, query, stored);
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
      this.warn(error instanceof Error ? error.message : String(error));
      return [];
    }
    if (!this.allowed() || this.database() !== db) {
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
      const summary = this.library.summaryOf(row);
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

  async #rebuild(rows: ReturnType<CardIndexStore["all"]>, db: Database): Promise<void> {
    this.progress = { completed: 0, total: rows.length };
    const store = new CardVectorStore(db);
    const index = new CardIndexStore({ db });
    for (const row of rows) {
      if (!this.allowed() || this.database() !== db) return;
      const card = await this.library.get(row.cardId);
      if (card === null || card.revision !== row.revision) continue;
      const vector = await this.#embedder.embed(
        [
          card.frontmatter.title,
          card.frontmatter.summary ?? "",
          card.body,
          card.frontmatter.tags.join(" "),
        ].join("\n"),
      );
      if (!this.allowed() || this.database() !== db) return;
      if (index.get(row.cardId)?.revision === row.revision) {
        store.put(row.cardId, row.revision, this.modelKey, vector);
      }
      this.progress = { ...this.progress, completed: this.progress.completed + 1 };
      this.onProgress?.({ phase: "index", ...this.progress });
    }
    if (rows.length === 0) {
      store.selectModel(this.modelKey);
    }
  }
}
