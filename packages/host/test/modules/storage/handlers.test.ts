import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { ExternalAgentOutsideWriteEntry } from "@cardiary/domain";
import type { ProtocolEventEmitter, ProtocolRequestContext } from "@cardiary/module-api";
import { Storage, StorageCleanup } from "@cardiary/storage";

import { ProtocolHandlerError } from "../../../src/modules/contract.js";
import { registerStorageProtocol } from "../../../src/modules/storage/protocol.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function harness(
  shellState?: () => Promise<{ usedBytes: number; limitBytes: number }>,
  outsideWrites?: () => Promise<readonly ExternalAgentOutsideWriteEntry[] | undefined>,
): {
  call(type: string, payload?: Record<string, unknown>): Promise<unknown>;
  layout: Storage["layout"];
  storage: Storage;
} {
  const root = mkdtempSync(path.join(tmpdir(), "cardiary-host-storage-"));
  const storage = Storage.open({ path: root, initialize: true, appVersion: "test" });
  cleanups.push(() => {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  });
  const handlers = new Map<string, (request: ProtocolRequestContext) => Promise<unknown>>();
  const protocol: ProtocolEventEmitter = {
    emit: () => {},
    registerNamespace: (namespace, handler) => {
      handlers.set(namespace, handler);
      return { dispose: () => handlers.delete(namespace) };
    },
    registerHttpRoute: () => ({ dispose: () => {} }),
  };
  const cleanup = new StorageCleanup({
    layout: storage.layout,
    cache: () => storage.cache,
  });
  registerStorageProtocol({
    cleanup,
    protocol,
    ...(shellState === undefined ? {} : { shellState }),
    ...(outsideWrites === undefined ? {} : { outsideWrites }),
  });
  return {
    storage,
    layout: storage.layout,
    call: async (type, payload = {}) => {
      const handler = handlers.get("storage");
      if (handler === undefined) throw new Error("沒有 storage 處理器");
      return handler({ type, payload, clientId: "device-1" } as ProtocolRequestContext);
    },
  };
}

