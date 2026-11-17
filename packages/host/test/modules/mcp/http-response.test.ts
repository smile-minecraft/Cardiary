/**
 * HTTP MCP 的 JSON-RPC 回應解析：有 expectedId 的請求維持嚴格解析與 id 比對；
 * 通知回應不論回什麼狀態都不當成結果。這裡用真的 `HttpMcpClient`
 * （走 `createMcpClient`）連真的 `http.createServer`，不注入假 client。
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

/** 關掉 server 前先砍掉卡住的 keep-alive 連線，避免 close() 永遠等不到。 */
async function closeServer(server: Server): Promise<void> {
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
  await closed;
}

interface ServerOptions {
  /** initialize 的回應；預設回正常的 JSON-RPC result。 */
  init?: (id: number | undefined, res: import("node:http").ServerResponse) => void;
  /** tools/list 的回應；預設回正常的 JSON-RPC result。 */
  tools?: (id: number | undefined, res: import("node:http").ServerResponse) => void;
}

/** 一個最小的 HTTP MCP server；初始化後的通知一律回 204 空 body。 */
async function startMcpServer(options: ServerOptions = {}): Promise<{ url: string }> {
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
      if (method === "notifications/initialized") {
        res.writeHead(204).end();
        return;
      }
      if (method === "initialize") {
        if (options.init !== undefined) {
          options.init(id, res);
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
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
        if (options.tools !== undefined) {
          options.tools(id, res);
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: { tools: [{ name: "echo" }] },
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
  return { url: `http://localhost:${port}/mcp` };
}

function httpRecord(url: string): McpServerRecord {
  return {
    serverId: "mcp-http-response",
    name: "Response",
    transport: "http",
    url,
    allowedHosts: ["localhost"],
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeClient(url: string) {
  return createMcpClient(httpRecord(url), {
    folderRoot: "",
    spawn: {} as never,
    logger: { debug: () => undefined, warn: () => undefined },
  });
}

describe("HTTP MCP 回應解析", () => {
  it("回應 id 不符時以 invalid_response 拒絕", async () => {
    const { url } = await startMcpServer({
      tools: (id, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: (id ?? 0) + 100,
            result: { tools: [{ name: "echo" }] },
          }),
        );
      },
    });
    const client = makeClient(url);
    await expect(client.listTools()).rejects.toMatchObject({
      code: "invalid_response",
    });
    await client.close();
  });

  it("非 2xx 回應以 http_error 拒絕，不做 JSON 解析", async () => {
    const { url } = await startMcpServer({
      tools: (_id, res) => {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("not json");
      },
    });
    const client = makeClient(url);
    await expect(client.listTools()).rejects.toMatchObject({
      code: "http_error",
    });
    await client.close();
  });
});
