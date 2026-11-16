import { describe, expect, it } from "vitest";

import {
  DEVICE_NAME_MAX_LENGTH,
  PAIRING_SESSION_TTL_MS,
  approvePairing,
  completePairing,
  createPairingSession,
  denyPairing,
  disconnectPairing,
  attemptShortCodeVerification,
  type ApprovalAuthority,
  type PairingSession,
} from "../../src/pairing/index.js";
import {
  isDeviceTokenActive,
  revokeDeviceToken,
  verifyDeviceToken,
} from "../../src/pairing/device-token.js";

const T0 = "2026-11-16T00:00:00.000Z";
const SHELL: ApprovalAuthority = { kind: "shell-control" };

function at(offsetMs: number, base: string = T0): string {
  return new Date(Date.parse(base) + offsetMs).toISOString();
}

/** 固定的線性同餘亂數，重現每一個測試的結果。 */
function seededRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return (length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      bytes[index] = state & 0xff;
    }
    return bytes;
  };
}

function freshSession(
  overrides: Partial<Parameters<typeof createPairingSession>[0]> = {},
  seed = 7,
): PairingSession {
  return createPairingSession(
    {
      deviceName: "測試手機",
      deviceKind: "web",
      connectionId: "conn-1",
      ...overrides,
    },
    { now: T0, randomBytes: seededRandom(seed) },
  );
}

function approvedSession(): PairingSession {
  const session = freshSession();
  const approved = approvePairing(session, SHELL, at(1_000));
  if (!approved.ok) {
    throw new Error("測試前置：核准失敗");
  }
  return approved.session;
}

describe("建立配對請求", () => {
  it("初始狀態是 requested；短碼八個字元；到期約兩分鐘後", () => {
    const session = freshSession();
    expect(session.status).toBe("requested");
    expect(session.shortCode).toHaveLength(8);
    expect(Date.parse(session.expiresAt) - Date.parse(session.requestedAt)).toBe(
      PAIRING_SESSION_TTL_MS,
    );
    expect(session.codeAttemptsUsed).toBe(0);
  });

  it("裝置名稱去頭尾空白；太長或全空白會擲出 RangeError", () => {
    expect(freshSession({ deviceName: "  我的手機  " }).deviceName).toBe("我的手機");
    expect(() => freshSession({ deviceName: " ".repeat(4) })).toThrow(RangeError);
    expect(() => freshSession({ deviceName: "x".repeat(DEVICE_NAME_MAX_LENGTH + 1) })).toThrow(
      RangeError,
    );
  });

  it("連線識別碼不能是空白", () => {
    expect(() => freshSession({ connectionId: "   " })).toThrow(RangeError);
  });

  it("壞掉的 now 會擲出 RangeError", () => {
    expect(() =>
      createPairingSession(
        { deviceName: "x", deviceKind: "web", connectionId: "c" },
        { now: "not-a-date", randomBytes: seededRandom(1) },
      ),
    ).toThrow(RangeError);
  });
});

