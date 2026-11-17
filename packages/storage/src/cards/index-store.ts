import { isUlid, normalizeLinkText } from "@cardiary/domain";
export * from "./vec-store.js";

import type { Database, Queryable } from "../db.js";
import { StorageError } from "../errors.js";
import { nowIso } from "../util.js";

/** `cache/index.sqlite` 的卡片索引表；全部可從 `cards/` 重建。 */
const CARD_INDEX_DDL = `
CREATE TABLE IF NOT EXISTS card_index (
  card_id       TEXT PRIMARY KEY,
  path          TEXT NOT NULL,
  mtime_ms      INTEGER NOT NULL,
  size_bytes    INTEGER NOT NULL,
  content_hash  TEXT NOT NULL,
  revision      TEXT NOT NULL,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  title_norm    TEXT NOT NULL,
  summary       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT,
  persona       TEXT NOT NULL DEFAULT 'default',
  asset_id      TEXT,
  supersedes    TEXT,
  broken        INTEGER NOT NULL DEFAULT 0,
  broken_reason TEXT,
  indexed_at    TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS card_index_by_created ON card_index (created_at);
CREATE INDEX IF NOT EXISTS card_index_by_kind ON card_index (kind, created_at);
CREATE INDEX IF NOT EXISTS card_index_by_asset ON card_index (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS card_index_by_supersedes ON card_index (supersedes) WHERE supersedes IS NOT NULL;
CREATE INDEX IF NOT EXISTS card_index_by_title_norm ON card_index (title_norm);

CREATE TABLE IF NOT EXISTS card_tags (
  card_id TEXT NOT NULL,
  tag     TEXT NOT NULL,
  PRIMARY KEY (card_id, tag)
) STRICT;
CREATE INDEX IF NOT EXISTS card_tags_by_tag ON card_tags (tag, card_id);

CREATE TABLE IF NOT EXISTS card_links (
  from_card_id TEXT NOT NULL,
  to_card_id   TEXT,
  target_text  TEXT NOT NULL,
  target_norm  TEXT NOT NULL,
  ordinal      INTEGER NOT NULL,
  PRIMARY KEY (from_card_id, target_text)
) STRICT;
CREATE INDEX IF NOT EXISTS card_links_by_target ON card_links (to_card_id) WHERE to_card_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS card_links_by_norm ON card_links (target_norm) WHERE to_card_id IS NULL;

CREATE TABLE IF NOT EXISTS card_sources (
  card_id        TEXT NOT NULL,
  source_card_id TEXT NOT NULL,
  PRIMARY KEY (card_id, source_card_id)
) STRICT;
CREATE INDEX IF NOT EXISTS card_sources_by_source ON card_sources (source_card_id);

CREATE TABLE IF NOT EXISTS asset_refs (
  asset_id TEXT NOT NULL,
  card_id  TEXT NOT NULL,
  PRIMARY KEY (asset_id, card_id)
) STRICT;
CREATE INDEX IF NOT EXISTS asset_refs_by_asset ON asset_refs (asset_id);

CREATE TABLE IF NOT EXISTS asset_meta (
  asset_id    TEXT PRIMARY KEY,
  media_type  TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  duration_ms INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS card_index_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS vec_cards (
  card_id TEXT PRIMARY KEY, model TEXT NOT NULL, revision TEXT NOT NULL, vector BLOB NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS vec_cards_usage (
  card_id TEXT PRIMARY KEY, last_used_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS vec_cards_evicted (
  card_id TEXT PRIMARY KEY, revision TEXT NOT NULL, evicted_at INTEGER NOT NULL
) STRICT;

CREATE VIRTUAL TABLE IF NOT EXISTS fts_cards USING fts5 (
  card_id UNINDEXED,
  title,
  summary,
  body,
  tags
);
`;

/** 索引是否追上 `cards/` 的旗標；原檔回收要等它為 true。 */
const READY_KEY = "cards.ready";
/** 全文索引的斷詞版本；舊快取會從原文重建。 */
const FTS_VERSION = "cjk-bigram-v1";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface IndexedFileFacts {
  readonly cardId: string;
  /** 內部相對路徑：`cards/<id>.md`。 */
  readonly path: string;
  readonly mtimeMs: number;
  readonly sizeBytes: number;
  /** 檔案位元組的 SHA-256。 */
  readonly contentHash: string;
  readonly indexedAt: string;
}

