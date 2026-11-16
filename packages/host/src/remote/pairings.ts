/**
 * 配對的記憶體代管：等待中的配對請求只活在這裡。
 *
 * 短碼不落地、不進控制通道以外的地方；請求一進終態就從代管清掉。
 * 容量上限避免未認證連線灌爆記憶體：每條連線只能有一筆等待中的請求，
 * 全域最多 `MAX_PENDING_PAIRINGS` 筆。
 */

import { createPairingSession, disconnectPairing, type PairingSession } from "@cardiary/domain";

import type { PairingDeviceKind } from "@cardiary/domain";

const MAX_PENDING_PAIRINGS = 32;
const MAX_PENDING_PER_CONNECTION = 1;

export interface PairingNotice {
  readonly pairingRequestId: string;
  readonly deviceName: string;
  readonly deviceKind: PairingDeviceKind;
  /** 明文短碼；只經私有控制通道送給殼顯示。 */
  readonly code: string;
  readonly expiresAt: string;
}

export class PairingCapacityError extends Error {
  readonly reason: "pending-limit" | "connection-pending";

  constructor(reason: "pending-limit" | "connection-pending", message: string) {
    super(message);
    this.name = "PairingCapacityError";
    this.reason = reason;
  }
}

export class PairingRegistry {
  readonly #sessions = new Map<string, PairingSession>();

  /** 提出請求的連線上限。 */
  get pendingCount(): number {
    return this.#sessions.size;
  }

  create(
    input: { readonly deviceName: string; readonly deviceKind: PairingDeviceKind },
    connectionId: string,
    now: string,
  ): PairingSession {
    if (this.pendingCount >= MAX_PENDING_PAIRINGS) {
      throw new PairingCapacityError("pending-limit", "等待中的配對請求太多，請稍後再試。");
    }
    const own = [...this.#sessions.values()].filter(
      (session) => session.connectionId === connectionId,
    );
    if (own.length >= MAX_PENDING_PER_CONNECTION) {
      throw new PairingCapacityError("connection-pending", "這條連線已有一筆等待中的配對請求。");
    }
    const session = createPairingSession(
      { deviceName: input.deviceName, deviceKind: input.deviceKind, connectionId },
      { now },
    );
    this.#sessions.set(session.pairingRequestId, session);
    return session;
  }

  get(pairingRequestId: string): PairingSession | undefined {
    return this.#sessions.get(pairingRequestId);
  }

  /** 寫回狀態機的最新結果；終態的請求直接移除。 */
  update(session: PairingSession): void {
    if (
      session.status === "completed" ||
      session.status === "denied" ||
      session.status === "expired"
    ) {
      this.#sessions.delete(session.pairingRequestId);
      return;
    }
    this.#sessions.set(session.pairingRequestId, session);
  }

  /** 斷線收屍；只處理同一條連線提出的請求。 */
  disconnect(connectionId: string, now: string): void {
    for (const session of [...this.#sessions.values()]) {
      if (session.connectionId !== connectionId) continue;
      const outcome = disconnectPairing(session, { connectionId }, now);
      if (outcome.ok) {
        this.update(outcome.session);
      }
    }
  }

  /** 收屍所有已過期的請求；回收記憶體用。 */
  sweep(now: string): number {
    let removed = 0;
    for (const session of [...this.#sessions.values()]) {
      if (Date.parse(session.expiresAt) <= Date.parse(now)) {
        this.#sessions.delete(session.pairingRequestId);
        removed += 1;
      }
    }
    return removed;
  }
}
