import type { CardQuery, CardSearchHit } from "@cardiary/domain";
import { CardIndexStore, CardVectorStore, type Database } from "@cardiary/storage";
import type { CardLibrary } from "../cards/library.js";
import type { SpawnRegistry } from "../../spawn/wrapper.js";
import type { VectorSource } from "./service.js";
import { LocalEmbedder } from "./embedder.js";
import { EMBEDDING_INDEX_KEY as MODEL } from "./model.js";

const QUERY_PREFIX =
  "Instruct: Given a query about personal notes, retrieve the notes that answer it\nQuery: ";

/** 同意下載後才建立的向量索引；重建與查詢都不能讓全文退路失效。 */
export class CardVectors implements VectorSource {
  readonly #embedder: LocalEmbedder;
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
  ) {
    this.#embedder = new LocalEmbedder(spawn, cache, onProgress);
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
    store.selectModel(MODEL);
    const rows = index.all().filter((row) => !row.broken);
    const byId = new Map(store.all(MODEL).map((row) => [row.cardId, row]));
    const missing = rows.filter((row) => byId.get(row.cardId)?.revision !== row.revision);
    if (missing.length > 0) {
      if (this.#building === undefined) {
        this.progress = { completed: 0, total: missing.length };
        this.#building = this.#rebuild(missing, db)
          .catch((error: unknown) => {
            this.warn(error instanceof Error ? error.message : String(error));
          })
          .finally(() => {
            if (this.database() === db) {
              this.#building = undefined;
            }
          });
      }
      return [];
    }
    if (rows.length === 0) return [];
    return this.#search(db, index, store, query);
  }

  async #search(
    db: Database,
    index: CardIndexStore,
    store: CardVectorStore,
    query: CardQuery,
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
    for (const stored of store.all(MODEL)) {
      const row = index.get(stored.cardId);
      if (
        row === undefined ||
        row.broken ||
        row.revision !== stored.revision ||
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
      if (stored.vector.length !== queryVector.length) continue;
      let score = 0;
      for (let i = 0; i < stored.vector.length; i += 1) {
        score += stored.vector[i]! * queryVector[i]!;
      }
      hits.push({ card: summary, score, snippet: summary.summary ?? summary.title });
    }
    return hits
      .sort((a, b) => b.score - a.score || a.card.cardId.localeCompare(b.card.cardId))
      .slice(0, 40);
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
        store.put(row.cardId, row.revision, MODEL, vector);
      }
      this.progress = { ...this.progress, completed: this.progress.completed + 1 };
      this.onProgress?.({ phase: "index", ...this.progress });
    }
    if (rows.length === 0) {
      store.selectModel(MODEL);
    }
  }
}
