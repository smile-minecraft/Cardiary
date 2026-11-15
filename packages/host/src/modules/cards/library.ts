import {
  AGENT_CREATABLE_KINDS,
  CardPatchError,
  SUMMARY_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  applyPatch,
  computeRevision,
  dedupeTags,
  extractOutgoingLinks,
  isUlid,
  newCardId,
  parseCardText,
  serializeCardFile,
  sha256Hex,
  type Card,
  type CardFrontmatter,
  type CardKind,
  type CardPage,
  type CardPatch,
  type CardQuery,
  type CardSearchHit,
  type CardSummary,
  type FrontmatterLayoutItem,
} from "@cardiary/domain";
import type { ProtocolEventIntent } from "@cardiary/module-api";
import type { JSONObject } from "@cardiary/protocol";
import { StorageError, type CardFileEntry, type CardFileStore } from "@cardiary/storage";
import type {
  CardIndexRow,
  CardIndexStore,
  IndexedCard,
  IndexedCardRecord,
  LocalAssetStore,
} from "@cardiary/storage";
import { basename } from "node:path";

import { ProtocolHandlerError } from "../contract.js";
import type { CardStateStore } from "./state.js";

/**
 * 卡片庫：`cards/` 的正本、可重建的索引與狀態庫。
 *
 * 這個類別是卡片模組的內部服務；協定處理器與代理工具都經過它，寫入序
 * 列化（一次只做一個變更），索引更新失敗不影響已經寫好的檔案。
 */

const AGENT_KINDS: ReadonlySet<string> = new Set(AGENT_CREATABLE_KINDS);

export interface CardLibraryOptions {
  readonly files: CardFileStore;
  /** 目前的快取索引；暫停後恢復時連線會換一個，所以取當下的。 */
  readonly index: () => CardIndexStore;
  readonly assets: () => LocalAssetStore;
  readonly state: CardStateStore;
  readonly now?: () => Date;
  readonly emit?: (intent: ProtocolEventIntent) => void;
  readonly warn?: (message: string, fields?: JSONObject) => void;
}

interface CreateCardInput {
  readonly kind: CardKind;
  readonly title: string;
  readonly body: string;
  readonly summary?: string;
  readonly tags?: readonly string[];
  readonly persona?: string;
  readonly sources?: readonly string[];
  readonly supersedes?: string;
  readonly assetBlobId?: string;
  /** 系統與匯入可以建立 memory／summary／persona／bedrock；代理與客戶端不行。 */
  readonly allowSystemKinds?: boolean;
}

export class CardLibrary {
  readonly #files: CardFileStore;
  readonly #index: () => CardIndexStore;
  readonly #assets: () => LocalAssetStore;
  readonly #state: CardStateStore;
  readonly #now: () => Date;
  readonly #emit: (intent: ProtocolEventIntent) => void;
  readonly #warn: (message: string, fields?: JSONObject) => void;
  /** 變更一次只做一個：協定請求與檔案監看共用同一條序列。 */
  #tail: Promise<void> = Promise.resolve();

  constructor(options: CardLibraryOptions) {
    this.#files = options.files;
    this.#index = options.index;
    this.#assets = options.assets;
    this.#state = options.state;
    this.#now = options.now ?? (() => new Date());
    this.#emit = options.emit ?? (() => {});
    this.#warn = options.warn ?? (() => {});
  }

  get files(): CardFileStore {
    return this.#files;
  }