/** 解析成功的一張卡；`body` 只進全文索引，不另外保存。 */
export interface IndexedCard extends IndexedFileFacts {
  readonly broken: false;
  readonly revision: string;
  readonly kind: string;
  readonly title: string;
  readonly summary?: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly sources: readonly string[];
  /** 內文 `[[ ]]` 的目標原文，依出現順序。 */
  readonly links: readonly string[];
  readonly persona: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly assetId?: string;
  readonly supersedes?: string;
}

/** 格式不符的檔案；只記檔案本身的事實與原因，不改寫也不刪除。 */
export interface IndexedBrokenCard extends IndexedFileFacts {
  readonly broken: true;
  readonly brokenReason: string;
  /**
   * 解析失敗但檔案裡仍有一行合法的 `asset:` 時記下的原檔雜湊。
   *
   * 這是盡力而為：真正的回收判斷會掃描卡片檔，不靠這一欄。
   */
  readonly assetId?: string;
}

export type IndexedCardRecord = IndexedCard | IndexedBrokenCard;

export interface CardIndexRow {
  readonly cardId: string;
  readonly path: string;
  readonly mtimeMs: number;
  readonly sizeBytes: number;
  readonly contentHash: string;
  readonly revision: string;
  readonly kind: string;
  readonly title: string;
  readonly summary?: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly persona: string;
  readonly assetId?: string;
  readonly supersedes?: string;
  readonly broken: boolean;
  readonly brokenReason?: string;
  readonly indexedAt: string;
}

export interface CardListQuery {
  readonly kinds?: readonly string[];
  readonly tags?: readonly string[];
  readonly persona?: string;
  /** 預設 false：被取代的卡不進列表。 */
  readonly includeSuperseded?: boolean;
  /** 預設 false：格式不符的檔案只在明確要求時列出。 */
  readonly includeBroken?: boolean;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface CardListPage {
  readonly items: readonly CardIndexRow[];
  readonly nextCursor?: string;
}

export interface CardSearchQuery {
  readonly query: string;
  readonly limit?: number;
  readonly includeSuperseded?: boolean;
}

export interface CardSearchResult {
  readonly card: CardIndexRow;
  readonly score: number;
  readonly snippet: string;
}

export interface AssetMeta {
  readonly assetId: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly width?: number;
  readonly height?: number;
  readonly durationMs?: number;
}

interface CardRow {
  readonly card_id: string;
  readonly path: string;
  readonly mtime_ms: number;
  readonly size_bytes: number;
  readonly content_hash: string;
  readonly revision: string;
  readonly kind: string;
  readonly title: string;
  readonly summary: string | null;
  readonly created_at: string;
  readonly updated_at: string | null;
  readonly persona: string;
  readonly asset_id: string | null;
  readonly supersedes: string | null;
  readonly broken: number;
  readonly broken_reason: string | null;
  readonly indexed_at: string;
}

/**
 * `cache/index.sqlite` 的卡片索引。
 *
 * 快取可以整個刪掉：`rebuild()` 從呼叫端解析好的卡片重建全部表格。
 * 被取代的卡只是查詢時排除，資料列仍留著可追溯。
 */
export class CardIndexStore {
  readonly #db: Database;
  readonly #now: () => Date;

  constructor(options: { readonly db: Database; readonly now?: () => Date }) {
    this.#db = options.db;
    this.#now = options.now ?? (() => new Date());
    this.#db.exec(CARD_INDEX_DDL);
    this.#upgradeFullText();
  }

