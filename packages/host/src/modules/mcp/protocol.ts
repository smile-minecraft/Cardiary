/**
 * `mcp.*` 協定處理器。
 *
 * 五個請求都在這裡解析、驗證，再交給控制器；控制器負責審批、啟動與停止。
 * 審批是「提出請求後立刻回 approvalId」，不是等人在同一個請求裡決定，
 * 因為審批可能在另一個客戶端完成，連線也可能先斷。
 */
import type { JsonValue } from "@cardiary/engine-adapter";
import {
  McpConfigError,
  validateMcpServerInput,
  type McpServerInput,
  type McpServerRecord,
} from "@cardiary/domain";
import type { McpServerInfo } from "@cardiary/protocol";
import type {
  ProtocolEventEmitter,
  ProtocolRegistrationHandle,
  ProtocolRequestContext,
} from "@cardiary/module-api";

import { ProtocolHandlerError } from "../contract.js";

/** 模組提供給協定層的動作；實作在 `index.ts`。 */
export interface McpController {
  listServers(): Promise<McpServerInfo[]>;
  requestAdd(input: McpServerInput): Promise<{ approvalId: string }>;
  removeServer(serverId: string): Promise<boolean>;
  setEnabled(serverId: string, enabled: boolean): Promise<McpServerInfo>;
  setAllowedHosts(serverId: string, allowedHosts: readonly string[]): Promise<McpServerInfo>;
}

/** 註冊 `mcp` 命名空間；回傳的 handle 由模組主機在停用時撤銷。 */
export function registerMcpProtocol(
  protocol: ProtocolEventEmitter,
  controller: McpController,
): ProtocolRegistrationHandle {
  return protocol.registerNamespace("mcp", async (request) => {
    switch (request.type) {
      case "mcp.servers.list":
        return { servers: await controller.listServers() } as unknown as JsonValue;
      case "mcp.server.add":
        return (await controller.requestAdd(parseAddInput(request))) as unknown as JsonValue;
      case "mcp.server.remove": {
        const serverId = requiredString(request.payload, "serverId");
        const removed = await controller.removeServer(serverId);
        return { serverId, removed } as unknown as JsonValue;
      }
      case "mcp.server.set_enabled": {
        const serverId = requiredString(request.payload, "serverId");
        const enabled = requiredBoolean(request.payload, "enabled");
        return {
          server: await controller.setEnabled(serverId, enabled),
        } as unknown as JsonValue;
      }
      case "mcp.server.allow_hosts": {
        const serverId = requiredString(request.payload, "serverId");
        const hosts = requiredStringArray(request.payload, "allowedHosts");
        return {
          server: await controller.setAllowedHosts(serverId, hosts),
        } as unknown as JsonValue;
      }
      default:
        throw new ProtocolHandlerError("unsupported", `不支援的 MCP 請求：${request.type}`);
    }
  });
}

/** 把正本記錄加上執行狀態，轉成協定回傳的伺服器資訊。 */
export function toServerInfo(
  record: McpServerRecord,
  runtime: { readonly state: "disabled" | "ready" | "failed"; readonly failure?: string } | null,
): McpServerInfo {
  const state = !record.enabled ? "disabled" : (runtime?.state ?? "disabled");
  const failure = state === "failed" ? runtime?.failure : undefined;
  return {
    serverId: record.serverId,
    name: record.name,
    transport: record.transport,
    ...(record.command === undefined ? {} : { command: record.command }),
    ...(record.args === undefined ? {} : { args: [...record.args] }),
    ...(record.url === undefined ? {} : { url: record.url }),
    allowedHosts: [...record.allowedHosts],
    enabled: record.enabled,
    state,
    ...(failure === undefined ? {} : { failure }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function parseAddInput(request: ProtocolRequestContext): McpServerInput {
  const payload = asRecord(request.payload, "payload");
  try {
    return validateMcpServerInput({
      name: requiredString(payload, "name"),
      transport: requiredTransport(payload),
      ...(payload.command === undefined ? {} : { command: requiredString(payload, "command") }),
      ...(payload.args === undefined ? {} : { args: requiredStringArray(payload, "args") }),
      ...(payload.url === undefined ? {} : { url: requiredString(payload, "url") }),
      allowedHosts: requiredStringArray(payload, "allowedHosts"),
    });
  } catch (error) {
    if (error instanceof McpConfigError) {
      throw new ProtocolHandlerError("invalid_message", error.message);
    }
    throw error;
  }
}

function requiredTransport(value: Record<string, JsonValue>): "stdio" | "http" {
  const transport = value.transport;
  if (transport !== "stdio" && transport !== "http") {
    throw new ProtocolHandlerError("invalid_message", "transport 必須是 stdio 或 http");
  }
  return transport;
}

function requiredString(value: JsonValue, field: string): string {
  const record = asRecord(value, field);
  const entry = record[field];
  if (typeof entry !== "string" || entry.length === 0) {
    throw new ProtocolHandlerError("invalid_message", `${field} 必須是非空字串`);
  }
  return entry;
}

function requiredBoolean(value: JsonValue, field: string): boolean {
  const record = asRecord(value, field);
  const entry = record[field];
  if (typeof entry !== "boolean") {
    throw new ProtocolHandlerError("invalid_message", `${field} 必須是布林值`);
  }
  return entry;
}

function requiredStringArray(value: JsonValue, field: string): string[] {
  const record = asRecord(value, field);
  const entry = record[field];
  if (!Array.isArray(entry) || entry.some((item) => typeof item !== "string")) {
    throw new ProtocolHandlerError("invalid_message", `${field} 必須是字串陣列`);
  }
  return [...(entry as string[])];
}

function asRecord(value: JsonValue, field: string): Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolHandlerError("invalid_message", `${field} 必須是物件`);
  }
  return value as Record<string, JsonValue>;
}