  /** 啟動掃描：清掉過期暫存檔、完整比對索引、回收沒有引用的原檔。 */
  async initialize(): Promise<void> {
    this.#files.ensureDirectory();
    const removed = this.#files.cleanupTempFiles();
    if (removed.length > 0) {
      this.#warn("清掉未完成的卡片暫存檔", { count: removed.length });
    }
    await this.#serialize(() => {
      this.#scan({ emitChanges: false });
      this.#reclaimOrphanAssets();
    });
  }

  /**
   * 整批回收沒有引用的原檔。
   *
   * 只在啟動掃描做：這時所有卡片檔都讀過一輪、索引也完成了，而且客戶端
   * 還沒連上，不會碰上「原檔剛寫好、卡片檔還沒寫」的中間狀態。刪卡時
   * 回 `skipped` 的原檔靠這裡補。回收失敗不擋啟動，記一筆警告就好。
   */
  #reclaimOrphanAssets(): void {
    try {
      const result = this.#assets().sweep();
      if (result.deleted > 0) {
        this.#warn("回收沒有引用的原檔", { deleted: result.deleted });
      }
    } catch (error) {
      this.#warn("原檔回收失敗", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 掃描全部卡片；`CardIndex` 介面的 `rebuild`。 */
  async rebuild(): Promise<{ indexed: number; broken: number }> {
    return this.#serialize(() => {
      const records: IndexedCardRecord[] = [];
      let broken = 0;
      for (const entry of this.#files.list()) {
        const record = this.#readRecord(entry);
        records.push(record);
        if (record.broken) broken += 1;
      }
      const result = this.#index().rebuild(records);
      return { indexed: result.indexed, broken };
    });
  }

  /** 低成本補掃：只比對 mtime 與大小；`CardIndex` 介面的 `rescan`。 */
  async rescan(): Promise<void> {
    await this.#serialize(() => {
      this.#scan({ emitChanges: true });
    });
  }

  /** 外部檔案變動：重新索引這幾個檔名（去抖後的批次）。 */
  async syncPaths(fileNames: readonly string[]): Promise<void> {
    await this.#serialize(() => {
      const index = this.#index();
      const seen = new Set<string>();
      for (const fileName of fileNames) {
        const cardId = cardIdOfFileName(fileName);
        if (cardId === null) continue;
        if (seen.has(cardId)) continue;
        seen.add(cardId);
        const content = this.#files.read(cardId);
        if (content === undefined) {
          const known = index.get(cardId);
          if (known !== undefined) {
            index.remove(cardId);
            this.#emit({ kind: "card-changed", cardId, change: "deleted" });
          }
          continue;
        }
        const known = index.get(cardId);
        if (known !== undefined && sameFacts(known, content)) continue;
        const record = this.#reindexRecord(content);
        this.#emitChange(record, known);
      }
    });
  }

  async get(
    cardId: string,
    options: { readonly conversationId?: string } = {},
  ): Promise<Card | null> {
    const id = normalizeCardId(cardId);
    const index = this.#index();
    const known = index.get(id);
    const content = this.#files.read(id);
    if (content === undefined) {
      if (known !== undefined) index.remove(id);
      return null;
    }
    const parsed = parseCardText(content.text, { expectedCardId: id });
    if (!parsed.ok) {
      index.upsert(brokenRecord(content, parsed.reason, this.#now().toISOString()));
      throw new ProtocolHandlerError("conflict", `卡片檔格式不符：${parsed.reason}`, {
        reason: "broken_card",
        cardId: id,
      });
    }
    // 讀取不改索引：外部編輯的索引更新與 card.changed 由監看或補掃負責，
    // 這裡先改的話，監看就看不到差異、事件也不會送出去。回傳的內容與
    // revision 仍然取自剛讀到的檔案。
    if (options.conversationId !== undefined) {
      this.#state.recordReference(options.conversationId, id);
    }
    return {
      cardId: id,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      revision: computeRevision(parsed.frontmatter, parsed.body),
    };
  }

  async list(query: CardQuery): Promise<CardPage<CardSummary>> {
    const index = this.#index();
    if (query.query !== undefined && query.query.trim().length > 0) {
      const hits = index.search({
        query: query.query,
        ...(query.includeSuperseded === undefined
          ? {}
          : { includeSuperseded: query.includeSuperseded }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      });
      const items = hits
        .map((hit) => hit.card)
        .filter((row) => this.#matches(row, query))
        .map((row) => this.summaryOf(row));
      return { items };
    }
    const page = index.list({
      ...(query.kinds === undefined ? {} : { kinds: query.kinds }),
      ...(query.tags === undefined ? {} : { tags: query.tags }),
      ...(query.persona === undefined ? {} : { persona: query.persona }),
      ...(query.includeSuperseded === undefined
        ? {}
        : { includeSuperseded: query.includeSuperseded }),
      includeBroken: true,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    const items = page.items
      .filter((row) => matchesLifecycle(this.#state.get(row.cardId).lifecycle, query.lifecycle))
      .map((row) => this.summaryOf(row));
    return {
      items,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  }

  async search(query: CardQuery): Promise<CardPage<CardSearchHit>> {
    const text = (query.query ?? "").trim();
    if (text.length === 0) return { items: [] };
    const hits = this.#index().search({
      query: text,
      ...(query.includeSuperseded === undefined
        ? {}
        : { includeSuperseded: query.includeSuperseded }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return {
      items: hits
        .filter((hit) => this.#matches(hit.card, query))
        .map((hit) => ({
          card: this.summaryOf(hit.card),
          score: hit.score,
          snippet: hit.snippet,
        })),
    };
  }

  async create(input: CreateCardInput): Promise<Card> {
    return this.#serialize(() => {
      const kind = input.kind;
      if (input.allowSystemKinds !== true && !AGENT_KINDS.has(kind)) {
        throw new ProtocolHandlerError(
          "invalid_message",
          `只能建立 note、image、audio；${kind} 由系統或匯入建立。`,
          { reason: "kind_not_creatable", kind },
        );
      }
      const title = truncate(input.title.trim(), TITLE_MAX_LENGTH);
      if (title.length === 0) {
        throw new ProtocolHandlerError("invalid_message", "標題不能是空的。", {
          reason: "title_empty",
        });
      }
      const body = input.body;
      const tags = dedupeTags((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean));
      const persona = input.persona?.trim();
      const summary = truncate(input.summary?.trim() ?? "", SUMMARY_MAX_LENGTH) || undefined;
      const asset = this.#assetPath(input.assetBlobId);
      if (asset === undefined && (kind === "image" || kind === "audio")) {
        throw new ProtocolHandlerError("invalid_message", `${kind} 卡片必須帶原檔。`, {
          reason: "asset_required",
          kind,
        });
      }
      const cardId = this.#newUniqueId();
      const now = this.#now().toISOString();
      const frontmatter: CardFrontmatter = {
        id: cardId,
        kind,
        title,
        ...(summary === undefined ? {} : { summary }),
        created: now,
        sources: (input.sources ?? []).map(normalizeCardId),
        ...(input.supersedes === undefined
          ? {}
          : { supersedes: normalizeCardId(input.supersedes) }),
        tags,
        ...(asset === undefined ? {} : { asset }),
        persona: persona !== undefined && persona.length > 0 ? persona : "default",
        extra: {},
      };
      const presentKeys = [
        "id",
        "kind",
        "title",
        ...(summary === undefined ? [] : ["summary"]),
        "created",
        ...(frontmatter.sources.length === 0 ? [] : ["sources"]),
        ...(frontmatter.supersedes === undefined ? [] : ["supersedes"]),
        ...(tags.length === 0 ? [] : ["tags"]),
        ...(asset === undefined ? [] : ["asset"]),
        ...(persona === undefined || persona.length === 0 ? [] : ["persona"]),
      ];
      const text = serializeCardFile({ frontmatter, presentKeys, body });
      this.#files.write({ cardId, text });
      const entry: CardFileEntry = {
        cardId,
        fileName: `${cardId}.md`,
        sizeBytes: Buffer.byteLength(text, "utf8"),
        mtimeMs: this.#now().getTime(),
      };
      const content = this.#files.read(cardId) ?? { ...entry, text };
      const record = this.#indexedRecord(content, frontmatter, body);
      this.#index().upsert(record);
      this.#state.ensure(cardId, frontmatter.persona);
      if (frontmatter.supersedes !== undefined) {
        this.#state.setSupersededBy(frontmatter.supersedes, cardId);
      }
      const revision = computeRevision(frontmatter, body);
      this.#emit({ kind: "card-changed", cardId, change: "created", revision });
      return { cardId, frontmatter, body, revision };
    });
  }

  async patch(input: {
    readonly cardId: string;
    readonly baseRevision: string;
    readonly patch: CardPatch;
  }): Promise<Card> {
    return this.#serialize(() => {
      const id = normalizeCardId(input.cardId);
      const content = this.#files.read(id);
      if (content === undefined) {
        throw new ProtocolHandlerError("not_found", `找不到卡片 ${id}。`, { cardId: id });
      }
      const parsed = parseCardText(content.text, { expectedCardId: id });
      if (!parsed.ok) {
        this.#index().upsert(brokenRecord(content, parsed.reason, this.#now().toISOString()));
        throw new ProtocolHandlerError("conflict", `卡片檔格式不符：${parsed.reason}`, {
          reason: "broken_card",
          cardId: id,
        });
      }
      const currentRevision = computeRevision(parsed.frontmatter, parsed.body);
      if (currentRevision !== input.baseRevision) {
        throw new ProtocolHandlerError("conflict", "卡片已經被改過；請重讀後再送出補丁。", {
          reason: "revision_mismatch",
          currentRevision,
        });
      }
      let body: string;
      try {
        body = applyPatch(parsed.body, input.patch);
      } catch (error) {
        if (error instanceof CardPatchError) {
          throw new ProtocolHandlerError("invalid_message", error.message, {
            reason: "patch_failed",
          });
        }
        throw error;
      }
      const now = this.#now().toISOString();
      const frontmatter: CardFrontmatter = { ...parsed.frontmatter, updated: now };
      const presentKeys = withUpdatedKey(parsed.presentKeys);
      const text = serializeCardFile({
        frontmatter,
        presentKeys,
        body,
        lineEnding: parsed.lineEnding,
        layout: withUpdatedField(parsed.layout),
      });
      this.#files.write({ cardId: id, text });
      const written = this.#files.read(id);
      if (written !== undefined) {
        this.#index().upsert(this.#indexedRecord(written, frontmatter, body));
      }
      this.#state.ensure(id, frontmatter.persona);
      const revision = computeRevision(frontmatter, body);
      this.#emit({ kind: "card-changed", cardId: id, change: "updated", revision });
      return { cardId: id, frontmatter, body, revision };
    });
  }

  async delete(cardId: string): Promise<{ readonly deletedAssets: number }> {
    return this.#serialize(() => {
      const id = normalizeCardId(cardId);
      const index = this.#index();
      const known = index.get(id);
      const content = this.#files.read(id);
      const parsed =
        content === undefined ? null : parseCardText(content.text, { expectedCardId: id });
      if (known === undefined && content === undefined) {
        throw new ProtocolHandlerError("not_found", `找不到卡片 ${id}。`, { cardId: id });
      }
      const existed = this.#files.remove(id);
      index.remove(id);
      this.#state.remove(id);
      // 兩個來源都當候選：索引記得的，以及檔案目前寫的（外部可能改過）。
      // 多送一個候選不會誤刪——回收前還會掃描所有卡片檔；少送才是漏刪。
      const candidates = new Set<string>();
      const fileAssetId =
        parsed === null
          ? undefined
          : parsed.ok
            ? assetIdOf(parsed.frontmatter.asset)
            : assetIdFromText(content?.text ?? "");
      if (fileAssetId !== undefined) candidates.add(fileAssetId);
      if (known?.assetId !== undefined) candidates.add(known.assetId);
      let deletedAssets = 0;
      for (const assetId of candidates) {
        try {
          if (this.#assets().release(assetId) === "deleted") deletedAssets += 1;
        } catch (error) {
          this.#warn("原檔回收失敗", {
            cardId: id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (existed || known !== undefined) {
        this.#emit({ kind: "card-changed", cardId: id, change: "deleted" });
      }
      return { deletedAssets };
    });
  }

  async refresh(cardId: string): Promise<number> {
    return this.#serialize(() => {
      const id = normalizeCardId(cardId);
      const index = this.#index();
      const known = index.get(id);
      if (known === undefined && this.#files.read(id) === undefined) {
        throw new ProtocolHandlerError("not_found", `找不到卡片 ${id}。`, { cardId: id });
      }
      const freshness = this.#state.refresh(id, known?.persona ?? "default");
      this.#emit({
        kind: "card-changed",
        cardId: id,
        change: "refreshed",
        ...(known === undefined ? {} : { revision: known.revision }),
        freshness,
      });
      return freshness;
    });
  }

  async noteConversationLoad(input: {
    readonly conversationId: string;
    readonly cardId: string;
  }): Promise<void> {
    const id = normalizeCardId(input.cardId);
    if (this.#index().get(id) === undefined) {
      throw new ProtocolHandlerError("not_found", `找不到卡片 ${id}。`, { cardId: id });
    }
    this.#state.recordLoad(input.conversationId, id, "search", true);
  }

  /** 索引列的摘要；協定與工具共用。 */
  summaryOf(row: CardIndexRow): CardSummary {
    const cardState = this.#state.get(row.cardId);
    const supersededBy = this.#index().supersededBy(row.cardId);
    return {
      cardId: row.cardId,
      kind: row.kind as CardKind,
      title: row.title,
      ...(row.summary === undefined ? {} : { summary: row.summary }),
      tags: this.#index().tagsOf(row.cardId),
      persona: row.persona,
      createdAt: row.createdAt,
      ...(row.updatedAt === undefined ? {} : { updatedAt: row.updatedAt }),
      lifecycle: cardState.lifecycle,
      ...(supersededBy === undefined ? {} : { supersededBy }),
      ...(row.broken
        ? {
            broken: true,
            ...(row.brokenReason === undefined ? {} : { brokenReason: row.brokenReason }),
          }
        : {}),
      ...(row.assetId === undefined ? {} : { assetId: row.assetId }),
    };
  }

  /** 給協定回應用的 asset 區塊；沒有中繼資料時省略。 */
  assetOf(row: CardIndexRow): { blobId: string; mediaType: string; sizeBytes: number } | undefined {
    if (row.assetId === undefined) return undefined;
    const meta = this.#index().getAssetMeta(row.assetId);
    if (meta === undefined) return undefined;
    return { blobId: meta.assetId, mediaType: meta.mediaType, sizeBytes: meta.sizeBytes };
  }

  rowOf(cardId: string): CardIndexRow | undefined {
    return isUlid(cardId) ? this.#index().get(cardId.toUpperCase()) : undefined;
  }

  summaryOfRow(cardId: string): CardSummary | undefined {
    const row = this.rowOf(cardId);
    return row === undefined ? undefined : this.summaryOf(row);
  }

  assetOfRow(cardId: string): ReturnType<CardLibrary["assetOf"]> {
    const row = this.rowOf(cardId);
    return row === undefined ? undefined : this.assetOf(row);
  }

  outgoingTargets(cardId: string): string[] {
    return this.#index().outgoingTargets(cardId);
  }

  backlinks(cardId: string): string[] {
    return this.#index().backlinks(cardId);
  }

  sourcesOf(cardId: string): string[] {
    return this.#index().sourcesOf(cardId);
  }

  /** 目前的新鮮度；沒有狀態列時是 100。 */
  freshnessOf(cardId: string): number {
    return this.#state.get(cardId).freshness;
  }

  #matches(row: CardIndexRow, query: CardQuery): boolean {
    if (query.kinds !== undefined && query.kinds.length > 0) {
      if (!query.kinds.includes(row.kind as CardKind)) return false;
    }
    if (query.persona !== undefined && row.persona !== query.persona) return false;
    const wanted = query.tags ?? [];
    return wanted.length === 0 || matchesQueryTags(this.#index().tagsOf(row.cardId), wanted);
  }

  /** 一次變更的序列化；失敗不影響後面的工作。 */
  #serialize<T>(work: () => T): Promise<T> {
    const run = this.#tail.then(work, work);
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  #scan(options: { readonly emitChanges: boolean }): void {
    const index = this.#index();
    const known = new Map(index.all().map((row) => [row.cardId, row]));
    const seen = new Set<string>();
    for (const entry of this.#files.list()) {
      seen.add(entry.cardId);
      const previous = known.get(entry.cardId);
      if (previous !== undefined && sameFacts(previous, entry)) continue;
      const content = this.#files.read(entry.cardId);
      if (content === undefined) continue;
      const record = this.#reindexRecord(content);
      if (options.emitChanges) this.#emitChange(record, previous);
    }
    for (const [cardId] of known) {
      if (seen.has(cardId)) continue;
      index.remove(cardId);
      if (options.emitChanges) {
        this.#emit({ kind: "card-changed", cardId, change: "deleted" });
      }
    }
    index.setReady(true);
  }

  /** 讀檔並解析成索引列；啟動掃描與重建共用。 */
  #readRecord(entry: CardFileEntry): IndexedCardRecord {
    const content = this.#files.read(entry.cardId) ?? {
      ...entry,
      text: "",
    };
    const parsed = parseCardText(content.text, { expectedCardId: entry.cardId });
    if (!parsed.ok) return brokenRecord(content, parsed.reason, this.#now().toISOString());
    return this.#indexedRecord(content, parsed.frontmatter, parsed.body);
  }

  #reindexRecord(content: CardFileEntry & { readonly text: string }): IndexedCardRecord {
    const parsed = parseCardText(content.text, { expectedCardId: content.cardId });
    const record = parsed.ok
      ? this.#indexedRecord(content, parsed.frontmatter, parsed.body)
      : brokenRecord(content, parsed.reason, this.#now().toISOString());
    this.#index().upsert(record);
    return record;
  }

  #indexedRecord(
    content: CardFileEntry & { readonly text: string },
    frontmatter: CardFrontmatter,
    body: string,
  ): IndexedCard {
    return {
      cardId: content.cardId,
      path: `cards/${content.cardId}.md`,
      mtimeMs: content.mtimeMs,
      sizeBytes: content.sizeBytes,
      contentHash: sha256Hex(content.text),
      indexedAt: this.#now().toISOString(),
      broken: false,
      revision: computeRevision(frontmatter, body),
      kind: frontmatter.kind,
      title: frontmatter.title,
      ...(frontmatter.summary === undefined ? {} : { summary: frontmatter.summary }),
      body,
      tags: frontmatter.tags,
      sources: frontmatter.sources,
      links: extractOutgoingLinks(body).map((link) => link.target),
      persona: frontmatter.persona || "default",
      createdAt: frontmatter.created,
      ...(frontmatter.updated === undefined ? {} : { updatedAt: frontmatter.updated }),
      ...(assetIdOf(frontmatter.asset) === undefined
        ? {}
        : { assetId: assetIdOf(frontmatter.asset) as string }),
      ...(frontmatter.supersedes === undefined ? {} : { supersedes: frontmatter.supersedes }),
    };
  }

  #emitChange(record: IndexedCardRecord, previous: CardIndexRow | undefined): void {
    if (record.broken) {
      this.#emit({ kind: "card-changed", cardId: record.cardId, change: "reindexed" });
      return;
    }
    const change =
      previous === undefined
        ? "created"
        : previous.contentHash === record.contentHash
          ? "reindexed"
          : "updated";
    this.#emit({
      kind: "card-changed",
      cardId: record.cardId,
      change,
      revision: record.revision,
    });
  }

  #assetPath(assetBlobId: string | undefined): string | undefined {
    if (assetBlobId === undefined || assetBlobId.length === 0) return undefined;
    const files = this.#assets().filesFor(assetBlobId);
    const target = files[0];
    if (target === undefined) {
      throw new ProtocolHandlerError("invalid_message", "找不到已上傳的原檔。", {
        reason: "asset_missing",
        blobId: assetBlobId,
      });
    }
    return `assets/${basename(target)}`;
  }

  #newUniqueId(): string {
    const index = this.#index();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = newCardId(this.#now().getTime());
      if (index.get(id) === undefined && this.#files.read(id) === undefined) return id;
    }
    throw new ProtocolHandlerError("internal", "產生卡片識別碼失敗。");
  }
}

