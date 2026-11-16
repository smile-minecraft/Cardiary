/**
 * 過期判斷：`cache/agents/<session>` 超過 30 天未更新就清。
 * 只放時間運算，實際刪除在主機層做。
 */
export const AGENT_CACHE_MAX_AGE_DAYS = 30;
export const AGENT_CACHE_MAX_AGE_MS = AGENT_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export function isAgentCacheStale(
  lastUsedAtMs: number,
  nowMs: number,
  maxAgeMs: number = AGENT_CACHE_MAX_AGE_MS,
): boolean {
  if (!Number.isFinite(lastUsedAtMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - lastUsedAtMs > maxAgeMs;
}
