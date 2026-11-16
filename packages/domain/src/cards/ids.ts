const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
import { sha256HexOf } from "./sha256.js";

/** Node 與瀏覽器都有的 Web Crypto 的最小形狀；只用 getRandomValues。 */
declare const crypto: { getRandomValues(array: Uint8Array): Uint8Array } | undefined;

function randomBytes(length: number): Uint8Array {
  if (typeof crypto === "undefined") {
    // 領域層沒有注入 Web Crypto 時只能用 Math.random 頂著；ULID 的隨機
    // 部分不依賴密碼學強度，碰撞由時間主幹與單調計數避免。
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
    return bytes;
  }
  return crypto.getRandomValues(new Uint8Array(length));
}

/** 產生 ULID 字串（26 個 Crockford base32 字元）。 */
export function newCardId(nowMs: number = Date.now()): string {
  const random = BigInt(`0x${bufferToHex(randomBytes(10))}`);
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

function bufferToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** ULID 的格式檢查；不驗證時間語意。 */
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

/**
 * 從固定種子產生 ULID：同一個種子永遠得到同一張卡的 id。
 *
 * 蒸餾用固定輸出卡 id 支援中斷續跑；這個 id 必須通過卡片庫的 ULID 檢查，
 * 否則記憶卡寫得出檔案卻進不了索引，檢索與發牌都看不到它。
 */
export function deterministicCardId(seed: string): string {
  const value = BigInt(`0x${sha256HexOf(seed).slice(0, 32)}`);
  return `${encode(value >> 80n, 10)}${encode(value & ((1n << 80n) - 1n), 16)}`;
}

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}

export { sha256HexOf as sha256Hex } from "./sha256.js";
