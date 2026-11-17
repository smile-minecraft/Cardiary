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

    modules.bundles = [srv1];
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

  it("真實登錄表移除後，新對話與後續事件都不會取回已移除的工具組", async () => {
    const host = await boot();
    const modules = host.host.modules;
    const captured: { remove?: () => Promise<void> } = {};
    await modules.registry.load({
      manifest: {
        id: "test-mcp",
        name: "test-mcp",
        version: "1.0.0",
        hostApiVersion: "1",
        dependencies: [],
        permissions: [],
        settings: [],
      },
      activate(context) {
        context.registerToolBundle({ bundleId: "mcp:srv-1", label: "一", tools: [] });
        const removed = context.registerToolBundle({
          bundleId: "mcp:srv-2",
          label: "二",
          tools: [],
        });
        captured.remove = () => removed.dispose();
      },
    });
    await modules.registry.activate("test-mcp");
    host.host.gateway.setModuleHost(modules);
    const original = modules.activeToolBundles();
    const remaining = original.filter((pin) => pin.bundleId === "mcp:srv-1");
    expect(original).toHaveLength(2);
    const client = await helloClient(host);
    const oldSession = await createSession(client);
    await captured.remove!();
    const removedEvent = waitForMcpEvent(host);
    host.host.gateway.emitIntent(mcpChangedIntent("srv-2", true));
    await removedEvent;
    const newSession = await createSession(client);
    expect((await host.host.engine.getConversation(newSession))?.toolBundles).toEqual(remaining);
    const laterEvent = waitForMcpEvent(host);
    host.host.gateway.emitIntent(mcpChangedIntent("srv-1"));
    await laterEvent;
    await compact(host, oldSession);
    expect((await host.host.engine.getConversation(oldSession))?.toolBundles).toEqual(remaining);
  }, 15000);

  it("新增後在壓縮前移除，不會套用已過時的預告", async () => {
    const host = await boot();
    const modules = new MutableModules();
    const first = { bundleId: "mcp:srv-1", generation: 1 };
    const second = { bundleId: "mcp:srv-2", generation: 1 };
    modules.bundles = [first];
    host.host.gateway.setModuleHost(modules);
    const client = await helloClient(host);
    const session = await createSession(client);
    modules.bundles = [first, second];
    const added = waitForMcpEvent(host);
    host.host.gateway.emitIntent(mcpChangedIntent("srv-2"));
    await added;
    modules.bundles = [first];
    const removed = waitForMcpEvent(host);
    host.host.gateway.emitIntent(mcpChangedIntent("srv-2", true));
    await removed;
    await compact(host, session);
    expect((await host.host.engine.getConversation(session))?.toolBundles).toEqual([first]);
  }, 15000);

  it("工具組沒有變更時，壓縮不標記套用且工具組不變", async () => {
    const host = await boot();
    const modules = new MutableModules();
    const srv1: ToolBundlePin = { bundleId: "mcp:srv-1", generation: 1 };
    modules.bundles = [srv1];
    host.host.gateway.setModuleHost(modules);

    const client = await helloClient(host);
    const sessionId = await createSession(client);
    const events = host.host.engine.subscribe({ conversationId: sessionId, afterSeq: 0 });
    const compacted: Array<{ appliedUpdate: boolean }> = [];
    void (async () => {
      for await (const event of events.events) {
        if (event.kind === "conversation.compacted") {
          compacted.push({ appliedUpdate: event.appliedUpdate });
        }
      }
    })();

    // 清單沒變，只是收到一次事件（例如設定微調）。引擎照樣收到預告，
    // 但合併後沒有差異，不該留下待套用的更新。
    const landed = waitForMcpEvent(host);
    host.host.gateway.emitIntent(mcpChangedIntent("srv-1"));
    await landed;
    await compact(host, sessionId);
    await compact(host, sessionId);

    expect(compacted.map((event) => event.appliedUpdate)).toEqual([false, false]);
    expect((await host.host.engine.getConversation(sessionId))?.toolBundles).toEqual([srv1]);
    events.close();
  }, 15000);

  it("工具組沒有變更時，先前預告的固定前綴仍能被壓縮套用", async () => {
    const host = await boot();
    const modules = new MutableModules();
    const srv1: ToolBundlePin = { bundleId: "mcp:srv-1", generation: 1 };
    modules.bundles = [srv1];
    host.host.gateway.setModuleHost(modules);

    const client = await helloClient(host);
    const sessionId = await createSession(client);
    const events = host.host.engine.subscribe({ conversationId: sessionId, afterSeq: 0 });
    const compacted: Array<{ appliedUpdate: boolean }> = [];
    void (async () => {
      for await (const event of events.events) {
        if (event.kind === "conversation.compacted") {
          compacted.push({ appliedUpdate: event.appliedUpdate });
        }
      }
    })();

    // 先預告一個前綴更新，再送一次沒有工具組變更的事件；前綴不能被抹掉。
    await host.host.engine.stageConversationUpdate(sessionId, {
      reason: "context-refresh",
      systemContext: "新的前綴",
    });
    const landed = waitForMcpEvent(host);
    host.host.gateway.emitIntent(mcpChangedIntent("srv-1"));
    await landed;
    await compact(host, sessionId);

    // 前綴預告還在，第一次壓縮就要套用；第二次沒有待套用更新。
    expect(compacted.map((event) => event.appliedUpdate)).toEqual([true]);
    events.close();
  }, 15000);
});
