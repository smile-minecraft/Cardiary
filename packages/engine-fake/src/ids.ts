import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastTime = 0;
let lastRandom: number[] = [];

function encodeTime(time: number): string {
  let value = time;
  let out = "";
  for (let index = 0; index < 10; index += 1) {
    out = CROCKFORD[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function encodeRandom(bytes: readonly number[]): string {
  let out = "";
  for (let index = 0; index < 16; index += 1) {
    out += CROCKFORD[(bytes[index] ?? 0) % 32];
  }
  return out;
}

/**
 * 單調遞增的 ULID。同一毫秒內連續呼叫也會遞增，測試可預期排序。
 */
export function ulid(now: number = Date.now()): string {
  let time = now;
  if (time <= lastTime) {
    time = lastTime;
    let carry = 1;
    for (let index = lastRandom.length - 1; index >= 0; index -= 1) {
      const value = (lastRandom[index] ?? 0) + carry;
      lastRandom[index] = value % 256;
      carry = value >= 256 ? 1 : 0;
      if (carry === 0) break;
    }
    if (carry === 1) lastRandom = Array.from({ length: 16 }, () => 0);
  } else {
    lastTime = time;
    lastRandom = Array.from(randomBytes(16));
  }
  return encodeTime(time) + encodeRandom(lastRandom);
}

export function prefixed(prefix: string): string {
  return `${prefix}_${ulid()}`;
}
