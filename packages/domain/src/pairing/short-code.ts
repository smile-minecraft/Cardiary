/**
 * 配對短碼：產生、正規化與比對。
 *
 * 短碼只供人在兩端核對「這是不是同一個配對請求」，不構成認證，也不能領取
 * Token；領取靠的是請求識別碼綁定的那條連線（見 `session.ts`）。
 *
 * 字母表排除 0、1、英文字母 I、L、O、U：0 和 O、1 和 I／L 在螢幕與口述時
 * 最容易看錯；U 排除是為了不讓短碼湊出英文粗口。剩下 30 個字元，產生時用
 * 拒絕取樣保證均勻，不用模數運算。8 個字元約 39 位元，配上兩分鐘有效期與
 * 五次比對上限，猜中的機會可以忽略。
 */

import { constantTimeEqual } from "./constant-time.js";
import { webCryptoRandomBytes, type RandomBytes } from "./random.js";

/** 字母表：8 個數字（2–9）＋ 22 個字母（去掉 I、L、O、U）。 */
export const SHORT_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 短碼長度（未分組的字元數）。 */
export const SHORT_CODE_LENGTH = 8;
/** 預設有效期限：兩分鐘，夠人核對兩端螢幕，又短到不必擔心被長時間濫用。 */
export const SHORT_CODE_TTL_MS = 120_000;
/** 同一請求最多可以比對失敗幾次；用完視為過期。 */
export const SHORT_CODE_MAX_ATTEMPTS = 5;

const REJECTION_LIMIT = Math.floor(256 / SHORT_CODE_ALPHABET.length) * SHORT_CODE_ALPHABET.length;

/**
 * 拒絕取樣：只接受小於 `REJECTION_LIMIT` 的位元組，避免模數偏差。
 * 注入的亂數來源如果一直回傳不可用的位元組，最多試 64 次就放棄，
 * 避免測試環境的壞來源讓主機卡死在迴圈裡。
 */
export function generateShortCode(randomBytes: RandomBytes = webCryptoRandomBytes): string {
  const chars: string[] = [];
  let guard = 0;
  while (chars.length < SHORT_CODE_LENGTH) {
    guard += 1;
    if (guard > SHORT_CODE_LENGTH * 64) {
      throw new Error("亂數來源無法產生可用的短碼位元組");
    }
    for (const byte of randomBytes(SHORT_CODE_LENGTH)) {
      if (byte < REJECTION_LIMIT) {
        chars.push(SHORT_CODE_ALPHABET[byte % SHORT_CODE_ALPHABET.length] as string);
        if (chars.length === SHORT_CODE_LENGTH) {
          break;
        }
      }
    }
  }
  return chars.join("");
}

/**
 * 正規化人看的字串：去掉空白與連字號、轉大寫。
 * 字母表裡沒有 0、1、I、L、O、U，所以這裡不做同形異義字映射；
 * 任何不在字母表裡的字元都會讓 `isShortCodeShape` 回傳 `false`。
 */
export function normalizeShortCode(input: string): string {
  return input.replace(/[\s-]+/g, "").toUpperCase();
}

/** 只驗形狀：正規化後是不是長度固定的字母表字串。 */
export function isShortCodeShape(value: string): boolean {
  if (value.length !== SHORT_CODE_LENGTH) {
    return false;
  }
  for (const char of value) {
    if (!SHORT_CODE_ALPHABET.includes(char)) {
      return false;
    }
  }
  return true;
}

/** 顯示用：`ABCD2345` → `ABCD-2345`。 */
export function formatShortCode(code: string): string {
  const normalized = normalizeShortCode(code);
  const splitAt = SHORT_CODE_LENGTH / 2;
  return `${normalized.slice(0, splitAt)}-${normalized.slice(splitAt)}`;
}

/**
 * 常數時間比對。輸入會先正規化；正規化後形狀不合法就直接回傳 `false`，
 * 這個分支只洩漏「是不是八個合法字元」，不洩漏任何前綴資訊。
 */
export function verifyShortCode(presented: string, expected: string): boolean {
  const left = normalizeShortCode(presented);
  const right = normalizeShortCode(expected);
  if (!isShortCodeShape(left) || !isShortCodeShape(right)) {
    return false;
  }
  return constantTimeEqual(left, right);
}
