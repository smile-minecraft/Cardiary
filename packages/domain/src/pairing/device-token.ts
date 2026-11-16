/**
 * 裝置 Token：建立、指紋與驗證。
 *
 * Token 是 32 位元組的不透明亂數，base64url 編碼後加上 `cdt_` 前綴（人看到
 * 就知道是 Cardiary 的裝置 Token，方便在日誌裡被掃到時辨識）。主機只存
 * SHA-256 雜湊，明文只活在配對完成的那一個回應裡；任何時候都不落地、不進
 * URL、不進日誌。
 *
 * 顯示用的兩個衍生物：
 * - `prefix`：`cdt_` 加上本文前 8 個字元，配對當下顯示給使用者核對。
 * - `fingerprint`：雜湊的前 16 個十六進位字元，用 `-` 分四組；可以只靠雜湊
 *   算出來，裝置清單裡拿來和使用者裝置上顯示的指紋對照。
 *
 * 到期與撤銷的語義：
 * - `expiresAt` 省略代表不到期；有設定時過期即失效。格式壞掉時 fail closed
 *   （視為過期）。
 * - `revokedAt` 有設定就失效；撤銷之後雜湊比對會先通過（才能確認是這台
 *   裝置）、再回報已撤銷，所以撤銷狀態不會藉由比對的時間差洩漏給 guesser。
 * - 重複撤銷是安全的：`revokeDeviceToken` 對已撤銷的紀錄原樣回傳。
 * - 撤銷之後既有連線要被關閉是主機的責任（逐請求重新驗證、並在撤銷事件上
 *   關閉連線）；這個模組只保證每一次驗證都看得到撤銷狀態。
 *
 * 沒有全域版本號或撤銷世代：殼是一台機器一台機器地撤銷，加一個全域
 * epoch 只會多一個所有請求都要搶的狀態，沒有人用得到。
 */

import { sha256HexOf } from "../cards/sha256.js";
import { constantTimeEqual } from "./constant-time.js";
import { webCryptoRandomBytes, type RandomBytes } from "./random.js";

/** Token 的前綴。 */
export const DEVICE_TOKEN_PREFIX = "cdt_";
/** Token 本文的亂數位元組數：256 位元。 */
export const DEVICE_TOKEN_BYTES = 32;

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const base64UrlEncode = (bytes: Uint8Array): string => {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const b0 = bytes[offset] as number;
    const b1 = offset + 1 < bytes.length ? (bytes[offset + 1] as number) : 0;
    const b2 = offset + 2 < bytes.length ? (bytes[offset + 2] as number) : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    output += BASE64URL_ALPHABET[(triple >> 18) & 63] as string;
    output += BASE64URL_ALPHABET[(triple >> 12) & 63] as string;
    if (offset + 1 < bytes.length) {
      output += BASE64URL_ALPHABET[(triple >> 6) & 63] as string;
    }
    if (offset + 2 < bytes.length) {
      output += BASE64URL_ALPHABET[triple & 63] as string;
    }
  }
  return output;
};

const DEVICE_TOKEN_PATTERN = /^cdt_[A-Za-z0-9-_]{43}$/;

/** 配對完成時簽發的結果；`token` 明文絕對不落地。 */
export interface IssuedDeviceToken {
  /** 明文；只回傳給完成配對的那一條連線，主機不得記錄。 */
  readonly token: string;
  /** SHA-256 十六進位；主機只存這個。 */
  readonly tokenHash: string;
  /** 顯示用：`cdt_` 加本文前 8 字元。 */
  readonly prefix: string;
  /** 顯示用：雜湊前 16 字元，四組用 `-` 分隔。 */
  readonly fingerprint: string;
}

/** 主機持久保存的紀錄；沒有明文，撤銷就是在這筆上記時間。 */
export interface DeviceTokenRecord {
  readonly deviceId: string;
  readonly tokenHash: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  /** 省略代表不到期。 */
  readonly expiresAt?: string | undefined;
  /** 有值就代表已撤銷；時間是撤銷發生的時間。 */
  readonly revokedAt?: string | undefined;
}

/** 驗證失敗的理由。 */
export type DeviceTokenFailure =
  "missing-token" | "malformed-token" | "unknown-token" | "token-revoked" | "token-expired";

