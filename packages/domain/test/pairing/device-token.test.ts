import { describe, expect, it } from "vitest";

import { sha256HexOf } from "../../src/cards/sha256.js";
import {
  DEVICE_TOKEN_PREFIX,
  createDeviceToken,
  displayPrefixOf,
  fingerprintOfHash,
  fingerprintOfToken,
  isDeviceTokenShape,
  isDeviceTokenActive,
  revokeDeviceToken,
  verifyDeviceToken,
  type DeviceTokenRecord,
} from "../../src/pairing/device-token.js";

const T0 = "2026-11-16T00:00:00.000Z";

function record(overrides: Partial<DeviceTokenRecord> = {}): DeviceTokenRecord {
  return {
    deviceId: "dev_01JEX8Q3W7Z9K5V2N4M6P8R0T1",
    tokenHash: "",
    fingerprint: "0000-0000-0000-0000",
    createdAt: T0,
    ...overrides,
  };
}

function deterministicBytes(): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (index * 7 + 1) & 0xff;
  }
  return bytes;
}

describe("建立裝置 Token", () => {
  const issued = createDeviceToken(() => deterministicBytes());

  it("是 cdt_ 前綴加 43 個 base64url 字元", () => {
    expect(issued.token.startsWith(DEVICE_TOKEN_PREFIX)).toBe(true);
    expect(isDeviceTokenShape(issued.token)).toBe(true);
  });

  it("固定亂數來源產生固定 Token", () => {
    const again = createDeviceToken(() => deterministicBytes());
    expect(again.token).toBe(issued.token);
    expect(again.tokenHash).toBe(issued.tokenHash);
  });

  it("主機只存雜湊；雜湊就是 Token 的 SHA-256", () => {
    expect(issued.tokenHash).toBe(sha256HexOf(issued.token));
    expect(issued.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("前綴與指紋由明文或雜湊都可以重算", () => {
    expect(issued.prefix).toBe(displayPrefixOf(issued.token));
    expect(issued.prefix).toBe(issued.token.slice(0, 12));
    expect(issued.fingerprint).toBe(fingerprintOfToken(issued.token));
    expect(fingerprintOfHash(issued.tokenHash)).toBe(issued.fingerprint);
    expect(issued.fingerprint).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it("亂數來源長度不足時擲出錯誤，不簽出弱 Token", () => {
    expect(() => createDeviceToken(() => new Uint8Array(8))).toThrow("亂數來源回傳的長度不足");
  });
});

describe("驗證裝置 Token", () => {
  const issued = createDeviceToken(() => deterministicBytes());
  const valid = record({
    tokenHash: issued.tokenHash,
    fingerprint: issued.fingerprint,
  });

  it("正確的 Token 通過驗證", () => {
    expect(verifyDeviceToken(issued.token, valid, T0)).toEqual({
      ok: true,
      deviceId: valid.deviceId,
    });
    expect(isDeviceTokenActive(valid, T0)).toBe(true);
  });

  it("沒有帶 Token 是 missing-token（帶偽造通道標頭也一樣，標頭不參與判斷）", () => {
    expect(verifyDeviceToken(undefined, valid, T0)).toEqual({ ok: false, reason: "missing-token" });
    expect(verifyDeviceToken("", valid, T0)).toEqual({ ok: false, reason: "missing-token" });
    // 請求裡聲稱自己是已認證的 Tailscale 使用者，但實際上沒有 Token。
    expect(verifyDeviceToken(undefined, valid, T0)).toEqual({ ok: false, reason: "missing-token" });
  });

  it("帶偽造通道標頭當 Token 是 malformed-token", () => {
    const forged = '{"tailscale-user":"smile","forwarded":"for 203.0.113.9"}';
    expect(isDeviceTokenShape(forged)).toBe(false);
    expect(verifyDeviceToken(forged, valid, T0)).toEqual({ ok: false, reason: "malformed-token" });
    expect(verifyDeviceToken("cdt_tooshort", valid, T0)).toEqual({
      ok: false,
      reason: "malformed-token",
    });
  });

  it("雜湊對不上是 unknown-token，不會洩漏紀錄是否存在", () => {
    const other = createDeviceToken(() => new Uint8Array(32).fill(9));
    expect(verifyDeviceToken(other.token, valid, T0)).toEqual({
      ok: false,
      reason: "unknown-token",
    });
    expect(verifyDeviceToken(issued.token, undefined, T0)).toEqual({
      ok: false,
      reason: "unknown-token",
    });
  });

  it("形狀對但雜湊對不上、而紀錄已撤銷時回 unknown-token，不洩漏撤銷狀態", () => {
    const other = createDeviceToken(() => new Uint8Array(32).fill(9));
    const revoked = revokeDeviceToken(valid, T0);
    expect(verifyDeviceToken(other.token, revoked, T0)).toEqual({
      ok: false,
      reason: "unknown-token",
    });
  });

  it("被撤銷的 Token 立即無效；其他裝置不受影響", () => {
    const revoked = revokeDeviceToken(valid, "2026-11-17T00:00:00.000Z");
    expect(verifyDeviceToken(issued.token, revoked, "2026-11-17T00:00:01.000Z")).toEqual({
      ok: false,
      reason: "token-revoked",
    });
    // 另一台沒有撤銷的裝置照常有效。
    const second = createDeviceToken(() => new Uint8Array(32).fill(42));
    const otherRecord = record({
      deviceId: "dev_SECOND",
      tokenHash: second.tokenHash,
      fingerprint: second.fingerprint,
    });
    expect(verifyDeviceToken(second.token, otherRecord, "2026-11-17T00:00:01.000Z").ok).toBe(true);
  });

  it("重複撤銷是安全的，第一次撤銷的時間不變", () => {
    const once = revokeDeviceToken(valid, "2026-11-17T00:00:00.000Z");
    const twice = revokeDeviceToken(once, "2026-11-18T00:00:00.000Z");
    expect(twice.revokedAt).toBe("2026-11-17T00:00:00.000Z");
  });

  it("到期之後失效；省略到期時間代表不到期", () => {
    const expiring = record({
      tokenHash: issued.tokenHash,
      fingerprint: issued.fingerprint,
      expiresAt: "2026-11-17T00:00:00.000Z",
    });
    expect(verifyDeviceToken(issued.token, expiring, "2026-11-16T23:59:59.000Z").ok).toBe(true);
    expect(verifyDeviceToken(issued.token, expiring, "2026-11-17T00:00:00.000Z")).toEqual({
      ok: false,
      reason: "token-expired",
    });
    // 到期時間壞掉時 fail closed。
    const broken = record({
      tokenHash: issued.tokenHash,
      fingerprint: issued.fingerprint,
      expiresAt: "not-a-date",
    });
    expect(verifyDeviceToken(issued.token, broken, T0)).toEqual({
      ok: false,
      reason: "token-expired",
    });
  });

  it("撤銷優先於到期判斷（兩者都發生時回報撤銷）", () => {
    const both = record({
      tokenHash: issued.tokenHash,
      fingerprint: issued.fingerprint,
      expiresAt: "2026-11-17T00:00:00.000Z",
      revokedAt: "2026-11-16T01:00:00.000Z",
    });
    expect(verifyDeviceToken(issued.token, both, "2026-11-18T00:00:00.000Z")).toEqual({
      ok: false,
      reason: "token-revoked",
    });
  });
});
