import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { ProtocolEventEmitter, ProtocolRequestContext } from "@cardiary/module-api";
import { Storage, StorageCleanup } from "@cardiary/storage";

import { ProtocolHandlerError } from "../../../src/modules/contract.js";
import { registerStorageProtocol } from "../../../src/modules/storage/protocol.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function harness(): {
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
  registerStorageProtocol({ cleanup, protocol });
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
  it("usage 只回協定五類，正本不可清", async () => {
    const { call, layout } = harness();
    put(layout, "cards/a.md", "card");
    put(layout, "cache/a.bin", "cache");
    const response = (await call("storage.usage")) as {
      usage: Array<{ category: string; bytes: number; cleanableBytes: number }>;
    };
    expect(response.usage.map((item) => item.category)).toEqual([
      "cards",
      "assets",
      "cache",
      "state",
      "logs",
    ]);
    expect(response.usage.find((item) => item.category === "cards")?.cleanableBytes).toBe(0);
  });

  it("拒絕正本類別與沒有預覽的執行", async () => {
    const { call } = harness();
    await expect(call("storage.cleanup.preview", { categories: ["cards"] })).rejects.toMatchObject({
      code: "invalid_message",
    } satisfies Partial<ProtocolHandlerError>);
    await expect(call("storage.cleanup.apply", { categories: ["cache"] })).rejects.toMatchObject({
      code: "invalid_message",
    } satisfies Partial<ProtocolHandlerError>);
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
