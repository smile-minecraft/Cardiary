import { describe, expect, it } from "vitest";

import type {
  HostModule,
  ModuleActivationContext,
  ModuleManifest,
  ModuleServices,
  ScheduleDeclaration,
  ToolBundle,
  ToolBundleId,
  ToolBundleState,
  ToolGeneration,
  ToolRegistry,
} from "@cardiary/module-api";

import { ProtocolHandlerError } from "../../../src/modules/contract.js";
import {
  CONTRIBUTIONS_SERVICE_NAME,
  HostServiceConflict,
  HostModuleRegistry,
  HostServiceMissing,
  HostServiceRegistryImpl,
  HttpRouter,
  HttpRouteRegistrationError,
  ProtocolRegistrationError,
  ProtocolRouter,
  ScopedHostServices,
  type ModuleContributions,
} from "../../../src/modules/registry.js";

/** 記錄註冊與退役次數的假工具註冊表。 */
class RecordingTools implements ToolRegistry {
  readonly registered: string[] = [];
  readonly retired: string[] = [];

  async register(bundle: ToolBundle): Promise<void> {
    this.registered.push(`${bundle.bundleId}@${bundle.generation}`);
  }

  async retire(bundleId: ToolBundleId, generation: ToolGeneration): Promise<void> {
    this.retired.push(`${bundleId}@${generation}`);
  }

  async list(): Promise<readonly ToolBundleState[]> {
    return [];
  }
}

const baseServices = {
  models: { invoke: async () => ({ text: "" }) },
  backgroundTasks: {
    run: async () => ({ conversationId: "x", status: "completed", summary: null }),
  },
  storage: { dataDir: "/tmp/data", cacheDir: "/tmp/cache", tempDir: "/tmp/temp" },
  paths: {
    root: "/tmp",
    cards: "/tmp/cards",
    assets: "/tmp/assets",
    boards: "/tmp/boards",
    skills: "/tmp/skills",
    state: "/tmp/state",
    modules: "/tmp/modules",
    cache: "/tmp/cache",
    tmp: "/tmp/tmp",
    logs: "/tmp/logs",
  },
  settings: { get: () => undefined, getLevel: () => "free" as const, onChange: () => () => {} },
  secrets: { withSecret: async (_ref, use) => use("secret") },
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  clock: { now: () => new Date() },
} as unknown as ModuleServices;

function manifestOf(id: string, overrides: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    hostApiVersion: "1",
    dependencies: [],
    permissions: [],
    settings: [{ key: "mode", title: "模式", kind: "string" }],
    ...overrides,
  };
}

interface RegistryHarness {
  readonly registry: HostModuleRegistry;
  readonly tools: RecordingTools;
  readonly events: { readonly emitted: unknown[] };
  readonly warns: Array<{ readonly message: string; readonly fields: unknown }>;
}

function makeRegistry(): RegistryHarness {
  const tools = new RecordingTools();
  const emitted: unknown[] = [];
  const warns: Array<{ readonly message: string; readonly fields: unknown }> = [];
  const registry = new HostModuleRegistry({
    tools,
    services: baseServices,
    events: { emit: (intent) => emitted.push(intent) },
    warn: (message, fields) => warns.push({ message, fields }),
  });
  return { registry, tools, events: { emitted }, warns };
}

/** 測試用的排程宣告；觸發方式不影響這裡要驗的通知。 */
function scheduleOf(scheduleId: string): ScheduleDeclaration {
  return {
    scheduleId,
    title: scheduleId,
    trigger: { kind: "interval", everyMs: 5 * 60_000 },
    defaultEnabled: true,
    requiresApproval: false,
    async run() {
      return;
    },
  };
}

describe("模組服務註冊表", () => {
  it("provide 之後 get 拿得到、require 拿不到時丟錯；重複 provide 是錯誤", () => {
    const services = new HostServiceRegistryImpl();
    services.provide("test.storage", { marker: "storage" });
    expect(services.get("test.storage")).toEqual({ marker: "storage" });
    expect(services.get("test.cards")).toBeUndefined();
    expect(() => services.require("test.cards")).toThrow(HostServiceMissing);
    expect(() => services.provide("test.storage", { marker: "second" })).toThrow(
      HostServiceConflict,
    );
    expect(services.names()).toEqual(["test.storage"]);
  });

  it("模組提供的服務記在模組名下，停用只撤銷自己的", () => {
    const parent = new HostServiceRegistryImpl();
    parent.provide("test.engine", { marker: "engine" });
    const cards = new ScopedHostServices(parent, "cards");
    const context = new ScopedHostServices(parent, "context");
    cards.provide("test.cards", { marker: "cards" });
    context.provide("test.context", { marker: "context" });

    expect(parent.get("test.cards")).toEqual({ marker: "cards" });
    cards.withdraw();
    cards.withdraw();
    expect(parent.get("test.cards")).toBeUndefined();
    expect(parent.get("test.context")).toEqual({ marker: "context" });
    expect(parent.get("test.engine")).toEqual({ marker: "engine" });
    // 撤銷後別的模組可以接同名服務。
    context.provide("test.cards", { marker: "second" });
    expect(parent.get("test.cards")).toEqual({ marker: "second" });
  });
});

