/**
 * 產出記憶卡的草稿：把經判定的結論變成新卡的完整形狀。
 *
 * 設計文件 m2-distillation.md §2.3、§2.4：新卡 `kind: memory`、persona 沿用
 * 歸零卡分區、`sources` 指回被提煉的原卡、無 `tags`、`supersedes` 只出現在
 * 取代的情況。標題與摘要由小模型產生併經 {@link memoryCardTitleAndSummary}
 * 整理；記憶正文就是提煉出的自含文字。
 *
 * 「合併」結論不產生卡片，回傳 `null`。
 */

import type { CardId } from "../cards/index.js";
import { memoryCardTitleAndSummary, type ExtractedMemoryItem } from "./extract.js";
import type { MemoryMergeVerdict } from "./merge.js";

/** 新長期記憶卡的完整形狀；檔案寫入與新鮮度初始值由主機負責。 */
export interface MemoryCardDraft {
  readonly kind: "memory";
  readonly persona: string;
  readonly title: string;
  readonly summary?: string;
  /** 記憶本文；是提煉出的自含文字。 */
  readonly body: string;
  readonly sources: readonly CardId[];
  readonly supersedes?: CardId;
  /** 蒸餾不加 `tags`，避免雜訊。 */
  readonly tags: readonly [];
}

/**
 * 組出要落地的記憶卡。`verdict` 為合併時回傳 `null`（合併不產卡）。
 *
 * `sources` 去重並保留順序；內文、標題與摘要都已正規化。
 */
export function planMemoryCardDraft(input: {
  readonly item: ExtractedMemoryItem;
  readonly verdict: MemoryMergeVerdict;
  readonly sources: readonly CardId[];
  readonly persona: string;
  /** 小模型產的標題與摘要；沒有時以 `text` 前段衍生標題。 */
  readonly model?: { readonly title?: string | undefined; readonly summary?: string | undefined };
}): MemoryCardDraft | null {
  if (input.verdict.action === "merge") {
    return null;
  }
  const { title, summary } = memoryCardTitleAndSummary(input.model ?? {}, input.item.text);
  const sources = dedupePreservingOrder(input.sources);
  const base: MemoryCardDraft = {
    kind: "memory",
    persona: input.persona,
    title,
    body: input.item.text,
    sources,
    tags: [],
    ...(summary !== undefined ? { summary } : {}),
    ...(input.verdict.action === "supersede" ? { supersedes: input.verdict.supersedes } : {}),
  };
  return base;
}

function dedupePreservingOrder(ids: readonly CardId[]): readonly CardId[] {
  const seen = new Set<CardId>();
  const out: CardId[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
