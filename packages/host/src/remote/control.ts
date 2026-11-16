/**
 * 殼的私有控制通道上，遠端裝置的核准與撤銷。
 *
 * 這些路由只存在於 stdin／stdout 的私有通道；公開的 WebSocket 協定上
 * 沒有對應的請求型別。領域層的 `approvePairing`／`denyPairing` 要求
 * `shell-control` 權限證明，這裡傳的永遠是它。
 */

import { approvePairing, denyPairing } from "@cardiary/domain";
import type { JSONObject } from "@cardiary/protocol";

import type { ControlChannel } from "../control/channel.js";
import { ControlError } from "../errors.js";
import type { RemoteStack } from "./stack.js";

function requiredField(payload: JSONObject, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ControlError("invalid_message", `缺少必填欄位 ${field}`);
  }
  return value;
}

export interface RemoteControlHooks {
  /** 撤銷後關閉該裝置所有既有連線；回傳關閉的連線數。 */
  closeDeviceConnections(deviceId: string): number;
}

function deviceView(record: {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly deviceKind: string;
  readonly fingerprint: string;
  readonly prefix?: string | undefined;
  readonly createdAt: string;
  readonly revokedAt?: string | undefined;
}): JSONObject {
  return {
    deviceId: record.deviceId,
    deviceName: record.deviceName,
    deviceKind: record.deviceKind,
    fingerprint: record.fingerprint,
    ...(record.prefix === undefined ? {} : { prefix: record.prefix }),
    createdAt: record.createdAt,
    ...(record.revokedAt === undefined ? {} : { revokedAt: record.revokedAt }),
  };
}

export function registerRemoteControlRoutes(
  channel: ControlChannel,
  stack: RemoteStack,
  hooks: RemoteControlHooks,
): void {
  const authority = { kind: "shell-control", note: "control-channel" } as const;

  channel.onRequest("control.pairing.approve", async (payload) => {
    const pairingRequestId = requiredField(payload, "pairingRequestId");
    const session = stack.pairings.get(pairingRequestId);
    if (!session) {
      throw new ControlError("unavailable", "找不到這筆配對請求（可能已結束或過期）");
    }
    const now = stack.now();
    const outcome = approvePairing(session, authority, now);
    stack.pairings.update(outcome.session);
    if (!outcome.ok) {
      throw new ControlError("invalid_message", `無法核准：${outcome.reason}`);
    }
    return { pairingRequestId, status: outcome.session.status };
  });

  channel.onRequest("control.pairing.deny", async (payload) => {
    const pairingRequestId = requiredField(payload, "pairingRequestId");
    const session = stack.pairings.get(pairingRequestId);
    if (!session) {
      throw new ControlError("unavailable", "找不到這筆配對請求（可能已結束或過期）");
    }
    const now = stack.now();
    const outcome = denyPairing(session, authority, now);
    stack.pairings.update(outcome.session);
    if (!outcome.ok) {
      throw new ControlError("invalid_message", `無法拒絕：${outcome.reason}`);
    }
    return { pairingRequestId, status: outcome.session.status };
  });

  channel.onRequest("control.devices.list", async () => {
    const records = await stack.devices.list();
    return { devices: records.map(deviceView) } as unknown as JSONObject;
  });

  channel.onRequest("control.devices.revoke", async (payload) => {
    const deviceId = requiredField(payload, "deviceId");
    const record = await stack.devices.revoke(deviceId, stack.now());
    if (!record) {
      throw new ControlError("unavailable", `找不到裝置：${deviceId}`);
    }
    const closed = hooks.closeDeviceConnections(deviceId);
    return { deviceId, revoked: true, closedConnections: closed };
  });
}
