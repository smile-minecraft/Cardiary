/**
 * 壓縮：挑保留範圍、產生摘要卡、丟棄逐字稿、套用等待中的變更。
 *
 * 摘要由主機產生，引擎只負責把第 7 層的起點移到保留範圍的第一則。
 * 每一步都能重來：摘要卡的血緣標記讓重跑認出同一個範圍，不會產生
 * 第二張；`compaction_in_progress` 讓重啟後知道要完成或放棄。
 */

import {
  DEFAULT_KEEP_RECENT_TOKENS,
  MAX_RELATED_PATHS,
  SUMMARY_MAX_OUTPUT_TOKENS,
  buildSummaryPrompt,
  encodeSummaryFooter,
  estimateTokens,
  extractRelatedPaths,
  nextPosition,
  parseSummaryFooter,
  planCompaction,
  renderTranscript,
  summaryTitle,
  type Card,
  type CardService,
  type CompactionMessage,
  type CompactionPlan,
  type ContextEntry,
} from "@cardiary/domain";
import type {
  ConversationCursor,
  ConversationId,
  ConversationMessage,
} from "@cardiary/engine-adapter";
import type { ModelInvoker } from "@cardiary/module-api";

import type { HostEngine } from "../engine/types.js";
import type { ContextAssembler, AssembledContext } from "./assembler.js";
import { entryIdOf } from "./assembler.js";
import type { ContextStore } from "./store.js";

/** 壓縮的觸發方式；只影響日誌與重跑，不影響範圍。 */
export type CompactionTrigger = "threshold" | "manual" | "recovery";

/** 讀卡片庫時一頁多少張、最多翻幾頁；避免卡片很多時無窮迴圈。 */
const SUMMARY_PAGE_SIZE = 200;
const SUMMARY_PAGE_LIMIT = 50;

/** 讀歷史時一頁的訊息數；引擎的上限是 200。 */
const HISTORY_PAGE_SIZE = 200;

/** 最多往回翻幾頁；避免引擎的 `nextBefore` 壞掉時無限迴圈。 */
const HISTORY_PAGE_LIMIT = 100;

/**
 * 系統產生的摘要卡。
 *
 * 公開的 `CardService` 只能建立 note、image、audio；摘要卡由壓縮器建立，
 * 和對話生命週期的封存摘要使用同一個接縫。
 */
interface SystemCardWriter {
  create(input: {
    readonly kind: "summary";
    readonly title: string;
    readonly body: string;
    readonly sources?: readonly string[];
    readonly allowSystemKinds: true;
  }): Promise<Card>;
}

export interface CompactionOutcome {
  readonly compacted: boolean;
  readonly reason?: "nothing-to-compact" | "not-supported" | "summary-failed" | "engine-failed";
  readonly summaryCardId?: string;
  readonly beforeTokens?: number;
  readonly afterTokens?: number;
  readonly compactedAt?: string;
}

/** 還沒完成的壓縮留下的摘要卡；沿用它接回，不重摘。 */
interface PendingResume {
  readonly cardId: string;
  readonly title: string;
  readonly body: string;
  readonly keepFromCursor: string;
}

export interface ContextCompactorOptions {
  readonly store: ContextStore;
  readonly assembler: ContextAssembler;
  readonly engine: HostEngine;
  readonly cards: CardService;
  readonly models: ModelInvoker;
  readonly now?: () => Date;
  readonly keepRecentTokens?: () => number;
  readonly emit?: (intent: {
    readonly kind: "context-changed" | "context-compacted";
    readonly conversationId: string;
    readonly context?: unknown;
    readonly payload?: unknown;
  }) => void;
  readonly warn?: (message: string, fields?: { readonly [key: string]: string | number }) => void;
}

