/**
 * 配對請求的狀態機：`requested → approved → completed`，以及收屍的終態
 * `denied` 和 `expired`。斷線和比對次數用盡都收進 `expired`（明細記在
 * `closedReason`），狀態集合不再擴張。
 *
 * 硬規則：
 *
 * - 只有殼的私有控制通道可以核准或拒絕。`approvePairing`／`denyPairing`
 *   的 `authority` 必須是 `kind: "shell-control"`；來源位址（包含 127.0.0.1）
 *   和任何通道標頭都不是核准者，傳了就回 `unauthorized`，Session 不變。
 * - 裝置只能在提出請求的同一條連線以 `pairing.complete` 領取結果；換一條
 *   連線回 `connection-mismatch`，請求不被消耗。
 * - 核准之前不能領取（`not-approved`）。`completed` 之後再領取、核准或
 *   拒絕都是 `already-completed`；`denied`、`expired` 同理，一次性的請求
 *   不會因為重送而復活。
 * - 過期只看時鐘：`expiresAt` 之後的任何操作都會把請求收進 `expired`，
 *   不論現在是 `requested` 還是 `approved`。
 * - 短碼不落地，只活在這個記憶體紀錄裡；完成或收屍之後它隨物件一起消失。
 *
 * 時間一律由呼叫端注入（RFC 3339 字串）；壞掉的時間 fail closed 當成已過期。
 */

import { createDeviceToken, type DeviceTokenRecord } from "./device-token.js";
import { newPrefixedId } from "./ids.js";
import { webCryptoRandomBytes, type RandomBytes } from "./random.js";
import {
  SHORT_CODE_MAX_ATTEMPTS,
  SHORT_CODE_TTL_MS,
  generateShortCode,
  verifyShortCode,
} from "./short-code.js";

/** 裝置的種類；與 `@cardiary/protocol` 的 `DeviceKind` 對齊。 */
export type PairingDeviceKind = "web" | "ios";

export type PairingSessionStatus = "requested" | "approved" | "completed" | "denied" | "expired";

/** 進入終態的原因；只有 `expired` 需要、且一定會帶。 */
export type PairingClosedReason = "denied" | "expired" | "disconnected" | "attempts-exhausted";

/** 配對請求的記憶體紀錄；不落地。 */
export interface PairingSession {
  readonly pairingRequestId: string;
  readonly deviceName: string;
  readonly deviceKind: PairingDeviceKind;
  /** 提出請求的連線識別碼；領取只能走同一條。 */
  readonly connectionId: string;
  /** 明文短碼；只供人核對，不落地、不構成認證。 */
  readonly shortCode: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly status: PairingSessionStatus;
  /** 短碼比對失敗的次數；用盡就收進 `expired`。 */
  readonly codeAttemptsUsed: number;
  readonly approvedAt?: string | undefined;
  readonly deniedAt?: string | undefined;
  readonly completedAt?: string | undefined;
  readonly closedReason?: PairingClosedReason | undefined;
}

/**
 * 核准／拒絕配對的權限證明。
 *
 * 主機只有在殼的私有控制通道收到核准時，才得以 `shell-control` 呼叫；
 * 三種公開來源（直接連 loopback、公開協定請求、只帶轉送標頭）在型別上
 * 就是不同的成員，執行期也一律回 `unauthorized`。標頭內容與來源位址都
 * 不參與判斷——傳進來的 `note` 只是除錯字串。
 */
export interface ApprovalAuthority {
  readonly kind: "shell-control" | "loopback-direct" | "public-request" | "channel-header";
  readonly note?: string | undefined;
}

export type PairingFailure =
  | "unauthorized"
  | "expired"
  | "not-approved"
  | "already-approved"
  | "already-denied"
  | "already-completed"
  | "connection-mismatch"
  | "code-mismatch"
  | "attempts-exhausted";

export type PairingTransition =
  | { readonly ok: true; readonly session: PairingSession }
  | { readonly ok: false; readonly reason: PairingFailure; readonly session: PairingSession };

/** 完成配對時簽發的裝置；`deviceToken` 明文只回傳這一次。 */
export interface CompletedDevice {
  readonly deviceId: string;
  /** 明文；只回傳給原連線一次，主機不得記錄。 */
  readonly deviceToken: string;
  readonly deviceTokenHash: string;
  readonly prefix: string;
  readonly fingerprint: string;
  /** 存入狀態資料庫的紀錄；沒有明文。 */
  readonly record: DeviceTokenRecord;
}