/** `assets/<sha256>.<ext>`；回傳內容雜湊。 */
function assetIdOf(asset: string | undefined): string | undefined {
  if (asset === undefined) return undefined;
  const name = asset.split("/").pop() ?? "";
  const id = name.split(".")[0];
  return id !== undefined && /^[0-9a-f]{64}$/.test(id) ? id : undefined;
}

/**
 * 從原始檔案文字裡取出 `asset:` 的雜湊。
 *
 * 只給解析失敗的檔案用：frontmatter 壞掉不代表它沒有引用原檔，那一行還
 * 寫著什麼就是什麼。找不到回 undefined。
 */
function assetIdFromText(text: string): string | undefined {
  const match =
    /^asset:[ \t]*["']?assets\/([0-9a-fA-F]{64})(?:\.[^"'\s]*)?["']?(?:[ \t]*#.*)?$/m.exec(text);
  return match === null ? undefined : (match[1] as string).toLowerCase();
}

function sameFacts(
  row: CardIndexRow,
  entry: { readonly mtimeMs: number; readonly sizeBytes: number },
): boolean {
  return Math.round(row.mtimeMs) === Math.round(entry.mtimeMs) && row.sizeBytes === entry.sizeBytes;
}

function brokenRecord(
  content: CardFileEntry & { readonly text: string },
  reason: string,
  indexedAt: string,
): IndexedCardRecord {
  // 格式不符的檔案仍是資料：還寫著 `asset:` 就記下引用，之後的回收才不會
  // 把它當成沒人引用。回收最終仍以檔案掃描為準，這裡只是讓索引不誤導。
  const assetId = assetIdFromText(content.text);
  return {
    cardId: content.cardId,
    path: `cards/${content.cardId}.md`,
    mtimeMs: content.mtimeMs,
    sizeBytes: content.sizeBytes,
    contentHash: sha256Hex(content.text),
    indexedAt,
    broken: true,
    brokenReason: reason,
    ...(assetId === undefined ? {} : { assetId }),
  };
}

/** 把 `updated` 放在 `created` 後面（`created` 不在時接在最後），與新卡一致。 */
function withUpdatedKey(presentKeys: readonly string[]): string[] {
  if (presentKeys.includes("updated")) return [...presentKeys];
  const index = presentKeys.indexOf("created");
  if (index < 0) return [...presentKeys, "updated"];
  return [...presentKeys.slice(0, index + 1), "updated", ...presentKeys.slice(index + 1)];
}

/** 版面比照 `withUpdatedKey`：`updated` 排在 `created` 後面。 */
function withUpdatedField(layout: readonly FrontmatterLayoutItem[]): FrontmatterLayoutItem[] {
  if (layout.some((item) => item.kind === "field" && item.key === "updated")) {
    return [...layout];
  }
  const result: FrontmatterLayoutItem[] = [];
  let inserted = false;
  for (const item of layout) {
    result.push(item);
    if (!inserted && item.kind === "field" && item.key === "created") {
      result.push({ kind: "field", key: "updated" });
      inserted = true;
    }
  }
  if (!inserted) result.push({ kind: "field", key: "updated" });
  return result;
}

function matchesQueryTags(tags: readonly string[], wanted: readonly string[]): boolean {
  return wanted.every((tag) => tags.includes(tag));
}

function matchesLifecycle(lifecycle: string, filter: CardQuery["lifecycle"]): boolean {
  if (filter === undefined || filter === "all") return true;
  return lifecycle === filter;
}

function cardIdOfFileName(fileName: string): string | null {
  const match = /^([0-9A-HJKMNP-TV-Z]{26})\.md$/i.exec(fileName);
  return match === null ? null : (match[1] as string).toUpperCase();
}

function normalizeCardId(cardId: string): string {
  const trimmed = cardId.trim();
  if (!isUlid(trimmed)) {
    throw new ProtocolHandlerError("invalid_message", "卡片識別碼必須是 ULID。", {
      reason: "invalid_card_id",
      cardId,
    });
  }
  return trimmed.toUpperCase();
}

function truncate(text: string, max: number): string {
  return [...text].slice(0, max).join("");
}

/** 儲存層的錯誤轉成協定看得懂的碼；其他例外照原樣往上。 */
export function asCardProtocolError(error: unknown): ProtocolHandlerError {
  if (error instanceof ProtocolHandlerError) return error;
  if (error instanceof StorageError) {
    return new ProtocolHandlerError("unavailable", error.message, { reason: error.code });
  }
  return new ProtocolHandlerError("internal", "卡片操作失敗。");
}
