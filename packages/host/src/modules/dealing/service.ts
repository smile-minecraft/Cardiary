/**
 * 開局發牌服務：`session.send_message` 之前由閘道呼叫。
 *
 * 流程：先看第 4 層是否開過局（已開過就什麼都不做），再以混合檢索（`dealing`
 * 模式）取最多 20 張候選；System One 逐卡判斷後，依門檻與預算挑卡；沒有
 * System One 或判斷整批失敗時，發檢索排名最前按預算截斷的卡。挑好的卡經
 * `context.applyOpeningDeal` 寫進第 4 層。
 *
 * 契約：只在第一則使用者訊息發生；檢索或判斷失敗都不讓對話卡住。
 */

import {
  DEFAULT_DEAL_BUDGET_TOKENS,
  MAX_DEAL_BUDGET_TOKENS,
  MIN_DEAL_BUDGET_TOKENS,
  estimateTokens,
  planOpeningDeal,
  shouldDealOpening,
  type Card,
  type CardPage,
  type CardQuery,
  type CardSearchHit,
  type CardService,
  type ContextView,
  type DealCandidate,
  type DealtCard,
  type RetrievalMode,
  type SystemOneDealJudge,
} from "@cardiary/domain";
import type { JsonValue } from "@cardiary/engine-adapter";
import type { ModelInvoker } from "@cardiary/module-api";

import { resolveSystemOne, type SystemOneModels, type SystemOneSource } from "./system-one.js";

export const DEALING_BUDGET_SETTING = "dealing.budgetTokens";

/** 檢索服務中 dealing 用得到的部分。 */
export interface DealingRetrieval {
  search(query: CardQuery, mode: RetrievalMode): Promise<CardPage<CardSearchHit>>;
}

/** 上下文服務中 dealing 用得到的部分。 */
export interface DealingContext {
  view(sessionId: string): Promise<ContextView>;
  applyOpeningDeal(input: {
    readonly sessionId: string;
    readonly cards: readonly DealtCard[];
  }): Promise<ContextView>;
}

/** 設定讀取的最小介面；`ModuleSettingsReader` 符合，值是 JSON。 */
export interface DealingSettings {
  get(key: string): JsonValue | undefined;
}

export interface DealingServiceOptions {
  readonly cards: CardService;
  readonly context: DealingContext;
  readonly retrieval: DealingRetrieval | undefined;
  /** 模型服務；省略時視為沒有 System One。 */
  readonly models: SystemOneModels | undefined;
  /** 模型呼叫的入口（`context.services.models`）。 */
  readonly invoker: ModelInvoker;
  readonly settings: DealingSettings;
  readonly warn: (message: string, fields?: { readonly [key: string]: string | number }) => void;
  readonly info: (message: string, fields?: { readonly [key: string]: string | number }) => void;
  /** 直接指定判斷器；測試用。省略時由 `models` 解析。 */
  readonly judge?: SystemOneDealJudge | null;
}

export interface DealOutcome {
  readonly cards: readonly DealtCard[];
  readonly source: "system-one" | "retrieval";
  readonly missing: readonly string[];
  readonly budgetTokens: number;
  readonly systemOne: SystemOneSource | "override";
  readonly failureCode?: string;
}

export class DealingService {
  readonly #cards: CardService;
  readonly #context: DealingContext;
  readonly #retrieval: DealingRetrieval | undefined;
  readonly #models: SystemOneModels | undefined;
  readonly #invoker: ModelInvoker;
  readonly #settings: DealingSettings;
  readonly #warn: DealingServiceOptions["warn"];
  readonly #info: DealingServiceOptions["info"];
  readonly #judgeOverride: SystemOneDealJudge | null | undefined;
  readonly #inFlight = new Map<string, Promise<DealOutcome | null>>();

  constructor(options: DealingServiceOptions) {
    this.#cards = options.cards;
    this.#context = options.context;
    this.#retrieval = options.retrieval;
    this.#models = options.models;
    this.#invoker = options.invoker;
    this.#settings = options.settings;
    this.#warn = options.warn;
    this.#info = options.info;
    this.#judgeOverride = options.judge;
  }

