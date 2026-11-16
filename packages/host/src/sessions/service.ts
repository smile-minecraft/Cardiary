import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssetStore, CardService } from "@cardiary/domain";
import type { ModelInvoker, ModuleLogger, ProtocolEventEmitter } from "@cardiary/module-api";
import type { ConversationSummary } from "@cardiary/engine-adapter";
import type { ConversationRecord, Database, FolderLayout, SettingsStore } from "@cardiary/storage";
import {
  ConversationStore,
  FreshnessStore,
  addDaysIso,
  assetIdsInCardText,
  existingAssetIds,
} from "@cardiary/storage";

import type { HostEngine } from "../engine/types.js";
import { AgentAudit } from "../permissions/agent-audit.js";

/**
 * 對話生命週期：封存、取消封存、倒數結束的摘要與刪除。
 *
 * 卡片庫擁有卡片檔；這裡只決定「哪些卡片只屬於這個對話」，卡片的檔案、
 * 索引與原檔都交回卡片庫與儲存層處理。規格書第 7 章：刪除立刻清掉對話、
 * 支線、專屬卡片與原檔，不留摘要；倒數結束先產生摘要卡再刪對話紀錄。
 */

/** 系統產生的卡片種類不能從公開的 `CardService` 建立；執行時是同一個實例。 */
interface SystemCardWriter {
  create(input: {
    readonly kind: "summary";
    readonly title: string;
    readonly body: string;
    readonly summary?: string;
    readonly allowSystemKinds: true;
  }): Promise<{ readonly cardId: string }>;
}

export interface SessionLifecycleOptions {
  readonly layout: FolderLayout;
  readonly state: Database;
  /** 快取索引的連線會換，所以用 getter。 */
  readonly cache: () => Database;
  readonly settings: SettingsStore;
  readonly engine: HostEngine;
  readonly cards: CardService;
  readonly assets: AssetStore;
  readonly models: ModelInvoker;
  readonly protocol: ProtocolEventEmitter;
  readonly logger: ModuleLogger;
  readonly now: () => Date;
}

export interface ArchiveResult {
  readonly archivedAt: string;
  readonly purgeAt: string;
}

export interface DeletionPreview {
  readonly subtreeSessionIds: readonly string[];
  readonly exclusiveCards: number;
  readonly sharedCards: number;
  readonly assets: number;
}

export interface DeletionResult {
  readonly deletedSessionIds: readonly string[];
  readonly deletedCards: number;
  readonly deletedAssets: number;
}

/** 生命週期的錯誤；協定層把它轉成線路上的錯誤碼。 */
export class SessionLifecycleError extends Error {
  readonly code: "not_found" | "invalid_message" | "unavailable";

  constructor(code: SessionLifecycleError["code"], message: string) {
    super(message);
    this.name = "SessionLifecycleError";
    this.code = code;
  }
}

const MAX_PURGE_DAYS = 365;
const SUMMARY_MAX_BODY = 200_000;

export class SessionLifecycleService {
  readonly #layout: FolderLayout;
  readonly #state: Database;
  readonly #cache: () => Database;
  readonly #settings: SettingsStore;
  readonly #engine: HostEngine;
  readonly #cards: CardService;
  readonly #systemCards: SystemCardWriter;
  readonly #assets: AssetStore;
  readonly #models: ModelInvoker;
  readonly #protocol: ProtocolEventEmitter;
  readonly #logger: ModuleLogger;
  readonly #now: () => Date;
  readonly #conversations: ConversationStore;
  readonly #freshness: FreshnessStore;
  readonly #audit: AgentAudit;
  /** 同一時間只跑一組到期封存；30 秒計時器與手動呼叫不重複摘要。 */
  #processDueArchivesRunning = false;
  /** 封存狀態的變更相互排除：摘要完成後的清除與取消封存不能交錯。 */
  #archiveMutationChain: Promise<void> = Promise.resolve();