  #upgradeFullText(): void {
    if (this.#getMeta("fts.tokenizer") === FTS_VERSION) return;
    const rows = this.#db.all<{
      card_id: string;
      title: string;
      summary: string;
      body: string;
      tags: string;
    }>("SELECT card_id, title, summary, body, tags FROM fts_cards");
    this.#db.transaction((tx) => {
      tx.exec(
        "DROP TABLE fts_cards; CREATE VIRTUAL TABLE fts_cards USING fts5(card_id UNINDEXED, title, summary, body, tags)",
      );
      for (const row of rows) {
        tx.run(
          "INSERT INTO fts_cards (card_id, title, summary, body, tags) VALUES (?, ?, ?, ?, ?)",
          row.card_id,
          indexText(rawText(row.title)),
          indexText(rawText(row.summary)),
          indexText(rawText(row.body)),
          indexText(rawText(row.tags)),
        );
      }
      tx.run(
        "INSERT INTO card_index_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value=excluded.value",
        "fts.tokenizer",
        FTS_VERSION,
      );
    });
  }

  /** 索引是否已經追上 `cards/`；重建中或還沒掃描時是 false。 */
  get isReady(): boolean {
    return this.#getMeta(READY_KEY) === "1";
  }

  setReady(ready: boolean): void {
    this.#setMeta(READY_KEY, ready ? "1" : "0");
  }

  /** 一張卡的索引列；沒有時回 undefined。 */
  get(cardId: string): CardIndexRow | undefined {
    const row = this.#db.get<CardRow>(
      "SELECT * FROM card_index WHERE card_id = ?",
      normalizeId(cardId),
    );
    return row === undefined ? undefined : rowToCard(row);
  }

  /** 目前索引裡的卡片數（含 broken 與被取代）。 */
  count(): number {
    const row = this.#db.get<{ n: number }>("SELECT COUNT(*) AS n FROM card_index");
    return Number(row?.n ?? 0);
  }

  /** 全部索引列；啟動掃描用它比對 `cards/` 的檔案清單。 */
  all(): CardIndexRow[] {
    return this.#db.all<CardRow>("SELECT * FROM card_index ORDER BY card_id").map(rowToCard);
  }

  /**
   * 寫入或更新一張卡的所有索引列。
   *
   * 同一個交易內換掉標籤、連結、血緣與原檔引用，並更新全文索引；新卡的
   * 標題也會讓先前未解析的連結接上。
   */
  upsert(card: IndexedCardRecord): void {
    this.#db.transaction((tx) => {
      this.#writeCard(tx, card);
    });
  }

  /** 刪掉一張卡的所有索引列；同時把指向它的連結改回未解析。 */
  remove(cardId: string): void {
    const id = normalizeId(cardId);
    this.#db.transaction((tx) => {
      this.#deleteCardRows(tx, id);
      tx.run("UPDATE card_links SET to_card_id = NULL WHERE to_card_id = ?", id);
    });
    // 刪除後把 WAL 併回主檔並清空，字串搜尋才不會在 -wal 裡找到舊內容。
    this.#db.checkpoint();
  }

  /**
   * 整份重建：清空卡片索引，再用傳入的卡片重寫。
   *
   * 呼叫端負責掃描 `cards/` 與解析；中斷時索引停在未完成狀態，
   * 原檔回收會跳過（`isReady === false`）。
   */
  rebuild(cards: Iterable<IndexedCardRecord>): { indexed: number; broken: number } {
    this.setReady(false);
    let indexed = 0;
    let broken = 0;
    this.#db.transaction((tx) => {
      tx.exec(
        `DELETE FROM card_index;
         DELETE FROM card_tags;
         DELETE FROM card_links;
         DELETE FROM card_sources;
         DELETE FROM asset_refs;
         DELETE FROM fts_cards;
         DELETE FROM vec_cards;
         DELETE FROM vec_cards_usage;
         DELETE FROM vec_cards_evicted;`,
      );
      for (const card of cards) {
        this.#writeCard(tx, card);
        if (card.broken) {
          broken += 1;
        } else {
          indexed += 1;
        }
      }
    });
    this.setReady(true);
    return { indexed, broken };
  }

  /** 依建立時間新到舊列出；游標分頁。 */
  list(query: CardListQuery = {}): CardListPage {
    const limit = clampLimit(query.limit);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.kinds !== undefined && query.kinds.length > 0) {
      conditions.push(`kind IN (${query.kinds.map(() => "?").join(", ")})`);
      params.push(...query.kinds);
    }
    for (const tag of query.tags ?? []) {
      conditions.push(
        "EXISTS (SELECT 1 FROM card_tags t WHERE t.card_id = card_index.card_id AND t.tag = ?)",
      );
      params.push(tag);
    }
    if (query.persona !== undefined) {
      conditions.push("persona = ?");
      params.push(query.persona);
    }
    if (query.includeBroken !== true) {
      conditions.push("broken = 0");
    }
    if (query.includeSuperseded !== true) {
      conditions.push(SUPERSEDED_EXCLUSION("card_index"));
    }
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor);
      conditions.push("(created_at, card_id) < (?, ?)");
      params.push(cursor.createdAt, cursor.cardId);
    }
    const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    const rows = this.#db.all<CardRow>(
      `SELECT * FROM card_index ${where} ORDER BY created_at DESC, card_id DESC LIMIT ?`,
      ...params,
      limit + 1,
    );
    const items = rows.slice(0, limit).map(rowToCard);
    const last = items[items.length - 1];
    const hasMore = rows.length > limit;
    return {
      items,
      ...(hasMore && last !== undefined
        ? { nextCursor: encodeCursor(last.createdAt, last.cardId) }
        : {}),
    };
  }

  /**
   * 全文搜尋。
   *
   * 三個字元以上走 FTS5 trigram；一至兩個字元用 LIKE 掃標題與摘要，
   * 不假裝是 FTS 命中。被取代的卡預設不搜。
   */
  search(query: CardSearchQuery): CardSearchResult[] {
    const text = query.query.trim();
    if (text.length === 0) {
      return [];
    }
    const limit = clampLimit(query.limit);
    const excludeSuperseded = query.includeSuperseded !== true;
    if ([...text].length >= 2 && /^[\p{L}\p{N}\s]+$/u.test(text)) {
      const rows = this.#db.all<CardRow & { score: number; snippet: string }>(
        `SELECT card_index.*, -bm25(fts_cards) AS score,
                snippet(fts_cards, -1, '', '', '…', 24) AS snippet
         FROM fts_cards JOIN card_index ON card_index.card_id = fts_cards.card_id
         WHERE fts_cards MATCH ? AND card_index.broken = 0
           ${excludeSuperseded ? `AND ${SUPERSEDED_EXCLUSION("card_index")}` : ""}
         ORDER BY score DESC, card_index.created_at DESC, card_index.card_id DESC
         LIMIT ?`,
        ftsQuery(text),
        limit,
      );
      return rows.map((row) => ({
        card: rowToCard(row),
        score: Number(row.score),
        snippet: row.snippet.split(GRAM_SEPARATOR)[0] ?? "",
      }));
    }
    const pattern = `%${escapeLike(text)}%`;
    const rows = this.#db.all<CardRow>(
      `SELECT card_index.* FROM card_index JOIN fts_cards ON fts_cards.card_id = card_index.card_id
       WHERE broken = 0 AND (fts_cards.title LIKE ? ESCAPE '\\' OR fts_cards.summary LIKE ? ESCAPE '\\' OR fts_cards.body LIKE ? ESCAPE '\\' OR fts_cards.tags LIKE ? ESCAPE '\\')
         ${excludeSuperseded ? `AND ${SUPERSEDED_EXCLUSION("card_index")}` : ""}
       ORDER BY created_at DESC, card_index.card_id DESC
       LIMIT ?`,
      pattern,
      pattern,
      pattern,
      pattern,
      limit,
    );
    return rows.map((row) => {
      const card = rowToCard(row);
      const field =
        card.title.toLowerCase().includes(text.toLowerCase()) || card.summary === undefined
          ? card.title
          : card.summary;
      return { card, score: 0, snippet: shortSnippet(field, text) };
    });
  }

  /** 指向這張卡的來源卡片；依 id 排序。 */
  backlinks(cardId: string): string[] {
    return this.#db
      .all<{ from_card_id: string }>(
        "SELECT DISTINCT from_card_id FROM card_links WHERE to_card_id = ? ORDER BY from_card_id",
        normalizeId(cardId),
      )
      .map((row) => row.from_card_id);
  }

  /** 這張卡連出去、而且已解析的卡片；依出現順序。 */
  outgoingLinks(cardId: string): string[] {
    return this.#db
      .all<{ to_card_id: string }>(
        "SELECT to_card_id FROM card_links WHERE from_card_id = ? AND to_card_id IS NOT NULL ORDER BY ordinal",
        normalizeId(cardId),
      )
      .map((row) => row.to_card_id);
  }

  /** 內文 `[[ ]]` 的目標原文，依出現順序；包含尚未解析的。 */
  outgoingTargets(cardId: string): string[] {
    return this.#db
      .all<{ target_text: string }>(
        "SELECT target_text FROM card_links WHERE from_card_id = ? ORDER BY ordinal",
        normalizeId(cardId),
      )
      .map((row) => row.target_text);
  }

  /** 標籤，依卡片檔裡的順序。 */
  tagsOf(cardId: string): string[] {
    return this.#db
      .all<{ tag: string }>(
        "SELECT tag FROM card_tags WHERE card_id = ? ORDER BY rowid",
        normalizeId(cardId),
      )
      .map((row) => row.tag);
  }

  /** 血緣：來源卡片識別碼，依卡片檔裡的順序。 */
  sourcesOf(cardId: string): string[] {
    return this.#db
      .all<{ source_card_id: string }>(
        "SELECT source_card_id FROM card_sources WHERE card_id = ? ORDER BY rowid",
        normalizeId(cardId),
      )
      .map((row) => row.source_card_id);
  }

  /** 取代這張卡的新卡；沒有時回 undefined。 */
  supersededBy(cardId: string): string | undefined {
    return this.#db.get<{ card_id: string }>(
      "SELECT card_id FROM card_index WHERE supersedes = ? ORDER BY created_at DESC, card_id DESC LIMIT 1",
      normalizeId(cardId),
    )?.card_id;
  }

  /** 還沒解析的連結目標原文。 */
  unresolvedLinks(): string[] {
    return this.#db
      .all<{ target_text: string }>(
        "SELECT DISTINCT target_text FROM card_links WHERE to_card_id IS NULL ORDER BY target_text",
      )
      .map((row) => row.target_text);
  }

  /** 引用同一個原檔的卡片。 */
  assetCards(assetId: string): string[] {
    return this.#db
      .all<{ card_id: string }>(
        "SELECT card_id FROM asset_refs WHERE asset_id = ? ORDER BY card_id",
        assetId,
      )
      .map((row) => row.card_id);
  }

  assetRefCount(assetId: string): number {
    return this.assetCards(assetId).length;
  }

  putAssetMeta(meta: AssetMeta): void {
    this.#db.run(
      `INSERT INTO asset_meta (asset_id, media_type, size_bytes, width, height, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (asset_id) DO UPDATE SET
         media_type = excluded.media_type, size_bytes = excluded.size_bytes,
         width = excluded.width, height = excluded.height, duration_ms = excluded.duration_ms`,
      meta.assetId,
      meta.mediaType,
      meta.sizeBytes,
      meta.width ?? null,
      meta.height ?? null,
      meta.durationMs ?? null,
    );
  }

  /** 只在沒有既有中繼資料時寫入；原檔已存在時不覆寫別人補的欄位。 */
  ensureAssetMeta(meta: AssetMeta): void {
    this.#db.run(
      `INSERT INTO asset_meta (asset_id, media_type, size_bytes, width, height, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (asset_id) DO NOTHING`,
      meta.assetId,
      meta.mediaType,
      meta.sizeBytes,
      meta.width ?? null,
      meta.height ?? null,
      meta.durationMs ?? null,
    );
  }

  getAssetMeta(assetId: string): AssetMeta | undefined {
    const row = this.#db.get<{
      asset_id: string;
      media_type: string;
      size_bytes: number;
      width: number | null;
      height: number | null;
      duration_ms: number | null;
    }>("SELECT * FROM asset_meta WHERE asset_id = ?", assetId);
    if (row === undefined) {
      return undefined;
    }
    return {
      assetId: row.asset_id,
      mediaType: row.media_type,
      sizeBytes: Number(row.size_bytes),
      ...(row.width === null ? {} : { width: Number(row.width) }),
      ...(row.height === null ? {} : { height: Number(row.height) }),
      ...(row.duration_ms === null ? {} : { durationMs: Number(row.duration_ms) }),
    };
  }

  removeAssetMeta(assetId: string): void {
    this.#db.run("DELETE FROM asset_meta WHERE asset_id = ?", assetId);
  }

  /** 把 WAL 併回主檔並清空；刪除後呼叫，字串搜尋才找不到舊內容。 */
  checkpoint(): void {
    this.#db.checkpoint();
  }

  #writeCard(tx: Queryable, card: IndexedCardRecord): void {
    const id = normalizeId(card.cardId);
    this.#deleteCardRows(tx, id);
    if (card.broken) {
      tx.run(
        `INSERT INTO card_index (
           card_id, path, mtime_ms, size_bytes, content_hash, revision, kind, title,
           title_norm, summary, created_at, updated_at, persona, asset_id, supersedes,
           broken, broken_reason, indexed_at
         ) VALUES (?, ?, ?, ?, ?, '', '', '', '', NULL, ?, NULL, 'default', ?, NULL, 1, ?, ?)`,
        id,
        card.path,
        Math.round(card.mtimeMs),
        card.sizeBytes,
        card.contentHash,
        card.indexedAt,
        card.assetId ?? null,
        card.brokenReason,
        card.indexedAt,
      );
      // 壞掉的檔案仍然是資料：解析失敗但還寫著 `asset:` 時，照樣記下引用。
      if (card.assetId !== undefined) {
        tx.run(
          "INSERT OR IGNORE INTO asset_refs (asset_id, card_id) VALUES (?, ?)",
          card.assetId,
          id,
        );
      }
      return;
    }
    const titleNorm = normalizeLinkText(card.title);
    tx.run(
      `INSERT INTO card_index (
         card_id, path, mtime_ms, size_bytes, content_hash, revision, kind, title,
         title_norm, summary, created_at, updated_at, persona, asset_id, supersedes,
         broken, broken_reason, indexed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
      id,
      card.path,
      Math.round(card.mtimeMs),
      card.sizeBytes,
      card.contentHash,
      card.revision,
      card.kind,
      card.title,
      titleNorm,
      card.summary ?? null,
      card.createdAt,
      card.updatedAt ?? null,
      card.persona,
      card.assetId ?? null,
      card.supersedes === undefined ? null : normalizeId(card.supersedes),
      card.indexedAt,
    );
    for (const tag of card.tags) {
      tx.run("INSERT OR IGNORE INTO card_tags (card_id, tag) VALUES (?, ?)", id, tag);
    }
    for (const source of card.sources) {
      tx.run(
        "INSERT OR IGNORE INTO card_sources (card_id, source_card_id) VALUES (?, ?)",
        id,
        normalizeId(source),
      );
    }
    if (card.assetId !== undefined) {
      tx.run(
        "INSERT OR IGNORE INTO asset_refs (asset_id, card_id) VALUES (?, ?)",
        card.assetId,
        id,
      );
    }
    card.links.forEach((targetText, ordinal) => {
      const targetNorm = normalizeLinkText(targetText);
      const resolved = this.#resolveTarget(tx, targetText, targetNorm, id);
      tx.run(
        `INSERT INTO card_links (from_card_id, to_card_id, target_text, target_norm, ordinal)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (from_card_id, target_text) DO UPDATE SET
           to_card_id = excluded.to_card_id, target_norm = excluded.target_norm,
           ordinal = excluded.ordinal`,
        id,
        resolved,
        targetText,
        targetNorm,
        ordinal,
      );
    });
    // 這張卡可能就是別人先前找不到的連結目標：比對標題，也比對 id。
    tx.run(
      `UPDATE card_links SET to_card_id = ?
       WHERE to_card_id IS NULL AND (target_norm = ? OR UPPER(target_text) = ?)
         AND from_card_id <> ?`,
      id,
      titleNorm,
      id,
      id,
    );
    tx.run(
      `INSERT INTO fts_cards (card_id, title, summary, body, tags) VALUES (?, ?, ?, ?, ?)`,
      id,
      indexText(card.title),
      indexText(card.summary ?? ""),
      indexText(card.body),
      indexText(card.tags.join(" ")),
    );
  }

  #deleteCardRows(tx: Queryable, cardId: string): void {
    tx.run("DELETE FROM card_index WHERE card_id = ?", cardId);
    tx.run("DELETE FROM card_tags WHERE card_id = ?", cardId);
    tx.run("DELETE FROM card_links WHERE from_card_id = ?", cardId);
    tx.run("DELETE FROM card_sources WHERE card_id = ?", cardId);
    tx.run("DELETE FROM asset_refs WHERE card_id = ?", cardId);
    tx.run("DELETE FROM fts_cards WHERE card_id = ?", cardId);
    tx.run("DELETE FROM vec_cards WHERE card_id = ?", cardId);
    tx.run("DELETE FROM vec_cards_usage WHERE card_id = ?", cardId);
    tx.run("DELETE FROM vec_cards_evicted WHERE card_id = ?", cardId);
  }

  #resolveTarget(
    tx: Queryable,
    targetText: string,
    targetNorm: string,
    selfId: string,
  ): string | null {
    if (isUlid(targetText)) {
      const byId = normalizeId(targetText);
      const exists = tx.get<{ card_id: string }>(
        "SELECT card_id FROM card_index WHERE card_id = ?",
        byId,
      );
      if (exists !== undefined) {
        return byId;
      }
    }
    const byTitle = tx.get<{ card_id: string }>(
      `SELECT card_id FROM card_index
       WHERE title_norm = ? AND broken = 0 AND card_id <> ?
       ORDER BY created_at, card_id LIMIT 1`,
      targetNorm,
      selfId,
    );
    return byTitle?.card_id ?? null;
  }

  #getMeta(key: string): string | undefined {
    return this.#db.get<{ value: string }>("SELECT value FROM card_index_meta WHERE key = ?", key)
      ?.value;
  }

  #setMeta(key: string, value: string): void {
    this.#db.run(
      "INSERT INTO card_index_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  /** 目前時間；給呼叫端組 `indexedAt` 用。 */
  nowIso(): string {
    return nowIso(this.#now);
  }
}

/** 被取代的卡：有人宣告 `supersedes` 指向它。`table` 只能是 card_index。 */
function SUPERSEDED_EXCLUSION(table: string): string {
  return `NOT EXISTS (SELECT 1 FROM card_index newer WHERE newer.supersedes = ${table}.card_id)`;
}

function rowToCard(row: CardRow): CardIndexRow {
  return {
    cardId: row.card_id,
    path: row.path,
    mtimeMs: Number(row.mtime_ms),
    sizeBytes: Number(row.size_bytes),
    contentHash: row.content_hash,
    revision: row.revision,
    kind: row.kind,
    title: row.title,
    ...(row.summary === null ? {} : { summary: row.summary }),
    createdAt: row.created_at,
    ...(row.updated_at === null ? {} : { updatedAt: row.updated_at }),
    persona: row.persona,
    ...(row.asset_id === null ? {} : { assetId: row.asset_id }),
    ...(row.supersedes === null ? {} : { supersedes: row.supersedes }),
    broken: row.broken === 1,
    ...(row.broken_reason === null ? {} : { brokenReason: row.broken_reason }),
    indexedAt: row.indexed_at,
  };
}

function normalizeId(cardId: string): string {
  return cardId.toUpperCase();
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

function grams(text: string): string[] {
  const chars = [...text];
  return chars.length < 2
    ? chars
    : chars.slice(0, -1).map((char, index) => char + chars[index + 1]);
}

/** 原文與詞之間的分隔；snippet 只回分隔之前的人看得懂的文字。 */
const GRAM_SEPARATOR = "\u0001";

function indexText(text: string): string {
  const tokens = [...text.matchAll(CJK)].flatMap((match) => grams(match[0]));
  return tokens.length === 0 ? text : `${text}${GRAM_SEPARATOR}${tokens.join(" ")}`;
}

function rawText(text: string): string {
  return text.split(GRAM_SEPARATOR)[0] ?? "";
}

/** 將查詢切成索引採用的詞，全部詞都要命中。 */
function ftsQuery(text: string): string {
  const parts =
    text.match(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}]+/gu,
    ) ?? [];
  const tokens = parts.flatMap((part) =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(part)
      ? grams(part)
      : [part],
  );
  return tokens.map((part) => `"${part.replaceAll('"', '""')}"`).join(" AND ");
}

function escapeLike(text: string): string {
  return text.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function shortSnippet(text: string, needle: string): string {
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) {
    return text.slice(0, 80);
  }
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + needle.length + 60);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function encodeCursor(createdAt: string, cardId: string): string {
  return Buffer.from(JSON.stringify([createdAt, cardId]), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; cardId: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string") {
      return { createdAt: parsed[0], cardId: parsed[1] };
    }
  } catch {
    // 落到下面的錯誤。
  }
  throw new StorageError("invalid-cursor", "卡片列表的游標不合法", { cursor });
}
