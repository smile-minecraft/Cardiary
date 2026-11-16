/**
 * 三種 System One 實作的門檻、候選數與逾時。
 *
 * 門檻依 spike 的實測：Jev 0.6（0.4–0.6 只標「可能相關」，不自動發）；
 * 小型模型的機率沒有鑑別力，門檻更保守、候選砍半，而且只建議在沒有
 * Jev 時使用。數值變更屬於產品行為，要同步改設計與設定頁。
 */

export type SystemOneMode = "none" | "jev" | "model";

/** 有 System One 的兩種模式。 */
export type JudgedSystemOneMode = Exclude<SystemOneMode, "none">;

/** 一種實作要遵守的發牌參數。 */
export interface SystemOneProfile {
  /** 相關機率大於等於這個值才發。 */
  readonly threshold: number;
  /** 一次最多送幾張候選卡。 */
  readonly candidateLimit: number;
  /** 判斷的逾時毫秒數。 */
  readonly timeoutMs: number;
}

/** Jev 1.14 的預設：spike 20 題 p50 610 ms、p95 698 ms。 */
export const JEV_PROFILE: SystemOneProfile = {
  threshold: 0.6,
  candidateLimit: 20,
  timeoutMs: 5_000,
};

/** 小型語言模型的預設：本機 3B 逐題約 0.7 秒，整批 8 秒上限。 */
export const MODEL_PROFILE: SystemOneProfile = {
  threshold: 0.75,
  candidateLimit: 5,
  timeoutMs: 8_000,
};

export function systemOneProfile(mode: JudgedSystemOneMode): SystemOneProfile {
  switch (mode) {
    case "jev":
      return JEV_PROFILE;
    case "model":
      return MODEL_PROFILE;
    default:
      throw new RangeError(`System One 模式不合法：${String(mode)}`);
  }
}
