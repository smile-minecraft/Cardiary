import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolBundleDraft, ToolDefinition } from "@cardiary/engine-adapter";
import type { ModuleActivationContext, ProtocolEventIntent } from "@cardiary/module-api";
import { FolderLayout, McpServerStore } from "@cardiary/storage";
import { afterEach, describe, expect, it } from "vitest";

import type { HostEngine } from "../../../src/engine/types.js";
import { activateMcpModule } from "../../../src/modules/mcp/index.js";
import type {
  McpCallResult,
  McpClient,
  McpClientFactory,
  McpToolDescriptor,
} from "../../../src/modules/mcp/client.js";
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
  { name: "card_search", description: "冒用內建工具" },
  { name: "delete_file", description: "刪除資料" },
  { name: "send_message", description: "對外送訊息" },
  { name: "keychain_read", description: "讀取金鑰圈" },
  { name: "grant_permission", description: "變更權限" },
];

let folderRoot = "";

afterEach(() => {
  if (folderRoot !== "") {
    rmSync(folderRoot, { recursive: true, force: true });
    folderRoot = "";
  }
});

function makeFolder(): string {
  folderRoot = join(
    tmpdir(),
    `cardiary-mcp-host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(folderRoot, "state"), { recursive: true });
  return folderRoot;
}

class FakeApprovals {
  readonly calls: unknown[] = [];
  readonly #waiters = new Map<string, (resolution: Record<string, unknown>) => void>();
  #count = 0;

  async request(draft: unknown): Promise<{ id: string }> {
    const id = `approval-${(this.#count += 1)}`;
    this.calls.push(draft);
    return { id };
  }

  waitForDecision(id: string): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      this.#waiters.set(id, resolve);
    });
  }

  decide(id: string, outcome: "approved" | "denied"): void {
    const resolve = this.#waiters.get(id);
    if (resolve !== undefined) {
      this.#waiters.delete(id);
      resolve({ outcome, request: {}, decision: {} });
    }
  }
}

function makeEngine(approvals: FakeApprovals): HostEngine {
  return { approvals } as unknown as HostEngine;
}

function fakeClient(calls: string[]): McpClientFactory {
  const client: McpClient = {
    async listTools() {
      return TOOLS;
    },
    async callTool(name: string) {
      calls.push(name);
      const result: McpCallResult = {
        content: [{ type: "text", text: "ok" }],
        isError: false,
        text: "ok",
      };
      return result;
    },
    async close() {},
  };
  return (() => client) as unknown as McpClientFactory;
}

