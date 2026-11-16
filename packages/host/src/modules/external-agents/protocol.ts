/**
 * `agent.*` 與 `module.external-agents.*` 協定處理器。
 *
 * `agent.*` 是協定 schema 的第一方命名空間，回傳值就是 response payload；
 * `module.external-agents.*` 走模組協定，回傳值由閘道包進 `data`。
 * 所有欄位都在這裡檢查過才交給服務，服務只收已確定型別的值。
 */
import type { ExternalAgentUsage, ExternalAgentKind } from "@cardiary/domain";
import type { JsonValue } from "@cardiary/engine-adapter";
import type { ProtocolEventEmitter, ProtocolRequestContext } from "@cardiary/module-api";
import type { AgentListResponsePayload } from "@cardiary/protocol";

import { ProtocolHandlerError } from "../contract.js";
import { AgentStartError, type ExternalAgentsService, type StartAgentInput } from "./service.js";

export interface ExternalAgentsProtocolOptions {
  readonly service: ExternalAgentsService;
  readonly protocol: ProtocolEventEmitter;
}

/** 註冊外部代理的兩組命名空間；handle 由模組主機在停用時撤銷。 */
export function registerExternalAgentsProtocol(options: ExternalAgentsProtocolOptions): void {
  const { service, protocol } = options;
  protocol.registerNamespace("agent", async (request: ProtocolRequestContext) => {
    try {
      switch (request.type) {
        case "agent.start":
          return asJson(await service.start(parseStart(request.payload)));
        case "agent.stop": {
          const agentSessionId = requiredString(objectOf(request.payload), "agentSessionId");
          return asJson(await service.stop(agentSessionId));
        }
        case "agent.list":
          return asJson({ agents: [...await service.list()] } satisfies AgentListResponsePayload);
        default:
          throw new ProtocolHandlerError("not_found", `沒有這個代理訊息：${request.type}`);
      }
    } catch (error) {
      throw asProtocolError(error);
    }
  });
  protocol.registerNamespace("module.external-agents", async (request: ProtocolRequestContext) => {
    try {
      if (request.type === "module.external-agents.usage") {
        const usage: ExternalAgentUsage = await service.usage();
        return asJson({ data: usage });
      }
      throw new ProtocolHandlerError("not_found", `沒有這個代理模組訊息：${request.type}`);
    } catch (error) {
      throw asProtocolError(error);
    }
  });
}

function parseStart(value: JsonValue): StartAgentInput {
  const payload = objectOf(value);
  const agentKind = enumOf(payload.agentKind, "agentKind", [
    "opencode",
    "claude-code",
  ]) as ExternalAgentKind;
  const workingDirectory = requiredString(payload, "workingDirectory");
  const prompt = optionalString(payload, "prompt");
  const clientRequestId = optionalString(payload, "clientRequestId");
  return {
    agentKind,
    workingDirectory,
    ...(prompt === undefined ? {} : { prompt }),
    ...(clientRequestId === undefined ? {} : { clientRequestId }),
  };
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

function objectOf(value: JsonValue): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolHandlerError("invalid_message", "payload 必須是物件。", { field: "payload" });
  }
  return value as Record<string, unknown>;
}

function requiredString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolHandlerError("invalid_message", `${field} 必須是非空字串。`, { field });
  }
  return value;
}

function optionalString(payload: Record<string, unknown>, field: string): string | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ProtocolHandlerError("invalid_message", `${field} 必須是字串。`, { field });
  }
  return value;
}

function enumOf(value: unknown, field: string, allowed: readonly string[]): string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new ProtocolHandlerError("invalid_message", `${field} 不是支援的代理種類。`, { field });
  }
  return value;
}

function asProtocolError(error: unknown): ProtocolHandlerError {
  if (error instanceof ProtocolHandlerError) return error;
  if (error instanceof AgentStartError) {
    return new ProtocolHandlerError(
      error.code === "sandbox-unavailable" ? "unsupported" : "invalid_message",
      error.message,
    );
  }
  return new ProtocolHandlerError("internal", error instanceof Error ? error.message : String(error));
}
