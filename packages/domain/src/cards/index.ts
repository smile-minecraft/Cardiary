/**
 * 卡片的領域型別。
 *
 * 這一層只有型別與介面；實作由卡片庫工作補上。協定的線路形狀在
 * `@cardiary/protocol`，這裡是主機內部用的領域模型，兩者由主機映射。
 */

/** 卡片識別碼（ULID）。 */
export type CardId = string;

/** 卡片種類。 */
export type CardKind = "note" | "image" | "audio" | "memory" | "summary" | "persona" | "bedrock";

/** 卡片生命週期；`cold` 是蒸餾後的冷封存。 */
export type CardLifecycle = "live" | "cold";

/** 卡片檔的 frontmatter；未知欄位放在 `extra`，寫回時原樣保留。 */
export interface CardFrontmatter {
  readonly id: CardId;
  readonly kind: CardKind;
  readonly title: string;
  readonly summary?: string;
  readonly created: string;
  readonly updated?: string;
  readonly sources: readonly CardId[];
  readonly supersedes?: CardId;
  readonly tags: readonly string[];
  readonly asset?: string;
  readonly persona: string;
  readonly importedFrom?: {
    readonly tool: string;
    readonly path: string;
    readonly hash: string;
  };
  /** 不認得的 frontmatter 欄位；依原本順序保存。 */
  readonly extra: Readonly<Record<string, unknown>>;
}

/** 一張卡片的完整內容。 */
export interface Card {
  readonly cardId: CardId;
  readonly frontmatter: CardFrontmatter;
  /** frontmatter 之後的 Markdown，原樣保存。 */
  readonly body: string;
  /** 正規化內容的 SHA-256；補丁的樂觀鎖。 */
  readonly revision: string;
}

/** 列表與事件用的摘要；不含內文。 */
export interface CardSummary {
  readonly cardId: CardId;
  readonly kind: CardKind;
  readonly title: string;
  readonly summary?: string;
  readonly tags: readonly string[];
  readonly persona: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly lifecycle: CardLifecycle;
  readonly supersededBy?: CardId;
  readonly assetId?: string;
  readonly broken?: boolean;
  readonly brokenReason?: string;
}

/** 卡片編輯；代理只能送 `unified`。 */
export interface CardPatch {
  readonly format: "unified" | "replace";
  readonly text: string;
}

/** 列表與搜尋的條件。 */
export interface CardQuery {
  readonly kinds?: readonly CardKind[];
  readonly tags?: readonly string[];
  readonly persona?: string;
  readonly lifecycle?: CardLifecycle | "all";
  readonly includeSuperseded?: boolean;
  readonly query?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/** 搜尋結果的一筆。 */
export interface CardSearchHit {
  readonly card: CardSummary;
  readonly score: number;
  readonly snippet: string;
}

/** 分頁結果。 */
export interface CardPage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

/**
 * 卡片服務：其他模組讀寫卡片的唯一入口。
 *
 * 新鮮度與載入紀錄不在這裡，由 `FreshnessService` 負責；卡片服務只寫
 * 卡片檔、索引與 `conversation_cards` 的引用。
 */
export interface CardService {
  get(cardId: CardId): Promise<Card | null>;
  list(query: CardQuery): Promise<CardPage<CardSummary>>;
  search(query: CardQuery): Promise<CardPage<CardSearchHit>>;
  create(input: {
    readonly kind: CardKind;
    readonly title: string;
    readonly body: string;
    readonly summary?: string;
    readonly tags?: readonly string[];
    readonly persona?: string;
    readonly sources?: readonly CardId[];
    readonly supersedes?: CardId;
    readonly assetBlobId?: string;
    readonly revisionHint?: string;
  }): Promise<Card>;
  patch(input: {
    readonly cardId: CardId;
    readonly baseRevision: string;
    readonly patch: CardPatch;
  }): Promise<Card>;
  delete(cardId: CardId): Promise<{ readonly deletedAssets: number }>;
  /** 讀取卡片時記下對話引用；`countsAsLoad` 由呼叫端決定。 */
  noteConversationLoad(input: {
    readonly conversationId: string;
    readonly cardId: CardId;
  }): Promise<void>;
}

/** 可重建索引的介面；刪掉 `cache/index.sqlite` 後由 `rebuild` 重建。 */
export interface CardIndex {
  rebuild(): Promise<{ readonly indexed: number; readonly broken: number }>;
  /** 使用者手動觸發或監看漏接時的補掃。 */
  rescan(): Promise<void>;
}

/** 原檔的介面；以內容雜湊命名，永不改寫。 */
export interface AssetStore {
  put(input: {
    readonly bytes: AsyncIterable<Uint8Array> | Uint8Array;
    readonly mediaType: string;
    readonly extension: string;
  }): Promise<{ readonly blobId: string; readonly sizeBytes: number }>;
  read(blobId: string): Promise<Uint8Array | null>;
  /** 沒有其他卡片引用時才刪除。 */
  release(blobId: string): Promise<boolean>;
}
