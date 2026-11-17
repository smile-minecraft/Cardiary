/**
 * MCP 用戶端讀取 `ui://` 介面資源的行為。
 *
 * 這裡走真正的 `createMcpClient`，Stdio 用真的可控子行程、Http 用真的
 * `http.createServer`，確認 `resources/read` 是照既有 request/送信機制送出，
 * 而不是另開一條路徑；同時確認 `tools/list` 會保留原始 `_meta`。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { McpServerRecord } from "@cardiary/domain";

import { createMcpClient, type McpClient } from "../../../src/modules/mcp/client.js";
import { SpawnRegistry } from "../../../src/spawn/wrapper.js";

// ── stdio ──────────────────────────────────────────────────────────────────

const STDIO_SCRIPT = `
const readline = require("node:readline");
function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === "initialize") {
    reply(message.id, { protocolVersion: "2025-06-18", capabilities: {} });
  } else if (message.method === "tools/list") {
    reply(message.id, { tools: [{
      name: "show",
      _meta: { ui: { resourceUri: "ui://app/view.html" } },
    }] });
  } else if (message.method === "resources/read") {
    if (message.params && message.params.uri === "ui://app/view.html") {
      reply(message.id, {
        contents: [{
          uri: "ui://app/view.html",
          mimeType: "text/html;profile=mcp-app",
          text: "<h1>hello</h1>",
        }],
      });
    } else {
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: message.id,
        error: { code: -32002, message: "resource not found" },
      }) + "\\n");
    }
  }
});
`;

let stdioRoot = "";
let registry: SpawnRegistry | null = null;
let stdioClient: McpClient | null = null;

function makeStdioClient(): McpClient {
  stdioRoot = mkdtempSync(join(tmpdir(), "cardiary-mcp-ui-client-"));
  registry = new SpawnRegistry();
  const record: McpServerRecord = {
    serverId: "ui-client-stdio",
    name: "UiClientStdio",
    transport: "stdio",
    command: process.execPath,
    args: ["-e", STDIO_SCRIPT],
    allowedHosts: [],
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const client = createMcpClient(record, {
    folderRoot: stdioRoot,
    spawn: registry,
    logger: { debug: () => undefined, warn: () => undefined },
  });
  stdioClient = client;
  return client;
}

// ── http ───────────────────────────────────────────────────────────────────

const servers: Server[] = [];

async function makeHttpClient(): Promise<McpClient> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      let method: string;
      let id: number | undefined;
      let params: Record<string, unknown>;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          method?: string;
          id?: number;
          params?: Record<string, unknown>;
        };
        method = parsed.method ?? "";
        id = parsed.id;
        params = parsed.params ?? {};
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (method === "notifications/initialized") {
        res.writeHead(204).end();
        return;
      }
      const json = (result: unknown): void => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      };
      if (method === "initialize") {
        json({ protocolVersion: "2025-06-18", capabilities: {} });
      } else if (method === "resources/read") {
        json({
          contents: [
            {
              uri: params.uri,
              mimeType: "text/html;profile=mcp-app",
              text: `<html data-uri="${String(params.uri)}"></html>`,
            },
          ],
        });
      } else {
        json({});
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  const record: McpServerRecord = {
    serverId: "ui-client-http",
    name: "UiClientHttp",
    transport: "http",
    url: `http://localhost:${port}/mcp`,
    allowedHosts: ["localhost"],
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  return createMcpClient(record, {
    folderRoot: "",
    spawn: {} as never,
    logger: { debug: () => undefined, warn: () => undefined },
  });
}

afterEach(async () => {
  await stdioClient?.close();
  stdioClient = null;
  await registry?.cancelAll(1_000);
  await registry?.waitAll();
  registry = null;
  if (stdioRoot !== "") rmSync(stdioRoot, { recursive: true, force: true });
  stdioRoot = "";
  await Promise.all(
    servers.splice(0).map(async (server) => {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    }),
  );
});

describe("MCP 用戶端讀取 ui 資源", () => {
  it("stdio：tools/list 保留原始 _meta，resources/read 用既有請求送出 uri", async () => {
    const client = makeStdioClient();
    const tools = await client.listTools();
    expect(tools[0]?.meta).toEqual({ ui: { resourceUri: "ui://app/view.html" } });

    const resource = await client.readResource("ui://app/view.html");
    expect(resource).toMatchObject({
      contents: [
        {
          uri: "ui://app/view.html",
          mimeType: "text/html;profile=mcp-app",
          text: "<h1>hello</h1>",
        },
      ],
    });
  });

  it("stdio：resources/read 的協定錯誤照原樣丟出，讓上層降級", async () => {
    const client = makeStdioClient();
    await expect(client.readResource("ui://app/missing.html")).rejects.toThrow();
  });

  it("http：resources/read 用既有送信機制帶 params.uri 送出並回傳結果", async () => {
    const client = await makeHttpClient();
    const resource = await client.readResource("ui://app/from-http.html");
    expect(resource).toMatchObject({
      contents: [
        {
          uri: "ui://app/from-http.html",
          mimeType: "text/html;profile=mcp-app",
          text: '<html data-uri="ui://app/from-http.html"></html>',
        },
      ],
    });
  });
});
