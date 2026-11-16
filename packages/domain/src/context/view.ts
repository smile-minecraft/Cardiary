/**
 * 上下文的視圖與門檻。
 *
 * `ContextView` 是 `context.get`、`context.changed` 與檢視欄共用的形狀；
 * `usedTokens` 一律由項目估算加總得到，呼叫端不能自己填，這樣
 * 「各項估算的加總等於 `usedTokens`」就是建構時的不變條件。
 */

import { CONTEXT_LAYERS, layerIndex, type ContextEntryState, type ContextLayer } from "./layers.js";

/** 這張卡是怎麼被發進上下文的；與 `@cardiary/protocol` 的 `ContextDealSource` 對齊。 */
export type ContextDealSource = "system-one" | "retrieval" | "manual";

/** 上下文中的一個項目。 */
export interface ContextEntry {
  readonly entryId: string;
  readonly layer: ContextLayer;
  readonly cardId?: string;
  readonly title: string;
  readonly tokenEstimate: number;
  readonly state: ContextEntryState;
  readonly position: number;
  /** 發牌機率（第 4 層的開局卡才有；退路與手動加入的卡省略）。 */
  readonly dealProbability?: number;
  /** 這張卡是怎麼發進來的；手動加入的卡是 `manual`。 */
  readonly dealSource?: ContextDealSource;
}

/** 目前上下文的視圖。 */
export interface ContextView {
  readonly sessionId: string;
  readonly version: number;
  readonly entries: readonly ContextEntry[];
  readonly usedTokens: number;
  readonly budgetTokens: number;
  readonly contextWindow: number;
  readonly compactionThreshold: number;
  readonly lastCompactedAt?: string;
}

/** 預設的壓縮門檻：用量的 75%。 */
export const DEFAULT_COMPACTION_THRESHOLD = 0.75;

/** 預設保留給輸出與工具結果的 token。 */
export const DEFAULT_RESERVE_TOKENS = 8192;

/** 可用的輸入預算：模型上限減去保留給輸出的量。 */
export function budgetTokensOf(contextWindow: number, reserveTokens: number): number {
  return Math.max(0, contextWindow - reserveTokens);
}

/** 觸發壓縮的用量；無條件進位，避免差一個 token 卡在門檻下方。 */
export function compactionTriggerTokens(budgetTokens: number, threshold: number): number {
  return Math.ceil(budgetTokens * threshold);
}

/** 依固定層順序與層內的 `position` 排序；不改變同一層的相對順序。 */
export function sortEntries(entries: readonly ContextEntry[]): ContextEntry[] {
  return [...entries]
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const layerDelta = layerIndex(left.entry.layer) - layerIndex(right.entry.layer);
      if (layerDelta !== 0) return layerDelta;
      const positionDelta = left.entry.position - right.entry.position;
      return positionDelta !== 0 ? positionDelta : left.index - right.index;
    })
    .map(({ entry }) => entry);
}

/** 下一張卡要放的順序號：這一層目前的最大 `position` 加 1。 */
export function nextPosition(entries: readonly ContextEntry[], layer: ContextLayer): number {
  let max = -1;
  for (const entry of entries) {
    if (entry.layer !== layer) continue;
    if (entry.position > max) max = entry.position;
  }
  return max + 1;
}

/** 組視圖的輸入；`usedTokens` 不開放填，由項目加總。 */
export interface ContextViewInput {
  readonly sessionId: string;
  readonly version: number;
  readonly entries: readonly ContextEntry[];
  readonly budgetTokens: number;
  readonly contextWindow: number;
  readonly compactionThreshold: number;
  readonly lastCompactedAt?: string;
}

/** 建立視圖；項目先排序，`usedTokens` 是加總。 */
export function buildContextView(input: ContextViewInput): ContextView {
  const entries = sortEntries(input.entries);
  const usedTokens = entries.reduce((sum, entry) => sum + entry.tokenEstimate, 0);
  return {
    sessionId: input.sessionId,
    version: input.version,
    entries,
    usedTokens,
    budgetTokens: input.budgetTokens,
    contextWindow: input.contextWindow,
    compactionThreshold: input.compactionThreshold,
    ...(input.lastCompactedAt === undefined ? {} : { lastCompactedAt: input.lastCompactedAt }),
  };
}

/** 目前用量是否已達壓縮門檻。 */
export function isCompactionDue(view: {
  readonly usedTokens: number;
  readonly budgetTokens: number;
  readonly compactionThreshold: number;
}): boolean {
  if (view.budgetTokens <= 0) return false;
  return view.usedTokens >= compactionTriggerTokens(view.budgetTokens, view.compactionThreshold);
}

/** 各層目前的估算加總；檢視欄的「這一層佔多少」用得到。 */
export function layerTotals(entries: readonly ContextEntry[]): readonly {
  readonly layer: ContextLayer;
  readonly tokens: number;
}[] {
  return CONTEXT_LAYERS.map((layer) => ({
    layer,
    tokens: entries
      .filter((entry) => entry.layer === layer)
      .reduce((sum, entry) => sum + entry.tokenEstimate, 0),
  }));
}
