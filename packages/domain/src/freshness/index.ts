/**
 * 新鮮度的領域型別與純函式。
 *
 * 規則在規格書第 7 章：0 到 100，預設半衰期 30 天；實際載入與手動保鮮
 * 回滿；所屬對話全部封存時改成線性下降，倒數結束到 0；成為孤兒歸零。
 * 一張卡被多個對話引用時，只要還有一個未封存的對話就按平時計算。
 *
 * 時間一律由呼叫端注入，測試才能重現。這裡不讀資料庫、不改檔案。
 */

/** 新鮮度上限，也是回滿與釘選的值。 */
export const FRESHNESS_MAX = 100;
/** 預設半衰期（天）。 */
export const DEFAULT_HALF_LIFE_DAYS = 30;

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
  /**
   * 所有引用都已封存時，最早結束的倒數時間；沒有封存中的引用時省略。
   *
   * 多個封存中的對話以最早的那個為準：那時候其中一段倒數已經結束，
   * 新鮮度應該已經到 0。
   */
  readonly archivePurgeAt?: string | undefined;
  /** 引用這張卡、且正在封存倒數中的對話數。 */
  readonly archivedConversationCount?: number;
  /** 是不是孤兒：沒有任何存活對話引用、也沒釘在白板。 */
  readonly orphaned: boolean;
}

/** 純函式：回傳 0 到 100 的新數值，不改輸入。 */
export type FreshnessCalculator = (input: FreshnessInput) => number;

/** 封存倒數的設定與結果。 */
export interface ArchivePolicy {
  /** 倒數天數，預設 7。 */
  readonly purgeAfterDays: number;
  /** 倒數結束時先壓成摘要卡再刪除；摘要失敗時延後刪除。 */
  readonly summarizeBeforeDelete: boolean;
}

/** 實際使用的新鮮度；所有規則都在這裡收斂。 */
export const computeFreshness: FreshnessCalculator = (input) => {
  const { state } = input;
  if (state.pinned) {
    return FRESHNESS_MAX;
  }
  if (state.lifecycle === "cold") {
    // 冷封存的卡不再參與發牌；保留原值供追溯，不改寫。
    return clampFreshness(state.value);
  }
  if (input.orphaned) {
    return 0;
  }
  if (input.liveConversationCount > 0) {
    return decayFreshness(state.value, state.at, input.now, input.halfLifeDays);
  }
  if ((input.archivedConversationCount ?? 0) > 0 && input.archivePurgeAt !== undefined) {
    return linearFreshness(state.value, state.at, input.archivePurgeAt, input.now);
  }
  return decayFreshness(state.value, state.at, input.now, input.halfLifeDays);
};

/**
 * 平時的指數衰減：每過一個半衰期剩一半。
 *
 * 時間往回走或格式不合法時不讓新鮮度增加，也不拋錯；狀態庫的時鐘可能
 * 被系統時間校正影響，寧可少扣也不要無故回春。
 */
export function decayFreshness(
  value: number,
  at: string,
  now: string,
  halfLifeDays: number,
): number {
  const elapsedDays = elapsedDaysBetween(at, now);
  if (elapsedDays === null || elapsedDays <= 0 || halfLifeDays <= 0) {
    return clampFreshness(value);
  }
  return clampFreshness(value * 0.5 ** (elapsedDays / halfLifeDays));
}

/**
 * 封存倒數中的線性下降，倒數結束時到 0。
 *
 * `at` 是上次計算的時間與當下的值；`value` 從那個點線性降到
 * `purgeAt` 的 0。提早於 `at` 或晚於 `purgeAt` 都夾在邊界。
 */
export function linearFreshness(value: number, at: string, purgeAt: string, now: string): number {
  const atMs = Date.parse(at);
  const purgeMs = Date.parse(purgeAt);
  const nowMs = Date.parse(now);
  if (![atMs, purgeMs, nowMs].every((entry) => Number.isFinite(entry))) {
    return clampFreshness(value);
  }
  if (nowMs <= atMs) {
    return clampFreshness(value);
  }
  if (nowMs >= purgeMs) {
    return 0;
  }
  if (purgeMs <= atMs) {
    return 0;
  }
  return clampFreshness(value * ((purgeMs - nowMs) / (purgeMs - atMs)));
}

/** 夾在 0 到 100；`NaN` 視為 0。 */
export function clampFreshness(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(FRESHNESS_MAX, Math.max(0, value));
}

function elapsedDaysBetween(at: string, now: string): number | null {
  const atMs = Date.parse(at);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(atMs) || !Number.isFinite(nowMs)) {
    return null;
  }
  return (nowMs - atMs) / 86_400_000;
}
