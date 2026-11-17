import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type {
  ModuleActivationContext,
  ModuleServices,
  ProtocolRequestContext,
} from "@cardiary/module-api";
import { Storage } from "@cardiary/storage";

import {
  HOST_SERVICE_NAMES,
  type CardEnvironment,
  type ExternalAgentsUsageService,
} from "../../../src/modules/contract.js";
import { HostServiceRegistryImpl, ScopedHostServices } from "../../../src/modules/registry.js";
import { hostModule as storageModule } from "../../../src/modules/storage/index.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

const injected = [
  { path: "/home/u/.claude/projects", tool: "claude-code", status: "measured", bytes: 4096 },
] as const;

/**
 * 用真的服務註冊表激活 storage 模組，抓下協定處理器，驗證 outsideWrites 是每次
 * 呼叫即時讀服務：activate 時沒有就省略，較晚 provide 拿得到，withdraw 後再省略。
 */
describe("storage 模組的外部用量 lazy 接線", () => {
  it("activate 時省略，provide 後可見，withdraw 後再省略", async () => {
    const root = mkdtempSync(join(tmpdir(), "cardiary-storage-wiring-"));
    const storage = Storage.open({ path: root, initialize: true, appVersion: "test" });
    cleanups.push(() => {
      storage.close();
      rmSync(root, { recursive: true, force: true });
    });
    const cabinet: CardEnvironment = {
      layout: storage.layout,
      state: storage.state,
      cache: () => storage.cache,
      settings: storage.settings,
      ownsConnections: false,
      close: () => {},
    };

    const registry = new HostServiceRegistryImpl();
    registry.provide(HOST_SERVICE_NAMES.cardStorage, cabinet);
    const storageHost = new ScopedHostServices(registry, "storage");
    const agents = new ScopedHostServices(registry, "external-agents");

    const handlers = new Map<string, (request: ProtocolRequestContext) => Promise<unknown>>();
    const services = {
      protocol: {
        emit: () => undefined,
        registerNamespace: (
          namespace: string,
          handler: (request: ProtocolRequestContext) => Promise<unknown>,
        ) => {
          handlers.set(namespace, handler);
          return { dispose: () => handlers.delete(namespace) };
        },
        registerHttpRoute: () => ({ dispose: () => undefined }),
      },
      clock: { now: () => new Date("2026-11-15T00:00:00.000Z") },
      host: storageHost,
    } as unknown as ModuleServices;
    const context = {
      identity: { id: "storage", version: "0.1.0", generation: 1 },
      services,
      registerToolBundle: () => ({ registrationId: "bundle", dispose: async () => undefined }),
      registerContextSection: () => ({ registrationId: "section", dispose: async () => undefined }),
      registerHook: () => ({ registrationId: "hook", dispose: async () => undefined }),
      registerSchedule: () => ({ registrationId: "schedule", dispose: async () => undefined }),
    } as unknown as ModuleActivationContext;

    await storageModule.activate(context);
    const call = async (): Promise<Record<string, unknown>> => {
      const handler = handlers.get("storage");
      if (handler === undefined) throw new Error("沒有 storage 處理器");
      return (await handler({
        type: "storage.usage",
        payload: {},
        clientId: "device-1",
      } as ProtocolRequestContext)) as Record<string, unknown>;
    };

    // activate 當下還沒有 externalAgentsUsage。
    expect("outsideWrites" in (await call())).toBe(false);

    // 較晚提供：每次呼叫即時讀，拿得到明細。
    agents.provide(HOST_SERVICE_NAMES.externalAgentsUsage, {
      outsideWrites: async () => injected,
    } satisfies ExternalAgentsUsageService);
    expect((await call()).outsideWrites).toEqual(injected);

    // 停用外部代理模組：withdraw 後拿到 undefined，省略欄位。
    agents.withdraw();
    expect("outsideWrites" in (await call())).toBe(false);
  });
});
