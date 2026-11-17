/**
 * 核准綁定的信任邊界：`state/mcp-servers.json` 就算 schema 合法、enabled 為
 * true，只要沒有受保護狀態庫裡對應的核准紀錄，就不能啟動，也不能註冊工具。
 *
 * 這裡直接手寫正本檔內容（模擬核准流程以外的寫入），再從頭啟動模組，
 * 確認與協定核准流程的結果不同。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeMcpServersFile, type McpServerRecord } from "@cardiary/domain";
import type { ToolBundleDraft } from "@cardiary/engine-adapter";
import type { ModuleActivationContext, ProtocolEventIntent } from "@cardiary/module-api";
import { FolderLayout, McpServerStore } from "@cardiary/storage";
import { afterEach, describe, expect, it } from "vitest";

import type { HostEngine } from "../../../src/engine/types.js";
import { activateMcpModule } from "../../../src/modules/mcp/index.js";
import type { McpClientFactory } from "../../../src/modules/mcp/client.js";
import { openMcpApprovals } from "./helpers.js";

const INPUT = {
  name: "Local",
  transport: "stdio" as const,
  command: "node",
  allowedHosts: [],
};

let root = "";

afterEach(() => {
  if (root !== "") {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

function makeFolder(): string {
  root = mkdtempSync(join(tmpdir(), "cardiary-mcp-binding-"));
  mkdirSync(join(root, "state"), { recursive: true });
  return root;
}

class FakeApprovals {
  readonly #waiters = new Map<string, (resolution: Record<string, unknown>) => void>();
  #count = 0;

  async request(): Promise<{ id: string }> {
    return { id: `approval-${(this.#count += 1)}` };
  }

  async listPending(): Promise<Array<Record<string, unknown>>> {
    // 重接只會把 hostApproval 標記為 mcp 的 module-enable 審批掛回等待；
    // 這個測試不重啟任何等待者，回傳空清單即可。
    return [];
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

/** 只要真的建立連線就記一筆，用來分辨「沒啟動」與「啟動但工具為空」。 */
function spyingClient(created: string[]): McpClientFactory {
  const client = {
    async listTools() {
      return [];
    },
    async callTool() {
      return { content: [], isError: false, text: "" };
    },
    async close() {},
  };
  return ((record: { serverId: string }) => {
    created.push(record.serverId);
    return client;
  }) as unknown as McpClientFactory;
}

