/**
 * 上下文的領域型別與純函式：八層、估算、視圖、壓縮範圍與摘要提示。
 *
 * 協定的線路形狀在 `@cardiary/protocol`；這裡是主機內部用的領域模型。
 */

import type { DealtCard } from "../dealing/index.js";
import type { ContextView } from "./view.js";

export {
  CONTEXT_LAYERS,
  SYSTEM_LAYERS,
  assembleSystemContext,
  isSystemLayer,
  layerIndex,
  volatileStateText,
  type ContextEntryState,
  type ContextLayer,
  type SystemSection,
} from "./layers.js";
export {
  CHARS_PER_TOKEN,
  MAX_CORRECTION,
  MIN_CORRECTION,
  correctEstimates,
  correctionFactor,
  estimateTokens,
  requestTokensOf,
  type TurnUsage,
} from "./estimate.js";
export {
  DEFAULT_COMPACTION_THRESHOLD,
  DEFAULT_RESERVE_TOKENS,
  budgetTokensOf,
  buildContextView,
  compactionTriggerTokens,
  isCompactionDue,
  layerTotals,
  nextPosition,
  sortEntries,
  type ContextDealSource,
  type ContextEntry,
  type ContextView,
  type ContextViewInput,
} from "./view.js";
export {
  DEFAULT_KEEP_RECENT_TOKENS,
  MAX_RELATED_PATHS,
  SUMMARY_MAX_OUTPUT_TOKENS,
  buildSummaryPrompt,
  encodeSummaryFooter,
  extractRelatedPaths,
  parseSummaryFooter,
  planCompaction,
  renderTranscript,
  summaryTitle,
  type CompactionMessage,
  type CompactionPlan,
  type SummaryFooter,
  type SummaryPromptInput,
} from "./compaction.js";

/** 估算一段文字的 token 數；實作要用同一場對話的校正係數。 */
export type TokenEstimator = (text: string) => number;

/** 壓縮的結果。 */
export interface CompactionResult {
  readonly summaryCardId: string;
  readonly beforeTokens: number;
  readonly afterTokens: number;
  readonly compactedAt: string;
}

/**
 * 上下文服務：加入、移除、壓縮、讀取視圖與開局發牌。
 *
 * 加入只追加在後段；移除只標記，下次壓縮才生效。開局發牌只在第一則
 * 訊息之前呼叫一次；重複呼叫是安全的 no-op。
 */
export interface ContextService {
  view(sessionId: string): Promise<ContextView>;
  addCard(input: { readonly sessionId: string; readonly cardId: string }): Promise<ContextView>;
  removeCard(input: { readonly sessionId: string; readonly cardId: string }): Promise<ContextView>;
  compact(input: {
    readonly sessionId: string;
    readonly instructions?: string;
  }): Promise<{ readonly scheduled: boolean }>;
  /** 把開局挑好的卡裝進第 4 層並推給引擎；已開過局時不做任何事。 */
  applyOpeningDeal(input: {
    readonly sessionId: string;
    readonly cards: readonly DealtCard[];
  }): Promise<ContextView>;
}