describe("核准：只有殼的控制通道可以核准", () => {
  it("殼的控制通道核准成功，記下核准時間", () => {
    const result = approvePairing(freshSession(), SHELL, at(1_000));
    expect(result.ok).toBe(true);
    expect(result.session.status).toBe("approved");
    expect(result.session.approvedAt).toBe(at(1_000));
  });

  it("負面：直接從 loopback 呼叫核准必須失敗，請求保持不變", () => {
    const session = freshSession();
    const result = approvePairing(
      session,
      { kind: "loopback-direct", note: "127.0.0.1" },
      at(1_000),
    );
    expect(result).toEqual({ ok: false, reason: "unauthorized", session });
    expect(result.session.status).toBe("requested");
  });

  it("負面：公開請求帶偽造的 Tailscale／Cloudflare／Forwarded 標頭不算數", () => {
    const session = freshSession();
    const forgedHeaders =
      "cf-connecting-ip=203.0.113.9; tailscale-user=smile; x-forwarded-for=127.0.0.1";
    const result = approvePairing(
      session,
      { kind: "public-request", note: forgedHeaders },
      at(1_000),
    );
    expect(result).toEqual({ ok: false, reason: "unauthorized", session });
  });

  it("負面：只帶通道標頭（自稱 Tailscale 使用者）不算數", () => {
    const session = freshSession();
    const result = approvePairing(
      session,
      { kind: "channel-header", note: "x-tailscale-user: smile" },
      at(1_000),
    );
    expect(result.ok).toBe(false);
    expect(result.session.status).toBe("requested");
  });

  it("負面：沒有權限證明物件（undefined）也不核准", () => {
    const session = freshSession();
    expect(approvePairing(session, undefined, at(1_000))).toEqual({
      ok: false,
      reason: "unauthorized",
      session,
    });
  });

  it("重送同一請求回 already-approved", () => {
    const session = approvedSession();
    const again = approvePairing(session, SHELL, at(2_000));
    expect(again).toEqual({ ok: false, reason: "already-approved", session });
  });

  it("拒絕之後不能核准", () => {
    const denied = denyPairing(freshSession(), SHELL, at(1_000));
    if (!denied.ok) throw new Error("測試前置：拒絕失敗");
    const result = approvePairing(denied.session, SHELL, at(2_000));
    expect(result).toEqual({ ok: false, reason: "already-denied", session: denied.session });
  });

  it("完成之後不能核准（同一請求的重送）", () => {
    const completed = completePairing(
      approvedSession(),
      { connectionId: "conn-1" },
      { now: at(2_000), randomBytes: seededRandom(3) },
    );
    if (!completed.ok) throw new Error("測試前置：領取失敗");
    const result = approvePairing(completed.session, SHELL, at(3_000));
    expect(result).toEqual({ ok: false, reason: "already-completed", session: completed.session });
  });
});

describe("拒絕", () => {
  it("殼拒絕成功，裝置之後領不到 Token", () => {
    const denied = denyPairing(freshSession(), SHELL, at(1_000));
    expect(denied.ok).toBe(true);
    expect(denied.session.status).toBe("denied");
    expect(denied.session.closedReason).toBe("denied");

    const claim = completePairing(
      denied.session,
      { connectionId: "conn-1" },
      { now: at(2_000), randomBytes: seededRandom(3) },
    );
    expect(claim).toEqual({ ok: false, reason: "already-denied", session: denied.session });
  });

  it("核准後殼可以撤回；撤回後裝置領不到 Token", () => {
    const denied = denyPairing(approvedSession(), SHELL, at(2_000));
    expect(denied.ok).toBe(true);
    const claim = completePairing(
      denied.session,
      { connectionId: "conn-1" },
      { now: at(3_000), randomBytes: seededRandom(3) },
    );
    expect(claim).toEqual({ ok: false, reason: "already-denied", session: denied.session });
  });

  it("非殼的來源不能拒絕", () => {
    const session = freshSession();
    const result = denyPairing(session, { kind: "loopback-direct", note: "127.0.0.1" }, at(1_000));
    expect(result).toEqual({ ok: false, reason: "unauthorized", session });
  });

  it("重複拒絕回 already-denied", () => {
    const denied = denyPairing(freshSession(), SHELL, at(1_000));
    if (!denied.ok) throw new Error("測試前置：拒絕失敗");
    expect(denyPairing(denied.session, SHELL, at(2_000))).toEqual({
      ok: false,
      reason: "already-denied",
      session: denied.session,
    });
  });
});

