/**
 * 八層的組裝：固定前綴、逐字稿的代表項與用量估算。
 *
 * 第 1 到 6 層由寫死的層順序與 `context_entries` 組出；第 7 層是引擎的
 * 逐字稿，這裡只放一個代表項；第 8 層是每輪重算的尾端訊息，也放一個
 * 代表項，讓 `usedTokens` 的加總看得到它。
 */

import {
  CONTEXT_LAYERS,
  DEFAULT_COMPACTION_THRESHOLD,
  DEFAULT_RESERVE_TOKENS,
  SYSTEM_LAYERS,
  assembleSystemContext,
  budgetTokensOf,
  buildContextView,
  correctEstimates,
  correctionFactor,
  estimateTokens,
  isCompactionDue,
  layerIndex,
  nextPosition,
  sortEntries,
  volatileStateText,
  type CardKind,
  type CardService,
  type ContextEntry,
  type ContextLayer,
  type ContextView,
  type DealtCard,
  type SystemSection,
} from "@cardiary/domain";

import type { ContextRecord, ContextStore } from "./store.js";

/** 預算來源；由服務依主模型與設定提供。 */
export interface ContextBudget {
  readonly contextWindow: number;
  readonly reserveTokens: number;
  readonly compactionThreshold: number;
}

/** 組裝的結果；`systemContext` 是第 1 到 6 層的固定前綴。 */
export interface AssembledContext {
  readonly systemContext: string;
  readonly view: ContextView;
  readonly sections: readonly SystemSection[];
  readonly cardIds: readonly string[];
  readonly due: boolean;
}

/** 加入卡片時可以丟的錯誤。 */
export class ContextError extends Error {
  readonly code: "not_found" | "invalid";

  constructor(code: "not_found" | "invalid", message: string) {
    super(message);
    this.name = "ContextError";
    this.code = code;
  }
}

export interface ContextAssemblerOptions {
  readonly store: ContextStore;
  readonly cards: CardService;
  readonly budget: () => ContextBudget;
  readonly now?: () => Date;
  readonly timeZone?: string;
}

/** 上下文組裝器；所有變動都經過它，確保視圖與固定前綴一致。 */
export class ContextAssembler {
  readonly #store: ContextStore;
  readonly #cards: CardService;
  readonly #budget: () => ContextBudget;
  readonly #now: () => Date;
  readonly #timeZone: string;