export type DeviceTokenVerdict =
  | { readonly ok: true; readonly deviceId: string }
  | { readonly ok: false; readonly reason: DeviceTokenFailure };

/** 建立新的裝置 Token；亂數來源壞掉就拋錯。 */
export function createDeviceToken(
  randomBytes: RandomBytes = webCryptoRandomBytes,
): IssuedDeviceToken {
  const payload = randomBytes(DEVICE_TOKEN_BYTES);
  if (payload.length !== DEVICE_TOKEN_BYTES) {
    throw new Error("亂數來源回傳的長度不足");
  }
  const token = `${DEVICE_TOKEN_PREFIX}${base64UrlEncode(payload)}`;
  const tokenHash = hashDeviceToken(token);
  return {
    token,
    tokenHash,
    prefix: displayPrefixOf(token),
    fingerprint: fingerprintOfHash(tokenHash),
  };
}

/** Token 的雜湊；查詢與比對一律用這個。 */
export function hashDeviceToken(token: string): string {
  return sha256HexOf(token);
}

export function isDeviceTokenShape(token: string): boolean {
  return DEVICE_TOKEN_PATTERN.test(token);
}

/** 配對當下顯示給使用者核對的前綴。 */
export function displayPrefixOf(token: string): string {
  return token.slice(0, DEVICE_TOKEN_PREFIX.length + 8);
}

/** 從雜湊算指紋；裝置清單只靠這個就能和使用者手上的比對。 */
export function fingerprintOfHash(tokenHash: string): string {
  const raw = tokenHash.slice(0, 16).toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

export function fingerprintOfToken(token: string): string {
  return fingerprintOfHash(hashDeviceToken(token));
}

/** 撤銷：記上撤銷時間；已經撤銷過就原樣回傳。 */
export function revokeDeviceToken(record: DeviceTokenRecord, now: string): DeviceTokenRecord {
  if (record.revokedAt !== undefined) {
    return record;
  }
  return { ...record, revokedAt: now };
}

/** 目前這一刻是否有效（供裝置清單或日誌判斷用）。 */
export function isDeviceTokenActive(record: DeviceTokenRecord, now: string): boolean {
  return verifyDeviceTokenRecord(record, now).ok;
}

/**
 * 驗證出示的 Token。
 *
 * 檢查順序是有意義的：先看形狀，再看紀錄存不存在，再常數時間比對雜湊，
 * 最後才看撤銷與到期——這樣比對之前不會洩漏「這個 Token 對應到哪台裝置」
 * 或它的撤銷狀態。
 *
 * 出示 `undefined` 或空字串是 missing-token（例如只有偽造的通道標頭、沒有
 * 真的帶 Token 的請求）；形狀不對是 malformed-token；雜湊對不上、包括拿
 * 別台裝置的 Token 來比對，都是 unknown-token。
 */
export function verifyDeviceToken(
  presented: string | undefined,
  record: DeviceTokenRecord | undefined,
  now: string,
): DeviceTokenVerdict {
  if (presented === undefined || presented.length === 0) {
    return { ok: false, reason: "missing-token" };
  }
  if (!isDeviceTokenShape(presented)) {
    return { ok: false, reason: "malformed-token" };
  }
  if (record === undefined) {
    return { ok: false, reason: "unknown-token" };
  }
  if (!constantTimeEqual(hashDeviceToken(presented), record.tokenHash)) {
    return { ok: false, reason: "unknown-token" };
  }
  return verifyDeviceTokenRecord(record, now);
}

function verifyDeviceTokenRecord(record: DeviceTokenRecord, now: string): DeviceTokenVerdict {
  if (record.revokedAt !== undefined) {
    return { ok: false, reason: "token-revoked" };
  }
  if (record.expiresAt !== undefined) {
    const expiresMs = Date.parse(record.expiresAt);
    const nowMs = Date.parse(now);
    if (!Number.isFinite(expiresMs) || !Number.isFinite(nowMs) || nowMs >= expiresMs) {
      // 到期時間或當下時間壞掉時 fail closed。
      return { ok: false, reason: "token-expired" };
    }
  }
  return { ok: true, deviceId: record.deviceId };
}
