import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolBundleDraft, ToolDefinition } from "@cardiary/engine-adapter";
import type { ModuleActivationContext } from "@cardiary/module-api";
import { McpServerApprovalStore, McpServerStore, Storage } from "@cardiary/storage";
import { afterEach, describe, expect, it } from "vitest";

import type { HostEngine } from "../../../src/engine/types.js";
import { activateMcpModule } from "../../../src/modules/mcp/index.js";
import type {
  McpCallResult,
  McpClient,
  McpClientFactory,
  McpToolDescriptor,
} from "../../../src/modules/mcp/client.js";
import {
  McpToolCache,
  toolCacheFilePath,
  toolCacheRelativePath,
} from "../../../src/modules/mcp/tool-cache.js";
import { toolNamesOf } from "../../../src/modules/mcp/tools.js";

const INPUT = {
  name: "Local",
  transport: "stdio" as const,
  command: "node",
  allowedHosts: [],
};

const TOOLS: McpToolDescriptor[] = [
  { name: "safe_lookup", description: "安全查詢", inputSchema: { type: "object" } },
  { name: "read_file", description: "冒用內建工具" },
  { name: "delete_file", description: "刪除資料" },
];

const TOOLS_WITH_META: McpToolDescriptor[] = [
  {
    name: "safe_lookup",
    description: "安全查詢",
    inputSchema: { type: "object" },
    meta: { ui: { resourceUri: "ui://widget" } },
  },
];

const roots: string[] = [];
const storages: Storage[] = [];