function put(layout: Storage["layout"], relativePath: string, content: string): void {
  const absolute = layout.absolute(relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

describe("storage 協定", () => {
  it("usage 回報七類，含暫存與殼狀態；正本不可清", async () => {
    const { call, layout } = harness(async () => ({ usedBytes: 2048, limitBytes: 52428800 }));
    put(layout, "cards/a.md", "card");
    put(layout, "cache/a.bin", "cache");
    put(layout, "tmp/a.bin", "tmp");
    const response = (await call("storage.usage")) as {
      usage: Array<{ category: string; bytes: number; cleanableBytes: number }>;
    };
    expect(response.usage.map((item) => item.category)).toEqual([
      "cards",
      "assets",
      "cache",
      "state",
      "logs",
      "tmp",
      "shellState",
    ]);
    expect(response.usage.find((item) => item.category === "cards")?.cleanableBytes).toBe(0);
    expect(response.usage.find((item) => item.category === "shellState")).toEqual({
      category: "shellState",
      bytes: 2048,
      cleanableBytes: 0,
    });
  });

  it("沒有殼或殼沒有回應時，殼狀態回 0 而不是讓整個請求失敗", async () => {
    const withoutShell = (await harness().call("storage.usage")) as {
      usage: Array<{ category: string; bytes: number }>;
    };
    expect(withoutShell.usage.find((item) => item.category === "shellState")?.bytes).toBe(0);

    const failing = (await harness(async () => {
      throw new Error("控制通道中斷");
    }).call("storage.usage")) as { usage: Array<{ category: string; bytes: number }> };
    expect(failing.usage.find((item) => item.category === "shellState")?.bytes).toBe(0);
  });

  it("注入 outsideWrites 時回傳明細，七類 usage 不變", async () => {
    const injected: readonly ExternalAgentOutsideWriteEntry[] = [
      { path: "/home/u/.claude/projects", tool: "claude-code", status: "measured", bytes: 4096 },
      { path: "/home/u/.claude/backups", tool: "claude-code", status: "absent", bytes: 0 },
      { path: "/home/u/.claude/plugins", tool: "claude-code", status: "unavailable" },
    ];
    const { call } = harness(undefined, async () => injected);
    const response = (await call("storage.usage")) as {
      usage: Array<{ category: string }>;
      outsideWrites?: readonly ExternalAgentOutsideWriteEntry[];
    };
    expect(response.outsideWrites).toEqual(injected);
    expect(response.usage.map((item) => item.category)).toEqual([
      "cards",
      "assets",
      "cache",
      "state",
      "logs",
      "tmp",
      "shellState",
    ]);
  });

  it("沒有注入 outsideWrites 時省略欄位，不回空陣列或 0", async () => {
    const response = (await harness().call("storage.usage")) as Record<string, unknown>;
    expect("outsideWrites" in response).toBe(false);
  });

  it("outsideWrites 擲錯時省略欄位，其餘用量仍回", async () => {
    const response = (await harness(undefined, async () => {
      throw new Error("量測失敗");
    }).call("storage.usage")) as {
      usage: Array<{ category: string }>;
      outsideWrites?: unknown;
    };
    expect("outsideWrites" in response).toBe(false);
    expect(response.usage).toHaveLength(7);
  });

  it("outsideWrites 回 undefined（模組未啟用）時省略欄位", async () => {
    const response = (await harness(undefined, async () => undefined).call(
      "storage.usage",
    )) as Record<string, unknown>;
    expect("outsideWrites" in response).toBe(false);
  });

  it("拒絕正本類別、殼狀態與沒有預覽的執行", async () => {
    const { call } = harness();
    for (const category of ["cards", "assets", "state", "shellState"]) {
      await expect(
        call("storage.cleanup.preview", { categories: [category] }),
        category,
      ).rejects.toMatchObject({
        code: "invalid_message",
      } satisfies Partial<ProtocolHandlerError>);
    }
    await expect(call("storage.cleanup.apply", { categories: ["cache"] })).rejects.toMatchObject({
      code: "invalid_message",
    } satisfies Partial<ProtocolHandlerError>);
  });

  it("預覽四類可清理的類別，總量是各類別之和", async () => {
    const { call, layout } = harness();
    put(layout, "cache/a.bin", "abc");
    put(layout, "tmp/b.bin", "12345");
    put(layout, "logs/host.log", "log-line");
    const preview = (await call("storage.cleanup.preview", {
      categories: ["cache", "temp", "indexes", "logs"],
    })) as {
      targets: Array<{ category: string; items: number; bytes: number }>;
      totalBytes: number;
    };
    expect(preview.targets.map((target) => target.category)).toEqual([
      "cache",
      "temp",
      "indexes",
      "logs",
    ]);
    expect(preview.totalBytes).toBe(preview.targets.reduce((sum, target) => sum + target.bytes, 0));
    expect(preview.targets.find((target) => target.category === "temp")?.bytes).toBe(5);
  });

  it("預覽後才清除，並留下清理紀錄", async () => {
    const { call, layout } = harness();
    put(layout, "cache/a.bin", "abc");
    const preview = (await call("storage.cleanup.preview", { categories: ["cache"] })) as {
      targets: unknown[];
      totalBytes: number;
    };
    const applied = (await call("storage.cleanup.apply", { categories: ["cache"] })) as {
      recordId: string;
      targets: unknown[];
      totalBytes: number;
    };
    expect(applied.targets).toEqual(preview.targets);
    expect(applied.totalBytes).toBe(preview.totalBytes);
    expect(existsSync(layout.absolute("cache/a.bin"))).toBe(false);
    expect(existsSync(layout.absolute("state/storage-cleanup.json"))).toBe(true);
  });
});
