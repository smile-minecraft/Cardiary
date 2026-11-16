/**
 * HTTP MCP 伺服器接受連線但永不回應時，移除、停用、關閉模組與背景啟動
 * 都不能被卡住。這裡用真的 `HttpMcpClient`（走 `createMcpClient`）連到一個
 * 真的、永不回應的 `http.createServer`，不注入假 client。
 *
 * 移除／停用／關閉用較長的請求逾時（5 秒），只有 `close()` 中止進行中的
 * fetch 才能讓它們在 1 秒內完成；背景啟動用較短逾時（200ms）證明逾時本身
 * 也會收斂。
 */
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { ToolBundleDraft } from "@cardiary/engine-adapter";
import type { ModuleActivationContext } from "@cardiary/module-api";
import { FolderLayout, McpServerStore } from "@cardiary/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMcpClient,
  type McpClient,
  type McpClientFactory,
  type McpToolDescriptor,
} from "../../../src/modules/mcp/client.js";
import { activateMcpModule } from "../../../src/modules/mcp/index.js";
import { openMcpApprovals } from "./helpers.js";

const LONG_TIMEOUT_MS = 5_000;
const SHORT_TIMEOUT_MS = 200;
const DONE_LIMIT_MS = 1_000;

const TOOLS: McpToolDescriptor[] = [
  { name: "safe_lookup", description: "安全查詢", inputSchema: { type: "object" } },
];

const folders: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

function makeFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), "cardiary-mcp-hang-"));
  folders.push(folder);
  mkdirSync(join(folder, "state"), { recursive: true });
  return folder;
}

/** 永不回應的 HTTP server：收到請求就什麼都不做，也不呼叫 res.end()。 */
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

/** 關掉 server 前先砍掉卡住的 keep-alive 連線，避免 close() 永遠等不到。 */
async function closeServer(server: Server): Promise<void> {
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
  await closed;
}