function makeContext(notifications: ProtocolEventIntent[], bundles: ToolBundleDraft[]) {
  const noop = (): void => {};
  return {
    identity: { moduleId: "mcp", generation: 1 },
    services: {
      paths: { root },
      logger: { debug: noop, info: noop, warn: noop, error: noop },
      protocol: {
        emit: (event: ProtocolEventIntent) => {
          notifications.push(event);
        },
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

/** 直接寫一份 schema 合法且 enabled 的正本；模擬繞過核准流程的寫入。 */
function writeHandMadeFile(record: McpServerRecord): void {
  writeFileSync(join(root, "state", "mcp-servers.json"), serializeMcpServersFile([record]));
}

describe("MCP 核准綁定：設定與核准紀錄不符就不啟動", () => {
  it("手寫、schema 合法且 enabled 的紀錄不啟動，並發出通知", async () => {
    makeFolder();
    const store = new McpServerStore(new FolderLayout(root));
    // 用正規 store 先建立一份合法紀錄，再故意不給它核准綁定。
    const record = await store.add(INPUT);
    await store.setEnabled(record.serverId, true);
    const bindings = openMcpApprovals();
    expect(bindings.approvalOf(record.serverId)).toBeUndefined();

    const notifications: ProtocolEventIntent[] = [];
    const bundles: ToolBundleDraft[] = [];
    const created: string[] = [];
    const handle = await activateMcpModule(makeContext(notifications, bundles), {
      store,
      folderRoot: root,
      clientFactory: spyingClient(created),
      bindings,
    });
    await handle.settled();

    expect(created).toEqual([]);
    expect(bundles).toEqual([]);
    expect(notifications).toContainEqual(
      expect.objectContaining({ kind: "notification", title: "MCP 設定待核准", level: "warning" }),
    );
    const info = (await handle.controller.listServers())[0];
    // 未核准不是故障：不啟動、不留下 failed，只靠通知說明待核准。
    expect(info).toMatchObject({ serverId: record.serverId, state: "disabled" });
    expect(info.failure).toBeUndefined();
    await handle.dispose();
  });

  it("核准後重新啟動才會連上並註冊工具", async () => {
    makeFolder();
    const store = new McpServerStore(new FolderLayout(root));
    const record = await store.add(INPUT);
    await store.setEnabled(record.serverId, true);
    const bindings = openMcpApprovals();
    const current = await store.get(record.serverId);
    bindings.approve(current!);

    const notifications: ProtocolEventIntent[] = [];
    const bundles: ToolBundleDraft[] = [];
    const created: string[] = [];
    const handle = await activateMcpModule(makeContext(notifications, bundles), {
      store,
      folderRoot: root,
      clientFactory: spyingClient(created),
      bindings,
    });
    await handle.settled();

    expect(created).toEqual([record.serverId]);
    expect(bundles).toHaveLength(1);
    expect(notifications.filter((event) => event.kind === "notification")).toEqual([]);
    await handle.dispose();
  });

  it("核准後改動內容，重新啟動不再連線", async () => {
    makeFolder();
    const store = new McpServerStore(new FolderLayout(root));
    const record = await store.add(INPUT);
    await store.setEnabled(record.serverId, true);
    const bindings = openMcpApprovals();
    const current = await store.get(record.serverId);
    bindings.approve(current!);

    // 只改 name 就讓內容雜湊不符；正本仍是 schema 合法且 enabled。
    const tampered: McpServerRecord = { ...current!, name: "篡改過的名稱" };
    writeHandMadeFile(tampered);

    const notifications: ProtocolEventIntent[] = [];
    const bundles: ToolBundleDraft[] = [];
    const created: string[] = [];
    const handle = await activateMcpModule(makeContext(notifications, bundles), {
      store,
      folderRoot: root,
      clientFactory: spyingClient(created),
      bindings,
    });
    await handle.settled();

    expect(created).toEqual([]);
    expect(bundles).toEqual([]);
    expect(notifications).toContainEqual(
      expect.objectContaining({ kind: "notification", title: "MCP 設定待核准", level: "warning" }),
    );
    await handle.dispose();
  });

  it("核准後只把 enabled 從 false 改 true，重新啟動仍不連線", async () => {
    makeFolder();
    const store = new McpServerStore(new FolderLayout(root));
    const record = await store.add(INPUT);
    await store.setEnabled(record.serverId, false);
    const bindings = openMcpApprovals();
    const current = await store.get(record.serverId);
    bindings.approve(current!);

    // 對已核准的停用紀錄，手動把 enabled 翻成 true（不經核准、不重算綁定）。
    const flipped: McpServerRecord = { ...current!, enabled: true };
    writeHandMadeFile(flipped);

    const notifications: ProtocolEventIntent[] = [];
    const bundles: ToolBundleDraft[] = [];
    const created: string[] = [];
    const handle = await activateMcpModule(makeContext(notifications, bundles), {
      store,
      folderRoot: root,
      clientFactory: spyingClient(created),
      bindings,
    });
    await handle.settled();

    expect(created).toEqual([]);
    expect(bundles).toEqual([]);
    expect(notifications).toContainEqual(
      expect.objectContaining({ kind: "notification", title: "MCP 設定待核准", level: "warning" }),
    );
    await handle.dispose();
  });

  it("重啟後行為一致：核准前不啟動，核准後啟動，再改內容又不啟動", async () => {
    makeFolder();
    const store = new McpServerStore(new FolderLayout(root));
    const record = await store.add(INPUT);
    await store.setEnabled(record.serverId, true);
    const bindings = openMcpApprovals();

    const firstNotifications: ProtocolEventIntent[] = [];
    const firstCreated: string[] = [];
    const first = await activateMcpModule(makeContext(firstNotifications, []), {
      store,
      folderRoot: root,
      clientFactory: spyingClient(firstCreated),
      bindings,
    });
    await first.settled();
    expect(firstCreated).toEqual([]);
    await first.dispose();

    const current = await store.get(record.serverId);
    bindings.approve(current!);

    const secondCreated: string[] = [];
    const second = await activateMcpModule(makeContext([], []), {
      store,
      folderRoot: root,
      clientFactory: spyingClient(secondCreated),
      bindings,
    });
    await second.settled();
    expect(secondCreated).toEqual([record.serverId]);
    await second.dispose();

    const tampered: McpServerRecord = { ...current!, args: ["--evil"] };
    writeHandMadeFile(tampered);

    const thirdNotifications: ProtocolEventIntent[] = [];
    const thirdCreated: string[] = [];
    const third = await activateMcpModule(makeContext(thirdNotifications, []), {
      store,
      folderRoot: root,
      clientFactory: spyingClient(thirdCreated),
      bindings,
    });
    await third.settled();
    expect(thirdCreated).toEqual([]);
    expect(thirdNotifications).toContainEqual(
      expect.objectContaining({ kind: "notification", title: "MCP 設定待核准", level: "warning" }),
    );
    await third.dispose();
  });

  it("正常流程：經協定新增並核准後會啟動，證明不是全部擋掉", async () => {
    makeFolder();
    const store = new McpServerStore(new FolderLayout(root));
    const approvals = new FakeApprovals();
    const bindings = openMcpApprovals();
    const notifications: ProtocolEventIntent[] = [];
    const bundles: ToolBundleDraft[] = [];
    const created: string[] = [];
    const handle = await activateMcpModule(makeContext(notifications, bundles), {
      store,
      engine: makeEngine(approvals),
      folderRoot: root,
      clientFactory: spyingClient(created),
      bindings,
    });

    const { approvalId } = await handle.controller.requestAdd(INPUT);
    // 核准前不寫正本、不註冊工具；決定的 waiter 還沒解析，不能等 settled。
    expect(await store.list()).toEqual([]);
    expect(bundles).toEqual([]);
    expect(created).toEqual([]);

    approvals.decide(approvalId, "approved");
    await handle.settled();

    const records = await store.list();
    expect(records).toHaveLength(1);
    expect(created).toEqual([records[0].serverId]);
    expect(bundles).toHaveLength(1);
    expect(bindings.isApproved(records[0])).toBe(true);
    await handle.dispose();
  });
});