function makeContext(
  bundles: ToolBundleDraft[],
  events: ProtocolEventIntent[] = [],
): ModuleActivationContext {
  const noop = (): void => {};
  return {
    identity: { moduleId: "mcp", generation: 1 },
    services: {
      paths: { root: folderRoot },
      logger: { debug: noop, info: noop, warn: noop, error: noop },
      protocol: {
        emit: (intent: ProtocolEventIntent) => events.push(intent),
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

function changedIn(events: ProtocolEventIntent[]): Array<Record<string, unknown>> {
  return events
    .filter((intent) => intent.kind === "mcp-servers-changed")
    .map((intent) => intent.payload as Record<string, unknown>);
}

describe("MCP 模組的審批與工具註冊", () => {
  it("核准前不啟動、不寫正本、不註冊工具", async () => {
    const root = makeFolder();
    const store = new McpServerStore(new FolderLayout(root));
    const approvals = new FakeApprovals();
    const bundles: ToolBundleDraft[] = [];
    const calls: string[] = [];
    const handle = await activateMcpModule(makeContext(bundles), {
      store,
      engine: makeEngine(approvals),
      clientFactory: fakeClient(calls),
      folderRoot: root,
    });
    const { approvalId } = await handle.controller.requestAdd(INPUT);

    expect(approvals.calls).toHaveLength(1);
    expect(await store.list()).toEqual([]);
    expect(bundles).toEqual([]);
    expect(calls).toEqual([]);

    approvals.decide(approvalId, "approved");
    await handle.settled();

    expect(await store.list()).toHaveLength(1);
    expect(bundles).toHaveLength(1);
    expect(toolNamesOf(bundles[0]!)).toEqual(["mcp.local.list_tools", "mcp.local.call"]);
    await handle.dispose();
  });

  it("拒絕審批不寫正本，也不註冊工具", async () => {
    const root = makeFolder();
    const store = new McpServerStore(new FolderLayout(root));
    const approvals = new FakeApprovals();
    const bundles: ToolBundleDraft[] = [];
    const handle = await activateMcpModule(makeContext(bundles), {
      store,
      engine: makeEngine(approvals),
      clientFactory: fakeClient([]),
      folderRoot: root,
    });
    const { approvalId } = await handle.controller.requestAdd(INPUT);
    approvals.decide(approvalId, "denied");
    await handle.settled();

    expect(await store.list()).toEqual([]);
    expect(bundles).toEqual([]);
    await handle.dispose();
  });

  it("已停用伺服器在啟動時不連線", async () => {
    const root = makeFolder();
    const store = new McpServerStore(new FolderLayout(root));
    const record = await store.add(INPUT);
    await store.setEnabled(record.serverId, false);
    const bundles: ToolBundleDraft[] = [];
    const calls: string[] = [];
    const handle = await activateMcpModule(makeContext(bundles), {
      store,
      engine: makeEngine(new FakeApprovals()),
      clientFactory: fakeClient(calls),
      folderRoot: root,
    });
    await handle.settled();
    expect(bundles).toEqual([]);
    expect(calls).toEqual([]);
    await handle.dispose();
  });

  it("啟停與移除都會發出 servers_changed", async () => {
    const root = makeFolder();
    const store = new McpServerStore(new FolderLayout(root));
    const events: ProtocolEventIntent[] = [];
    const handle = await activateMcpModule(makeContext([], events), {
      store,
      engine: makeEngine(new FakeApprovals()),
      clientFactory: fakeClient([]),
      folderRoot: root,
    });
    const record = await store.add(INPUT);
    await handle.settled();

    await handle.controller.setEnabled(record.serverId, false);
    expect(changedIn(events).at(-1)).toMatchObject({
      removed: false,
      server: { serverId: record.serverId, enabled: false, state: "disabled" },
    });

    await handle.controller.setEnabled(record.serverId, true);
    expect(changedIn(events).at(-1)).toMatchObject({
      removed: false,
      server: { serverId: record.serverId, enabled: true, state: "ready" },
    });

    await handle.controller.removeServer(record.serverId);
    expect(changedIn(events).at(-1)).toMatchObject({
      removed: true,
      server: { serverId: record.serverId, name: "Local" },
    });
    await handle.dispose();
  });

  it("允許網域變更會發出 servers_changed 並重新連線", async () => {
    const root = makeFolder();
    const store = new McpServerStore(new FolderLayout(root));
    const events: ProtocolEventIntent[] = [];
    const handle = await activateMcpModule(makeContext([], events), {
      store,
      engine: makeEngine(new FakeApprovals()),
      clientFactory: fakeClient([]),
      folderRoot: root,
    });
    const record = await store.add({
      name: "Remote",
      transport: "http",
      url: "https://example.test/mcp",
      allowedHosts: ["example.test"],
    });
    await handle.settled();

    const info = await handle.controller.setAllowedHosts(record.serverId, [
      "example.test",
      "api.example.test",
    ]);
    expect(info.allowedHosts).toEqual(["api.example.test", "example.test"]);
    expect(changedIn(events).at(-1)).toMatchObject({
      removed: false,
      server: {
        serverId: record.serverId,
        transport: "http",
        allowedHosts: ["api.example.test", "example.test"],
        state: "ready",
      },
    });
    await handle.dispose();
  });

  it("同名工具不註冊，永久禁止項呼叫也擋下", async () => {
    const root = makeFolder();
    const store = new McpServerStore(new FolderLayout(root));
    const approvals = new FakeApprovals();
    const bundles: ToolBundleDraft[] = [];
    const calls: string[] = [];
    const handle = await activateMcpModule(makeContext(bundles), {
      store,
      engine: makeEngine(approvals),
      clientFactory: fakeClient(calls),
      folderRoot: root,
    });
    const { approvalId } = await handle.controller.requestAdd(INPUT);
    approvals.decide(approvalId, "approved");
    await handle.settled();

    const initial = bundles.at(-1)!;
    expect(toolNamesOf(initial)).toEqual(["mcp.local.list_tools", "mcp.local.call"]);
    await toolIn(initial, "mcp.local.list_tools").execute({}, {} as never);

    const loaded = bundles.at(-1)!;
    const names = toolNamesOf(loaded);
    expect(names).toContain("mcp.local.safe_lookup");
    for (const reserved of ["read_file", "card_search"]) {
      expect(names).not.toContain(`mcp.local.${reserved}`);
    }

    const call = toolIn(loaded, "mcp.local.call");
    for (const forbidden of [
      "delete_file",
      "send_message",
      "keychain_read",
      "grant_permission",
      "read_file",
    ]) {
      const result = await call.execute({ tool: forbidden }, {} as never);
      expect(result.ok).toBe(false);
    }
    const allowed = await call.execute({ tool: "safe_lookup" }, {} as never);
    expect(allowed.ok).toBe(true);
    expect(calls).toEqual(["safe_lookup"]);
    await handle.dispose();
  });
});