  async dealIfNeeded(input: {
    readonly sessionId: string;
    readonly requestText: string;
    readonly turnIndex: number;
  }): Promise<DealOutcome | null> {
    const existing = this.#inFlight.get(input.sessionId);
    if (existing !== undefined) return existing;
    const inFlight = this.#deal(input).finally(() => {
      this.#inFlight.delete(input.sessionId);
    });
    this.#inFlight.set(input.sessionId, inFlight);
    return inFlight;
  }

  async #deal(input: {
    readonly sessionId: string;
    readonly requestText: string;
    readonly turnIndex: number;
  }): Promise<DealOutcome | null> {
    if (input.turnIndex !== 0) return null;
    const view = await this.#context.view(input.sessionId);
    const openingDealt = view.entries.some((entry) => entry.layer === "opening-memory");
    if (!shouldDealOpening({ turnIndex: input.turnIndex, openingDealt })) return null;

    const budgetTokens = this.#budgetTokens();
    const candidates = await this.#candidates(input.requestText);
    const resolution =
      this.#judgeOverride !== undefined
        ? { judge: this.#judgeOverride, source: "override" as const }
        : resolveSystemOne({ models: this.#models, invoker: this.#invoker });
    const deal = await planOpeningDeal({
      requestText: input.requestText,
      candidates,
      budgetTokens,
      judge: resolution.judge,
    });
    if (deal.failure !== undefined) {
      this.#warn("System One 判斷失敗；改用檢索排名發牌", {
        sessionId: input.sessionId,
        code: deal.failure.code,
      });
    }
    await this.#context.applyOpeningDeal({ sessionId: input.sessionId, cards: deal.cards });
    for (const card of deal.cards) {
      try {
        await this.#cards.noteConversationLoad({
          conversationId: input.sessionId,
          cardId: card.cardId,
          kind: "deal",
          linkToConversation: false,
        });
      } catch (error) {
        this.#warn("記下發牌卡的載入紀錄失敗", {
          sessionId: input.sessionId,
          cardId: card.cardId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.#info("開局發牌完成", {
      sessionId: input.sessionId,
      dealt: deal.cards.length,
      source: deal.source,
      budgetTokens,
    });
    return {
      cards: deal.cards,
      source: deal.source,
      missing: deal.missing,
      budgetTokens,
      systemOne: resolution.source,
      ...(deal.failure === undefined ? {} : { failureCode: deal.failure.code }),
    };
  }

  /** 檢索失敗回 0 候選（不發牌，對話照常）。 */
  async #candidates(requestText: string): Promise<DealCandidate[]> {
    if (this.#retrieval === undefined) {
      this.#warn("檢索服務不在；這場對話不發開局卡", {});
      return [];
    }
    let hits: CardPage<CardSearchHit>;
    try {
      hits = await this.#retrieval.search({ query: requestText }, "dealing");
    } catch (error) {
      this.#warn("檢索失敗；這場對話不發開局卡", {
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
    const candidates: DealCandidate[] = [];
    for (const [rank, hit] of hits.items.entries()) {
      const cardId = hit.card.cardId;
      let card: Card | null;
      try {
        card = await this.#cards.get(cardId);
      } catch {
        continue;
      }
      if (card === null) continue;
      candidates.push({
        cardId,
        title: card.frontmatter.title,
        ...(hit.card.summary === undefined ? {} : { summary: hit.card.summary }),
        tokenEstimate: estimateTokens(`${card.frontmatter.title}\n${card.body}`),
        rank,
        retrievalScore: hit.score,
      });
    }
    return candidates;
  }

  #budgetTokens(): number {
    const value = this.#settings.get(DEALING_BUDGET_SETTING);
    const parsed =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DEAL_BUDGET_TOKENS;
    return Math.min(MAX_DEAL_BUDGET_TOKENS, Math.max(MIN_DEAL_BUDGET_TOKENS, Math.floor(parsed)));
  }
}
