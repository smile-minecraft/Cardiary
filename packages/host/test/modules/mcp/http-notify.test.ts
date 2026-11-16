/**
 * HTTP MCP 初始化：initialize 回正常 JSON，notifications/initialized 是
 * JSON-RPC 通知，伺服器常回 202/204 且 body 是空的。用戶端不能把空 body
 * 當成錯誤，必須照樣完成初始化並列出工具。
 *
 * 這裡用真的 `HttpMcpClient`（走 `createMcpClient`）連真的 `http.createServer`，
 * 不注入假 client，逐一驗證通知回 202、204 與空 200 三種常見回法。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import type { McpServerRecord } from "@cardiary/domain";

import { createMcpClient } from "../../../src/modules/mcp/client.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

/** 關掉 server 前先砍掉 keep-alive 連線，避免 close() 永遠等不到。 */
async function closeServer(server: Server): Promise<void> {
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
  await closed;
}

/**
 * 一個最小的 HTTP MCP server：
 * - initialize 回標協定版本的 JSON-RPC result；
 * - notifications/initialized 依傳入的 status 回空 body；
 * - tools/list 回一個工具。
 * 同時記錄收到的 method，方便斷言通知確實送出。
 */
async function startMcpServer(notificationStatus: number): Promise<{
  url: string;
  methods: string[];
}> {
  const methods: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      let method: string;
      let id: number | undefined;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          method?: string;
          id?: number;
        };
        method = parsed.method ?? "";
        id = parsed.id;
      } catch {
        res.writeHead(400).end();
        return;
      }
      methods.push(method);
      if (method === "notifications/initialized") {
        res.writeHead(notificationStatus).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      if (method === "initialize") {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { protocolVersion: "2025-06-18", capabilities: {} },
          }),
        );
        return;
      }
      if (method === "tools/list") {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              tools: [{ name: "echo", description: "回聲", inputSchema: { type: "object" } }],
            },
          }),
        );
        return;
      }
      res.writeHead(400).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  return { url: `http://localhost:${port}/mcp`, methods };
}

function httpRecord(url: string): McpServerRecord {
  return {
    serverId: "mcp-http-notify",
    name: "Notify",
    transport: "http",
    url,
    allowedHosts: ["localhost"],
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("HTTP MCP 初始化接受空 body 的通知回應", () => {
  for (const status of [202, 204, 200]) {
    it(`notifications/initialized 回 ${status} 空 body 時仍完成初始化並列出工具`, async () => {
      const { url, methods } = await startMcpServer(status);
      const client = createMcpClient(httpRecord(url), {
        folderRoot: "",
        spawn: {} as never,
        logger: { debug: () => undefined, warn: () => undefined },
      });

      const tools = await client.listTools();
      expect(tools).toEqual([
        { name: "echo", description: "回聲", inputSchema: { type: "object" } },
      ]);
      expect(methods).toContain("initialize");
      expect(methods).toContain("notifications/initialized");
      expect(methods).toContain("tools/list");
      await client.close();
    });
  }
});
