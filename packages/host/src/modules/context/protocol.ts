/**
 * `context.*` 協定處理器。
 *
 * 只做輸入檢查與線路形狀的映射；八層、估算與壓縮在 `../../context/`。
 */

import type { ContextView } from "@cardiary/domain";
import type { JsonValue } from "@cardiary/engine-adapter";
import type { ProtocolEventEmitter, ProtocolRequestContext } from "@cardiary/module-api";
import type { JSONObject } from "@cardiary/protocol";

import { ProtocolHandlerError } from "../contract.js";
import { ContextError } from "../../context/assembler.js";
import type { ContextServiceImpl } from "../../context/service.js";

export interface ContextProtocolOptions {
  readonly service: ContextServiceImpl;
  readonly protocol: ProtocolEventEmitter;
}

export function registerContextProtocol(options: ContextProtocolOptions): void {
  const { service } = options;
  options.protocol.registerNamespace(
    "context",
    async (request: ProtocolRequestContext): Promise<JsonValue> => {
      try {
        switch (request.type) {
          case "context.get":
            return asJson({ context: await service.view(sessionOf(request)) });
          case "context.add_card": {
            const payload = objectOf(request.payload);
            return asJson({
              context: await service.addCard({
                sessionId: sessionOf(request),
                cardId: requiredString(payload, "cardId"),
              }),
            });
          }
          case "context.remove_card": {
            const payload = objectOf(request.payload);
            return asJson({
              context: await service.removeCard({
                sessionId: sessionOf(request),
                cardId: requiredString(payload, "cardId"),
              }),
            });
          }
          case "context.compact": {
            const payload = objectOf(request.payload);
            const instructions = optionalString(payload, "instructions");
            const result = await service.compact({
              sessionId: sessionOf(request),
              ...(instructions === undefined ? {} : { instructions }),
            });
            return asJson({ sessionId: sessionOf(request), scheduled: result.scheduled });
          }
          default:
            throw new ProtocolHandlerError("not_found", `沒有這個上下文訊息：${request.type}`);
        }
      } catch (error) {
        if (error instanceof ProtocolHandlerError) throw error;
        if (error instanceof ContextError) {
          throw new ProtocolHandlerError(
            error.code === "not_found" ? "not_found" : "invalid_message",
            error.message,
          );
        }
        throw error;
      }
    },
  );
}

/** 會話識別碼以 payload 為準；`request.sessionId` 是閘道從同一個欄位取出的。 */
function sessionOf(request: ProtocolRequestContext): string {
  const payload = objectOf(request.payload);
  return requiredString(payload, "sessionId");
}

function objectOf(value: JsonValue | undefined): JSONObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolHandlerError("invalid_message", "請求內容必須是物件。");
  }
  return value as JSONObject;
}

function requiredString(input: JSONObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolHandlerError("invalid_message", `缺少或型別不符的欄位：${key}`, {
      field: key,
    });
  }
  return value;
}

function optionalString(input: JSONObject, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ProtocolHandlerError("invalid_message", `欄位 ${key} 必須是字串。`, { field: key });
  }
  return value;
}

function asJson(payload: object | ContextView): JsonValue {
  return payload as unknown as JsonValue;
}