function makeContext(root: string, disposed?: Set<string>): ModuleActivationContext {
  const noop = (): void => {};
  return {
    identity: { moduleId: "mcp", generation: 1 },
    services: {
      paths: { root },
      logger: { debug: noop, info: noop, warn: noop, error: noop },
      protocol: {
        emit: () => undefined,
        registerNamespace: () => ({ dispose: noop }),
      },
      host: { provide: noop, get: () => undefined, require: () => undefined },
    },
    registerToolBundle(draft: ToolBundleDraft) {
      return {
        registrationId: draft.bundleId,
        dispose: () => disposed?.add(draft.bundleId),
      };
    },
  } as unknown as ModuleActivationContext;
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`等待逾時：${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("HTTP MCP 伺服器永不回應時，生命週期操作不會卡住", () => {
  it("removeServer 在 1 秒內完成（close 中止進行中的 fetch）", async () => {
    const { url, firstRequest } = await startHangingServer();
    const folder = makeFolder();
    const store = new McpServerStore(new FolderLayout(folder));
    const bindings = openMcpApprovals();
    const record = await store.add({
      name: "Hang",
      transport: "http",
      url,
      allowedHosts: ["localhost"],
    });
    bindings.approve(record);

    const handle = await activateMcpModule(makeContext(folder), {
      store,
      folderRoot: folder,
      bindings,
      clientFactory: createMcpClient,
      requestTimeoutMs: LONG_TIMEOUT_MS,
    });
    await firstRequest;

    const start = Date.now();
    await handle.controller.removeServer(record.serverId);
    expect(Date.now() - start).toBeLessThan(DONE_LIMIT_MS);
    expect(await store.list()).toEqual([]);
    await handle.dispose();
  });

  it("setEnabled(false) 在 1 秒內完成", async () => {
    const { url, firstRequest } = await startHangingServer();
    const folder = makeFolder();
    const store = new McpServerStore(new FolderLayout(folder));
    const bindings = openMcpApprovals();
    const record = await store.add({
      name: "Hang",
      transport: "http",
      url,
      allowedHosts: ["localhost"],
    });
    bindings.approve(record);

    const handle = await activateMcpModule(makeContext(folder), {
      store,
      folderRoot: folder,
      bindings,
      clientFactory: createMcpClient,
      requestTimeoutMs: LONG_TIMEOUT_MS,
    });
    await firstRequest;

    const start = Date.now();
    const info = await handle.controller.setEnabled(record.serverId, false);
    expect(Date.now() - start).toBeLessThan(DONE_LIMIT_MS);
    expect(info).toMatchObject({ enabled: false, state: "disabled" });
    await handle.dispose();
  });

  it("dispose 在 1 秒內完成（背景啟動被收掉）", async () => {
    const { url, firstRequest } = await startHangingServer();
    const folder = makeFolder();
    const store = new McpServerStore(new FolderLayout(folder));
    const bindings = openMcpApprovals();
    const record = await store.add({
      name: "Hang",
      transport: "http",
      url,
      allowedHosts: ["localhost"],
    });
    bindings.approve(record);

    const handle = await activateMcpModule(makeContext(folder), {
      store,
      folderRoot: folder,
      bindings,
      clientFactory: createMcpClient,
      requestTimeoutMs: LONG_TIMEOUT_MS,
    });
    await firstRequest;

    const start = Date.now();
    await handle.dispose();
    expect(Date.now() - start).toBeLessThan(DONE_LIMIT_MS);
  });

  it("背景啟動靠請求逾時收斂，settled 不會永久卡住", async () => {
    const { url } = await startHangingServer();
    const folder = makeFolder();
    const store = new McpServerStore(new FolderLayout(folder));
    const bindings = openMcpApprovals();
    const record = await store.add({
      name: "Hang",
      transport: "http",
      url,
      allowedHosts: ["localhost"],
    });
    bindings.approve(record);

    const handle = await activateMcpModule(makeContext(folder), {
      store,
      folderRoot: folder,
      bindings,
      clientFactory: createMcpClient,
      requestTimeoutMs: SHORT_TIMEOUT_MS,
    });

    const start = Date.now();
    await handle.settled();
    expect(Date.now() - start).toBeLessThan(2_000);
    const info = (await handle.controller.listServers())[0];
    expect(info?.state).toBe("failed");
    expect(info?.failure).toContain("沒有在期限內回應");
    await handle.dispose();
  });
});

describe("快速停用再啟用不會 dispose 新註冊的工具組", () => {
  it("stopServer 等完舊啟動後，用 identity 比對保留新的 bundle", async () => {
    const folder = makeFolder();
    const store = new McpServerStore(new FolderLayout(folder));
    const bindings = openMcpApprovals();
    const record = await store.add({
      name: "Local",
      transport: "stdio",
      command: "node",
      allowedHosts: [],
    });
    bindings.approve(record);

    // 第一個 client 卡在 listTools()，close() 故意不釋放它，
    // 逼 stopServer 走到等待上界，給第二次啟動留下註冊新 bundle 的窗口。
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let listToolsCalled = false;
    let bundlesRegistered = 0;
    const created: McpClient[] = [];
    const factory: McpClientFactory = () => {
      const isFirst = created.length === 0;
      const client: McpClient = {
        async listTools() {
          if (isFirst) {
            listToolsCalled = true;
            await gateA;
          }
          return TOOLS;
        },
        async callTool() {
          return { content: [], isError: false, text: "" };
        },
        async close() {
          // 第一個 client 不釋放 gateA；第二個正常關閉。
        },
      };
      created.push(client);
      return client;
    };

    const disposed = new Set<string>();
    const context = makeContext(folder, disposed);
    const originalRegister = context.registerToolBundle.bind(context);
    context.registerToolBundle = (draft) => {
      bundlesRegistered += 1;
      return originalRegister(draft);
    };
    const handle = await activateMcpModule(context, {
      store,
      folderRoot: folder,
      bindings,
      clientFactory: factory,
    });
    await waitFor(() => listToolsCalled, "第一次啟動卡在 listTools");

    const disabling = handle.controller.setEnabled(record.serverId, false);
    // 等 stopServer 進入等待舊啟動；此時再啟用會建立第二個連線並註冊新 bundle。
    await new Promise((resolve) => setTimeout(resolve, 30));
    await handle.controller.setEnabled(record.serverId, true);
    await waitFor(() => bundlesRegistered >= 1, "第二次啟動註冊新工具組");

    await disabling;
    // 舊的 stopServer 等完舊啟動後，沒有把新註冊的工具組 dispose 掉。
    expect(bundlesRegistered).toBeGreaterThanOrEqual(1);
    expect(disposed.size).toBe(0);
    releaseA();
    await handle.dispose();
  });
});