  constructor(options: SessionLifecycleOptions) {
    this.#layout = options.layout;
    this.#state = options.state;
    this.#cache = options.cache;
    this.#settings = options.settings;
    this.#engine = options.engine;
    this.#cards = options.cards;
    this.#systemCards = options.cards as unknown as SystemCardWriter;
    this.#assets = options.assets;
    this.#models = options.models;
    this.#protocol = options.protocol;
    this.#logger = options.logger;
    this.#now = options.now;
    this.#conversations = new ConversationStore({ db: this.#state, now: this.#now });
    this.#audit = new AgentAudit(this.#layout.subfolderPath("state"));
    this.#freshness = new FreshnessStore({
      db: this.#state,
      now: this.#now,
      halfLifeDays: () => this.#halfLifeDays(),
    });
  }

  /** 依規格書第 7 章重新計算所有新鮮度；啟動時呼叫一次。 */
  recomputeFreshness(): number {
    return this.#freshness.recomputeAll();
  }

  /** 從狀態庫讀取目前的封存倒數。 */
  archiveOf(sessionId: string): ArchiveResult | undefined {
    const stored = this.#conversations.get(sessionId);
    if (stored?.archivedAt === undefined || stored.purgeAt === undefined) return undefined;
    return { archivedAt: stored.archivedAt, purgeAt: stored.purgeAt };
  }

  /** 開始或更新封存倒數；已經在倒數中時保留第一次的 `archived_at`。 */
  async archive(
    sessionId: string,
    purgeAfterDays?: number,
    archivedBy = "user",
  ): Promise<ArchiveResult> {
    const summary = await this.#engine.getConversation(sessionId as never);
    const existing = this.#conversations.get(sessionId);
    if (summary === null && existing === undefined) {
      throw new SessionLifecycleError("not_found", `找不到會話 ${sessionId}。`);
    }
    if (existing?.archivedAt !== undefined && existing.purgeAt !== undefined) {
      // 冪等：重複封存不重設倒數。
      return { archivedAt: existing.archivedAt, purgeAt: existing.purgeAt };
    }
    if (purgeAfterDays !== undefined) {
      if (
        !Number.isInteger(purgeAfterDays) ||
        purgeAfterDays < 1 ||
        purgeAfterDays > MAX_PURGE_DAYS
      ) {
        throw new SessionLifecycleError("invalid_message", "倒數天數必須是 1 到 365 的整數。");
      }
    }
    const days = purgeAfterDays ?? this.#archiveCountdownDays();
    const archivedAt = this.#iso();
    const purgeAt = addDaysIso(archivedAt, days);
    this.#ensureConversation(sessionId, summary, archivedAt);

    const subtree = await this.#subtree(sessionId);
    const cardIds = this.#conversations.referencedCardIds(subtree);
    // 先以封存前的有效值當新錨點，再把封存狀態落地。順序反過來的話，
    // compute 會看到「這張卡已經在倒數中」，把封存前的時間也當成線性下降，
    // 或在另一場封存對話的倒數中把值算回去。
    this.#freshness.anchorAfterArchive(cardIds, archivedAt);
    this.#conversations.archive({ conversationId: sessionId, archivedAt, purgeAt, archivedBy });

    this.#emitLifecycle("archived", sessionId, {
      sessionId,
      archive: { archivedAt, purgeAt },
    });
    return { archivedAt, purgeAt };
  }

  /** 取消封存；沒有在倒數中時回 false，不送事件。 */
  async unarchive(sessionId: string): Promise<{ sessionId: string; unarchived: boolean }> {
    // 和到期封存的清除相互排除：摘要成功後不能讓這裡的寫入和刪除交錯。
    return this.#withArchiveMutation(async () => {
      const existing = this.#conversations.get(sessionId);
      if (existing === undefined || existing.archivedAt === undefined) {
        return { sessionId, unarchived: false };
      }
      const at = this.#iso();
      const subtree = await this.#subtree(sessionId);
      const cardIds = this.#conversations.referencedCardIds(subtree);
      // 先算好取消當下的有效值（含線性下降），取消後才不會看起來瞬間回春。
      const values = cardIds.map((cardId) => ({
        cardId,
        value: this.#freshness.compute(cardId, at),
      }));
      this.#conversations.unarchive(sessionId);
      this.#freshness.resumeAfterUnarchive(values, at);
      this.#emitLifecycle("unarchived", sessionId, { sessionId });
      return { sessionId, unarchived: true };
    });
  }

  /** 刪除前的預估；不改任何狀態。 */
  async preview(sessionId: string): Promise<DeletionPreview> {
    await this.#assertKnown(sessionId);
    const subtree = await this.#subtree(sessionId);
    return this.#previewOf(subtree);
  }

  /**
   * 立即刪除：對話、支線、專屬卡片與原檔；沒有摘要、不留紀錄。
   *
   * 專屬卡片被其他對話引用或釘在白板時保留。原檔交給卡片庫的回收規則：
   * 只有確認沒有任何卡片引用時才刪，否則保留。
   */
  async delete(sessionId: string): Promise<DeletionResult> {
    await this.#assertKnown(sessionId);
    const subtree = await this.#subtree(sessionId);
    const exclusive = this.#conversations.exclusiveCardIds(subtree);
    const assetIds = this.#assetIdsOfCards(exclusive);
    const assetsPresentBefore = existingAssetIds(this.#layout, assetIds);

    // 狀態庫刪除意圖含 card_ids／asset_ids；引擎路徑的 Cardiary 交易與恢復
    // 都靠它。fake 引擎不寫意圖，下面的本機清理會補上。
    await this.#engine.deleteConversation(sessionId as never, { includeBranches: true });
    // 引擎路徑（產品組裝）完成後會移除它自己的意圖，但卡片檔與快取索引列
    // 是這裡收的。先補一筆意圖，卡片刪到一半失敗時下次啟動才有人接手；
    // 卡片全部刪除成功才移除。
    this.#putCardDeletionIntent(sessionId, subtree, exclusive, assetIds);
    this.#conversations.deleteConversations(subtree);
    this.#forgetAudit(subtree);
    const deletedCards = await this.#deleteCards(exclusive, subtree);

    await this.#releaseAssets(assetIds);
    const assetsPresentAfter = existingAssetIds(this.#layout, assetIds);
    const deletedAssets = [...assetsPresentBefore].filter(
      (assetId) => !assetsPresentAfter.has(assetId),
    ).length;
    this.#removeDeletionIntent(sessionId);
    // 引擎刪除只壓縮引擎庫；狀態庫的 free page 還在，WAL 也可能留著舊頁。
    // 補上 checkpoint 與 incremental_vacuum，資料庫檔才會真的縮小。
    this.#compactDatabases();

    const result: DeletionResult = {
      deletedSessionIds: subtree,
      deletedCards,
      deletedAssets,
    };
    this.#emitLifecycle("deleted", sessionId, {
      sessionId,
      deletedSessionIds: subtree,
      deletedCards,
      deletedAssets,
    });
    return result;
  }

  /**
   * 處理到期的封存：摘要、刪除對話與引用，專屬卡片保留但歸零。
   *
   * 摘要失敗時不刪除：保留原狀，`purge_at` 已過期會留在下一次啟動重試。
   */
  async processDueArchives(): Promise<number> {
    // 已有一組到期封存在跑（計時器可能在模型摘要的 120 秒逾時裡再觸發）時直接返回。
    if (this.#processDueArchivesRunning) return 0;
    this.#processDueArchivesRunning = true;
    try {
      const now = this.#iso();
      const due = this.#conversations.due(now);
      let processed = 0;
      for (const row of due) {
        try {
          if (await this.#purgeArchivedConversation(row.conversationId)) {
            processed += 1;
          }
        } catch (error) {
          this.#logger.warn("封存倒數結束，摘要失敗；保留對話待下次重試", {
            sessionId: row.conversationId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return processed;
    } finally {
      this.#processDueArchivesRunning = false;
    }
  }

  /** 目前待處理的封存；診斷與測試用。 */
  dueArchives(): readonly ConversationRecord[] {
    return this.#conversations.due(this.#iso());
  }

  /**
   * 到期封存的清除。回傳 true 代表真的清掉了；回傳 false 代表封存在
   * 摘要期間被取消，什麼都沒有刪。
   *
   * 摘要可能跑到 120 秒；期間使用者取消封存是合法的。`archived_at`／
   * `purge_at` 在摘要返回後會重新確認，確認和刪除又和取消封存相互排除，
   * 所以取消封存不會和清除交錯。
   */
  async #purgeArchivedConversation(conversationId: string): Promise<boolean> {
    const initial = this.#conversations.get(conversationId);
    if (initial === undefined) return false;
    if (initial.archivedAt === undefined || initial.purgeAt === undefined) return false;

    let summaryCardId = initial.archiveSummaryCardId;
    let createdCardId: string | undefined;
    if (summaryCardId === undefined) {
      summaryCardId = await this.#summarizeConversation(conversationId);
      createdCardId = summaryCardId;
    }

    return this.#withArchiveMutation(async () => {
      const current = this.#conversations.get(conversationId);
      if (
        current === undefined ||
        current.archivedAt === undefined ||
        current.purgeAt === undefined ||
        current.archivedAt !== initial.archivedAt ||
        current.purgeAt !== initial.purgeAt
      ) {
        // 取消封存在摘要期間成立（或被重新封存成另一個倒數）：保留對話，
        // 剛建立的摘要卡沒人要留，一起移除。
        if (createdCardId !== undefined) {
          try {
            await this.#cards.delete(createdCardId);
          } catch (error) {
            this.#logger.warn("取消封存後摘要卡刪除失敗，留下孤兒摘要卡", {
              cardId: createdCardId,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return false;
      }
      if (createdCardId !== undefined && current.archiveSummaryCardId === undefined) {
        this.#conversations.setSummaryCard(conversationId, createdCardId);
      }

      const subtree = await this.#subtree(conversationId);
      // 先拿掉卡片引用並歸零，但對話列留到引擎刪除成功；中斷後 `purge_at`
      // 還在，下一次啟動會重試，不會留下刪一半的對話。
      const cardIds = this.#conversations.removeCardReferences(subtree);
      const at = this.#iso();
      this.#freshness.zeroUnreferenced(cardIds, at);

      await this.#engine.deleteConversation(conversationId as never, { includeBranches: true });
      this.#conversations.deleteConversations(subtree);
      this.#forgetAudit(subtree);
      this.#removeDeletionIntent(conversationId);
      this.#emitLifecycle("deleted", conversationId, {
        sessionId: conversationId,
        deletedSessionIds: subtree,
        deletedCards: 0,
        deletedAssets: 0,
      });
      return true;
    });
  }

  async #summarizeConversation(conversationId: string): Promise<string> {
    const summary = await this.#engine.getConversation(conversationId as never);
    const history = await this.#engine.readConversationHistory({
      conversationId: conversationId as never,
      limit: 400,
    });
    const transcript = history.messages
      .slice(-400)
      .map(
        (message) => `${message.role === "user" ? "使用者" : "助理"}: ${textOf(message.content)}`,
      )
      .join("\n");
    const title = summary?.title?.trim() || "未命名對話";
    const prompt = [
      "請把下面的對話壓成一張卡片大小的摘要，保留：使用者的目標、已決定的事、未完成的待辦、關鍵事實與數字。",
      "不要加上原本沒有的內容；不確定的地方寫「未確定」。",
      "只輸出摘要正文，不要加標題或評論。",
      "",
      `對話標題：${title}`,
      "",
      transcript.length > SUMMARY_MAX_BODY ? transcript.slice(0, SUMMARY_MAX_BODY) : transcript,
    ].join("\n");
    const result = await this.#models.invoke(
      {
        role: "small",
        purpose: "封存摘要",
        prompt,
        maxOutputTokens: 4096,
        conversationId: conversationId as never,
      },
      { signal: AbortSignal.timeout(120_000) },
    );
    const text = result.text.trim();
    if (text.length === 0) {
      throw new SessionLifecycleError("unavailable", "摘要模型回傳了空白內容。");
    }
    const card = await this.#systemCards.create({
      kind: "summary",
      title: `對話摘要：${title}`.slice(0, 300),
      summary: [...text].slice(0, 200).join(""),
      body: text,
      allowSystemKinds: true,
    });
    return card.cardId;
  }

  async #assertKnown(sessionId: string): Promise<void> {
    const summary = await this.#engine.getConversation(sessionId as never);
    if (summary !== null) return;
    const stored = this.#conversations.get(sessionId);
    if (stored !== undefined) return;
    const referenced = this.#conversations.referencedCardIds([sessionId]);
    if (referenced.length > 0) return;
    throw new SessionLifecycleError("not_found", `找不到會話 ${sessionId}。`);
  }

  #previewOf(subtree: readonly string[]): DeletionPreview {
    const exclusive = this.#conversations.exclusiveCardIds(subtree);
    const shared = this.#conversations.sharedCardIds(subtree);
    const assets = this.#assetIdsOfCards(exclusive);
    return {
      subtreeSessionIds: [...subtree],
      exclusiveCards: exclusive.length,
      sharedCards: shared.length,
      assets: existingAssetIds(this.#layout, assets).size,
    };
  }

  async #subtree(sessionId: string): Promise<string[]> {
    const list = (await this.#engine.listConversations?.()) ?? [];
    if (list.length === 0) {
      return [sessionId];
    }
    const known = new Set<string>();
    for (const conversation of list) {
      known.add(conversation.id);
    }
    if (!known.has(sessionId)) {
      return [sessionId];
    }
    const byParent = new Map<string, string[]>();
    for (const conversation of list) {
      const parent = conversation.origin?.parentConversationId;
      if (parent === undefined) continue;
      const siblings = byParent.get(parent) ?? [];
      siblings.push(conversation.id);
      byParent.set(parent, siblings);
    }
    const result: string[] = [];
    const queue = [sessionId];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (visited.has(current)) continue;
      visited.add(current);
      result.push(current);
      queue.push(...(byParent.get(current) ?? []));
    }
    return result;
  }

  #assetIdsOfCards(cardIds: readonly string[]): string[] {
    const found = new Set<string>();
    for (const cardId of cardIds) {
      const file = join(this.#layout.subfolderPath("cards"), `${cardId}.md`);
      let text: string;
      try {
        text = existsSync(file) ? readFileSync(file, "utf8") : "";
      } catch {
        // 無法確認時不帶入候選；卡片庫的原檔回收會自己再掃描一次。
        continue;
      }
      for (const assetId of assetIdsInCardText(text)) {
        found.add(assetId);
      }
    }
    return [...found].sort();
  }

  async #deleteCards(cardIds: readonly string[], subtree: readonly string[]): Promise<number> {
    let deleted = 0;
    for (const cardId of cardIds) {
      const path = join(this.#layout.subfolderPath("cards"), `${cardId}.md`);
      const inIndex = this.#cardInIndex(cardId);
      if (!existsSync(path) && !inIndex) {
        // 幽靈列也算刪除：預覽有數它，回報也要有數。
        deleted += 1;
        continue;
      }
      const exclusiveAfter = this.#conversations.isExclusiveAfter([cardId], subtree);
      if (exclusiveAfter.length === 0) {
        this.#logger.warn("卡片已被其他對話引用或釘選，刪除時保留", { cardId });
        continue;
      }
      try {
        await this.#cards.delete(cardId);
        deleted += 1;
      } catch (error) {
        if (isNotFound(error)) {
          deleted += 1;
          continue;
        }
        throw new SessionLifecycleError(
          "unavailable",
          `專屬卡片 ${cardId} 刪除失敗：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return deleted;
  }

  async #releaseAssets(assetIds: readonly string[]): Promise<void> {
    for (const assetId of assetIds) {
      try {
        await this.#assets.release(assetId);
      } catch (error) {
        this.#logger.warn("原檔回收失敗，保留原檔", {
          assetId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  #cardInIndex(cardId: string): boolean {
    try {
      const database = this.#cache();
      const row = database.get<{ one: number }>(
        "SELECT 1 AS one FROM card_index WHERE card_id = ? LIMIT 1",
        cardId.toUpperCase(),
      );
      return row !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * 卡片刪除前的恢復依據：記下這批專屬卡片，階段直接是 `vacuum`。
   *
   * 對話列與引擎資料已經刪完（引擎路徑處理或上面的交易），只剩卡片檔；
   * 恢復時 `vacuum` 階段只會補刪卡片檔與壓縮，不會重跑刪列。
   */
  #putCardDeletionIntent(
    sessionId: string,
    subtree: readonly string[],
    cardIds: readonly string[],
    assetIds: readonly string[],
  ): void {
    const at = this.#iso();
    this.#state.run(
      `INSERT INTO conversation_deletions
         (root_id, conversation_ids, client_request_ids, card_ids, asset_ids, phase, requested_at, updated_at)
       VALUES (?, ?, '[]', ?, ?, 'vacuum', ?, ?)
       ON CONFLICT (root_id) DO NOTHING`,
      sessionId,
      JSON.stringify(subtree),
      JSON.stringify(cardIds),
      JSON.stringify(assetIds),
      at,
      at,
    );
  }

  #removeDeletionIntent(sessionId: string): void {
    this.#state.run("DELETE FROM conversation_deletions WHERE root_id = ?", sessionId);
  }

  /**
   * 把刪掉的對話從稽核紀錄移掉（目前檔案與輪替檔）。
   *
   * 稽核是正本區的附屬紀錄，清不掉不影響刪除結果；壞掉的行由清除端略過。
   */
  #forgetAudit(ids: readonly string[]): void {
    try {
      this.#audit.removeConversations(ids);
    } catch (error) {
      this.#logger.warn("移除對話稽核紀錄失敗", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 收掉狀態庫與快取的 WAL，再回收 free pages；快取失敗不影響刪除結果。 */
  #compactDatabases(): void {
    try {
      this.#state.checkpoint();
      this.#state.incrementalVacuum();
      this.#state.checkpoint();
    } catch (error) {
      this.#logger.warn("刪除後壓縮狀態庫失敗", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      const cache = this.#cache();
      cache.checkpoint();
      cache.incrementalVacuum();
      cache.checkpoint();
    } catch (error) {
      this.#logger.warn("刪除後壓縮快取失敗", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #ensureConversation(
    sessionId: string,
    summary: ConversationSummary | null,
    archivedAt: string,
  ): void {
    this.#conversations.ensure({
      conversationId: sessionId,
      ...(this.#conversations.get(sessionId)?.title
        ? {}
        : summary?.title === undefined
          ? {}
          : { title: summary.title }),
      ...(summary?.createdAt === undefined ? {} : { createdAt: summary.createdAt }),
      ...(summary?.updatedAt === undefined ? {} : { updatedAt: summary.updatedAt }),
      lastActivityAt: summary?.updatedAt ?? archivedAt,
    });
  }

  #emitLifecycle(
    event: "archived" | "unarchived" | "deleted",
    conversationId: string,
    payload: Record<string, unknown>,
  ): void {
    this.#protocol.emit({
      kind: "session-lifecycle",
      conversationId: conversationId as never,
      event,
      payload: payload as never,
    });
  }

  /**
   * 封存狀態變更的互斥：同一時間只有一個取消封存或清除關鍵段在跑。
   * 摘要本身不經過這裡（可能長達 120 秒）；這裡的函式只包住寫入與刪除。
   */
  async #withArchiveMutation<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.#archiveMutationChain;
    let release!: () => void;
    this.#archiveMutationChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  #iso(): string {
    return this.#now().toISOString();
  }

  #halfLifeDays(): number {
    return settingNumber(this.#settings, "freshness.halfLifeDays", 30);
  }

  #archiveCountdownDays(): number {
    return settingNumber(this.#settings, "conversation.archiveCountdownDays", 7);
  }
}

function settingNumber(settings: SettingsStore, key: string, fallback: number): number {
  const raw = settings.get(key)?.value;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function textOf(content: readonly { readonly type: string; readonly text?: string }[]): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim();
}

function isNotFound(error: unknown): boolean {
  const code = (error as { readonly code?: unknown } | null)?.code;
  return code === "not_found";
}
