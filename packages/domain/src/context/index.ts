/**
 * 上下文的領域型別：八層、項目、視圖與服務介面。
 *
 * 實作由上下文組裝工作補上；協定的線路形狀在 `@cardiary/protocol`。
 */

/** 八層的識別碼，順序由前往後。 */
export type ContextLayer =
  | "bedrock"
  | "persona"
  | "core-memory"
  | "opening-memory"
  | "short-term-memory"
  | "other-cards"
  | "working-context"
  | "volatile-state";

/** 項目在上下文中的狀態。 */
export type ContextEntryState = "active" | "pending-removal";

/** 上下文中的一個項目。 */
export interface ContextEntry {
  readonly entryId: string;
  readonly layer: ContextLayer;
  readonly cardId?: string;
  readonly title: string;
  readonly tokenEstimate: number;
  readonly state: ContextEntryState;
  readonly position: number;
}

/** 目前上下文的視圖；`usedTokens` 等於項目估算的加總。 */
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
 * 上下文服務：加入、移除、壓縮與讀取視圖。
 *
 * 加入只追加在後段；移除只標記，下次壓縮才生效。
 */
export interface ContextService {
  view(sessionId: string): Promise<ContextView>;
  addCard(input: { readonly sessionId: string; readonly cardId: string }): Promise<ContextView>;
  removeCard(input: { readonly sessionId: string; readonly cardId: string }): Promise<ContextView>;
  compact(input: {
    readonly sessionId: string;
    readonly instructions?: string;
  }): Promise<{ readonly scheduled: boolean }>;
}
