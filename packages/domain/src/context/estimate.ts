/**
 * 上下文的 token 估算。
 *
 * 引擎沒有提供「目前佔用」的欄位，所以主機自己算：各層先用「字元數 ÷ 2.5」
 * 估一次，再用最近一輪的 `request_tokens` 校正。估算值只用於檢視欄與
 * 壓縮門檻，不是供應商的精確數字，介面要標明是估算。
 */

/** 中文與英文混合的粗略換算：平均幾個字元一個 token。 */
export const CHARS_PER_TOKEN = 2.5;

/** 校正係數的容許範圍；超出範圍代表資料不可信，夾住避免估算爆走。 */
export const MIN_CORRECTION = 0.25;
export const MAX_CORRECTION = 4;

/** 一輪助理訊息回報的用量。 */
export interface TurnUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** 這一輪送出的前綴大小：`input + cacheRead + cacheWrite`。 */
  readonly requestTokens: number;
}

/** 估算一段文字的 token 數；空字串是 0。 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** 從一個回合的用量算出這一輪送出的前綴大小。 */
export function requestTokensOf(usage: {
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

/**
 * 校正係數：`request_tokens / 估算出的前綴`。
 *
 * 沒有上一輪的用量時回 1；估算為 0 時也回 1，避免除以零。只套用在
 * 同一場對話、同一個模型——換主模型等於重新開始，呼叫端不要沿用。
 */
export function correctionFactor(
  requestTokens: number | null | undefined,
  estimatedPrefix: number,
): number {
  if (requestTokens === null || requestTokens === undefined || requestTokens <= 0) return 1;
  if (estimatedPrefix <= 0) return 1;
  const factor = requestTokens / estimatedPrefix;
  if (!Number.isFinite(factor) || factor <= 0) return 1;
  return Math.min(MAX_CORRECTION, Math.max(MIN_CORRECTION, factor));
}

/**
 * 把原始估算乘上校正係數。
 *
 * 每一項四捨五入成整數；`usedTokens` 是四捨五入後的加總，因此
 * 「各項估算的加總等於 `usedTokens`」永遠成立。
 */
export function correctEstimates(
  raw: readonly number[],
  factor: number,
): { readonly estimates: readonly number[]; readonly total: number } {
  const estimates = raw.map((value) => {
    const scaled = Math.round(Math.max(0, value) * factor);
    return Number.isFinite(scaled) ? scaled : 0;
  });
  const total = estimates.reduce((sum, value) => sum + value, 0);
  return { estimates, total };
}
