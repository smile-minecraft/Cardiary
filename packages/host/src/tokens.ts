import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Token 的格式：43 個 base64url 字元（32 bytes）。 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/**
 * 常數時間比較：長度不同也走完整段比較，不提早 return。
 *
 * 兩邊都轉成 SHA-256 摘要再比，長度固定為 32 bytes，避免長度差異成為側通道。
 */
export function constantTimeEqual(left: unknown, right: unknown): boolean {
  if (typeof left !== "string" || typeof right !== "string") {
    // 仍然做一次固定成本比較，讓「型別不對」與「值不對」花的時間相近。
    const dummy = createHash("sha256").update("").digest();
    timingSafeEqual(dummy, dummy);
    return false;
  }
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest) && left.length === right.length;
}

/** 日誌用的 Token 前綴：SHA-256 前 8 個十六進位字元，不可逆推。 */
export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex").slice(0, 8);
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}
