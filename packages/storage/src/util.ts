import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

/** 目前時間的 ISO-8601 UTC 字串；資料庫的時間欄位一律用這個格式。 */
export function nowIso(clock: () => Date = () => new Date()): string {
  return clock().toISOString();
}

/** 在指定時間上加減毫秒，回傳 ISO 字串。 */
export function shiftIso(iso: string, deltaMs: number): string {
  return new Date(Date.parse(iso) + deltaMs).toISOString();
}

/** 在指定時間上加上天數，回傳 ISO 字串。 */
export function addDaysIso(iso: string, days: number): string {
  return shiftIso(iso, days * 24 * 60 * 60 * 1000);
}

/** 同步睡眠；node:sqlite 是同步 API，忙碌重試需要同步等待。 */
export function sleepSync(milliseconds: number): void {
  if (milliseconds <= 0) {
    return;
  }
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}

/** 以固定間隔重試；只重試 `shouldRetry` 回 true 的錯誤。 */
export function retrySync<T>(
  action: () => T,
  shouldRetry: (error: unknown) => boolean,
  delaysMs: readonly number[] = [10, 20, 40],
): T {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      return action();
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error) || attempt === delaysMs.length) {
        break;
      }
      sleepSync(delaysMs[attempt] ?? 0);
    }
  }
  throw lastError;
}

/** 路徑用的短雜湊；只用於診斷，不代替身分。 */
export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/** 把位元組數轉成穩定的小數字串。 */
export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** 解析 JSON 字串；失敗回 null，不把解析錯誤當成例外往外丟。 */
export function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
