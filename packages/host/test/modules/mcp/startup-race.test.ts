/**
 * 啟動期間的競態：`listTools()` 還沒回來就停用、移除或改允許網域時，晚回來的
 * 啟動不能把工具組掛回去，也不能把連線留在行程裡。
 *
 * 這些測試走真的 `McpModule`：真的 `state/mcp-servers.json` 正本、真的核准
 * 綁定，只把 client 換成需要手動放行的假連線。正常速度的假 client 測不到
 * 這個時間窗口，所以每一條都先確認連線已建立、`listTools()` 仍卡住。
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolBundleDraft } from "@cardiary/engine-adapter";
import type { ModuleActivationContext } from "@cardiary/module-api";
import { FolderLayout, McpServerStore } from "@cardiary/storage";
import { afterEach, describe, expect, it } from "vitest";

import { activateMcpModule } from "../../../src/modules/mcp/index.js";
import type {
  McpClient,
  McpClientFactory,
  McpToolDescriptor,
} from "../../../src/modules/mcp/client.js";
import { bundleIdFor } from "../../../src/modules/mcp/tools.js";
import { openMcpApprovals } from "./helpers.js";

const INPUT = {
  name: "Local",
  transport: "stdio" as const,
  command: "node",
  allowedHosts: [],
};

const HTTP_INPUT = {
  name: "Remote",
  transport: "http" as const,
  url: "https://example.test/mcp",
  allowedHosts: ["example.test"],
};

const TOOLS: McpToolDescriptor[] = [
  { name: "safe_lookup", description: "安全查詢", inputSchema: { type: "object" } },
];

/** 一組需要手動放行的假連線；`close()` 會讓卡住的 `listTools()` 立刻解脫。 */
interface GatedClient {
  readonly serverId: string;
  closed(): boolean;
  release(): void;
}

function gatedFactory(): { factory: McpClientFactory; clients: GatedClient[] } {
  const clients: GatedClient[] = [];
  const factory: McpClientFactory = (record) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let closed = false;
    const client: McpClient = {
      async listTools() {
        await gate;
        return TOOLS;
      },
      async callTool() {
        return { content: [], isError: false, text: "" };
      },
      async close() {
        closed = true;
        release();
      },
    };
    clients.push({ serverId: record.serverId, closed: () => closed, release: () => release() });
    return client;
  };
  return { factory, clients };
}

let root = "";

afterEach(() => {
  if (root !== "") {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

function makeFolder(): string {
  root = mkdtempSync(join(tmpdir(), "cardiary-mcp-race-"));
  mkdirSync(join(root, "state"), { recursive: true });
  return root;
}

function makeContext(bundles: ToolBundleDraft[]): ModuleActivationContext {
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

/** 等背景啟動走到指定狀態；逾時就讓測試失敗，而不是默默通過。 */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`等待逾時：${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("MCP 啟動期間的競態", () => {
  it("啟動中移除：晚回來的啟動不註冊工具，也不留下連線", async () => {
    const folder = makeFolder();
    const store = new McpServerStore(new FolderLayout(folder));
    const bindings = openMcpApprovals();
    const record = await store.add(INPUT);
    bindings.approve(record);
    const { factory, clients } = gatedFactory();
    const bundles: ToolBundleDraft[] = [];
    const handle = await activateMcpModule(makeContext(bundles), {
      store,
      clientFactory: factory,
      folderRoot: folder,
      bindings,
    });
    await waitFor(() => clients.length === 1, "第一次啟動建立連線");
    expect(bundles).toEqual([]);

    await handle.controller.removeServer(record.serverId);

    expect(bundles).toEqual([]);
    expect(await store.list()).toEqual([]);
    await handle.settled();
    expect(bundles).toEqual([]);
    expect(clients).toHaveLength(1);
    expect(clients[0]?.closed()).toBe(true);
    await handle.dispose();
  });

  it("啟動中停用：晚回來的啟動不註冊工具，狀態是停用", async () => {
    const folder = makeFolder();
    const store = new McpServerStore(new FolderLayout(folder));
    const bindings = openMcpApprovals();
    const record = await store.add(INPUT);
    bindings.approve(record);
    const { factory, clients } = gatedFactory();
    const bundles: ToolBundleDraft[] = [];
    const handle = await activateMcpModule(makeContext(bundles), {
      store,
      clientFactory: factory,
      folderRoot: folder,
      bindings,
    });
    await waitFor(() => clients.length === 1, "第一次啟動建立連線");

    const info = await handle.controller.setEnabled(record.serverId, false);
    await handle.settled();

    expect(info).toMatchObject({ enabled: false, state: "disabled" });
    expect(bundles).toEqual([]);
    expect(clients[0]?.closed()).toBe(true);
    await handle.dispose();
  });

  it("啟動中改允許網域：舊啟動作廢，只用新設定連一次", async () => {
    const folder = makeFolder();
    const store = new McpServerStore(new FolderLayout(folder));
    const bindings = openMcpApprovals();
    const record = await store.add(HTTP_INPUT);
    bindings.approve(record);
    const { factory, clients } = gatedFactory();
    const bundles: ToolBundleDraft[] = [];
    const handle = await activateMcpModule(makeContext(bundles), {
      store,
      clientFactory: factory,
      folderRoot: folder,
      bindings,
    });
    await waitFor(() => clients.length === 1, "第一次啟動建立連線");

    const updating = handle.controller.setAllowedHosts(record.serverId, [
      "example.test",
      "api.example.test",
    ]);
    await waitFor(() => clients.length === 2, "改網域後重新連線");
    expect(clients[0]?.closed()).toBe(true);
    expect(bundles).toEqual([]);

    clients[1]?.release();
    const info = await updating;
    await handle.settled();

    expect(info.allowedHosts).toEqual(["api.example.test", "example.test"]);
    expect(info.state).toBe("ready");
    expect(bundles.map((draft) => draft.bundleId)).toEqual([bundleIdFor(record.serverId)]);
    expect(clients).toHaveLength(2);
    await handle.dispose();
  });

  it("啟動中關閉模組：連線被關掉，不註冊工具", async () => {
    const folder = makeFolder();
    const store = new McpServerStore(new FolderLayout(folder));
    const bindings = openMcpApprovals();
    const record = await store.add(INPUT);
    bindings.approve(record);
    const { factory, clients } = gatedFactory();
    const bundles: ToolBundleDraft[] = [];
    const handle = await activateMcpModule(makeContext(bundles), {
      store,
      clientFactory: factory,
      folderRoot: folder,
      bindings,
    });
    await waitFor(() => clients.length === 1, "第一次啟動建立連線");

    await handle.dispose();

    expect(bundles).toEqual([]);
    expect(clients[0]?.closed()).toBe(true);
  });

  it("正常完成的啟動仍會註冊工具（對照組）", async () => {
    const folder = makeFolder();
    const store = new McpServerStore(new FolderLayout(folder));
    const bindings = openMcpApprovals();
    const record = await store.add(INPUT);
    bindings.approve(record);
    const { factory, clients } = gatedFactory();
    const bundles: ToolBundleDraft[] = [];
    const handle = await activateMcpModule(makeContext(bundles), {
      store,
      clientFactory: factory,
      folderRoot: folder,
      bindings,
    });
    await waitFor(() => clients.length === 1, "第一次啟動建立連線");
    expect(bundles).toEqual([]);

    clients[0]?.release();
    await handle.settled();

    expect(bundles.map((draft) => draft.bundleId)).toEqual([bundleIdFor(record.serverId)]);
    expect(clients[0]?.closed()).toBe(false);
    await handle.dispose();
  });
});