  constructor(options: ContextAssemblerOptions) {
    this.#store = options.store;
    this.#cards = options.cards;
    this.#budget = options.budget;
    this.#now = options.now ?? (() => new Date());
    this.#timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  }

  /** 確保對話有上下文列。 */
  ensure(conversationId: string): ContextRecord {
    return this.#store.ensure(conversationId, this.#defaults());
  }

  /** 把卡片追加到後段；重複加入同一張卡是安全的。 */
  async addCard(conversationId: string, cardId: string): Promise<ContextView> {
    this.ensure(conversationId);
    const card = await this.#cards.get(cardId);
    if (card === null) {
      throw new ContextError("not_found", `找不到卡片 ${cardId}。`);
    }
    const entries = this.#store.entries(conversationId);
    const existing = entries.find((entry) => entry.cardId === cardId);
    if (existing !== undefined) {
      if (existing.state === "pending-removal") {
        this.#store.updateEntry(existing.entryId, { state: "active" });
      }
      return (await this.assemble(conversationId, { bumpVersion: true })).view;
    }
    const layer = resolveAddLayer(card.frontmatter.kind, entries);
    const entry: ContextEntry = {
      entryId: entryIdOf(conversationId, `card:${cardId}`),
      layer,
      cardId,
      title: card.frontmatter.title,
      tokenEstimate: estimateTokens(`${card.frontmatter.title}\n${card.body}`),
      state: "active",
      position: nextPosition(entries, layer),
      dealSource: "manual",
    };
    this.#store.addEntry(conversationId, entry);
    await this.#cards.noteConversationLoad({ conversationId, cardId });
    return (await this.assemble(conversationId, { bumpVersion: true })).view;
  }

  /** 標記移除；下一次壓縮才真的拿掉。 */
  async removeCard(conversationId: string, cardId: string): Promise<ContextView> {
    this.ensure(conversationId);
    const entry = this.#store.entryOfCard(conversationId, cardId);
    if (entry === null) {
      throw new ContextError("not_found", `卡片 ${cardId} 不在這場對話的上下文裡。`);
    }
    if (entry.state !== "pending-removal") {
      this.#store.markPendingRemoval(entry.entryId, this.#now().toISOString());
    }
    return (await this.assemble(conversationId, { bumpVersion: true })).view;
  }

  /**
   * 開局寫入第 4 層（`opening-memory`）。
   *
   * 只應在對話的第一則訊息之前呼叫一次；重複呼叫是安全的 no-op。0 張被發時
   * 寫一個無卡片的 `opening-deal` 標記項，讓之後的回合不會再走一遍檢索與
   * 判斷。標記項沒有 `cardId`，不進前綴，只用來標記「這場對話開過局」。
   */
  async appendOpeningMemory(
    conversationId: string,
    cards: readonly DealtCard[],
  ): Promise<ContextView> {
    this.ensure(conversationId);
    const openingDealt = this.#store
      .entries(conversationId)
      .some((entry) => entry.layer === "opening-memory");
    if (!openingDealt) {
      for (const card of cards) {
        this.#store.addEntry(conversationId, {
          entryId: entryIdOf(conversationId, `deal:${card.cardId}`),
          layer: "opening-memory",
          cardId: card.cardId,
          title: card.title,
          tokenEstimate: card.tokenEstimate,
          state: "active",
          position: card.position,
          ...(card.dealProbability === undefined ? {} : { dealProbability: card.dealProbability }),
          dealSource: card.dealSource,
        });
      }
      if (cards.length === 0) {
        this.#store.addEntry(conversationId, {
          entryId: entryIdOf(conversationId, "opening-deal"),
          layer: "opening-memory",
          title: "開局發牌",
          tokenEstimate: 0,
          state: "active",
          position: 0,
        });
      }
    }
    return (await this.assemble(conversationId, { bumpVersion: !openingDealt })).view;
  }

  /** 目前視圖；不會加版本。 */
  async view(conversationId: string): Promise<ContextView> {
    return (await this.assemble(conversationId)).view;
  }

  /** 重算並落地視圖；`bumpVersion` 用在內容變動，`workingTokens` 用在壓縮後。 */
  async assemble(
    conversationId: string,
    options: { readonly bumpVersion?: boolean; readonly workingTokens?: number } = {},
  ): Promise<AssembledContext> {
    const record = this.ensure(conversationId);
    await this.#syncFixedCards(conversationId);
    const stored = this.#store.entries(conversationId);
    const contributions = await this.#renderCards(stored);

    const now = this.#now();
    const working = this.#workingEntry(conversationId, stored, record, options.workingTokens);
    const volatile = this.#volatileEntry(conversationId, stored, now);

    // 只校正第 1 到 6 層：第 7 層已經是上一輪送出的實際大小，第 8 層是固定小量。
    const cardRaw = contributions.map((contribution) => contribution.rawTokens);
    const usage = this.#store.latestUsage(conversationId);
    const compactedAfterLastUsage =
      record.lastCompactedAt !== undefined &&
      (usage === null || usage.recordedAt <= record.lastCompactedAt);
    const estimatedPrefix =
      cardRaw.reduce((sum, value) => sum + value, 0) +
      Math.max(0, working.rawTokens) +
      Math.max(0, volatile.rawTokens);
    const factor = compactedAfterLastUsage
      ? 1
      : correctionFactor(usage?.requestTokens ?? null, estimatedPrefix);
    const corrected = correctEstimates(cardRaw, factor);
    const workingTokens = Math.max(0, Math.round(working.rawTokens));
    const volatileTokens = Math.max(0, Math.round(volatile.rawTokens));
    const usedTokens = corrected.total + workingTokens + volatileTokens;

    contributions.forEach((contribution, index) => {
      this.#store.updateEntry(contribution.entry.entryId, {
        tokenEstimate: corrected.estimates[index] ?? 0,
      });
    });
    this.#store.updateEntry(working.entry.entryId, { tokenEstimate: workingTokens });
    this.#store.updateEntry(volatile.entry.entryId, { tokenEstimate: volatileTokens });

    const budget = this.#budget();
    const entries = this.#store.entries(conversationId);
    const version = record.version + (options.bumpVersion === true ? 1 : 0);
    this.#store.updateMetrics(conversationId, {
      version,
      usedTokens,
      budgetTokens: budgetTokensOf(budget.contextWindow, budget.reserveTokens),
      contextWindow: budget.contextWindow,
      compactionThreshold: budget.compactionThreshold,
      reserveTokens: budget.reserveTokens,
    });

    const view = buildContextView({
      sessionId: conversationId,
      version,
      entries: sortEntries(entries),
      budgetTokens: budgetTokensOf(budget.contextWindow, budget.reserveTokens),
      contextWindow: budget.contextWindow,
      compactionThreshold: budget.compactionThreshold,
      ...(record.lastCompactedAt === undefined ? {} : { lastCompactedAt: record.lastCompactedAt }),
    });

    return {
      systemContext: assembleSystemContext(
        contributions.map((contribution) => contribution.section),
      ),
      view,
      sections: contributions.map((contribution) => contribution.section),
      cardIds: contributions.map((contribution) => contribution.cardId),
      due: isCompactionDue(view),
    };
  }

  /** 卡片層的預設內容：基岩與人格只有第一次組裝時補上。 */
  async #syncFixedCards(conversationId: string): Promise<void> {
    const existing = this.#store.entries(conversationId);
    const hasBedrock = existing.some((entry) => entry.layer === "bedrock");
    const hasPersona = existing.some((entry) => entry.layer === "persona");
    if (!hasBedrock) {
      await this.#seedLayer(conversationId, "bedrock", "bedrock");
    }
    if (!hasPersona) {
      await this.#seedLayer(conversationId, "persona", "persona");
    }
  }

  async #seedLayer(conversationId: string, layer: ContextLayer, kind: CardKind): Promise<void> {
    const page = await this.#cards.list({ kinds: [kind], limit: 200 });
    let entries = this.#store.entries(conversationId);
    for (const summary of page.items) {
      if (entries.some((entry) => entry.cardId === summary.cardId)) continue;
      this.#store.addEntry(conversationId, {
        entryId: entryIdOf(conversationId, `card:${summary.cardId}`),
        layer,
        cardId: summary.cardId,
        title: summary.title,
        tokenEstimate: estimateTokens(summary.title),
        state: "active",
        position: nextPosition(entries, layer),
      });
      entries = this.#store.entries(conversationId);
    }
  }

  /** 讀取卡片內容並排成固定前綴的區段；卡片被刪除時順手清掉項目。 */
  async #renderCards(entries: readonly ContextEntry[]): Promise<
    readonly {
      readonly entry: ContextEntry;
      readonly cardId: string;
      readonly section: SystemSection;
      readonly rawTokens: number;
    }[]
  > {
    const contributions: {
      entry: ContextEntry;
      cardId: string;
      section: SystemSection;
      rawTokens: number;
    }[] = [];
    for (const entry of entries) {
      if (entry.cardId === undefined) continue;
      if (!SYSTEM_LAYERS.includes(entry.layer)) continue;
      const card = await this.#cards.get(entry.cardId);
      if (card === null) {
        this.#store.deleteEntry(entry.entryId);
        continue;
      }
      const text = card.body.trim();
      if (text.length === 0) continue;
      contributions.push({
        entry,
        cardId: entry.cardId,
        section: {
          layer: entry.layer,
          title: card.frontmatter.title,
          text: card.body,
        },
        rawTokens: estimateTokens(`${card.frontmatter.title}\n${card.body}`),
      });
    }
    return contributions;
  }

  /** 第 7 層的代表項；估算用最近一輪送出的前綴，沒有時是 0。 */
  #workingEntry(
    conversationId: string,
    entries: readonly ContextEntry[],
    record: ContextRecord,
    override: number | undefined,
  ): { readonly entry: ContextEntry; readonly rawTokens: number } {
    const entryId = entryIdOf(conversationId, "working");
    const existing = entries.find((entry) => entry.entryId === entryId);
    const usage = this.#store.latestUsage(conversationId);
    const compactedAfterLastUsage =
      record.lastCompactedAt !== undefined &&
      (usage === null || usage.recordedAt <= record.lastCompactedAt);
    const rawTokens =
      override ??
      (compactedAfterLastUsage
        ? Math.max(0, existing?.tokenEstimate ?? 0)
        : Math.max(0, usage?.requestTokens ?? 0));
    const entry =
      existing ??
      this.#createMarker(conversationId, entryId, "working-context", "對話內容", rawTokens);
    return { entry, rawTokens };
  }

  /** 第 8 層的代表項；每次請求重算，估算固定小量。 */
  #volatileEntry(
    conversationId: string,
    entries: readonly ContextEntry[],
    now: Date,
  ): { readonly entry: ContextEntry; readonly rawTokens: number } {
    const entryId = entryIdOf(conversationId, "volatile");
    const existing = entries.find((entry) => entry.entryId === entryId);
    const text = volatileStateText(now, this.#timeZone);
    const rawTokens = estimateTokens(text);
    const entry =
      existing ??
      this.#createMarker(conversationId, entryId, "volatile-state", "目前狀態", rawTokens);
    return { entry, rawTokens };
  }

  #createMarker(
    conversationId: string,
    entryId: string,
    layer: ContextLayer,
    title: string,
    tokenEstimate: number,
  ): ContextEntry {
    const entry: ContextEntry = {
      entryId,
      layer,
      title,
      tokenEstimate,
      state: "active",
      position: 0,
    };
    this.#store.addEntry(conversationId, entry);
    return entry;
  }

  #defaults(): {
    readonly contextWindow: number;
    readonly budgetTokens: number;
    readonly compactionThreshold: number;
    readonly reserveTokens: number;
  } {
    const budget = this.#budget();
    return {
      contextWindow: budget.contextWindow,
      budgetTokens: budgetTokensOf(budget.contextWindow, budget.reserveTokens),
      compactionThreshold: budget.compactionThreshold,
      reserveTokens: budget.reserveTokens,
    };
  }
}

/**
 * 手動加入的卡片要放在哪裡。
 *
 * 卡片只往後追加：自然層在目前最後一張卡之前時，改放第 6 層尾端，
 * 這樣已送出的前綴不會被插入的內容改寫。
 */
export function resolveAddLayer(kind: CardKind, entries: readonly ContextEntry[]): ContextLayer {
  const natural: ContextLayer =
    kind === "bedrock"
      ? "bedrock"
      : kind === "persona"
        ? "persona"
        : kind === "summary"
          ? "short-term-memory"
          : kind === "memory"
            ? "opening-memory"
            : "other-cards";
  const lastCardLayer = entries.reduce((max, entry) => {
    if (entry.cardId === undefined) return max;
    return Math.max(max, layerIndex(entry.layer));
  }, -1);
  if (layerIndex(natural) >= lastCardLayer) return natural;
  return "other-cards";
}

/** 項目識別碼：會話加用途，同一場對話內唯一。 */
export function entryIdOf(conversationId: string, suffix: string): string {
  return `${conversationId}:${suffix}`;
}

/** 層的固定順序；測試與除錯用。 */
export { CONTEXT_LAYERS, DEFAULT_COMPACTION_THRESHOLD, DEFAULT_RESERVE_TOKENS };