export type CompletePairingResult =
  | { readonly ok: true; readonly session: PairingSession; readonly device: CompletedDevice }
  | {
      readonly ok: false;
      readonly reason: PairingFailure;
      readonly session: PairingSession;
    };

export const DEVICE_NAME_MAX_LENGTH = 80;
export const PAIRING_SESSION_TTL_MS = SHORT_CODE_TTL_MS;

export interface CreatePairingSessionInput {
  readonly deviceName: string;
  readonly deviceKind: PairingDeviceKind;
  readonly connectionId: string;
}

/** 建立配對請求；名稱或連線識別碼不合法就拋 `RangeError`。 */
export function createPairingSession(
  input: CreatePairingSessionInput,
  deps: { now: string; randomBytes?: RandomBytes; ttlMs?: number },
): PairingSession {
  const deviceName = input.deviceName.trim();
  if (deviceName.length === 0 || deviceName.length > DEVICE_NAME_MAX_LENGTH) {
    throw new RangeError(`deviceName 必須是 1 到 ${DEVICE_NAME_MAX_LENGTH} 個字元`);
  }
  const connectionId = input.connectionId.trim();
  if (connectionId.length === 0) {
    throw new RangeError("connectionId 不能是空字串");
  }
  const nowMs = Date.parse(deps.now);
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("now 不是合法的 RFC 3339 時間");
  }
  const ttl = deps.ttlMs ?? PAIRING_SESSION_TTL_MS;
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new RangeError("ttlMs 必須是正數");
  }
  const randomBytes = deps.randomBytes ?? webCryptoRandomBytes;
  return {
    pairingRequestId: newPrefixedId("pair", nowMs, randomBytes),
    deviceName,
    deviceKind: input.deviceKind,
    connectionId,
    shortCode: generateShortCode(randomBytes),
    requestedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttl).toISOString(),
    status: "requested",
    codeAttemptsUsed: 0,
  };
}

/** 殼核准。過期、重複核准、已拒絕或已完成都回明確的失敗理由。 */
export function approvePairing(
  session: PairingSession,
  authority: ApprovalAuthority | undefined,
  now: string,
): PairingTransition {
  if (authority?.kind !== "shell-control") {
    return { ok: false, reason: "unauthorized", session };
  }
  const settled = settleIfExpired(session, now);
  if (settled.expired) {
    return { ok: false, reason: "expired", session: settled.session };
  }
  const current = settled.session;
  switch (current.status) {
    case "requested":
      return { ok: true, session: { ...current, status: "approved", approvedAt: now } };
    case "approved":
      return { ok: false, reason: "already-approved", session: current };
    case "denied":
      return { ok: false, reason: "already-denied", session: current };
    case "completed":
      return { ok: false, reason: "already-completed", session: current };
    case "expired":
      return { ok: false, reason: "expired", session: current };
  }
}

/** 殼拒絕。拒絕之後裝置拿不到 Token，也不能再領取。 */
export function denyPairing(
  session: PairingSession,
  authority: ApprovalAuthority | undefined,
  now: string,
): PairingTransition {
  if (authority?.kind !== "shell-control") {
    return { ok: false, reason: "unauthorized", session };
  }
  const settled = settleIfExpired(session, now);
  if (settled.expired) {
    return { ok: false, reason: "expired", session: settled.session };
  }
  const current = settled.session;
  switch (current.status) {
    case "requested":
      return {
        ok: true,
        session: { ...current, status: "denied", deniedAt: now, closedReason: "denied" },
      };
    case "approved":
      // 已核准尚未領取時，殼要撤回也是合法需求；把請求收進 denied，裝置就領不到了。
      return {
        ok: true,
        session: { ...current, status: "denied", deniedAt: now, closedReason: "denied" },
      };
    case "denied":
      return { ok: false, reason: "already-denied", session: current };
    case "completed":
      return { ok: false, reason: "already-completed", session: current };
    case "expired":
      return { ok: false, reason: "expired", session: current };
  }
}

/**
 * 提出請求的連線斷線。請求（不論是否已核准）立刻作廢；
 * 其他連線的斷線對這個請求沒有影響。
 */