describe("協定處理器表", () => {
  it("不同前綴各自處理；未知型別回 not_found", async () => {
    const router = new ProtocolRouter();
    router.register("cards", "card", async () => ({ from: "cards" }));
    router.register("context", "context", async () => ({ from: "context" }));

    const call = (type: string) =>
      router.dispatch({ type, payload: {}, clientId: "test" }) as Promise<{ from: string }>;
    expect(await call("card.list")).toEqual({ from: "cards" });
    expect(await call("context.get")).toEqual({ from: "context" });
    await expect(call("board.list")).rejects.toBeInstanceOf(ProtocolHandlerError);
  });

  it("最長前綴優先，精確型別優先於前綴", async () => {
    const router = new ProtocolRouter();
    router.register("cards", "card", async () => ({ from: "card" }));
    router.register("cards", "card.special", async () => ({ from: "card.special" }));
    router.register("lifecycle", "session.archive", async () => ({ from: "session.archive" }));

    const call = (type: string) =>
      router.dispatch({ type, payload: {}, clientId: "test" }) as Promise<{ from: string }>;
    expect(await call("card.list")).toEqual({ from: "card" });
    expect(await call("card.special.list")).toEqual({ from: "card.special" });
    expect(await call("session.archive")).toEqual({ from: "session.archive" });
    expect(router.hasExact("session.archive")).toBe(true);
    expect(router.hasExact("session.archive.extra")).toBe(false);
    expect(router.hasPrefix("session.archive.extra")).toBe(true);
  });

  it("重複登記、保留型別與不合法的名稱都被拒絕", () => {
    const router = new ProtocolRouter();
    router.register("cards", "card", async () => ({}));
    expect(() => router.register("cards-2", "card", async () => ({}))).toThrow(
      ProtocolRegistrationError,
    );
    for (const reserved of [
      "card",
      "system.hello",
      "system",
      "session.create",
      "approval.decide",
      "system.modules.get",
    ]) {
      if (reserved === "card") continue;
      expect(() => router.register("bad", reserved, async () => ({}))).toThrow(
        ProtocolRegistrationError,
      );
    }
    expect(() => router.register("bad", "Bad Name", async () => ({}))).toThrow(
      ProtocolRegistrationError,
    );
  });

  it("撤銷 handle 之後型別回到未登記，可以重新登記", async () => {
    const router = new ProtocolRouter();
    const handle = router.register("cards", "card", async () => ({ from: "first" }));
    expect(router.hasPrefix("card.list")).toBe(true);
    handle.dispose();
    handle.dispose();
    expect(router.hasPrefix("card.list")).toBe(false);
    router.register("cards-2", "card", async () => ({ from: "second" }));
    const payload = (await router.dispatch({
      type: "card.list",
      payload: {},
      clientId: "test",
    })) as { from: string };
    expect(payload.from).toBe("second");
  });
});

describe("HTTP 路由表", () => {
  it("同一個 method 與路徑重複登記被拒；精確路徑優先於前綴", () => {
    const router = new HttpRouter();
    router.register("media", {
      method: "GET",
      path: "/v1/blobs/",
      handle: async () => ({ status: 200 }),
    });
    expect(() =>
      router.register("media", {
        method: "GET",
        path: "/v1/blobs/",
        handle: async () => ({ status: 200 }),
      }),
    ).toThrow(HttpRouteRegistrationError);
    router.register("media", {
      method: "GET",
      path: "/v1/blobs/special",
      handle: async () => ({ status: 201 }),
    });

    const exact = router.find("GET", "/v1/blobs/special");
    const prefix = router.find("GET", "/v1/blobs/abc");
    expect(prefix?.path).toBe("/v1/blobs/");
    expect(exact?.path).toBe("/v1/blobs/special");
    expect(router.find("POST", "/v1/blobs/abc")).toBeNull();
    expect(router.routesOf("media")).toEqual(["GET /v1/blobs/", "GET /v1/blobs/special"]);
  });
});

