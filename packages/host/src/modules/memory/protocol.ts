/**
 * `module.memory.undo` 協定處理器。
 *
 * 走既有 `registerNamespace`，不進基底 schema。網頁客戶端不開放呼叫——
 * 但協定層沒有通道概念，這裡只做純輸入檢查，真正的寫入由復原服務把關。
 */

import type { JsonValue } from "@cardiary/engine-adapter";
import type { ProtocolEventEmitter, ProtocolRequestContext } from "@cardiary/module-api";

import { undoItem, undoOutcomeToJson, type UndoOptions } from "./undo.js";

export function registerMemoryProtocol(options: {
  readonly undo: UndoOptions;
  readonly protocol: ProtocolEventEmitter;
}): void {
  options.protocol.registerNamespace("module.memory", async (request: ProtocolRequestContext) => {
    if (request.type === "module.memory.undo") {
      const payload = objectOf(requestPayload(request.payload));
      const notificationId = stringOf(payload.notificationId);
      const itemId = stringOf(payload.itemId);
      if (notificationId === null || itemId === null) {
        return { ok: false, reason: "invalid-input" } as unknown as JsonValue;
      }
      const outcome = await undoItem(options.undo, notificationId, itemId);
      return undoOutcomeToJson(outcome);
    }
    return { ok: false, reason: "not-found" } as unknown as JsonValue;
  });
}

function requestPayload(payload: ProtocolRequestContext["payload"]): unknown {
  if (payload !== null && typeof payload === "object" && "data" in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

function objectOf(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
