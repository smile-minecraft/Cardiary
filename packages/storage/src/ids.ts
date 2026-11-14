import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastTime = -1;
let lastRandom = 0n;

/** 產生 ULID 字串（26 個 Crockford base32 字元）。 */
export function newUlid(nowMs: number = Date.now()): string {
  let random = BigInt(`0x${randomBytes(10).toString("hex")}`);
  if (nowMs === lastTime) {
    // 同一毫秒內單調遞增，確保排序穩定。
    random = (lastRandom + 1n) & ((1n << 80n) - 1n);
  }
  lastTime = nowMs;
  lastRandom = random;
  return `${encode(BigInt(nowMs), 10)}${encode(random, 16)}`;
}

function encode(value: bigint, length: number): string {
  let remaining = value;
  const chars = new Array<string>(length);
  for (let index = length - 1; index >= 0; index -= 1) {
    chars[index] = CROCKFORD[Number(remaining & 31n)] ?? "0";
    remaining >>= 5n;
  }
  return chars.join("");
}

/** 測試需要重置單調計數器時使用；正式程式不呼叫。 */
export function resetUlidStateForTests(): void {
  lastTime = -1;
  lastRandom = 0n;
}