describe("模組生命週期", () => {
  it("撤銷工具組會移除釘選，舊手把不會撤銷重新註冊的工具組", async () => {
    const { registry, tools } = makeRegistry();
    const captured: { context?: ModuleActivationContext } = {};
    await registry.load({
      manifest: manifestOf("mcp"),
      activate(context) {
        captured.context = context;
      },
    });
    await registry.activate("mcp");
    const context = captured.context!;
    const draft = { bundleId: "mcp:server", label: "server", tools: [] };
    const first = context.registerToolBundle(draft);
    expect(registry.activeToolBundles()).toEqual([{ bundleId: "mcp:server", generation: 1 }]);
    const second = context.registerToolBundle(draft);
    expect(registry.activeToolBundles()).toEqual([{ bundleId: "mcp:server", generation: 1 }]);
    await first.dispose();
    await first.dispose();
    expect(registry.activeToolBundles()).toEqual([{ bundleId: "mcp:server", generation: 1 }]);
    expect(tools.retired).toEqual([]);
    await second.dispose();
    await second.dispose();
    expect(registry.activeToolBundles()).toEqual([]);
    expect(tools.retired).toEqual(["mcp:server@1"]);
    const third = context.registerToolBundle(draft);
    expect(registry.activeToolBundles()).toEqual([{ bundleId: "mcp:server", generation: 1 }]);
    await third.dispose();
    expect(registry.activeToolBundles()).toEqual([]);
    expect(tools.retired).toEqual(["mcp:server@1", "mcp:server@1"]);
  });

  it("啟用註冊、停用由主機銷毀每個 handle 一次，模組不自行銷毀也不重複", async () => {
    const { registry, tools } = makeRegistry();
    const captured: { handle: { dispose(): Promise<void> } | null } = { handle: null };
    let deactivateCount = 0;
    const module: HostModule = {
      manifest: manifestOf("cards"),
      activate(context) {
        const toolsHandle = context.registerToolBundle({
          bundleId: "cards.tools",
          label: "卡片工具",
          tools: [],
        });
        const protocolHandle = context.services.protocol.registerNamespace("card", async () => ({
          ok: true,
        }));
        // 模擬模組自己的停用處理器：不在這裡銷毀，交給主機。
        captured.handle = toolsHandle;
        void protocolHandle;
      },
      deactivate() {
        deactivateCount += 1;
      },
    };
    await registry.load(module);
    const active = await registry.activate("cards");
    expect(active.state).toBe("active");
    expect(tools.registered).toEqual(["cards.tools@1"]);
    expect(registry.protocol.hasPrefix("card.list")).toBe(true);

    await registry.deactivate("cards", { reason: "user" });
    expect(deactivateCount).toBe(1);
    expect(tools.retired).toEqual(["cards.tools@1"]);
    expect(registry.protocol.hasPrefix("card.list")).toBe(false);
    // 第二次停用被狀態擋下，不會再銷毀一次。
    await expect(registry.deactivate("cards", { reason: "user" })).rejects.toThrow(/沒有啟用/);
    expect(tools.retired).toEqual(["cards.tools@1"]);
    // 模組自己先呼叫 handle.dispose 也不會讓主機重複銷毀。
    await captured.handle?.dispose();
    expect(tools.retired).toEqual(["cards.tools@1"]);
  });

  it("啟用中的模組提供工具組版本；停用後清空，重新啟用配發新 generation", async () => {
    const { registry } = makeRegistry();
    await registry.load({
      manifest: manifestOf("cards"),
      activate(context) {
        context.registerToolBundle({ bundleId: "cards.tools", label: "卡片工具", tools: [] });
        context.registerToolBundle({ bundleId: "cards.tips", label: "卡片提示", tools: [] });
      },
    });
    await registry.load({
      manifest: manifestOf("local-tools"),
      activate(context) {
        context.registerToolBundle({ bundleId: "local-tools", label: "本機工具", tools: [] });
      },
    });
    await registry.activate("cards");
    await registry.activate("local-tools");
    expect(registry.activeToolBundles()).toEqual([
      { bundleId: "cards.tools", generation: 1 },
      { bundleId: "cards.tips", generation: 1 },
      { bundleId: "local-tools", generation: 2 },
    ]);

    await registry.deactivate("cards", { reason: "user" });
    expect(registry.activeToolBundles()).toEqual([{ bundleId: "local-tools", generation: 2 }]);

    await registry.activate("cards");
    expect(registry.activeToolBundles()).toEqual([
      { bundleId: "cards.tools", generation: 3 },
      { bundleId: "cards.tips", generation: 3 },
      { bundleId: "local-tools", generation: 2 },
    ]);
  });

  it("載入失敗、停用與尚未啟用的模組不提供工具組", async () => {
    const { registry } = makeRegistry();
    const healthy: HostModule = {
      manifest: manifestOf("healthy"),
      activate(context) {
        context.registerToolBundle({ bundleId: "healthy.tools", label: "好", tools: [] });
      },
    };
    const broken: HostModule = {
      manifest: manifestOf("broken"),
      activate(context) {
        context.registerToolBundle({
          bundleId: "broken.tools",
          label: "壞",
          tools: [],
        });
        throw new Error("壞掉了");
      },
    };
    await registry.load(broken);
    await registry.load(healthy, { inactive: true });
    await registry.activate("broken");
    expect(registry.activeToolBundles()).toEqual([]);
    await registry.activate("healthy");
    expect(registry.activeToolBundles()).toEqual([{ bundleId: "healthy.tools", generation: 2 }]);
  });

  it("重新啟用配發新的 generation；服務提供在停用後撤銷", async () => {
    const { registry } = makeRegistry();
    const module: HostModule = {
      manifest: manifestOf("cards"),
      activate(context) {
        context.services.host.provide("cards", { generation: context.identity.generation });
        context.services.protocol.registerNamespace("card", async () => ({}));
      },
    };
    await registry.load(module);
    const first = await registry.activate("cards");
    expect(first.identity.generation).toBe(1);
    expect(registry.hostServices.get<{ generation: number }>("cards")).toEqual({ generation: 1 });
    await registry.deactivate("cards", { reason: "user" });
    expect(registry.hostServices.get("cards")).toBeUndefined();
    const second = await registry.activate("cards");
    expect(second.identity.generation).toBe(2);
    expect(registry.hostServices.get<{ generation: number }>("cards")).toEqual({ generation: 2 });
  });

  it("重載：舊的註冊先被撤銷一次，新的 generation 重新註冊", async () => {
    const { registry, tools } = makeRegistry();
    let deactivateCount = 0;
    const module: HostModule = {
      manifest: manifestOf("cards"),
      activate(context) {
        context.registerToolBundle({ bundleId: "cards.tools", label: "卡片工具", tools: [] });
        context.services.protocol.registerNamespace("card", async () => ({}));
      },
      deactivate() {
        deactivateCount += 1;
      },
    };
    await registry.load(module);
    const first = await registry.activate("cards");
    const result = await registry.reload("cards");
    expect(deactivateCount).toBe(1);
    expect(result.previousGeneration).toBe(first.identity.generation);
    expect(result.identity.generation).toBe(first.identity.generation + 1);
    expect(tools.registered).toEqual(["cards.tools@1", "cards.tools@2"]);
    expect(tools.retired).toEqual(["cards.tools@1"]);
    expect(registry.protocol.keysOf("cards")).toEqual(["card"]);
  });

  it("啟用失敗隔離：模組進 failed，其他模組照常，失敗的註冊被撤銷", async () => {
    const { registry, tools } = makeRegistry();
    const broken: HostModule = {
      manifest: manifestOf("broken"),
      activate(context) {
        context.registerToolBundle({ bundleId: "broken.tools", label: "壞掉", tools: [] });
        context.services.protocol.registerNamespace("broken", async () => ({}));
        throw new Error("壞掉了");
      },
    };
    const healthy: HostModule = {
      manifest: manifestOf("healthy"),
      activate(context) {
        context.services.protocol.registerNamespace("healthy", async () => ({}));
      },
    };
    await registry.load(broken);
    await registry.load(healthy);
    await registry.activate("broken");
    await registry.activate("healthy");

    const record = registry.record("broken");
    expect(record?.state).toBe("failed");
    expect(record?.failure?.message).toBe("壞掉了");
    expect(registry.protocol.hasPrefix("broken.x")).toBe(false);
    expect(tools.retired).toEqual(["broken.tools@1"]);
    expect(registry.record("healthy")?.state).toBe("active");
    expect(registry.protocol.hasPrefix("healthy.x")).toBe(true);
  });

  it("重複前綴讓後啟用的模組 failed，先啟用的保留", async () => {
    const { registry } = makeRegistry();
    await registry.load({
      manifest: manifestOf("cards"),
      activate(context) {
        context.services.protocol.registerNamespace("card", async () => ({ from: "cards" }));
      },
    });
    await registry.load({
      manifest: manifestOf("cards-two"),
      activate(context) {
        context.services.protocol.registerNamespace("card", async () => ({ from: "cards-two" }));
      },
    });
    await registry.activate("cards");
    const second = await registry.activate("cards-two");
    expect(second.state).toBe("failed");
    expect(second.failure?.message).toContain("card");
    expect(registry.protocol.hasPrefix("card.list")).toBe(true);
    expect(registry.record("cards")?.state).toBe("active");
  });

  it("相依模組先啟用；相依的模組停用後才輪到自己", async () => {
    const { registry } = makeRegistry();
    const order: string[] = [];
    await registry.load({
      manifest: manifestOf("base"),
      activate() {
        order.push("base");
      },
    });
    await registry.load({
      manifest: manifestOf("uses-base", {
        dependencies: [{ moduleId: "base", versionRange: "^1.0.0" }],
      }),
      activate() {
        order.push("uses-base");
      },
    });
    await registry.activate("base");
    await registry.activate("uses-base");
    expect(order).toEqual(["base", "uses-base"]);
    await expect(registry.deactivate("base", { reason: "user" })).rejects.toThrow(/仍有模組相依/);
    await registry.deactivate("base", { reason: "user", cascade: true });
    expect(registry.record("base")?.state).toBe("inactive");
    expect(registry.record("uses-base")?.state).toBe("inactive");
  });
});

