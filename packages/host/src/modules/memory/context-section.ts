/**
 * 上下文第 3 層：核心記憶組；每場對話必載，不超過 token 預算。
 *
 * 順序固定 `added_day, card_id` 升冪（決定性），與卡片庫的核心組 Store 一致。
 * 從卡片讀標題、摘要與內文估算 token；加入一張就檢查預算，超額就停止（不
 * 自動換出）。核心組一天最多變動一次由 Store 與蒸餾共同把關，這裡只讀。
 */

import type { CardService } from "@cardiary/domain";
import {
  CORE_TOKEN_BUDGET_DEFAULT,
  estimateCoreMemoryTokens,
  type CoreCardTokens,
} from "@cardiary/domain";
import type { ContextSectionContribution } from "@cardiary/module-api";

import { CoreMemoryStore } from "@cardiary/storage";

export interface CoreMemorySectionOptions {
  readonly core: CoreMemoryStore;
  readonly cards: CardService;
  readonly tokenBudget: () => number;
}

/** 建立核心記憶的上下文區段貢獻（掛在 `core-memory` 層）。 */
export function createCoreMemorySection(
  options: CoreMemorySectionOptions,
): ContextSectionContribution {
  return {
    sectionId: "memory.core",
    layer: "core-memory",
    title: "核心記憶",
    order: 0,
    render: async ({ trigger }) => {
      // 壓縮當下也重載核心組；觸發不影響內容，只保留給追蹤用。
      void trigger;
      const entries = options.core.list("default");
      if (entries.length === 0) return null;

      const budget = options.tokenBudget() || CORE_TOKEN_BUDGET_DEFAULT;
      const included: CoreCardTokens[] = [];
      const lines: string[] = [];
      const sourceCards: string[] = [];
      let tokens = 0;
      for (const entry of entries) {
        const card = await options.cards.get(entry.cardId);
        if (card === null) continue;
        const tokensForCard = estimateCoreMemoryTokens([
          {
            title: card.frontmatter.title,
            ...(card.frontmatter.summary === undefined
              ? {}
              : { summary: card.frontmatter.summary }),
            body: card.body,
          },
        ]);
        if (tokens + tokensForCard > budget) break;
        tokens += tokensForCard;
        included.push({
          title: card.frontmatter.title,
          ...(card.frontmatter.summary === undefined ? {} : { summary: card.frontmatter.summary }),
          body: card.body,
        });
        sourceCards.push(entry.cardId);
        lines.push(
          `- ${card.frontmatter.title}${card.frontmatter.summary ? `：${card.frontmatter.summary}` : ""}`,
        );
      }
      if (lines.length === 0) return null;
      return {
        text: `以下是每場對話都應記得的核心記憶：\n${lines.join("\n")}`,
        tokenEstimate: tokens,
        sourceCards,
      };
    },
  };
}
