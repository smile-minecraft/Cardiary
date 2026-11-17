import type { ToolBundlePin } from "@cardiary/engine-adapter";
import type { ProtocolEventIntent } from "@cardiary/module-api";
import type { ModuleInfo } from "@cardiary/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModuleHostBridge } from "../../src/modules/contract.js";
import { TestClient, startTestHost, waitUntil, type TestHost } from "../helpers.js";

const hosts: TestHost[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) {
    await host.close();
  }
});

async function boot(): Promise<TestHost> {
  // 關掉示範工具，讓工具組清單只含測試放進去的項目，比較好下精確的斷言。
  const host = await startTestHost({ demo: false });
  hosts.push(host);
  return host;
}

/** 可變動的工具組清單，用來模擬 MCP 伺服器增刪後的現況。 */
class MutableModules implements ModuleHostBridge {
  bundles: readonly ToolBundlePin[] = [];

  listModules(): readonly ModuleInfo[] {
    return [];
  }

  activeToolBundles(): readonly ToolBundlePin[] {
    return this.bundles;
  }

  async setModuleEnabled(): Promise<ModuleInfo> {
    throw new Error("測試用不到");
  }

  hasExactHandler(): boolean {
    return false;
  }

  hasPrefixHandler(): boolean {
    return false;
  }

  async dispatchProtocol(): Promise<never> {
    throw new Error("測試用不到");
  }

  async dispatchHttp() {
    return null;
  }
}

/** 與協定 McpServerInfo 欄位一致的測試資料。 */
const mcpServerInfo = (serverId: string) => ({
  serverId,
  name: serverId,
  transport: "stdio",
  command: "node",
  args: ["server.mjs"],
  allowedHosts: ["example.test"],
  enabled: true,
  state: "ready",
  createdAt: "2026-11-17T00:00:00.000Z",
});

/** MCP 模組 emitChanged 送出的真實事件意圖形狀。 */
const mcpChangedIntent = (serverId: string, removed = false): ProtocolEventIntent => ({
  kind: "mcp-servers-changed",
  payload: { server: mcpServerInfo(serverId), removed },
});

async function helloClient(host: TestHost): Promise<TestClient> {
  const client = await TestClient.connect(host.url);
  await client.waitForReply(await client.hello(host.token));
  return client;
}

async function createSession(client: TestClient): Promise<string> {
  const id = client.request("session.create", { clientRequestId: `cr-${Math.random()}` });
  const reply = await client.waitForReply(id);
  return (reply.payload?.session as { id: string }).id;
}

type Compactable = { compact(id: string): Promise<void> };

async function compact(host: TestHost, conversationId: string): Promise<void> {
  await (host.host.engine as unknown as Compactable).compact(conversationId);
}

/** 等 mcp.servers_changed 事件落地；用它當「事件已處理完」的訊號。 */
function waitForMcpEvent(host: TestHost): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = host.host.gateway.streamLog.subscribe((event) => {
      if (event.kind === "mcp.servers_changed") {
        unsubscribe();
        resolve();
      }
    });
  });
}

