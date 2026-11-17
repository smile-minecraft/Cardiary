/**
 * HTTP MCP 伺服器和用戶端都已連上，但初始化請求卡住不回時，`close()` 必須
 * 立刻中止進行中的 fetch，讓等待中的 `listTools()` 以 `closed` 結束。
 *
 * 這裡用真的 `HttpMcpClient`（走 `createMcpClient`）連到一個真的、接受連線
 * 但永不回應的 `http.createServer`，不注入假 client。請求逾時刻意設得比
 * 斷言上界長（5 秒 vs 1 秒），所以只有 `close()` 主動 abort fetch 才能讓
 * 測試通過；只靠逾時收斂的實作會超過 1 秒而失敗。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import type { McpServerRecord } from "@cardiary/domain";

import { createMcpClient } from "../../../src/modules/mcp/client.js";

const LONG_TIMEOUT_MS = 5_000;
const CLOSE_LIMIT_MS = 1_000;

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

/** 永不回應的 HTTP server：收到初始化請求就什麼都不做，也不呼叫 res.end()。 */
async function startHangingServer(): Promise<{ url: string; firstRequest: Promise<void> }> {
  let signalFirst!: () => void;
  const firstRequest = new Promise<void>((resolve) => {
    signalFirst = resolve;
  });
  const server = createServer(() => {
    signalFirst();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  return { url: `http://localhost:${port}/mcp`, firstRequest };
}

function httpRecord(url: string): McpServerRecord {
  return {
    serverId: "mcp-http-close-abort",
    name: "Hang",
    transport: "http",
    url,
    allowedHosts: ["localhost"],
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("close() 中止進行中的 HTTP 請求", () => {
  it("初始化卡住時呼叫 close()，listTools() 在 1 秒內以 closed 拒絕", async () => {
    const { url, firstRequest } = await startHangingServer();
    const client = createMcpClient(httpRecord(url), {
      folderRoot: "",
      spawn: {} as never,
      logger: { debug: () => undefined, warn: () => undefined },
      requestTimeoutMs: LONG_TIMEOUT_MS,
    });

    // 請求已經送出、server 已收到，但沒有任何回應。
    const pending = client.listTools();
    await firstRequest;

    await client.close();

    // 用有界等待包住拒絕；close() 不 abort fetch 的實作會在這裡逾時而失敗，
    // 而不是一路卡到 vitest 的測試逾時。
    const outcome = await Promise.race([
      pending.then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      ),
      new Promise<{ kind: "timeout" }>((resolve) =>
        setTimeout(() => resolve({ kind: "timeout" }), CLOSE_LIMIT_MS),
      ),
    ]);

    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") {
      expect(outcome.error).toMatchObject({ code: "closed" });
    }
  });
});