/** 一場對話的壓縮器；同一時間只跑一次，後到的呼叫等同一個結果。 */
export class ContextCompactor {
  readonly #store: ContextStore;
  readonly #assembler: ContextAssembler;
  readonly #engine: HostEngine;
  readonly #cards: CardService;
  readonly #systemCards: SystemCardWriter;
  readonly #models: ModelInvoker;
  readonly #now: () => Date;
  readonly #keepRecentTokens: () => number;
  readonly #emit: ContextCompactorOptions["emit"];
  readonly #warn: ContextCompactorOptions["warn"];
  readonly #inflight = new Map<string, Promise<CompactionOutcome>>();

  constructor(options: ContextCompactorOptions) {
    this.#store = options.store;
    this.#assembler = options.assembler;
    this.#engine = options.engine;
    this.#cards = options.cards;
    this.#systemCards = options.cards as unknown as SystemCardWriter;
    this.#models = options.models;
    this.#now = options.now ?? (() => new Date());
    this.#keepRecentTokens = options.keepRecentTokens ?? (() => DEFAULT_KEEP_RECENT_TOKENS);
    this.#emit = options.emit;
    this.#warn = options.warn;
  }

  /**
   * 啟動時補做被中斷的壓縮。
   *
   * 摘要卡與保留範圍都記在卡片內文尾端；重做時沿用同一張卡，不重摘、
   * 不產生第二張。無法接回時清掉旗標，不會永遠卡在中斷狀態。
   */
  async recoverInterrupted(): Promise<void> {
    for (const conversationId of this.#store.interrupted()) {
      const outcome = await this.compact(conversationId, { trigger: "recovery" });
      if (!outcome.compacted && outcome.reason === "summary-failed") {
        this.#store.setCompactionInProgress(conversationId, false);
      }
    }
  }

  /** 壓縮一場對話；進行中的壓縮會等同一個結果。 */
  async compact(
    conversationId: string,
    options: {
      readonly trigger: CompactionTrigger;
      readonly instructions?: string;
    },
  ): Promise<CompactionOutcome> {
    const running = this.#inflight.get(conversationId);
    if (running !== undefined) return running;
    const promise = this.#compactOnce(conversationId, options);
    this.#inflight.set(conversationId, promise);
    try {
      return await promise;
    } finally {
      this.#inflight.delete(conversationId);
    }
  }