export function disconnectPairing(
  session: PairingSession,
  input: { readonly connectionId: string },
  now: string,
): PairingTransition {
  const settled = settleIfExpired(session, now);
  if (settled.expired) {
    return { ok: false, reason: "expired", session: settled.session };
  }
  const current = settled.session;
  if (current.status === "completed" || current.status === "denied") {
    return { ok: true, session: current };
  }
  if (current.status === "expired") {
    return { ok: true, session: current };
  }
  if (current.connectionId !== input.connectionId) {
    return { ok: false, reason: "connection-mismatch", session: current };
  }
  return {
    ok: true,
    session: { ...current, status: "expired", closedReason: "disconnected" },
  };
}

/**
 * 核對短碼。只當雙通道核對的輔助；失敗次數用盡就把請求收進 `expired`。
 * 通過不代表可以領取 Token——領取仍然要看核准與連線綁定。
 */
export function attemptShortCodeVerification(
  session: PairingSession,
  presentedCode: string,
  now: string,
): PairingTransition {
  const settled = settleIfExpired(session, now);
  if (settled.expired) {
    return { ok: false, reason: "expired", session: settled.session };
  }
  const current = settled.session;
  switch (current.status) {
    case "requested":
      break;
    case "approved":
      return { ok: false, reason: "already-approved", session: current };
    case "denied":
      return { ok: false, reason: "already-denied", session: current };
    case "completed":
      return { ok: false, reason: "already-completed", session: current };
    case "expired":
      return { ok: false, reason: "expired", session: current };
  }
  if (verifyShortCode(presentedCode, current.shortCode)) {
    return { ok: true, session: current };
  }
  const used = current.codeAttemptsUsed + 1;
  if (used >= SHORT_CODE_MAX_ATTEMPTS) {
    return {
      ok: false,
      reason: "attempts-exhausted",
      session: {
        ...current,
        codeAttemptsUsed: used,
        status: "expired",
        closedReason: "attempts-exhausted",
      },
    };
  }
  return { ok: false, reason: "code-mismatch", session: { ...current, codeAttemptsUsed: used } };
}

/**
 * 領取配對結果。只能走提出請求的同一條連線；核准之前、已拒絕、已完成、
 * 已過期都領不到。成功時簽發裝置 Token，並回傳主機要持久保存的紀錄
 * （沒有明文）。
 */
export function completePairing(
  session: PairingSession,
  input: { readonly connectionId: string },
  deps: { now: string; randomBytes?: RandomBytes },
): CompletePairingResult {
  const settled = settleIfExpired(session, deps.now);
  if (settled.expired) {
    return { ok: false, reason: "expired", session: settled.session };
  }
  const current = settled.session;
  if (current.connectionId !== input.connectionId) {
    return { ok: false, reason: "connection-mismatch", session: current };
  }
  switch (current.status) {
    case "requested":
      return { ok: false, reason: "not-approved", session: current };
    case "denied":
      return { ok: false, reason: "already-denied", session: current };
    case "completed":
      return { ok: false, reason: "already-completed", session: current };
    case "expired":
      return { ok: false, reason: "expired", session: current };
    case "approved": {
      const randomBytes = deps.randomBytes ?? webCryptoRandomBytes;
      const issued = createDeviceToken(randomBytes);
      const deviceId = newPrefixedId("dev", Date.parse(deps.now) || 0, randomBytes);
      const completed: PairingSession = {
        ...current,
        status: "completed",
        completedAt: deps.now,
      };
      return {
        ok: true,
        session: completed,
        device: {
          deviceId,
          deviceToken: issued.token,
          deviceTokenHash: issued.tokenHash,
          prefix: issued.prefix,
          fingerprint: issued.fingerprint,
          record: {
            deviceId,
            tokenHash: issued.tokenHash,
            fingerprint: issued.fingerprint,
            createdAt: deps.now,
          },
        },
      };
    }
  }
}

function isTerminal(status: PairingSessionStatus): boolean {
  return status === "completed" || status === "denied" || status === "expired";
}

function settleIfExpired(
  session: PairingSession,
  now: string,
): { session: PairingSession; expired: boolean } {
  if (isTerminal(session.status)) {
    return { session, expired: false };
  }
  const nowMs = Date.parse(now);
  const expiresMs = Date.parse(session.expiresAt);
  if (Number.isFinite(nowMs) && Number.isFinite(expiresMs) && nowMs < expiresMs) {
    return { session, expired: false };
  }
  // 時間壞掉時 fail closed。
  return { session: { ...session, status: "expired", closedReason: "expired" }, expired: true };
}
