/**
 * 圈選卡片生成新卡的草稿。
 *
 * 草稿只帶血緣（derivedFrom），實際的卡片寫入由 host 處理；
 * 這樣領域層不依賴卡片儲存，也能單獨驗證血緣是否去重、是否指向真實卡片。
 */

import { isUlid } from "../cards/ids.js";
import { BoardDomainError } from "./errors.js";
import type { CardDraftFromSelection } from "./types.js";

export interface CreateCardDraftInput {
  readonly title: string;
  /** 被圈選的卡片識別碼；順序保留，重複的去掉。 */
  readonly cardIds: readonly string[];
}

/**
 * 圈選集合轉成新卡草稿。
 *
 * `derivedFrom` 日後寫成卡片 frontmatter 的 `sources`，所以這裡就先去重，
 * 避免同一張來源卡在血緣中出現多次。至少要好一張來源卡。
 */
export function createCardDraftFromSelection(input: CreateCardDraftInput): CardDraftFromSelection {
  if (input.title.trim().length === 0) {
    throw new BoardDomainError("invalid_id", "新卡標題不能是空的");
  }
  const seen = new Set<string>();
  const derivedFrom: string[] = [];
  for (const cardId of input.cardIds) {
    if (!isUlid(cardId)) {
      throw new BoardDomainError("invalid_id", `來源卡 id 不是 ULID：${cardId}`);
    }
    if (!seen.has(cardId)) {
      seen.add(cardId);
      derivedFrom.push(cardId);
    }
  }
  if (derivedFrom.length === 0) {
    throw new BoardDomainError("unknown_card", "圈選至少要有一張來源卡");
  }
  return { title: input.title, derivedFrom };
}
