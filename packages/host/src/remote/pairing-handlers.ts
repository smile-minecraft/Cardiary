/**
 * 配對請求的公開協定處理：`pairing.begin` 與 `pairing.complete`。
 *
 * 只有未認證連線會走到這裡（閘道在分派之前分流）。這兩個型別不會
 * 觸碰任何其他請求；核准與撤銷永遠只走殼的私有控制通道。
 */

import { completePairing, isDeviceTokenActive } from "@cardiary/domain";

import { protocolError, type ProtocolErrorInfo } from "../errors.js";
import type { JSONObject } from "@cardiary/protocol";

import type { RemoteStack } from "./stack.js";
import { PairingCapacityError } from "./pairings.js";

/** 配對處理失敗；閘道轉成協定錯誤回應。 */
export class RemoteFailure extends Error {
  readonly info: ProtocolErrorInfo;

  constructor(info: ProtocolErrorInfo) {
    super(info.message);
    this.name = "RemoteFailure";
    this.info = info;
  }
}

function fail(info: ProtocolErrorInfo): never {
  throw new RemoteFailure(info);
}

export interface PairingRequestContext {
  readonly id: string;
  readonly payload: JSONObject;
}

function requiredField(payload: JSONObject, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.length === 0) {
    fail(protocolError("invalid_message", `缺少必填欄位 ${field}。`, { details: { field } }));
  }
  return value;
}

export async function handlePairingBegin(
  stack: RemoteStack,
  connectionId: string,
  request: PairingRequestContext,
): Promise<Record<string, unknown>> {
  const deviceName = requiredField(request.payload, "deviceName");
  const kind = requiredField(request.payload, "kind");
  if (kind !== "web" && kind !== "ios") {
    fail(
      protocolError("invalid_message", "kind 只能是 web 或 ios。", { details: { field: "kind" } }),
    );
  }
  const now = stack.now();
  let session;
  try {
    session = stack.pairings.create({ deviceName, deviceKind: kind }, connectionId, now);
  } catch (error) {
    if (error instanceof PairingCapacityError) {
      fail(protocolError("busy", error.message, { details: { reason: error.reason } }));
    }
    if (error instanceof RangeError) {
      fail(protocolError("invalid_message", error.message, { details: { field: "deviceName" } }));
    }
    throw error;
  }
  stack.notifyPairingRequested?.({
    pairingRequestId: session.pairingRequestId,
    deviceName: session.deviceName,
    deviceKind: session.deviceKind,
    code: session.shortCode,
    expiresAt: session.expiresAt,
  });
  return {
    v: 1,
    kind: "response",
    replyTo: request.id,
    type: "pairing.begin",
    payload: {
      pairingRequestId: session.pairingRequestId,
      code: session.shortCode,
      expiresAt: session.expiresAt,
    },
  };
}

export async function handlePairingComplete(
  stack: RemoteStack,
  connectionId: string,
  request: PairingRequestContext,
): Promise<{ frame: Record<string, unknown> }> {
  const pairingRequestId = requiredField(request.payload, "pairingRequestId");
  const session = stack.pairings.get(pairingRequestId);
  if (!session) {
    // 不存在或已進終態：不透露區別。
    fail(
      protocolError("conflict", "配對請求不存在或已結束。", {
        details: { reason: "unknown-or-closed" },
      }),
    );
  }
  const now = stack.now();
  const outcome = completePairing(session, { connectionId }, { now });
  stack.pairings.update(outcome.session);
  if (!outcome.ok) {
    fail(protocolError("conflict", "無法領取配對結果。", { details: { reason: outcome.reason } }));
  }
  const device = outcome.device;
  await stack.devices.insert({
    ...device.record,
    deviceName: session.deviceName,
    deviceKind: session.deviceKind,
    prefix: device.prefix,
  });
  return {
    frame: {
      v: 1,
      kind: "response",
      replyTo: request.id,
      type: "pairing.complete",
      payload: {
        deviceId: device.deviceId,
        deviceName: session.deviceName,
        deviceToken: device.deviceToken,
      },
    },
  };
}

export type DeviceTokenCheck =
  { readonly ok: true } | { readonly ok: false; readonly code: "auth_invalid" | "auth_expired" };

/**
 * 逐請求重新驗證裝置 Token：撤銷或到期後，下一個請求就失敗。
 */
export async function checkDeviceTokenActive(
  stack: RemoteStack,
  tokenHash: string,
): Promise<DeviceTokenCheck> {
  const record = await stack.devices.findByHash(tokenHash);
  if (!record) return { ok: false, code: "auth_invalid" };
  if (!isDeviceTokenActive(record, stack.now())) {
    return { ok: false, code: record.revokedAt !== undefined ? "auth_invalid" : "auth_expired" };
  }
  return { ok: true };
}