describe("領取配對結果", () => {
  it("核准後由同一連線領取：簽發 Token；主機存的紀錄沒有明文", () => {
    const session = approvedSession();
    const result = completePairing(
      session,
      { connectionId: "conn-1" },
      { now: at(2_000), randomBytes: seededRandom(11) },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.status).toBe("completed");
    expect(result.device.deviceToken.startsWith("cdt_")).toBe(true);
    expect(result.device.record.tokenHash).not.toBe(result.device.deviceToken);
    expect(JSON.stringify(result.device.record)).not.toContain(result.device.deviceToken);
    // 簽發出來的 Token 立刻可以驗證。
    const verdict = verifyDeviceToken(result.device.deviceToken, result.device.record, at(2_000));
    expect(verdict).toEqual({ ok: true, deviceId: result.device.deviceId });
    expect(isDeviceTokenActive(result.device.record, at(2_000))).toBe(true);
  });

  it("核准之前不能領取", () => {
    const session = freshSession();
    const result = completePairing(
      session,
      { connectionId: "conn-1" },
      { now: at(1_000), randomBytes: seededRandom(3) },
    );
    expect(result).toEqual({ ok: false, reason: "not-approved", session });
  });

  it("換一條連線領取會被拒絕，而且請求不會被消耗", () => {
    const session = approvedSession();
    const wrong = completePairing(
      session,
      { connectionId: "conn-evil" },
      { now: at(2_000), randomBytes: seededRandom(3) },
    );
    expect(wrong).toEqual({ ok: false, reason: "connection-mismatch", session });

    const right = completePairing(
      session,
      { connectionId: "conn-1" },
      { now: at(3_000), randomBytes: seededRandom(3) },
    );
    expect(right.ok).toBe(true);
  });

  it("同一請求只能被領取一次；重送回 already-completed", () => {
    const session = approvedSession();
    const first = completePairing(
      session,
      { connectionId: "conn-1" },
      { now: at(2_000), randomBytes: seededRandom(3) },
    );
    if (!first.ok) throw new Error("測試前置：第一次領取失敗");
    const replay = completePairing(
      first.session,
      { connectionId: "conn-1" },
      { now: at(3_000), randomBytes: seededRandom(4) },
    );
    expect(replay).toEqual({ ok: false, reason: "already-completed", session: first.session });
  });
});

describe("過期與斷線：作廢之後不可重用", () => {
  it("過期之後核准與領取都失敗，狀態收進 expired", () => {
    const session = freshSession();
    const tooLate = at(PAIRING_SESSION_TTL_MS + 1);
    const approve = approvePairing(session, SHELL, tooLate);
    expect(approve).toEqual({
      ok: false,
      reason: "expired",
      session: { ...session, status: "expired", closedReason: "expired" },
    });

    const approved = approvePairing(freshSession(), SHELL, at(1_000));
    if (!approved.ok) throw new Error("測試前置：核准失敗");
    const claim = completePairing(
      approved.session,
      { connectionId: "conn-1" },
      {
        now: at(PAIRING_SESSION_TTL_MS + 1),
        randomBytes: seededRandom(3),
      },
    );
    expect(claim.ok).toBe(false);
    expect(claim.session.status).toBe("expired");
  });

  it("到期時間正好到，算過期", () => {
    const session = freshSession();
    const atExpiry = approvePairing(session, SHELL, session.expiresAt);
    expect(atExpiry.ok).toBe(false);
    expect(atExpiry.session.status).toBe("expired");
  });

  it("提出請求的連線斷線，請求作廢；核准過的也一樣", () => {
    const beforeApprove = disconnectPairing(freshSession(), { connectionId: "conn-1" }, at(1_000));
    expect(beforeApprove.ok).toBe(true);
    expect(beforeApprove.session.status).toBe("expired");
    expect(beforeApprove.session.closedReason).toBe("disconnected");

    const afterApprove = disconnectPairing(
      approvedSession(),
      { connectionId: "conn-1" },
      at(1_500),
    );
    expect(afterApprove.ok).toBe(true);
    expect(afterApprove.session.status).toBe("expired");

    // 作廢之後領不到 Token。
    const claim = completePairing(
      afterApprove.session,
      { connectionId: "conn-1" },
      { now: at(2_000), randomBytes: seededRandom(3) },
    );
    expect(claim).toEqual({ ok: false, reason: "expired", session: afterApprove.session });
  });

  it("別條連線斷線，這個請求不受影響", () => {
    const session = approvedSession();
    const result = disconnectPairing(session, { connectionId: "conn-other" }, at(1_500));
    expect(result).toEqual({ ok: false, reason: "connection-mismatch", session });
  });

  it("已完成的請求斷線，結果不受影響", () => {
    const completed = completePairing(
      approvedSession(),
      { connectionId: "conn-1" },
      { now: at(2_000), randomBytes: seededRandom(3) },
    );
    if (!completed.ok) throw new Error("測試前置：領取失敗");
    const result = disconnectPairing(completed.session, { connectionId: "conn-1" }, at(3_000));
    expect(result).toEqual({ ok: true, session: completed.session });
  });
});

