/**
 * 配對領域的識別碼：`pair_` 與 `dev_` 加上 26 個 Crockford Base32 字元
 * （48 位元時間 ＋ 80 位元亂數，ULID 的形狀）。可排序、好對照日誌；
 * 不依賴全域時間函數，時間與亂數都由呼叫端注入。
 */

import type { RandomBytes } from "./random.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newPrefixedId(prefix: string, nowMs: number, randomBytes: RandomBytes): string {
  const time = encodeBigEndian(BigInt(Math.max(0, Math.floor(nowMs))), 10);
  const random = randomBytes(10);
  let randomPart = 0n;
  for (const byte of random) {
    randomPart = (randomPart << 8n) | BigInt(byte);
  }
  return `${prefix}${time}${encodeBigEndian(randomPart, 16)}`;
}

function encodeBigEndian(value: bigint, length: number): string {
  let remaining = value;
  const chars = new Array<string>(length).fill("0");
  for (let index = length - 1; index >= 0; index -= 1) {
    chars[index] = CROCKFORD[Number(remaining & 31n)] ?? "0";
    remaining >>= 5n;
  }
  return chars.join("");
}
