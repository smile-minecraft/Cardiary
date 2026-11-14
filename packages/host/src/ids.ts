import type { Clock } from "@cardiary/engine-adapter";
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

/** 單調遞增的 ULID；同一毫秒內連續呼叫也會遞增。 */
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
  let out = "";
  for (let index = 0; index < 16; index += 1) {
    out += CROCKFORD[(lastRandom[index] ?? 0) % 32];
  }
  return encodeTime(time) + out;
}

export function prefixed(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

export const systemClock: Clock = { now: () => new Date() };

export function uptimeSeconds(startedAt: string, clock: Clock = systemClock): number {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((clock.now().getTime() - started) / 1000));
}
