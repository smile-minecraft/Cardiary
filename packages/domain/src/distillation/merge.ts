/**
 * 合併與取代：一條新提煉的記憶對上既有長期記憶時，會變成什麼。
 *
 * 設計文件 m2-distillation.md §2.3：
 * - 重複（判定「同一回事」）：不建立新卡，記錄「合併進哪張卡」；
 * - 矛盾（判定「矛盾」）：建立新卡，`frontmatter.supersedes` 指向舊卡；
 *   舊卡不改寫、不刪除，仍可追溯，檢索與發牌依 `supersedes` 過濾；
 * - 兩者皆否：建立全新的記憶卡，無 `supersedes`。
 *
 * 比對候選由混合檢索提供（含冷封存、`kind = memory`）；領域層只拿輸入
 * 做決定，不檢索。判定本身是小模型的是／否題，以 {@link MemoryJudge}
 * 注入；領域層負責順序、過濾與分支。
 */

import type { CardId, CardKind, CardLifecycle } from "../cards/index.js";
import type { ExtractedMemoryItem } from "./extract.js";

/** 小模型的的是／否判定器；兩題依序問，與設計 §2.3 一致。 */
export interface MemoryJudge {
  /** 「這兩條陳述是同一回事嗎？」 */
  sameAs(candidate: string, item: string): Promise<boolean>;
  /** 「這兩條陳述矛盾嗎？」非重複的候選才會被問。 */
  contradicts(candidate: string, item: string): Promise<boolean>;
}

/** 一張可用來比對的既有長期記憶卡；文字是可比較的陳述。 */
export interface MemoryMatchCandidate {
  readonly cardId: CardId;
  readonly kind: CardKind;
  /** 可比較的陳述文字，例如「為什麼」或「標題＋摘要」的組合。 */
  readonly text: string;
  readonly lifecycle: CardLifecycle;
  /** 已被另一張卡蓋過的候選不參與比對；被取代的記憶不是有效錨點。 */
  readonly supersededBy?: CardId | undefined;
}

/** 一條提煉項目對上既有記憶後的結論。 */
export type MemoryMergeVerdict =
  | { readonly action: "merge"; readonly mergedInto: CardId }
  | { readonly action: "supersede"; readonly supersedes: CardId }
  | { readonly action: "create" };

/**
 * 過濾出可比對的候選：`kind = memory`、未被取代、`text` 非空，順序沿用
 * 呼叫端（檢索名次）；檢索決定名次，領域層不重排。
 */
export function comparisonCandidates(
  candidates: readonly MemoryMatchCandidate[],
): MemoryMatchCandidate[] {
  return candidates.filter(
    (candidate) =>
      candidate.kind === "memory" && !candidate.supersededBy && candidate.text.trim().length > 0,
  );
}

/**
 * 逐候選判定。順序：先問「同一回事」（按名次），有則合併；否則逐候選問
 * 「矛盾」，取第一個矛盾的候選作為被取代者；都沒有就是全新記憶。
 */
export async function judgeMemoryItem(
  item: ExtractedMemoryItem,
  candidates: readonly MemoryMatchCandidate[],
  judge: MemoryJudge,
): Promise<MemoryMergeVerdict> {
  const comparable = comparisonCandidates(candidates);
  for (const candidate of comparable) {
    if (await judge.sameAs(candidate.text, item.text)) {
      return { action: "merge", mergedInto: candidate.cardId };
    }
  }
  for (const candidate of comparable) {
    if (await judge.contradicts(candidate.text, item.text)) {
      return { action: "supersede", supersedes: candidate.cardId };
    }
  }
  return { action: "create" };
}
