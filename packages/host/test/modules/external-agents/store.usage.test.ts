import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExternalAgentOutsideWriteEntry, ExternalAgentUsage } from "@cardiary/domain";
import type { ProtocolEventEmitter, ProtocolRequestContext } from "@cardiary/module-api";
import { afterEach, describe, expect, it } from "vitest";

import type { ExternalAgentsService } from "../../../src/modules/external-agents/service.js";
import { registerExternalAgentsProtocol } from "../../../src/modules/external-agents/protocol.js";
import { computeOutsideWrites } from "../../../src/modules/external-agents/store.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

async function makeHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-outside-writes-"));
  roots.push(root);
  return root;
}

const PROJECTS = [".claude", "projects"] as const;
const BACKUPS = [".claude", "backups"] as const;
const PLUGINS = [".claude", "plugins"] as const;
const CACHE = ["Library", "Caches", "claude-cli-nodejs"] as const;

function entryAt(
  entries: readonly ExternalAgentOutsideWriteEntry[],
  relative: readonly string[],
): ExternalAgentOutsideWriteEntry {
  const suffix = relative.join("/");
  const found = entries.find(
    (entry) => entry.path.split("/").slice(-relative.length).join("/") === suffix,
  );
  if (found === undefined) throw new Error(`找不到候選 ${suffix}`);
  return found;
}

function expectUnavailable(entry: ExternalAgentOutsideWriteEntry): void {
  expect(entry.status).toBe("unavailable");
  expect("bytes" in entry).toBe(false);
  expect(entry.tool).toBe("claude-code");
}

const runningAsRoot = typeof process.getuid === "function" && process.getuid() === 0;

describe("computeOutsideWrites：資料夾外寫入的唯讀量測", () => {
  it("measured：bytes 等於目錄內檔案的位元組總和", async () => {
    const home = await makeHome();
    const dir = join(home, ".claude", "projects");
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "a.jsonl"), "12345");
    await writeFile(join(dir, "sub", "b.jsonl"), "abc");

    const entries = await computeOutsideWrites(home);
    expect(entryAt(entries, PROJECTS)).toEqual({
      path: dir,
      tool: "claude-code",
      status: "measured",
      bytes: 8,
    });
  });

  it("absent：可測得候選不存在，bytes 為 0", async () => {
    const home = await makeHome();
    const entries = await computeOutsideWrites(home);
    for (const relative of [PROJECTS, BACKUPS, PLUGINS, CACHE]) {
      const entry = entryAt(entries, relative);
      expect(entry.status).toBe("absent");
      expect(entry.bytes).toBe(0);
      expect("bytes" in entry).toBe(true);
      expect(entry.tool).toBe("claude-code");
    }
    expect(entries).toHaveLength(4);
  });

  it("unavailable：候選本身是 symlink，不追、不計入目標大小", async () => {
    const home = await makeHome();
    const target = join(home, "outside-target");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "secret"), "0123456789");
    await mkdir(join(home, ".claude"), { recursive: true });
    await symlink(target, join(home, ".claude", "projects"));

    expectUnavailable(entryAt(await computeOutsideWrites(home), PROJECTS));
  });

  it("unavailable：祖先層是 symlink，不追到外部目標", async () => {
    const home = await makeHome();
    const target = join(home, "outside-claude");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "secret"), "0123456789");
    await symlink(target, join(home, ".claude"));

    const entries = await computeOutsideWrites(home);
    for (const relative of [PROJECTS, BACKUPS, PLUGINS]) {
      expectUnavailable(entryAt(entries, relative));
    }
  });

  it("unavailable：目錄內子項是 symlink，整筆降 unavailable", async () => {
    const home = await makeHome();
    const dir = join(home, ".claude", "projects");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "ok"), "abc");
    const target = join(home, "outside-target");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "secret"), "0123456789");
    await symlink(target, join(dir, "link"));

    expectUnavailable(entryAt(await computeOutsideWrites(home), PROJECTS));
  });

  it("unavailable：循環 symlink 不無限遞迴", async () => {
    const home = await makeHome();
    const dir = join(home, ".claude", "projects");
    await mkdir(dir, { recursive: true });
    await symlink(".", join(dir, "loop"));

    expectUnavailable(entryAt(await computeOutsideWrites(home), PROJECTS));
  });

  it.skipIf(runningAsRoot)("unavailable：候選目錄權限不足", async () => {
    const home = await makeHome();
    const dir = join(home, ".claude", "projects");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "a.jsonl"), "12345");
    await chmod(dir, 0);
    try {
      expectUnavailable(entryAt(await computeOutsideWrites(home), PROJECTS));
    } finally {
      await chmod(dir, 0o755);
    }
  });
});

describe("legacy external-agents usage 形狀回歸", () => {
  it("module.external-agents.usage handler 原样回傳 service.usage()，保留 exists、不帶 status", async () => {
    const legacyUsage: ExternalAgentUsage = {
      cacheBytes: 10,
      tempBytes: 0,
      outsideEntries: [{ path: "/fixture/.claude/projects", bytes: 100, exists: true }],
    };
    const handlers = new Map<string, (request: ProtocolRequestContext) => Promise<unknown>>();
    const protocol: ProtocolEventEmitter = {
      emit: () => {},
      registerNamespace: (namespace, handler) => {
        handlers.set(namespace, handler);
        return { dispose: () => handlers.delete(namespace) };
      },
      registerHttpRoute: () => ({ dispose: () => {} }),
    };
    const service = { usage: async () => legacyUsage } as unknown as ExternalAgentsService;
    registerExternalAgentsProtocol({ service, protocol });

    const handler = handlers.get("module.external-agents");
    if (handler === undefined) throw new Error("沒有 module.external-agents 處理器");
    const result = (await handler({
      type: "module.external-agents.usage",
      payload: {},
      clientId: "test",
    } as ProtocolRequestContext)) as { data: ExternalAgentUsage };

    expect(result).toEqual({ data: legacyUsage });
    const entry = result.data.outsideEntries[0];
    expect("exists" in entry).toBe(true);
    expect("status" in entry).toBe(false);
    expect("tool" in entry).toBe(false);
  });
});