describe("短碼：比對與重試上限", () => {
  it("比對成功不消耗狀態", () => {
    const session = freshSession();
    const result = attemptShortCodeVerification(session, session.shortCode, at(1_000));
    expect(result).toEqual({ ok: true, session });
  });

  it("比對失敗會計數", () => {
    const session = freshSession();
    const wrong = session.shortCode === "ABCD2345" ? "23456789" : "ABCD2345";
    const first = attemptShortCodeVerification(session, wrong, at(1_000));
    expect(first).toEqual({
      ok: false,
      reason: "code-mismatch",
      session: { ...session, codeAttemptsUsed: 1 },
    });
  });

  it("五次比對失敗後請求作廢；短碼重放也無效", () => {
    let session = freshSession();
    const wrong = session.shortCode === "ABCD2345" ? "23456789" : "ABCD2345";
    for (let round = 1; round <= 4; round += 1) {
      const result = attemptShortCodeVerification(session, wrong, at(round));
      if (!result.ok) {
        expect(result.reason).toBe("code-mismatch");
      }
      session = result.session;
    }
    const fifth = attemptShortCodeVerification(session, wrong, at(5));
    expect(fifth.ok).toBe(false);
    if (fifth.ok) return;
    expect(fifth.reason).toBe("attempts-exhausted");
    expect(fifth.session.status).toBe("expired");
    expect(fifth.session.closedReason).toBe("attempts-exhausted");

    // 作廢之後：核對、核准、領取全部拒絕，短碼不能重放。
    const verify = attemptShortCodeVerification(fifth.session, session.shortCode, at(6));
    expect(verify).toEqual({ ok: false, reason: "expired", session: fifth.session });
    const approve = approvePairing(fifth.session, SHELL, at(6));
    expect(approve.ok).toBe(false);
    const claim = completePairing(
      fifth.session,
      { connectionId: "conn-1" },
      { now: at(6), randomBytes: seededRandom(3) },
    );
    expect(claim.ok).toBe(false);
  });

  it("完成之後核對短碼回 already-completed，短碼失去用途", () => {
    const completed = completePairing(
      approvedSession(),
      { connectionId: "conn-1" },
      { now: at(2_000), randomBytes: seededRandom(3) },
    );
    if (!completed.ok) throw new Error("測試前置：領取失敗");
    const result = attemptShortCodeVerification(
      completed.session,
      completed.session.shortCode,
      at(3_000),
    );
    expect(result).toEqual({ ok: false, reason: "already-completed", session: completed.session });
  });
});

describe("撤銷：完成配對之後的裝置", () => {
  it("配對完成的紀錄可以直接存；撤銷後 Token 立即無效，另一台裝置不受影響", () => {
    const first = completePairing(
      approvedSession(),
      { connectionId: "conn-1" },
      { now: at(2_000), randomBytes: seededRandom(21) },
    );
    if (!first.ok) throw new Error("測試前置：第一次領取失敗");

    const secondSession = createPairingSession(
      { deviceName: "另一台", deviceKind: "ios", connectionId: "conn-2" },
      { now: T0, randomBytes: seededRandom(22) },
    );
    const secondApproved = approvePairing(secondSession, SHELL, at(1_000));
    if (!secondApproved.ok) throw new Error("測試前置：第二次核准失敗");
    const second = completePairing(
      secondApproved.session,
      { connectionId: "conn-2" },
      { now: at(2_000), randomBytes: seededRandom(23) },
    );
    if (!second.ok) throw new Error("測試前置：第二次領取失敗");

    const revoked = revokeDeviceToken(first.device.record, at(3_000));
    expect(verifyDeviceToken(first.device.deviceToken, revoked, at(3_001))).toEqual({
      ok: false,
      reason: "token-revoked",
    });
    expect(verifyDeviceToken(second.device.deviceToken, second.device.record, at(3_001))).toEqual({
      ok: true,
      deviceId: second.device.deviceId,
    });
  });
});