describe("MCP 伺服器變更預告給進行中的對話", () => {
  it("新增伺服器後，已釘選 MCP 工具組的對話收到預告，下次壓縮套用新工具組", async () => {
    const host = await boot();
    const modules = new MutableModules();
    const srv1: ToolBundlePin = { bundleId: "mcp:srv-1", generation: 1 };
    const srv2: ToolBundlePin = { bundleId: "mcp:srv-2", generation: 1 };
    modules.bundles = [srv1];
    host.host.gateway.setModuleHost(modules);
    const stage = vi.spyOn(host.host.engine, "stageConversationUpdate");

    const client = await helloClient(host);
    const sessionId = await createSession(client);
    expect((await host.host.engine.getConversation(sessionId))?.toolBundles).toEqual([srv1]);

    // 新增伺服器：現況多一組 MCP 工具組，隨後送出變更事件。
    modules.bundles = [srv1, srv2];
    host.host.gateway.emitIntent(mcpChangedIntent("srv-2"));

    await waitUntil(() => stage.mock.calls.some(([id]) => id === sessionId));
    const staged = stage.mock.calls.find(([id]) => id === sessionId)?.[1];
    expect(staged?.reason).toBe("module-reload");
    expect(staged?.toolBundles).toEqual([srv1, srv2]);

    // 壓縮前仍用舊工具組；壓縮後才套用新清單。
    expect((await host.host.engine.getConversation(sessionId))?.toolBundles).toEqual([srv1]);
    await compact(host, sessionId);
    expect((await host.host.engine.getConversation(sessionId))?.toolBundles).toEqual([srv1, srv2]);
  }, 15000);

  it("移除伺服器後，已釘選 MCP 工具組的對話收到預告，下次壓縮移除該工具組", async () => {
    const host = await boot();
    const modules = new MutableModules();
    const srv1: ToolBundlePin = { bundleId: "mcp:srv-1", generation: 1 };
    const srv2: ToolBundlePin = { bundleId: "mcp:srv-2", generation: 1 };
    modules.bundles = [srv1, srv2];
    host.host.gateway.setModuleHost(modules);
    const stage = vi.spyOn(host.host.engine, "stageConversationUpdate");

    const client = await helloClient(host);
    const sessionId = await createSession(client);
    expect((await host.host.engine.getConversation(sessionId))?.toolBundles).toEqual([srv1, srv2]);

    // 移除伺服器：真實的模組主機會保留舊的工具組釘選（只註銷工具定義），
    // 所以這裡刻意不變動 modules.bundles，讓預告必須靠事件的 removed 排除它。
    host.host.gateway.emitIntent(mcpChangedIntent("srv-2", true));

    await waitUntil(() => stage.mock.calls.some(([id]) => id === sessionId));
    const staged = stage.mock.calls.find(([id]) => id === sessionId)?.[1];
    expect(staged?.toolBundles).toEqual([srv1]);

    await compact(host, sessionId);
    expect((await host.host.engine.getConversation(sessionId))?.toolBundles).toEqual([srv1]);
  }, 15000);

  it("新對話直接拿到目前工具組，不受較早的預告影響", async () => {
    const host = await boot();
    const modules = new MutableModules();
    const srv1: ToolBundlePin = { bundleId: "mcp:srv-1", generation: 1 };
    const srv2: ToolBundlePin = { bundleId: "mcp:srv-2", generation: 1 };
    modules.bundles = [srv1];
    host.host.gateway.setModuleHost(modules);

    const client = await helloClient(host);
    const oldSession = await createSession(client);

    modules.bundles = [srv1, srv2];
    host.host.gateway.emitIntent(mcpChangedIntent("srv-2"));

    // 新對話立刻看到現在的清單（含 srv2），不用等壓縮。
    const newSession = await createSession(client);
    expect((await host.host.engine.getConversation(newSession))?.toolBundles).toEqual([srv1, srv2]);
    // 舊對話在壓縮前仍是原本釘選的清單。
    expect((await host.host.engine.getConversation(oldSession))?.toolBundles).toEqual([srv1]);
  }, 15000);

  it("沒有釘選 MCP 工具組的對話不會收到預告", async () => {
    const host = await boot();
    const modules = new MutableModules();
    const local: ToolBundlePin = { bundleId: "local.tools", generation: 1 };
    const srv1: ToolBundlePin = { bundleId: "mcp:srv-1", generation: 1 };
    modules.bundles = [local];
    host.host.gateway.setModuleHost(modules);
    const stage = vi.spyOn(host.host.engine, "stageConversationUpdate");

    const client = await helloClient(host);
    const localSession = await createSession(client);

    modules.bundles = [local, srv1];
    const landed = waitForMcpEvent(host);
    host.host.gateway.emitIntent(mcpChangedIntent("srv-1"));
    await landed;
    // 事件落地後還要給預告邏輯一個事件迴圈的機會；用 microtask 讓它跑完。
    await new Promise((resolve) => setImmediate(resolve));

    expect(stage.mock.calls.some(([id]) => id === localSession)).toBe(false);
  }, 15000);

  it("工具組沒有變更時不會重複預告", async () => {
    const host = await boot();
    const modules = new MutableModules();
    const srv1: ToolBundlePin = { bundleId: "mcp:srv-1", generation: 1 };
    modules.bundles = [srv1];
    host.host.gateway.setModuleHost(modules);
    const stage = vi.spyOn(host.host.engine, "stageConversationUpdate");

    const client = await helloClient(host);
    const sessionId = await createSession(client);

    // 清單沒變，只是收到一次事件（例如設定微調），不該讓對話多一次預告。
    const landed = waitForMcpEvent(host);
    host.host.gateway.emitIntent(mcpChangedIntent("srv-1"));
    await landed;
    await new Promise((resolve) => setImmediate(resolve));

    expect(stage.mock.calls.some(([id]) => id === sessionId)).toBe(false);
  }, 15000);
});