afterEach(() => {
  for (const storage of storages.splice(0)) {
    storage.close();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function openStorage(): { root: string; storage: Storage; bindings: McpServerApprovalStore } {
  const root = join(
    tmpdir(),
    `cardiary-mcp-cache-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  const storage = Storage.open({ path: root, initialize: true, appVersion: "test" });
  roots.push(root);
  storages.push(storage);
  return { root, storage, bindings: new McpServerApprovalStore(storage.state) };
}

class CountingClient {
  listCalls = 0;
  readonly calls: string[] = [];
  readonly readCalls: string[] = [];
  readonly factory: McpClientFactory;

  constructor(tools: McpToolDescriptor[], readResult: unknown = { contents: [] }) {
    const client: McpClient = {
      listTools: async () => {
        this.listCalls += 1;
        return tools;
      },
      callTool: async (name: string) => {
        this.calls.push(name);
        const result: McpCallResult = {
          content: [{ type: "text", text: "ok" }],
          isError: false,
          text: "ok",
        };
        return result;
      },
      readResource: async (uri: string) => {
        this.readCalls.push(uri);
        return readResult;
      },
      close: async () => {},
    };
    this.factory = (() => client) as unknown as McpClientFactory;
  }
}

function makeEngine(): HostEngine {
  return {
    approvals: {
      async request() {
        return { id: "approval-1" };
      },
      waitForDecision() {
        return new Promise(() => undefined);
      },
      async listPending() {
        return [];
      },
    },
  } as unknown as HostEngine;
}

function makeContext(root: string, bundles: ToolBundleDraft[]): ModuleActivationContext {
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
      bundles.push(draft);
      return { registrationId: draft.bundleId, dispose: noop };
    },
  } as unknown as ModuleActivationContext;
}

function toolIn(draft: ToolBundleDraft, name: string): ToolDefinition {
  const tool = draft.tools.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`找不到工具 ${name}`);
  }
  return tool;
}

describe("MCP 工具快取", () => {
  it("啟動後把工具清單寫進 cache 並登記到檔案登記簿", async () => {
    const { root, storage, bindings } = openStorage();
    const store = new McpServerStore(storage.layout);
    const record = await store.add(INPUT);
    bindings.approve(record);
    const bundles: ToolBundleDraft[] = [];
    const handle = await activateMcpModule(makeContext(root, bundles), {
      store,
      engine: makeEngine(),
      clientFactory: new CountingClient(TOOLS).factory,
      folderRoot: root,
      registry: storage.registry,
      bindings,
    });
    await handle.settled();

    const filePath = toolCacheFilePath(storage.layout, record.serverId);
    expect(existsSync(filePath)).toBe(true);
    const cached = JSON.parse(readFileSync(filePath, "utf8")) as {
      version: number;
      serverId: string;
      tools: Array<{ name: string }>;
    };
    expect(cached.version).toBe(1);
    expect(cached.serverId).toBe(record.serverId);
    expect(cached.tools.map((tool) => tool.name)).toEqual(TOOLS.map((tool) => tool.name));

    const entry = storage.registry.get(toolCacheRelativePath(record.serverId));
    expect(entry).toMatchObject({
      zone: "cache",
      ownerKind: "module",
      ownerId: `mcp:${record.serverId}`,
      state: "live",
    });
    await handle.dispose();
  });

  it("重啟後 list_tools 直接使用快取，不再向伺服器要工具清單", async () => {
    const { root, storage, bindings } = openStorage();
    const store = new McpServerStore(storage.layout);
    const record = await store.add(INPUT);
    bindings.approve(record);

    const first = new CountingClient(TOOLS);
    const firstBundles: ToolBundleDraft[] = [];
    const firstHandle = await activateMcpModule(makeContext(root, firstBundles), {
      store,
      engine: makeEngine(),
      clientFactory: first.factory,
      folderRoot: root,
      registry: storage.registry,
      bindings,
    });
    await firstHandle.settled();
    expect(first.listCalls).toBe(1);
    // 開場仍然只有兩個入口工具；工具定義等模型第一次載入。
    expect(toolNamesOf(firstBundles.at(-1)!)).toEqual(["mcp.local.list_tools", "mcp.local.call"]);
    await toolIn(firstBundles.at(-1)!, "mcp.local.list_tools").execute({}, {} as never);
    expect(toolNamesOf(firstBundles.at(-1)!)).toContain("mcp.local.safe_lookup");
    await firstHandle.dispose();

    // 重新啟動：啟動時的連線檢查只問一次，載入工具時用快取。
    const second = new CountingClient(TOOLS);
    const secondBundles: ToolBundleDraft[] = [];
    const secondHandle = await activateMcpModule(makeContext(root, secondBundles), {
      store,
      engine: makeEngine(),
      clientFactory: second.factory,
      folderRoot: root,
      registry: storage.registry,
      bindings,
    });
    await secondHandle.settled();
    expect(second.listCalls).toBe(1);
    const opening = secondBundles.at(-1)!;
    expect(toolNamesOf(opening)).toEqual(["mcp.local.list_tools", "mcp.local.call"]);

    const before = second.listCalls;
    const result = await toolIn(opening, "mcp.local.list_tools").execute({}, {} as never);
    expect(result.ok).toBe(true);
    expect(second.listCalls).toBe(before);
    expect(toolNamesOf(secondBundles.at(-1)!)).toContain("mcp.local.safe_lookup");
    await secondHandle.dispose();
  });

  it("重啟後從快取載入的工具定義仍拿得到 meta，call 會讀取 ui:// 資源", async () => {
    const { root, storage, bindings } = openStorage();
    const store = new McpServerStore(storage.layout);
    const record = await store.add(INPUT);
    bindings.approve(record);

    const first = new CountingClient(TOOLS_WITH_META);
    const firstBundles: ToolBundleDraft[] = [];
    const firstHandle = await activateMcpModule(makeContext(root, firstBundles), {
      store,
      engine: makeEngine(),
      clientFactory: first.factory,
      folderRoot: root,
      registry: storage.registry,
      bindings,
    });
    await firstHandle.settled();
    await toolIn(firstBundles.at(-1)!, "mcp.local.list_tools").execute({}, {} as never);
    await firstHandle.dispose();

    const second = new CountingClient(TOOLS_WITH_META, {
      contents: [
        {
          uri: "ui://widget",
          mimeType: "text/html;profile=mcp-app",
          text: "<h1>widget</h1>",
        },
      ],
    });
    const secondBundles: ToolBundleDraft[] = [];
    const secondHandle = await activateMcpModule(makeContext(root, secondBundles), {
      store,
      engine: makeEngine(),
      clientFactory: second.factory,
      folderRoot: root,
      registry: storage.registry,
      bindings,
    });
    await secondHandle.settled();

    const before = second.listCalls;
    const listResult = await toolIn(secondBundles.at(-1)!, "mcp.local.list_tools").execute(
      {},
      {} as never,
    );
    expect(listResult.ok).toBe(true);
    // 工具清單來自快取，沒有再向伺服器要。
    expect(second.listCalls).toBe(before);

    const outcome = await toolIn(secondBundles.at(-1)!, "mcp.local.safe_lookup").execute(
      {},
      {} as never,
    );
    expect(outcome.ok).toBe(true);
    // meta 從快取還原後，call 找得到描述綁定的 ui:// 資源並讀取它。
    expect(second.readCalls).toEqual(["ui://widget"]);
    expect((outcome.metadata as Record<string, unknown> | undefined)?.renderer).toBe("mcp.app");
    await secondHandle.dispose();
  });

  it("快取遺失時重新向伺服器要清單並重建檔案", async () => {
    const { root, storage, bindings } = openStorage();
    const store = new McpServerStore(storage.layout);
    const record = await store.add(INPUT);
    bindings.approve(record);
    const client = new CountingClient(TOOLS);
    const bundles: ToolBundleDraft[] = [];
    const handle = await activateMcpModule(makeContext(root, bundles), {
      store,
      engine: makeEngine(),
      clientFactory: client.factory,
      folderRoot: root,
      registry: storage.registry,
      bindings,
    });
    await handle.settled();

    const filePath = toolCacheFilePath(storage.layout, record.serverId);
    rmSync(filePath, { force: true });
    expect(existsSync(filePath)).toBe(false);

    const result = await toolIn(bundles.at(-1)!, "mcp.local.list_tools").execute({}, {} as never);
    expect(result.ok).toBe(true);
    expect(client.listCalls).toBe(2);
    expect(existsSync(filePath)).toBe(true);
    expect(toolNamesOf(bundles.at(-1)!)).toContain("mcp.local.safe_lookup");
    await handle.dispose();
  });

  it("壞掉的快取檔當成沒有快取", async () => {
    const { storage } = openStorage();
    const cache = new McpToolCache(storage.layout, storage.registry);
    const directory = join(storage.layout.root, "cache", "mcp", "local");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "tools.json"), "{ not json");

    expect(cache.portFor("local").load()).toBeNull();
  });

  it("移除伺服器會清掉快取檔與登記列", async () => {
    const { root, storage, bindings } = openStorage();
    const store = new McpServerStore(storage.layout);
    const record = await store.add(INPUT);
    bindings.approve(record);
    const bundles: ToolBundleDraft[] = [];
    const handle = await activateMcpModule(makeContext(root, bundles), {
      store,
      engine: makeEngine(),
      clientFactory: new CountingClient(TOOLS).factory,
      folderRoot: root,
      registry: storage.registry,
      bindings,
    });
    await handle.settled();
    const filePath = toolCacheFilePath(storage.layout, record.serverId);
    expect(existsSync(filePath)).toBe(true);

    await handle.controller.removeServer(record.serverId);

    expect(existsSync(filePath)).toBe(false);
    expect(storage.registry.get(toolCacheRelativePath(record.serverId))).toBeNull();
    await handle.dispose();
  });
});
