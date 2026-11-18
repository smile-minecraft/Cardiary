/**
 * HTTP MCP 的重新導向白名單。
 *
 * 主機自己連線 HTTP 伺服器時，重新導向的每一跳都要重新比對 `allowedHosts`，
 * 不能只在第一次連線前檢查。這裡用本機 `http.createServer` 當起點、中繼與
 * 終點，不連外網：被拒絕的導向目標另外開一個 listener，確認主機真的沒有
 * 向它發出連線，而不是只相信錯誤碼。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import type { McpServerRecord } from "@cardiary/domain";

import { createMcpClient, McpClientError } from "../../../src/modules/mcp/client.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    }),
  );
});

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

/** 開一個只綁定本機的 HTTP listener，回傳實際埠號。 */
async function listen(handler: Handler): Promise<number> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

function record(port: number): McpServerRecord {
  return {
    serverId: "redirect-test",
    name: "RedirectTest",
    transport: "http",
    url: `http://localhost:${String(port)}/mcp`,
    allowedHosts: ["localhost"],
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** 一個最小 MCP 端點：回應 initialize、通知與 tools/list，並記下方法順序。 */
function mcpEndpoint(methods: string[]): Handler {
  return (request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id?: number;
        method?: string;
      };
      methods.push(message.method ?? "");
      if (message.method === "notifications/initialized") {
        response.writeHead(202).end();
        return;
      }
      if (message.method === "initialize") {
        sendJson(response, {
          jsonrpc: "2.0",
          id: message.id,
          result: { protocolVersion: "2025-06-18", capabilities: {} },
        });
        return;
      }
      if (message.method === "tools/list") {
        sendJson(response, {
          jsonrpc: "2.0",
          id: message.id,
          result: { tools: [{ name: "ping" }] },
        });
        return;
      }
      sendJson(response, { jsonrpc: "2.0", id: message.id, result: {} });
    });
  };
}

function redirect(location: string, status = 307): Handler {
  return (_request, response) => {
    response.writeHead(status, { location }).end();
  };
}

describe("HTTP MCP 的重新導向白名單", () => {
  it("導向白名單內的主機時照常完成初始化與工具列表", async () => {
    const methods: string[] = [];
    const finalPort = await listen(mcpEndpoint(methods));
    const startPort = await listen(redirect(`http://localhost:${String(finalPort)}/mcp`));

    const client = createMcpClient(record(startPort), {
      folderRoot: "",
      spawn: {} as never,
      logger: { debug: () => undefined, warn: () => undefined },
      requestTimeoutMs: 5_000,
    });
    try {
      const tools = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(["ping"]);
      expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    } finally {
      await client.close();
    }
  });

  it("前一跳允許、下一跳不在白名單時拒絕，且不向該主機發出連線", async () => {
    let sinkConnections = 0;
    const sinkPort = await listen((_request, response) => {
      sinkConnections += 1;
      sendJson(response, { jsonrpc: "2.0", id: 1, result: {} });
    });

    // 第一跳是白名單內的 localhost；它再把請求導向 127.0.0.1（不在白名單）。
    let middleRequests = 0;
    const middlePort = await listen((_request, response) => {
      middleRequests += 1;
      response.writeHead(307, { location: `http://127.0.0.1:${String(sinkPort)}/mcp` }).end();
    });
    const startPort = await listen(redirect(`http://localhost:${String(middlePort)}/mcp`));

    const client = createMcpClient(record(startPort), {
      folderRoot: "",
      spawn: {} as never,
      logger: { debug: () => undefined, warn: () => undefined },
      requestTimeoutMs: 5_000,
    });
    try {
      const error = await client.listTools().then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(McpClientError);
      expect((error as McpClientError).code).toBe("host_not_allowed");
      expect(sinkConnections, "被拒絕的導向主機不應收到連線").toBe(0);
      expect(middleRequests, "中繼主機應收到第一跳").toBe(1);
    } finally {
      await client.close();
    }
  });
});
