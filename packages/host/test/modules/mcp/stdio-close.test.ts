/**
 * 初始化期間的 close 必須同時拿到子行程控制權和等待中的 RPC。子行程收到
 * initialize 但不回時，沒持有 child 的用戶端要等 30 秒逾時，停用或移除
 * 後還會留下行程。這裡用真的 sandbox-exec + node 子行程重現並驗證。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolBundleDraft } from "@cardiary/engine-adapter";
import type { ModuleActivationContext } from "@cardiary/module-api";
import { FolderLayout, McpServerStore } from "@cardiary/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createMcpClient } from "../../../src/modules/mcp/client.js";
import { activateMcpModule } from "../../../src/modules/mcp/index.js";
import { SpawnRegistry } from "../../../src/spawn/wrapper.js";
import { openMcpApprovals } from "./helpers.js";

const SCRIPT = `
const fs = require("node:fs");
const readline = require("node:readline");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") fs.writeFileSync("initialized", String(process.pid));
});
`;

let root = "";
let registry: SpawnRegistry;

afterEach(async () => {
  await registry?.cancelAll(1_000);
  await registry?.waitAll();
  if (root !== "") rmSync(root, { recursive: true, force: true });
  root = "";
});

function setup(): void {
  root = realpathSync(mkdtempSync(join(tmpdir(), "cardiary-mcp-close-")));
  mkdirSync(join(root, "state"), { recursive: true });
  registry = new SpawnRegistry();
}

async function waitForInitialize(serverId: string): Promise<number> {
  const marker = join(root, "tmp", "mcp", serverId, "initialized");
  const deadline = Date.now() + 3_000;
  while (!existsSync(marker) || readFileSync(marker, "utf8").length === 0) {
    if (Date.now() >= deadline) throw new Error("等待子行程收到 initialize 逾時");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return Number(readFileSync(marker, "utf8"));
}

async function withinOneSecond<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("操作超過一秒")), 1_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function expectExited(pid: number): void {
  expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
}

const input = {
  name: "等待初始化",
  transport: "stdio" as const,
  command: process.execPath,
  args: ["-e", SCRIPT],
  allowedHosts: [],
};

describe.skipIf(process.platform !== "darwin")("stdio 初始化期間關閉", () => {
  it("關閉會終止子行程並讓等待中的清單以 closed 拒絕", async () => {
    setup();
    const store = new McpServerStore(new FolderLayout(root));
    const record = await store.add(input);
    const client = createMcpClient(record, {
      folderRoot: root,
      spawn: registry,
      logger: { debug: () => undefined, warn: () => undefined },
    });
    const listing = client.listTools();
    const rejected = expect(listing).rejects.toMatchObject({ code: "closed" });
    const pid = await waitForInitialize(record.serverId);

    await withinOneSecond(Promise.all([client.close(), rejected]));
    expectExited(pid);
    expect(registry.runningCount).toBe(0);
    await expect(client.listTools()).rejects.toMatchObject({ code: "closed" });
  });

  for (const action of ["remove", "disable"] as const) {
    it(`初始化期間${action === "remove" ? "移除" : "停用"}不留下工具或子行程`, async () => {
      setup();
      const store = new McpServerStore(new FolderLayout(root));
      const record = await store.add(input);
      const bindings = openMcpApprovals();
      bindings.approve(record);
      const bundles: ToolBundleDraft[] = [];
      const noop = (): void => {};
      const context = {
        identity: { moduleId: "mcp", generation: 1 },
        services: {
          paths: { root },
          logger: { debug: noop, info: noop, warn: noop, error: noop },
          protocol: { emit: noop, registerNamespace: () => ({ dispose: noop }) },
          host: { provide: noop, get: () => undefined, require: () => undefined },
        },
        registerToolBundle(draft: ToolBundleDraft) {
          bundles.push(draft);
          return { registrationId: draft.bundleId, dispose: noop };
        },
      } as unknown as ModuleActivationContext;
      const handle = await activateMcpModule(context, {
        store,
        bindings,
        spawn: registry,
        folderRoot: root,
      });
      const pid = await waitForInitialize(record.serverId);
      const stopping =
        action === "remove"
          ? handle.controller.removeServer(record.serverId)
          : handle.controller.setEnabled(record.serverId, false);

      await withinOneSecond(stopping);
      await withinOneSecond(handle.settled());
      expect(bundles).toEqual([]);
      expectExited(pid);
      expect(registry.runningCount).toBe(0);
      if (action === "remove") expect(await store.list()).toEqual([]);
      else expect((await store.get(record.serverId))?.enabled).toBe(false);
      await handle.dispose();
    });
  }
});