describe("排程變更通知", () => {
  it("模組註冊與停用排程時通知訂閱者，取消訂閱後不再通知", async () => {
    const { registry } = makeRegistry();
    const contributions = registry.hostServices.require<ModuleContributions>(
      CONTRIBUTIONS_SERVICE_NAME,
    );
    const seen: string[][] = [];
    const unsubscribe = contributions.onSchedulesChanged(() => {
      seen.push(contributions.schedules().map((schedule) => schedule.scheduleId));
    });
    await registry.load({
      manifest: manifestOf("memory"),
      activate(context) {
        context.registerSchedule(scheduleOf("memory.distillation.daily"));
      },
    });
    // 載入只檢查描述檔，還沒有宣告。
    expect(seen).toEqual([]);

    await registry.activate("memory");
    expect(seen).toEqual([["memory.distillation.daily"]]);
    expect(contributions.schedules()).toHaveLength(1);

    unsubscribe();
    await registry.deactivate("memory", { reason: "user" });
    expect(seen).toEqual([["memory.distillation.daily"]]);
    expect(contributions.schedules()).toEqual([]);
  });

  it("啟用失敗時移除已註冊的宣告並通知，監聽者丟錯不影響生命週期", async () => {
    const { registry, warns } = makeRegistry();
    const contributions = registry.hostServices.require<ModuleContributions>(
      CONTRIBUTIONS_SERVICE_NAME,
    );
    const seen: number[] = [];
    contributions.onSchedulesChanged(() => {
      seen.push(contributions.schedules().length);
      throw new Error("監聽壞了");
    });
    const module: HostModule = {
      manifest: manifestOf("memory"),
      activate(context) {
        context.registerSchedule(scheduleOf("memory.distillation.daily"));
        throw new Error("模組壞了");
      },
    };
    await registry.load(module);
    const failed = await registry.activate("memory");
    expect(failed.state).toBe("failed");
    // 註冊時通知一次（1 筆），啟用失敗清掉 handle 再通知一次（0 筆）。
    expect(seen).toEqual([1, 0]);
    expect(contributions.schedules()).toEqual([]);
    expect(warns.map((entry) => entry.message)).toEqual([
      "排程變更通知失敗",
      "排程變更通知失敗",
      "模組啟用失敗",
    ]);
  });

  it("關閉主機時停用模組不通知；宣告消失只在使用者停用模組時才算", async () => {
    const { registry } = makeRegistry();
    const contributions = registry.hostServices.require<ModuleContributions>(
      CONTRIBUTIONS_SERVICE_NAME,
    );
    const seen: number[] = [];
    contributions.onSchedulesChanged(() => {
      seen.push(contributions.schedules().length);
    });
    await registry.load({
      manifest: manifestOf("memory"),
      activate(context) {
        context.registerSchedule(scheduleOf("memory.distillation.daily"));
      },
    });
    await registry.activate("memory");
    expect(seen).toEqual([1]);

    // 關機不是宣告被移除：排程列要留著，下次啟動才能補跑錯過的時段。
    await registry.deactivateAll("shutdown");
    expect(seen).toEqual([1]);
    expect(contributions.schedules()).toEqual([]);
  });
});
