/**
 * 新鮮度的領域型別與純函式介面。
 *
 * 實作由新鮮度與封存工作補上；時間一律由呼叫端注入，測試才能重現。
 */

/** 一張卡的新鮮度狀態。 */
export interface FreshnessState {
  /** 0 到 100。 */
  readonly value: number;
  /** 上次計算的時間，RFC 3339。 */
  readonly at: string;
  /** 是否釘在白板；釘選固定 100。 */
  readonly pinned: boolean;
  /** 卡片生命週期。 */
  readonly lifecycle: "live" | "cold";
}

/** 計算新鮮度需要的輸入。 */
export interface FreshnessInput {
  readonly state: FreshnessState;
  readonly now: string;
  /** 半衰期（天），預設 30。 */
  readonly halfLifeDays: number;
  /** 引用這張卡、且尚未封存的對話數。 */
  readonly liveConversationCount: number;
  /** 其中一個對話的封存倒數結束時間；沒有封存中的引用時省略。 */
  readonly archivePurgeAt?: string;
  /** 是不是孤兒：沒有任何存活對話引用、也沒釘在白板。 */
  readonly orphaned: boolean;
}

/** 純函式：回傳 0 到 100 的新數值，不改輸入。 */
export type FreshnessCalculator = (input: FreshnessInput) => number;

/** 封存倒數的設定與結果。 */
export interface ArchivePolicy {
  /** 倒數天數，預設 7。 */
  readonly purgeAfterDays: number;
  /** 倒數結束時先壓成摘要卡再刪除；M1 建議 true：摘要失敗時延後刪除，待使用者同意後才固定。 */
  readonly summarizeBeforeDelete: boolean;
}
