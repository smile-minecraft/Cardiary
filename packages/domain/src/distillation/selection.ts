/**
 * 挑選：哪些卡進入這一晚的蒸餾。
 *
 * 規則在設計文件 m2-distillation.md §2.1 與規格書第 7 章：
 * `live` 且新鮮度歸零；排除已冷封存、基岩卡、人格卡、壞卡、被取代的卡，
 * 以及核心組成員（核心組不降級，需先退出核心組）。以人格為單位分區處理，
 * 同分區內以 `card_id` 升冪掃描，保證同一份輸入每次都走一樣的順序。
 */

import type { CardId, CardKind, CardLifecycle } from "../cards/index.js";

/** 不蒸餾的卡種：基岩卡與人格卡是地基，不該衰減出局。 */
export const DISTILLATION_EXCLUDED_KINDS: readonly CardKind[] = ["bedrock", "persona"];

/** 一張候選卡；呼叫端從索引與 `card_state` 組出，領域層不碰資料庫。 */
export interface DistillationCandidateCard {
  readonly cardId: CardId;
  readonly kind: CardKind;
  readonly lifecycle: CardLifecycle;
  /** 0 到 100；歸零才進蒸餾。 `<= 0` 視為歸零。 */
  readonly freshness: number;
  readonly persona: string;
  /**
   * 被另一張卡以 `supersedes` 蓋過時，呼叫端查 `card_index.superseded_by`
   * 填入蓋過它的卡 id。被取代的記憶卡不再進蒸餾。
   */
  readonly supersededBy?: CardId | undefined;
  /** 格式錯誤的卡；仍可搜尋與追溯，但不是提煉來源。 */
  readonly broken?: boolean | undefined;
  /** `core_memory` 成員；核心組成員不降級，需先由蒸餾提議退出核心組。 */
  readonly coreMember?: boolean | undefined;
}

/**
 * 挑選要蒸餾的卡；回傳依 `cardId` 升冪排序的新陣列，不改寫輸入。
 *
 * 歸零的判定用 `freshness <= 0`（領域層的新鮮度已夾在 0 到 100）。
 * 長期記憶卡（`kind: memory`）衰減到 0 也參與蒸餾重提煉。
 */
export function selectDistillationCandidates(
  cards: readonly DistillationCandidateCard[],
  persona: string,
): DistillationCandidateCard[] {
  const picked = cards.filter(
    (card) =>
      card.persona === persona &&
      card.lifecycle === "live" &&
      Number.isFinite(card.freshness) &&
      card.freshness <= 0 &&
      !DISTILLATION_EXCLUDED_KINDS.includes(card.kind) &&
      card.broken !== true &&
      !card.supersededBy &&
      card.coreMember !== true,
  );
  return [...picked].sort((left, right) =>
    left.cardId < right.cardId ? -1 : left.cardId > right.cardId ? 1 : 0,
  );
}
