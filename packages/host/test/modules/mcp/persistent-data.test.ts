/**
 * MCP 持久資料目錄：`modules/mcp/<serverId>/` 的授權、隔離與移除。
 *
 * 覆蓋的行為：
 * - 核准時可以一併授權寫入自己的持久資料目錄，授權綁在核准紀錄上；
 *   手改正本讓設定雜湊不符後，舊授權不能沿用。
 * - stdio 沙盒只額外放行自己的目錄；未授權的伺服器不能寫。
 * - 目錄的上層是符號連結時，建立與沙盒放行都會擋下（fail closed）。
 * - 停用保留目錄；移除伺服器連同目錄一起刪除；刪除失敗只回報，
 *   核准照樣撤銷、其他清理不受影響。
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import type { ToolBundleDraft } from "@cardiary/engine-adapter";
import type { ModuleActivationContext, ProtocolEventIntent } from "@cardiary/module-api";
import { FolderLayout, McpServerStore } from "@cardiary/storage";
import type { McpServerRecord } from "@cardiary/domain";
import { afterEach, describe, expect, it } from "vitest";

import type { HostEngine } from "../../../src/engine/types.js";
import { activateMcpModule } from "../../../src/modules/mcp/index.js";
import type { McpClientFactory } from "../../../src/modules/mcp/client.js";
import { createMcpStdioSandbox, buildMcpStdioProfile } from "../../../src/modules/mcp/sandbox.js";
import {
  ensureMcpPersistentDir,
  mcpPersistentDataUsage,
  removeMcpPersistentDir,
  McpPersistentDirError,
} from "../../../src/modules/mcp/persistent-data.js";
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
  root = realpathSync(mkdtempSync(join(tmpdir(), "cardiary-mcp-persistent-")));
  mkdirSync(join(root, "state"), { recursive: true });
  return root;
}

class FakeApprovals {
  readonly requests: unknown[] = [];
  readonly #waiters = new Map<string, (resolution: Record<string, unknown>) => void>();
  #count = 0;

  async request(action: unknown): Promise<{ id: string }> {
    this.requests.push(action);
    return { id: `approval-${(this.#count += 1)}` };
  }

  async listPending(): Promise<Array<Record<string, unknown>>> {
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

/** 記錄每次連線的 serverId 與 context，用來分辨授權有沒有傳進用戶端。 */
function spyingClient(
  created: Array<{ serverId: string; persistentData?: boolean }>,
): McpClientFactory {
  const client = {
    async listTools() {
      return [];
    },
    async callTool() {
      return { content: [], isError: false, text: "" };
    },
    async close() {},
  };
  return ((record: { serverId: string }, context: { persistentData?: boolean }) => {
    created.push({ serverId: record.serverId, persistentData: context.persistentData });
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

function folderLayout(): FolderLayout {
  return new FolderLayout(root);
}

describe("MCP 持久資料授權", () => {
  it("核准時可以一併授權；授權跟著核准紀錄走，手改正本後不沿用", async () => {
    makeFolder();
    const store = new McpServerStore(folderLayout());
    const approvals = new FakeApprovals();
    const bindings = openMcpApprovals();
    const notifications: ProtocolEventIntent[] = [];
    const handle = await activateMcpModule(makeContext(notifications, []), {
      store,
      engine: makeEngine(approvals),
      folderRoot: root,
      clientFactory: spyingClient([]),
      bindings,
    });

    const { approvalId } = await handle.controller.requestAdd(INPUT, { persistentData: true });
    approvals.decide(approvalId, "approved");
    await handle.settled();

    const record = (await store.list())[0];
    // 核准請求有帶上持久資料授權。
    const action = (
      approvals.requests[0] as { action: { details: { label: string; value: string }[] } }
    ).action;
    expect(action.details).toContainEqual(
      expect.objectContaining({ label: "持久資料目錄", value: expect.stringContaining("允許") }),
    );
    // 授權登記在核准紀錄上，且設定沒被改過。
    expect(bindings.isApproved(record)).toBe(true);
    expect(bindings.persistentWrite(record)).toBe(true);

    // 手改正本後，核准與持久資料授權都不再成立。
    const tampered: McpServerRecord = { ...record, name: "篡改過的名稱" };
    await handle.dispose();
    const { serializeMcpServersFile } = await import("@cardiary/domain");
    writeFileSync(join(root, "state", "mcp-servers.json"), serializeMcpServersFile([tampered]));
    expect(bindings.isApproved(tampered)).toBe(false);
    expect(bindings.persistentWrite(tampered)).toBe(false);
  });

  it("授權傳到 stdio 用戶端的 context，未勾選時不會傳", async () => {
    makeFolder();
    const store = new McpServerStore(folderLayout());
    const bindings = openMcpApprovals();
    const record = await store.add(INPUT);
    bindings.approve(record, { persistentData: true });

    const created: Array<{ serverId: string; persistentData?: boolean }> = [];
    const approved = await activateMcpModule(makeContext([], []), {
      store,
      folderRoot: root,
      clientFactory: spyingClient(created),
      bindings,
    });
    await approved.settled();
    expect(created).toEqual([{ serverId: record.serverId, persistentData: true }]);
    await approved.dispose();

    // 撤銷授權後重新啟動，不會再拿到授權。
    bindings.revoke(record.serverId);
    bindings.approve(record, { persistentData: false });
    const created2: Array<{ serverId: string; persistentData?: boolean }> = [];
    const plain = await activateMcpModule(makeContext([], []), {
      store,
      folderRoot: root,
      clientFactory: spyingClient(created2),
      bindings,
    });
    await plain.settled();
    expect(created2).toEqual([{ serverId: record.serverId, persistentData: undefined }]);
    await plain.dispose();
  });

  it("停用保留目錄與檔案；重新啟用後目錄內容還在", async () => {
    makeFolder();
    const store = new McpServerStore(folderLayout());
    const record = await store.add(INPUT);
    const bindings = openMcpApprovals();
    bindings.approve(record, { persistentData: true });

    const handle = await activateMcpModule(makeContext([], []), {
      store,
      folderRoot: root,
      clientFactory: spyingClient([]),
      bindings,
    });
    await handle.settled();

    // 建立一個假的資料目錄（實際寫入由沙盒保證）。
    const dir = ensureMcpPersistentDir(root, record.serverId);
    writeFileSync(join(dir, "keep.txt"), "still here", "utf8");

    await handle.controller.setEnabled(record.serverId, false);
    expect(existsSync(join(dir, "keep.txt"))).toBe(true);

    await handle.controller.setEnabled(record.serverId, true);
    expect(existsSync(join(dir, "keep.txt"))).toBe(true);
    await handle.dispose();
  });

  it("移除伺服器時刪除整個目錄並撤銷核准", async () => {
    makeFolder();
    const store = new McpServerStore(folderLayout());
    const record = await store.add(INPUT);
    const bindings = openMcpApprovals();
    bindings.approve(record, { persistentData: true });

    const handle = await activateMcpModule(makeContext([], []), {
      store,
      folderRoot: root,
      clientFactory: spyingClient([]),
      bindings,
    });
    await handle.settled();

    const dir = ensureMcpPersistentDir(root, record.serverId);
    writeFileSync(join(dir, "data.db"), "bytes", "utf8");

    await expect(handle.controller.removeServer(record.serverId)).resolves.toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(bindings.approvalOf(record.serverId)).toBeUndefined();
    expect(await store.get(record.serverId)).toBeNull();
    await handle.dispose();
  });

  it("目錄刪除失敗只回報，核准照樣撤銷", async () => {
    makeFolder();
    const store = new McpServerStore(folderLayout());
    const record = await store.add(INPUT);
    const bindings = openMcpApprovals();
    bindings.approve(record, { persistentData: true });

    const notifications: ProtocolEventIntent[] = [];
    const handle = await activateMcpModule(makeContext(notifications, []), {
      store,
      folderRoot: root,
      clientFactory: spyingClient([]),
      bindings,
    });
    await handle.settled();

    // modules/mcp 變成符號連結時，removeTreeSafely 會拒絕跟隨。
    mkdirSync(join(root, "outside"), { recursive: true });
    mkdirSync(join(root, "modules"), { recursive: true });
    symlinkSync(join(root, "outside"), join(root, "modules", "mcp"));
    writeFileSync(join(root, "outside", "sentinel.txt"), "keep", "utf8");

    await expect(handle.controller.removeServer(record.serverId)).resolves.toBe(true);
    expect(bindings.approvalOf(record.serverId)).toBeUndefined();
    expect(notifications).toContainEqual(
      expect.objectContaining({
        kind: "notification",
        title: "MCP 持久資料目錄未刪除",
        level: "error",
      }),
    );
    await handle.dispose();
  });

  it("listServers 回報授權狀態與目錄用量（bytes／檔案數）", async () => {
    makeFolder();
    const store = new McpServerStore(folderLayout());
    const record = await store.add(INPUT);
    const bindings = openMcpApprovals();
    bindings.approve(record, { persistentData: true });

    const handle = await activateMcpModule(makeContext([], []), {
      store,
      folderRoot: root,
      clientFactory: spyingClient([]),
      bindings,
    });
    await handle.settled();

    const dir = ensureMcpPersistentDir(root, record.serverId);
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "sub", "a.bin"), "0123456789", "utf8");

    const [info] = await handle.controller.listServers();
    expect(info.persistentData).toEqual({ allowed: true, bytes: 10, files: 1 });
    await handle.dispose();
  });
});

describe("MCP 持久資料目錄的沙盒防線", () => {
  it("未授權時 profile 不放行 modules/mcp/<id>；授權後才放行，且該規則在拒絕 modules 之後", async () => {
    makeFolder();
    const entry = join(root, "modules", "mcp", "demo");
    const denied = buildMcpStdioProfile({ folderRoot: root, serverId: "demo" });
    expect(denied).not.toContain(`(allow file-write* (subpath ${JSON.stringify(entry)})`);
    expect(denied).toContain("(deny file-write*");

    const granted = buildMcpStdioProfile({
      folderRoot: root,
      serverId: "demo",
      persistentData: true,
    });
    const allowLine = granted
      .split("\n")
      .find((line) => line.startsWith("(allow file-write*") && line.includes("modules/mcp/demo"));
    expect(allowLine, "授權後應有針對自己目錄的 allow").toBeDefined();
    const denyModules = granted.indexOf("modules");
    expect(granted.indexOf("modules/mcp/demo")).toBeGreaterThan(denyModules);
    expect(existsSync(entry)).toBe(true);
  });

  it("上層 modules/mcp 是符號連結時，建立目錄被擋下（fail closed）", () => {
    makeFolder();
    mkdirSync(join(root, "outside"), { recursive: true });
    mkdirSync(join(root, "modules"), { recursive: true });
    symlinkSync(join(root, "outside"), join(root, "modules", "mcp"));
    expect(() => ensureMcpPersistentDir(root, "demo")).toThrow(McpPersistentDirError);
    expect(() =>
      createMcpStdioSandbox({ folderRoot: root, serverId: "demo", persistentData: true }),
    ).toThrow(McpPersistentDirError);
  });

  it("modules 本身是符號連結時，也會被擋下", () => {
    makeFolder();
    mkdirSync(join(root, "outside"), { recursive: true });
    symlinkSync(join(root, "outside"), join(root, "modules"));
    expect(() => ensureMcpPersistentDir(root, "demo")).toThrow(McpPersistentDirError);
  });

  it("removeMcpPersistentDir 只刪自己的目錄，其他目錄不受影響", () => {
    makeFolder();
    const mine = ensureMcpPersistentDir(root, "demo");
    const other = ensureMcpPersistentDir(root, "other");
    writeFileSync(join(mine, "mine.txt"), "m", "utf8");
    writeFileSync(join(other, "other.txt"), "o", "utf8");

    expect(removeMcpPersistentDir(root, "demo")).toBe(true);
    expect(existsSync(mine)).toBe(false);
    expect(existsSync(join(other, "other.txt"))).toBe(true);
    expect(removeMcpPersistentDir(root, "demo")).toBe(false);
  });

  it("mcpPersistentDataUsage 不跟隨符號連結，回傳相加的 bytes 與檔案數", () => {
    makeFolder();
    const dir = ensureMcpPersistentDir(root, "demo");
    writeFileSync(join(dir, "a.bin"), "aaaaa", "utf8");
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "sub", "b.bin"), "bbbbbb", "utf8");
    symlinkSync(join(dir, "a.bin"), join(dir, "link"));

    const usage = mcpPersistentDataUsage(root, "demo");
    expect(usage.bytes).toBeGreaterThanOrEqual(11);
    expect(usage.files).toBe(3);
  });

  it("folderRoot 是符號連結時，建立、用量與刪除一致走實際路徑", () => {
    // 模擬 macOS 的 /var -> /private/var：呼叫端給的是連結路徑，三個函式
    // 都要走實際路徑，不能把連結本身當成鏈上的一段而拒絕。
    const real = realpathSync(mkdtempSync(join(tmpdir(), "cardiary-mcp-real-")));
    const link = join(tmpdir(), `cardiary-mcp-link-${process.pid}-${Date.now()}`);
    symlinkSync(real, link);
    try {
      mkdirSync(join(real, "state"), { recursive: true });
      const dir = ensureMcpPersistentDir(link, "demo");
      expect(dir).toBe(join(real, "modules", "mcp", "demo"));
      writeFileSync(join(dir, "a.bin"), "abc", "utf8");
      expect(mcpPersistentDataUsage(link, "demo")).toEqual({ bytes: 3, files: 1 });
      expect(removeMcpPersistentDir(link, "demo")).toBe(true);
      expect(existsSync(dir)).toBe(false);
    } finally {
      rmSync(link, { force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });
});

describe("MCP 持久資料目錄的殘留回報", () => {
  async function runRemoveServerWithResidue(createResidue: (dir: string) => void | Promise<void>) {
    makeFolder();
    const store = new McpServerStore(folderLayout());
    const record = await store.add(INPUT);
    const bindings = openMcpApprovals();
    bindings.approve(record, { persistentData: true });

    const notifications: ProtocolEventIntent[] = [];
    const handle = await activateMcpModule(makeContext(notifications, []), {
      store,
      folderRoot: root,
      clientFactory: spyingClient([]),
      bindings,
    });
    await handle.settled();

    const dir = ensureMcpPersistentDir(root, record.serverId);
    writeFileSync(join(dir, "data.bin"), "bytes", "utf8");
    await createResidue(dir);

    await expect(handle.controller.removeServer(record.serverId)).resolves.toBe(true);
    await handle.dispose();
    return { store, bindings, notifications, record, dir };
  }

  function expectErrorNotification(notifications: ProtocolEventIntent[]): void {
    expect(notifications).toContainEqual(
      expect.objectContaining({
        kind: "notification",
        title: "MCP 持久資料目錄未刪除",
        level: "error",
      }),
    );
  }

  it("目錄內有硬連結時，其他清理完成、發出錯誤通知，檔案保留", async () => {
    const { store, bindings, notifications, record, dir } = await runRemoveServerWithResidue(
      (dir) => {
        linkSync(join(dir, "data.bin"), join(dir, "alias.bin"));
      },
    );

    expect(await store.get(record.serverId)).toBeNull();
    expect(bindings.approvalOf(record.serverId)).toBeUndefined();
    expect(existsSync(join(dir, "data.bin"))).toBe(true);
    expect(existsSync(join(dir, "alias.bin"))).toBe(true);
    expectErrorNotification(notifications);
  });

  it("目錄內有 FIFO 時，其他清理完成、發出錯誤通知，FIFO 保留", async () => {
    const { store, bindings, notifications, record, dir } = await runRemoveServerWithResidue(
      (dir) => {
        execFileSync("mkfifo", [join(dir, "pipe")]);
      },
    );

    expect(await store.get(record.serverId)).toBeNull();
    expect(bindings.approvalOf(record.serverId)).toBeUndefined();
    expect(existsSync(join(dir, "pipe"))).toBe(true);
    expectErrorNotification(notifications);
  });

  it("目錄內有 Unix socket 時，其他清理完成、發出錯誤通知，socket 保留", async () => {
    // Node 的 server.close() 會刪掉 socket 檔，所以測試全程保持監聽，最後才關。
    const holder: { server?: net.Server } = {};
    const { store, bindings, notifications, record, dir } = await runRemoveServerWithResidue(
      (dir) =>
        new Promise<void>((resolve, reject) => {
          const server = net.createServer();
          holder.server = server;
          server.once("error", reject);
          server.listen(join(dir, "app.sock"), resolve);
        }),
    );

    expect(await store.get(record.serverId)).toBeNull();
    expect(bindings.approvalOf(record.serverId)).toBeUndefined();
    expect(existsSync(join(dir, "app.sock"))).toBe(true);
    expectErrorNotification(notifications);
    await new Promise<void>((resolve) => holder.server!.close(() => resolve()));
  });

  it("removeMcpPersistentDir 對硬連結丟 McpPersistentDirError，不強刪", () => {
    makeFolder();
    const dir = ensureMcpPersistentDir(root, "demo");
    writeFileSync(join(dir, "data.bin"), "bytes", "utf8");
    linkSync(join(dir, "data.bin"), join(dir, "alias.bin"));

    expect(() => removeMcpPersistentDir(root, "demo")).toThrow(McpPersistentDirError);
    expect(existsSync(join(dir, "data.bin"))).toBe(true);
  });

  it("removeMcpPersistentDir 對 FIFO 丟 McpPersistentDirError", () => {
    makeFolder();
    const dir = ensureMcpPersistentDir(root, "demo");
    execFileSync("mkfifo", [join(dir, "pipe")]);

    expect(() => removeMcpPersistentDir(root, "demo")).toThrow(McpPersistentDirError);
    expect(existsSync(join(dir, "pipe"))).toBe(true);
  });

  it("removeMcpPersistentDir 對 Unix socket 丟 McpPersistentDirError", async () => {
    makeFolder();
    const dir = ensureMcpPersistentDir(root, "demo");
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      // server.close() 會刪 socket 檔，這裡保持監聽，結束才關。
      server.listen(join(dir, "app.sock"), resolve);
    });
    try {
      expect(() => removeMcpPersistentDir(root, "demo")).toThrow(McpPersistentDirError);
      expect(existsSync(join(dir, "app.sock"))).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