  async #compactOnce(
    conversationId: string,
    options: { readonly trigger: CompactionTrigger; readonly instructions?: string },
  ): Promise<CompactionOutcome> {
    if (typeof this.#engine.compactConversation !== "function") {
      return { compacted: false, reason: "not-supported" };
    }
    try {
      return await this.#run(conversationId, options);
    } catch (error) {
      this.#warn?.("壓縮失敗；保留資料，下次可重試", {
        conversationId,
        message: error instanceof Error ? error.message : String(error),
      });
      return { compacted: false, reason: "engine-failed" };
    }
  }

  async #run(
    conversationId: string,
    options: { readonly trigger: CompactionTrigger; readonly instructions?: string },
  ): Promise<CompactionOutcome> {
    const before = await this.#assembler.assemble(conversationId);
    // 旗標還在時，先接回上一次沒做完的壓縮；中斷在建立卡片之前的，
    // 接回後再看這一輪有沒有剩餘範圍，有的話照一般流程補一次。
    // 外面用 recovery 重試同一場對話時，也沿用上一張摘要卡，不重摘。
    const pending = await this.#pendingResume(conversationId, options.trigger);
    if (pending === "bail") {
      this.#store.setCompactionInProgress(conversationId, false);
      return { compacted: false, reason: "nothing-to-compact" };
    }
    let resumed: CompactionOutcome | null = null;
    if (pending !== null) {
      resumed = await this.#resume(conversationId, pending, before);
      if (!resumed.compacted) return resumed;
    }
    const plan = await this.#plan(conversationId);
    if (plan === null) {
      this.#store.setCompactionInProgress(conversationId, false);
      return resumed ?? { compacted: false, reason: "nothing-to-compact" };
    }

    // 從這裡開始會寫摘要卡；先標記進行中，重啟後才知道要補完。
    this.#store.setCompactionInProgress(conversationId, true);
    const existing = await this.#existingSummary(conversationId, plan);
    let summaryCardId: string;
    let summaryCardTitle: string;
    let summaryBody: string;
    if (existing !== null) {
      summaryCardId = existing.cardId;
      summaryCardTitle = existing.title;
      summaryBody = existing.body;
    } else {
      let summary: string;
      try {
        summary = await this.#summarize(plan, options.instructions);
      } catch (error) {
        this.#store.setCompactionInProgress(conversationId, false);
        this.#warn?.("摘要失敗；不刪任何資料", {
          conversationId,
          message: error instanceof Error ? error.message : String(error),
        });
        return { compacted: false, reason: "summary-failed" };
      }
      const footer = encodeSummaryFooter({
        conversationId,
        fromCursor: plan.dropped[0]?.cursor ?? "",
        toCursor: plan.dropped.at(-1)?.cursor ?? "",
        keepFromCursor: plan.keepFromCursor,
      });
      summaryBody = `${summary.trim()}\n\n${footer}`;
      const card = await this.#systemCards.create({
        kind: "summary",
        title: summaryTitle(this.#now().toISOString()),
        body: summaryBody,
        sources: await this.#summarySources(conversationId),
        allowSystemKinds: true,
      });
      summaryCardId = card.cardId;
      summaryCardTitle = card.frontmatter.title;
    }

    const keptTokens = plan.kept.reduce((sum, message) => sum + message.tokenEstimate, 0);
    return this.#finish(conversationId, {
      summaryCardId,
      summaryCardTitle,
      summaryBody,
      keepFromCursor: plan.keepFromCursor,
      keptTokens,
      before: await this.#assembler.assemble(conversationId),
    });
  }

  /**
   * 接回還沒完成的壓縮：沿用摘要卡與保留範圍，不重摘、不建新卡。
   *
   * 引擎的壓縮是重送安全的：假引擎重設第 7 層的起點，Pi 引擎會認出
   * 一模一樣的 `pi.compaction` entry 而跳過。
   */
  async #resume(
    conversationId: string,
    pending: PendingResume,
    before: AssembledContext,
  ): Promise<CompactionOutcome> {
    // 保留範圍從完整歷史裡找；找不到就不猜，保留資料等下一次壓縮。
    const history = await this.#readHistory(conversationId);
    const startIndex = history.findIndex((message) => message.cursor === pending.keepFromCursor);
    if (startIndex < 0) {
      this.#warn?.("進行中的壓縮找不到保留範圍的游標；放棄重做", {
        conversationId,
        keepFromCursor: pending.keepFromCursor,
      });
      this.#store.setCompactionInProgress(conversationId, false);
      return { compacted: false, reason: "nothing-to-compact" };
    }
    const keptTokens = history
      .slice(startIndex)
      .reduce((sum, message) => sum + toCompactionMessage(message, false).tokenEstimate, 0);
    return this.#finish(conversationId, {
      summaryCardId: pending.cardId,
      summaryCardTitle: pending.title,
      summaryBody: pending.body,
      keepFromCursor: pending.keepFromCursor,
      keptTokens,
      before,
    });
  }

  /** 壓縮的最後幾步：換前綴、丟逐字稿、更新用量；兩條路徑共用。 */
  async #finish(
    conversationId: string,
    args: {
      readonly summaryCardId: string;
      readonly summaryCardTitle: string;
      readonly summaryBody: string;
      readonly keepFromCursor: string;
      readonly keptTokens: number;
      readonly before: AssembledContext;
    },
  ): Promise<CompactionOutcome> {
    const { summaryCardId, summaryCardTitle, summaryBody, keepFromCursor, keptTokens, before } =
      args;
    // 摘要卡一定進第 5 層，而且這場對話要引用它：中斷後重跑時補上缺少的
    // 那一半，刪除對話時卡片才會被當成專屬卡片帶走。
    const hasEntry = this.#store
      .entries(conversationId)
      .some((entry) => entry.cardId === summaryCardId);
    if (!hasEntry) {
      this.#addSummaryEntry(conversationId, summaryCardId, summaryCardTitle, summaryBody);
    }
    await this.#cards.noteConversationLoad({ conversationId, cardId: summaryCardId });

    // 摘要在固定前綴裡；先換前綴再丟逐字稿，兩者算同一步。
    const withSummary = await this.#assembler.assemble(conversationId);
    if (typeof this.#engine.configureConversationContext === "function") {
      await this.#engine.configureConversationContext(conversationId, withSummary.systemContext);
    }
    const commitCompaction = this.#engine.compactConversation;
    if (commitCompaction === undefined) {
      this.#store.setCompactionInProgress(conversationId, false);
      return { compacted: false, reason: "not-supported" };
    }
    await commitCompaction.call(this.#engine, conversationId, {
      summary: summaryBody,
      keepFromCursor,
      beforeTokens: before.view.usedTokens,
      afterTokens: keptTokens,
    });
    this.#store.deletePendingRemovals(conversationId);
    const compactedAt = this.#now().toISOString();
    // 壓縮時間先落地，後面的組裝才不會拿壓縮前的用量校正新視圖；不然
    // usedTokens 會被舊的校正係數墊高，比壓縮前還大。
    const rowBeforeCommit = this.#store.read(conversationId);
    this.#store.updateMetrics(conversationId, {
      usedTokens: rowBeforeCommit?.usedTokens ?? before.view.usedTokens,
      budgetTokens: rowBeforeCommit?.budgetTokens ?? before.view.budgetTokens,
      contextWindow: rowBeforeCommit?.contextWindow ?? before.view.contextWindow,
      compactionThreshold: rowBeforeCommit?.compactionThreshold ?? before.view.compactionThreshold,
      reserveTokens: rowBeforeCommit?.reserveTokens ?? 8192,
      lastCompactedAt: compactedAt,
    });
    const after = await this.#assembler.assemble(conversationId, {
      bumpVersion: true,
      workingTokens: keptTokens,
    });
    // 移除標記在壓縮這一步才生效；前綴要跟著換掉，否則被移除的卡片還會
    // 留在引擎的固定前綴裡。
    if (typeof this.#engine.configureConversationContext === "function") {
      await this.#engine.configureConversationContext(conversationId, after.systemContext);
    }
    this.#store.setCompactionInProgress(conversationId, false);

    this.#emit?.({
      kind: "context-changed",
      conversationId,
      context: after.view,
    });
    this.#emit?.({
      kind: "context-compacted",
      conversationId,
      payload: {
        sessionId: conversationId,
        summaryCardId,
        beforeTokens: before.view.usedTokens,
        afterTokens: after.view.usedTokens,
        compactedAt,
      },
    });
    return {
      compacted: true,
      summaryCardId,
      beforeTokens: before.view.usedTokens,
      afterTokens: after.view.usedTokens,
      compactedAt,
    };
  }

  /**
   * 還沒完成的壓縮；有就接回。
   *
   * 旗標清掉之前，最新的那張本場摘要卡永遠是這個進行中的動作留下的：先
   * 建卡、再寫項目、最後才丟逐字稿並清旗標。認出它就沿用，不重新摘要。
   * 中斷發生在建立卡片之前時沒有殘留項目，回 `null` 走一般流程。
   *
   * 沒有血緣標記、或別的對話留下的摘要卡只是普通的第 5 層卡片，不是接回
   * 的目標；只有本場的標記缺了保留範圍（卡片被編輯過、或是舊格式）才放棄
   * 重做。標記移除的項目本來就會在這次壓縮被拿掉，不當接回目標，也不讓它
   * 觸發放棄。
   *
   * 外面用 `recovery` 重試同一場對話時（例如人工重試），就算旗標已經
   * 清掉，也沿用上一張摘要卡，不產生第二張。
   */
  async #pendingResume(
    conversationId: string,
    trigger: CompactionTrigger,
  ): Promise<PendingResume | "bail" | null> {
    const interrupted = this.#store.read(conversationId)?.compactionInProgress === true;
    if (!interrupted && trigger !== "recovery") return null;
    const entries = this.#store.entriesOfLayer(conversationId, "short-term-memory");
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry?.cardId === undefined) continue;
      if (entry.state === "pending-removal") continue;
      const card = await this.#cards.get(entry.cardId);
      if (card === null) {
        // 卡片讀不到，認不出是不是本場的摘要；進行中的壓縮不敢猜範圍。
        if (!interrupted) return null;
        this.#warn?.("進行中的壓縮找不到摘要卡；放棄重做，等下一次壓縮", {
          conversationId,
          cardId: entry.cardId,
        });
        return "bail";
      }
      const footer = parseSummaryFooter(card.body);
      if (footer === null || footer.conversationId !== conversationId) continue;
      if (footer.keepFromCursor === undefined || footer.keepFromCursor === "") {
        if (!interrupted) return null; // 沒有進行中的動作；走一般流程，那裡會放棄
        this.#warn?.("進行中的壓縮認不出保留範圍；放棄重做，等下一次壓縮", {
          conversationId,
          cardId: entry.cardId,
        });
        return "bail";
      }
      return {
        cardId: card.cardId,
        title: card.frontmatter.title,
        body: card.body,
        keepFromCursor: footer.keepFromCursor,
      };
    }
    return null;
  }

  /**
   * 挑這次要摘要的範圍；只處理上一張摘要之後的訊息。
   *
   * 中斷的壓縮由 `#pendingResume` 接回，不會走到這裡；這裡認不出任何
   * 一張摘要卡、卻有還沒清乾淨的壓縮紀錄時放棄重算，寧可這次不壓，
   * 也不要產生和舊摘要重疊的新卡。
   */
  async #plan(conversationId: string): Promise<CompactionPlan | null> {
    const base = await this.#committedSummaryBase(conversationId);
    if (
      base === null &&
      this.#store.read(conversationId)?.compactionInProgress === true &&
      (await this.#hasLibrarySummary(conversationId))
    ) {
      // 可能有還沒接回的孤兒卡；從完整歷史重算會產生重疊的摘要卡。
      this.#warn?.("上次中斷留下的摘要卡還沒接回；放棄重算", { conversationId });
      return null;
    }
    const visible =
      base === null
        ? await this.#readHistory(conversationId)
        : await this.#readHistoryAfter(conversationId, base);
    if (visible === null) return null;
    const messages = visible.map((message, index) =>
      toCompactionMessage(message, index === visible.length - 1),
    );
    return planCompaction(messages, { keepRecentTokens: this.#keepRecentTokens() });
  }

  /**
   * 上一張摘要涵蓋到哪裡；沒有本場對話的摘要卡時回 `null`。
   *
   * 第 5 層裡沒有血緣標記、或屬於別場對話的摘要卡，只是一般的卡片：它們
   * 不是重算的起點，也不代表本場的摘要壞掉。重算範圍只會蓋到本場自己的
   * 摘要，不會和別張卡重疊。
   */
  async #committedSummaryBase(conversationId: string): Promise<string | null> {
    const entries = this.#store.entriesOfLayer(conversationId, "short-term-memory");
    let base: string | null = null;
    for (const entry of entries) {
      if (entry.cardId === undefined) continue;
      const card = await this.#cards.get(entry.cardId);
      const footer = card === null ? null : parseSummaryFooter(card.body);
      if (footer === null || footer.conversationId !== conversationId) continue;
      base = footer.toCursor;
    }
    return base;
  }

  /** 卡片庫裡有沒有這場對話的摘要卡；用來擋住「完整歷史重算」的落點。 */
  async #hasLibrarySummary(conversationId: string): Promise<boolean> {
    return this.#forEachSummaryCard(
      async (card) => parseSummaryFooter(card.body)?.conversationId === conversationId,
    );
  }

  /** 讀完整歷史；引擎一次最多 200 則，往前翻到沒有下一頁。 */
  async #readHistory(conversationId: string): Promise<ConversationMessage[]> {
    const pages: ConversationMessage[][] = [];
    let before: ConversationCursor | undefined;
    for (let page = 0; page < HISTORY_PAGE_LIMIT; page += 1) {
      const result = await this.#engine.readConversationHistory({
        conversationId: conversationId as ConversationId,
        limit: HISTORY_PAGE_SIZE,
        ...(before === undefined ? {} : { before }),
      });
      pages.unshift([...result.messages]);
      if (result.nextBefore === null) return pages.flat();
      before = result.nextBefore;
    }
    this.#warn?.("對話歷史超過翻頁上限；只摘要最近的部分", {
      conversationId,
      pages: HISTORY_PAGE_LIMIT,
    });
    return pages.flat();
  }

  /**
   * 讀 `cursor` 之後的訊息；游標不在歷史裡時回 `null`。
   *
   * 上次摘要的游標可能比最新一頁還舊，所以要往前翻頁直到找到它；長對話
   * 才不會漏掉最前面還沒摘要的訊息。找不到時不要退回完整歷史——那會產生
   * 和舊摘要重疊的新卡；寧可這次不壓，等下一次壓縮再收斂。
   */
  async #readHistoryAfter(
    conversationId: string,
    cursor: string,
  ): Promise<ConversationMessage[] | null> {
    const pages: ConversationMessage[][] = [];
    let before: ConversationCursor | undefined;
    for (let page = 0; page < HISTORY_PAGE_LIMIT; page += 1) {
      const result = await this.#engine.readConversationHistory({
        conversationId: conversationId as ConversationId,
        limit: HISTORY_PAGE_SIZE,
        ...(before === undefined ? {} : { before }),
      });
      const index = result.messages.findIndex((message) => message.cursor === cursor);
      if (index >= 0) {
        pages.unshift(result.messages.slice(index + 1));
        return pages.flat();
      }
      pages.unshift([...result.messages]);
      if (result.nextBefore === null) break;
      before = result.nextBefore;
    }
    this.#warn?.("找不到上次摘要的游標；放棄這次壓縮", {
      conversationId,
      cursor,
    });
    return null;
  }

  async #summarize(plan: CompactionPlan, instructions: string | undefined): Promise<string> {
    const texts = plan.dropped.map((message) => message.text);
    const relatedPaths = extractRelatedPaths([
      ...texts,
      ...plan.kept.map((message) => message.text),
    ]).slice(-MAX_RELATED_PATHS);
    const result = await this.#models.invoke({
      role: "small",
      purpose: "對話壓縮",
      prompt: buildSummaryPrompt({
        transcript: renderTranscript(plan.dropped),
        relatedPaths,
        ...(instructions === undefined ? {} : { instructions }),
      }),
      maxOutputTokens: summaryMaxOutputTokens(this.#models),
    });
    return result.text;
  }

  /**
   * 同一個範圍的摘要卡；重跑時沿用，不產生第二張。
   *
   * 先看第 5 層的項目；沒有項目時再掃卡片庫，接回「卡片已建立、項目還
   * 沒寫入就中斷」留下的孤兒卡。卡片庫用游標翻頁讀到盡頭。
   */
  async #existingSummary(
    conversationId: string,
    plan: CompactionPlan,
  ): Promise<{ readonly cardId: string; readonly title: string; readonly body: string } | null> {
    for (const entry of this.#store.entriesOfLayer(conversationId, "short-term-memory")) {
      if (entry.cardId === undefined) continue;
      const card = await this.#cards.get(entry.cardId);
      const match = card === null ? null : this.#matchingSummary(card, conversationId, plan);
      if (match !== null) return match;
    }
    let found: { readonly cardId: string; readonly title: string; readonly body: string } | null =
      null;
    await this.#forEachSummaryCard(async (card) => {
      const match = this.#matchingSummary(card, conversationId, plan);
      if (match === null) return false;
      found = match;
      return true;
    });
    return found;
  }

  /** 依序拜訪卡片庫裡的摘要卡；`visit` 回 true 就停止並回 true。 */
  async #forEachSummaryCard(visit: (card: Card) => Promise<boolean>): Promise<boolean> {
    let cursor: string | undefined;
    for (let page = 0; page < SUMMARY_PAGE_LIMIT; page += 1) {
      const result = await this.#cards.list({
        kinds: ["summary"],
        limit: SUMMARY_PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const summary of result.items) {
        const card = await this.#cards.get(summary.cardId);
        if (card === null) continue;
        if (await visit(card)) return true;
      }
      if (result.nextCursor === undefined || result.nextCursor === "") return false;
      cursor = result.nextCursor;
    }
    return false;
  }

  #matchingSummary(
    card: Card,
    conversationId: string,
    plan: CompactionPlan,
  ): { readonly cardId: string; readonly title: string; readonly body: string } | null {
    const footer = parseSummaryFooter(card.body);
    if (
      footer === null ||
      footer.conversationId !== conversationId ||
      footer.fromCursor !== (plan.dropped[0]?.cursor ?? "") ||
      footer.toCursor !== (plan.dropped.at(-1)?.cursor ?? "")
    ) {
      return null;
    }
    return { cardId: card.cardId, title: card.frontmatter.title, body: card.body };
  }

  #addSummaryEntry(conversationId: string, cardId: string, title: string, body: string): void {
    const entries = this.#store.entries(conversationId);
    const entry: ContextEntry = {
      entryId: entryIdOf(conversationId, `card:${cardId}`),
      layer: "short-term-memory",
      cardId,
      title,
      tokenEstimate: estimateTokens(`${title}\n${body}`),
      state: "active",
      position: nextPosition(entries, "short-term-memory"),
    };
    this.#store.addEntry(conversationId, entry);
  }

  /** 摘要卡的血緣：目前還在前段的卡片。 */
  async #summarySources(conversationId: string): Promise<string[]> {
    const sources = new Set<string>();
    for (const entry of this.#store.entries(conversationId)) {
      if (entry.cardId === undefined) continue;
      if (entry.state !== "active") continue;
      sources.add(entry.cardId);
    }
    return [...sources];
  }
}

/** 摘要呼叫的輸出上限；主機的模型服務可以再提高，但不能低於 4,096。 */
export function summaryMaxOutputTokens(models: ModelInvoker): number {
  const candidate = models as { summaryMaxOutputTokens?: () => number };
  const value =
    typeof candidate.summaryMaxOutputTokens === "function"
      ? candidate.summaryMaxOutputTokens()
      : SUMMARY_MAX_OUTPUT_TOKENS;
  return Math.max(SUMMARY_MAX_OUTPUT_TOKENS, value);
}

/** 逐字稿訊息轉成壓縮範圍的輸入；尾端的工具結果視為未完成，會被保留。 */
function toCompactionMessage(message: ConversationMessage, isLast: boolean): CompactionMessage {
  const text = message.content
    .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
    .join("");
  const tool =
    message.role === "tool"
      ? {
          callId: message.id,
          name: "tool",
          completed: !isLast,
        }
      : undefined;
  return {
    cursor: message.cursor,
    role: message.role,
    text,
    tokenEstimate: estimateTokens(text),
    ...(tool === undefined ? {} : { tool }),
  };
}

/** 給服務用的組合結果；避免服務自己再算一次。 */
export type { AssembledContext };
