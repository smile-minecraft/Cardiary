import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EngineLogger, ToolBundlePin } from "@cardiary/engine-adapter";
import type { FakeModelStep } from "@cardiary/engine-fake";
import type { ModuleServices } from "@cardiary/module-api";
import type { ModuleInfo } from "@cardiary/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProtocolHandlerError, type ModuleHostBridge } from "../../src/modules/contract.js";
import { loadFirstPartyModules, type LoadedModules } from "../../src/modules/loader.js";
import { TestClient, startTestHost, waitUntil, type TestHost } from "../helpers.js";

const hosts: TestHost[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) {
    await host.close();
  }
});

async function boot(options?: Parameters<typeof startTestHost>[0]): Promise<TestHost> {
  const host = await startTestHost(options);
  hosts.push(host);
  return host;
}

async function helloClient(host: TestHost): Promise<TestClient> {
  const client = await TestClient.connect(host.url);
  const requestId = await client.hello(host.token);
  await client.waitForReply(requestId);
  return client;
}

async function createSession(client: TestClient): Promise<string> {
  const id = client.request("session.create", { clientRequestId: `cr-${Math.random()}` });
  const reply = await client.waitForReply(id);
  return (reply.payload?.session as { id: string }).id;
}

const moduleServices = {
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

class RecordingLogger implements EngineLogger {
  readonly warnings: { message: string; fields?: Record<string, unknown> }[] = [];

  debug(): void {}
  info(): void {}
  error(): void {}
  warn(message: string, fields?: Record<string, unknown>): void {
    this.warnings.push(fields === undefined ? { message } : { message, fields });
  }
}

/** 閘道分派用的替身；不經載入器，直接指定哪些型別有人處理。 */
class StubModules implements ModuleHostBridge {
  readonly exact: Set<string>;
  readonly prefixes: Set<string>;
  readonly requests: string[] = [];
  failure: Error | null = null;
  infos: ModuleInfo[] = [];

  constructor(exact: readonly string[] = [], prefixes: readonly string[] = []) {
    this.exact = new Set(exact);
    this.prefixes = new Set(prefixes);
  }

  listModules(): readonly ModuleInfo[] {
    return this.infos;
  }

  activeToolBundles(): readonly ToolBundlePin[] {
    return [];
  }

  async setModuleEnabled(moduleId: string, enabled: boolean): Promise<ModuleInfo> {
    const info = this.infos.find((entry) => entry.moduleId === moduleId);
    if (info === undefined) throw new Error("找不到模組");
    info.enabled = enabled;
    return info;
  }

  hasExactHandler(type: string): boolean {
    return this.exact.has(type);
  }

  hasPrefixHandler(type: string): boolean {
    for (const prefix of this.prefixes) {
      if (type.startsWith(`${prefix}.`)) return true;
    }
    return false;
  }

  async dispatchProtocol(request: { readonly type: string }) {
    this.requests.push(request.type);
    if (this.failure !== null) throw this.failure;
    return { handledBy: "stub", type: request.type };
  }

  async dispatchHttp() {
    return null;
  }
}

async function writeModule(
  root: string,
  id: string,
  activate: string,
  options?: { readonly hostApiVersion?: string },
): Promise<void> {
  await mkdir(join(root, id), { recursive: true });
  await writeFile(
    join(root, id, "index.js"),
    `export const hostModule = {
  manifest: {
    id: ${JSON.stringify(id)},
    name: ${JSON.stringify(id)},
    version: "1.0.0",
    hostApiVersion: ${JSON.stringify(options?.hostApiVersion ?? "1")},
    dependencies: [],
    permissions: [],
    settings: [{ key: "mode", title: "模式", kind: "string" }],
  },
  async activate(context) {
    ${activate}
  },
};
`,
  );
}

interface LoadedHarness {
  readonly host: TestHost;
  readonly modules: LoadedModules;
}

async function bootWithModules(
  setup: (root: string) => Promise<void>,
  options?: { readonly logger?: EngineLogger },
): Promise<LoadedHarness> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-gateway-modules-"));
  await setup(root);
  const host = await boot(options?.logger === undefined ? undefined : { logger: options.logger });
  const modules = await loadFirstPartyModules({
    tools: host.host.engine.tools,
    services: moduleServices,
    events: { emit: (intent) => host.host.gateway.emitIntent(intent) },
    directory: root,
  });
  host.host.gateway.setModuleHost(modules);
  return { host, modules };
}

describe("閘道分派順序", () => {
  it("精確型別 → 核心 switch → 前綴 → module.* → unsupported", async () => {
    const host = await boot();
    const stub = new StubModules(["session.archive"], ["card"]);
    host.host.gateway.setModuleHost(stub);
    host.host.gateway.registerModuleNamespace("demo", async () => ({ pong: true }));
    const client = await helloClient(host);

    const exact = client.request("session.archive", { sessionId: "s1" });
    const exactReply = await client.waitForReply(exact);
    expect((exactReply.payload as { handledBy: string }).handledBy).toBe("stub");

    // 核心型別不會被替身搶走。
    const created = client.request("session.create", { clientRequestId: "cr-order" });
    const createdReply = await client.waitForReply(created);
    expect((createdReply.payload as { session: { id: string } }).session.id).toBeTruthy();

    const prefixed = client.request("card.list", {});
    const prefixReply = await client.waitForReply(prefixed);
    expect((prefixReply.payload as { type: string }).type).toBe("card.list");

    const legacy = client.request("module.demo.ping", { data: {} });
    const legacyReply = await client.waitForReply(legacy);
    expect((legacyReply.payload as { data: { pong: boolean } }).data.pong).toBe(true);

    const unknown = client.request("board.list", {});
    const unknownReply = await client.waitForReply(unknown);
    expect(unknownReply.code).toBe("unsupported");
    expect(stub.requests).toEqual(["session.archive", "card.list"]);
    await client.close();
  });

  it("處理器丟 ProtocolHandlerError 轉成對應錯誤碼，其他例外回 internal", async () => {
    const host = await boot();
    const stub = new StubModules([], ["card"]);
    host.host.gateway.setModuleHost(stub);
    const client = await helloClient(host);

    stub.failure = new ProtocolHandlerError("not_found", "沒有這張卡。", { cardId: "c1" });
    const missing = client.request("card.get", { cardId: "c1" });
    const missingReply = await client.waitForReply(missing);
    expect(missingReply.code).toBe("not_found");
    expect(missingReply.message).toBe("沒有這張卡。");
    expect(missingReply.details).toEqual({ cardId: "c1" });

    stub.failure = new Error("內部細節不外流");
    const broken = client.request("card.list", {});
    const brokenReply = await client.waitForReply(broken);
    expect(brokenReply.code).toBe("internal");
    expect(brokenReply.message).not.toContain("內部細節");
    await client.close();
  });

  it("沒有模組主機時 system.modules.get 回空清單、set_enabled 回 unsupported", async () => {
    const host = await boot();
    // 組合根一定會接上模組主機（測試環境載入零個模組），這裡拆掉它，
    // 驗的是閘道在完全沒有模組主機時的兩個回應。
    host.host.gateway.setModuleHost(null);
    const client = await helloClient(host);
    const get = client.request("system.modules.get", {});
    const getReply = await client.waitForReply(get);
    expect((getReply.payload as { modules: unknown[] }).modules).toEqual([]);

    const set = client.request("system.modules.set_enabled", {
      moduleId: "cards",
      enabled: true,
      clientRequestId: "r1",
    });
    const setReply = await client.waitForReply(set);
    expect(setReply.code).toBe("unsupported");
    await client.close();
  });
});

describe("模組主機與閘道", () => {
  it("載入兩個模組：前綴、精確型別、HTTP 路由與 system.modules.get", async () => {
    const { host } = await bootWithModules(async (root) => {
      await writeModule(
        root,
        "cards",
        `context.services.protocol.registerNamespace("card", async (request) => ({ cards: [], type: request.type }));
         context.services.protocol.registerNamespace("session.archive", async () => ({ archived: true }));
         context.services.protocol.registerHttpRoute({
           method: "GET",
           path: "/v1/blobs/",
           handle: async (request) => ({
             status: 200,
             headers: { "content-type": "text/plain" },
             body: new TextEncoder().encode("blob:" + request.url.pathname),
           }),
         });`,
      );
      await writeModule(root, "broken", "throw new Error('壞掉了');");
    });
    const client = await helloClient(host);

    const list = client.request("card.list", {});
    const listReply = await client.waitForReply(list);
    expect((listReply.payload as { type: string }).type).toBe("card.list");

    const archive = client.request("session.archive", { sessionId: "s1" });
    const archiveReply = await client.waitForReply(archive);
    expect((archiveReply.payload as { archived: boolean }).archived).toBe(true);

    const modules = client.request("system.modules.get", {});
    const modulesReply = await client.waitForReply(modules);
    const infos = (modulesReply.payload as { modules: ModuleInfo[] }).modules;
    expect(infos.map((info) => info.moduleId)).toEqual(["broken", "cards"]);
    expect(infos[0]?.state).toBe("failed");
    expect(infos[0]?.failure).toBe("壞掉了");
    expect(infos[1]?.state).toBe("active");
    expect(infos[1]?.protocolPrefixes).toEqual(["card", "session.archive"]);
    // 沒有標分級的設定宣告一律視為 human-only。
    expect(infos[1]?.settings).toEqual([
      { key: "mode", title: "模式", kind: "string", level: "human-only" },
    ]);

    const url = `http://127.0.0.1:${host.host.port}/v1/blobs/abc`;
    const http = await fetch(url, { headers: { authorization: `Bearer ${host.token}` } });
    expect(http.status).toBe(200);
    expect(http.headers.get("content-type")).toBe("text/plain");
    expect(await http.text()).toBe("blob:/v1/blobs/abc");

    const missing = await fetch(`http://127.0.0.1:${host.host.port}/v1/other`, {
      headers: { authorization: `Bearer ${host.token}` },
    });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { code: string }).code).toBe("not_found");
    await client.close();
  });

  it("停用模組：前綴不登記、HTTP 路由消失，system.modules.changed 落地；重複停用不重送事件", async () => {
    const { host } = await bootWithModules(async (root) => {
      await writeModule(
        root,
        "cards",
        `context.services.protocol.registerNamespace("card", async () => ({ cards: [] }));
         context.services.protocol.registerHttpRoute({
           method: "GET",
           path: "/v1/blobs/",
           handle: async () => ({ status: 200, body: new Uint8Array([1]) }),
         });`,
      );
    });
    const client = await helloClient(host);
    const subscribe = client.request("system.subscribe", {});
    await client.waitForReply(subscribe);

    const disable = client.request("system.modules.set_enabled", {
      moduleId: "cards",
      enabled: false,
      clientRequestId: "r-disable",
    });
    const disabled = await client.waitForReply(disable);
    const info = (disabled.payload as { module: ModuleInfo }).module;
    expect(info.enabled).toBe(false);
    expect(info.state).toBe("inactive");
    const event = await client.waitForEvent("system.modules.changed");
    expect((event.payload as { module: ModuleInfo }).module.state).toBe("inactive");

    const list = client.request("card.list", {});
    expect((await client.waitForReply(list)).code).toBe("unsupported");
    const http = await fetch(`http://127.0.0.1:${host.host.port}/v1/blobs/x`, {
      headers: { authorization: `Bearer ${host.token}` },
    });
    expect(http.status).toBe(404);

    // 同一個狀態再設定一次：回應相同，但不重送事件。
    const before = client.frames.filter((frame) => frame.type === "system.modules.changed").length;
    const again = client.request("system.modules.set_enabled", {
      moduleId: "cards",
      enabled: false,
      clientRequestId: "r-disable-2",
    });
    expect(
      ((await client.waitForReply(again)).payload as { module: ModuleInfo }).module.state,
    ).toBe("inactive");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.frames.filter((frame) => frame.type === "system.modules.changed").length).toBe(
      before,
    );

    // 重新啟用：新的 activation 會重新註冊前綴。
    const enable = client.request("system.modules.set_enabled", {
      moduleId: "cards",
      enabled: true,
      clientRequestId: "r-enable",
    });
    const enabled = await client.waitForReply(enable);
    expect((enabled.payload as { module: ModuleInfo }).module.state).toBe("active");
    const restored = client.request("card.list", {});
    expect((await client.waitForReply(restored)).code).toBeUndefined();
    await client.close();
  });

  it("set_enabled 的參數驗證：未知模組回 not_found、缺欄位與錯型別回 invalid_message", async () => {
    const { host } = await bootWithModules(async (root) => {
      await writeModule(root, "cards", `context.services.host.provide("test", {});`);
    });
    const client = await helloClient(host);

    const unknown = client.request("system.modules.set_enabled", {
      moduleId: "nope",
      enabled: true,
      clientRequestId: "r-1",
    });
    expect((await client.waitForReply(unknown)).code).toBe("not_found");

    const wrongType = client.request("system.modules.set_enabled", {
      moduleId: "cards",
      enabled: "yes",
      clientRequestId: "r-2",
    });
    const wrongTypeReply = await client.waitForReply(wrongType);
    expect(wrongTypeReply.code).toBe("invalid_message");
    expect((wrongTypeReply.details as { field: string }).field).toBe("enabled");

    const missingKey = client.request("system.modules.set_enabled", {
      moduleId: "cards",
      enabled: true,
    });
    expect((await client.waitForReply(missingKey)).code).toBe("invalid_message");
    await client.close();
  });

  it("重複前綴讓後載入的模組 failed，先載入的保留；未知型別回 unsupported", async () => {
    const { host } = await bootWithModules(async (root) => {
      await writeModule(
        root,
        "a-cards",
        `context.services.protocol.registerNamespace("card", async () => ({ from: "a" }));`,
      );
      await writeModule(
        root,
        "b-cards",
        `context.services.protocol.registerNamespace("card", async () => ({ from: "b" }));`,
      );
    });
    const client = await helloClient(host);
    const modules = client.request("system.modules.get", {});
    const infos = ((await client.waitForReply(modules)).payload as { modules: ModuleInfo[] })
      .modules;
    expect(infos.map((info) => [info.moduleId, info.state])).toEqual([
      ["a-cards", "active"],
      ["b-cards", "failed"],
    ]);
    const list = client.request("card.list", {});
    expect((await client.waitForReply(list)).payload).toEqual({ from: "a" });
    const unknown = client.request("nothing.here", {});
    expect((await client.waitForReply(unknown)).code).toBe("unsupported");
    await client.close();
  });
});

async function writeToolModule(root: string, id: string, bundleId: string): Promise<void> {
  await writeModule(
    root,
    id,
    `context.registerToolBundle({
      bundleId: ${JSON.stringify(bundleId)},
      label: "假工具",
      tools: [
        {
          name: "fake.echo",
          description: "回傳輸入的文字",
          parameters: { type: "object" },
          replay: "safe",
          async execute(input) {
            const text =
              typeof input === "object" && input !== null && "text" in input
                ? String(input.text ?? "")
                : "";
            return { ok: true, content: [{ type: "text", text: "模組回：" + text }] };
          },
        },
      ],
    });`,
  );
}

/** 啟動一個載入了假工具模組的主機；回傳主機與模組主機。 */
async function bootWithToolModule(
  scripts: readonly (readonly FakeModelStep[])[],
): Promise<LoadedHarness> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-gateway-pin-"));
  await writeToolModule(root, "fake", "fake.tools");
  const host = await boot({ demo: false, scripts });
  const modules = await loadFirstPartyModules({
    tools: host.host.engine.tools,
    services: moduleServices,
    events: { emit: (intent) => host.host.gateway.emitIntent(intent) },
    directory: root,
  });
  host.host.gateway.setModuleHost(modules);
  return { host, modules };
}

async function subscribeSession(client: TestClient, sessionId: string): Promise<void> {
  const id = client.request("session.subscribe", { sessionId });
  await client.waitForReply(id);
}

describe("工具組釘選", () => {
  it("啟用中的模組工具組進新對話；停用後不進，工具回 tool-unavailable", async () => {
    const { host, modules } = await bootWithToolModule([
      [
        { kind: "tool", toolName: "fake.echo", input: { text: "你好" } },
        { kind: "text", text: "完成" },
      ],
      [
        { kind: "tool", toolName: "fake.echo", input: { text: "再見" } },
        { kind: "text", text: "完成" },
      ],
    ]);
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    const conversation = await host.host.engine.getConversation(sessionId);
    expect(conversation?.toolBundles).toEqual([{ bundleId: "fake.tools", generation: 1 }]);

    await subscribeSession(client, sessionId);
    client.request("session.send_message", {
      sessionId,
      text: "用工具",
      delivery: "queue",
    });
    const requested = await client.waitForEvent("approval.requested");
    const approvalId = (requested.payload as { approvalId: string }).approvalId;
    client.request("approval.decide", { approvalId, optionId: "approve" });
    const result = await client.waitForEvent("stream.tool_result");
    const payload = result.payload as {
      sessionId: string;
      status: string;
      output: { text?: string };
      diagnostics: { readonly code: string }[];
    };
    expect(payload.sessionId).toBe(sessionId);
    expect(payload.status).toBe("ok");
    expect(payload.output.text).toBe("模組回：你好");

    // 停用後：新對話不帶工具組，呼叫直接回 tool-unavailable，不會重問審批。
    await modules.setModuleEnabled("fake", false);
    const second = await helloClient(host);
    const disabledSession = await createSession(second);
    const disabledConversation = await host.host.engine.getConversation(disabledSession);
    expect(disabledConversation?.toolBundles).toEqual([]);
    await subscribeSession(second, disabledSession);
    second.request("session.send_message", {
      sessionId: disabledSession,
      text: "用工具",
      delivery: "queue",
    });
    const unavailable = await second.waitForEvent("stream.tool_result");
    const unavailablePayload = unavailable.payload as {
      sessionId: string;
      status: string;
      diagnostics: { readonly code: string }[];
    };
    expect(unavailablePayload.sessionId).toBe(disabledSession);
    expect(unavailablePayload.status).toBe("error");
    expect(unavailablePayload.diagnostics.map((entry) => entry.code)).toContain("tool_unavailable");
    expect(second.frames.some((frame) => frame.type === "approval.requested")).toBe(false);
    await second.close();
    await client.close();
  });

  it("重新啟用配發新的 generation，新對話釘選新版", async () => {
    const { host, modules } = await bootWithToolModule([
      [
        { kind: "tool", toolName: "fake.echo", input: { text: "一" } },
        { kind: "text", text: "完成" },
      ],
    ]);
    await modules.setModuleEnabled("fake", false);
    await modules.setModuleEnabled("fake", true);
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    const conversation = await host.host.engine.getConversation(sessionId);
    expect(conversation?.toolBundles).toEqual([{ bundleId: "fake.tools", generation: 2 }]);
    await client.close();
  });
});

describe("模組事件意圖", () => {
  it("card.changed 驗證後落地並廣播；壞掉的事件只記診斷", async () => {
    const logger = new RecordingLogger();
    const host = await boot({ logger });
    const client = await helloClient(host);
    const subscribe = client.request("system.subscribe", {});
    await client.waitForReply(subscribe);

    host.host.gateway.emitIntent({
      kind: "card-changed",
      cardId: "c1",
      change: "updated",
      revision: "r2",
      freshness: 80,
    });
    const event = await client.waitForEvent("card.changed");
    expect(event.payload).toEqual({
      cardId: "c1",
      change: "updated",
      revision: "r2",
      freshness: 80,
    });
    expect(event.stream).toBe("system");

    const seqBefore = host.host.gateway.streamLog.boundary("system");
    host.host.gateway.emitIntent({
      kind: "card-changed",
      cardId: "c2",
      change: "exploded" as unknown as "updated",
    });
    host.host.gateway.emitIntent({ kind: "notification", title: "t", body: "b" });
    await waitUntil(() => logger.warnings.length >= 2, 2000);
    expect(host.host.gateway.streamLog.boundary("system")).toBe(seqBefore);
    expect(logger.warnings.some((entry) => entry.message.includes("schema"))).toBe(true);
    expect(logger.warnings.some((entry) => entry.message.includes("事件意圖"))).toBe(true);
    await client.close();
  });

  it("會話事件同時掛在 system 與該會話串流；payload 的會話必須一致", async () => {
    const host = await boot();
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    const systemSubscribe = client.request("system.subscribe", {});
    await client.waitForReply(systemSubscribe);
    const sessionSubscribe = client.request("session.subscribe", { sessionId });
    await client.waitForReply(sessionSubscribe);

    host.host.gateway.emitIntent({
      kind: "session-lifecycle",
      conversationId: sessionId,
      event: "unarchived",
      payload: { sessionId },
    });
    const systemEvent = await client.waitForEvent("session.unarchived");
    expect(systemEvent.stream).toBe("system");
    const sessionEvent = await client.waitFor(
      (frame) =>
        frame.kind === "event" &&
        frame.type === "session.unarchived" &&
        frame.stream === `session:${sessionId}`,
    );
    // 兩個串流各自配號；payload 相同，序號不互相影響。
    expect(typeof sessionEvent.seq).toBe("number");
    expect(typeof systemEvent.seq).toBe("number");
    expect(sessionEvent.payload).toEqual(systemEvent.payload);

    const seqBefore = host.host.gateway.streamLog.boundary(`session:${sessionId}`);
    host.host.gateway.emitIntent({
      kind: "session-lifecycle",
      conversationId: sessionId,
      event: "archived",
      payload: { sessionId: "someone-else" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host.host.gateway.streamLog.boundary(`session:${sessionId}`)).toBe(seqBefore);
    await client.close();
  });

  it("context.changed 的巢狀內容也驗；模組事件走 module.* 型別", async () => {
    const logger = new RecordingLogger();
    const host = await boot({ logger });
    const client = await helloClient(host);
    const sessionId = await createSession(client);
    const systemSubscribe = client.request("system.subscribe", {});
    await client.waitForReply(systemSubscribe);
    const subscribe = client.request("session.subscribe", { sessionId });
    await client.waitForReply(subscribe);

    host.host.gateway.emitIntent({
      kind: "context-changed",
      conversationId: sessionId,
      context: {
        sessionId,
        version: 1,
        entries: [],
        usedTokens: 0,
        budgetTokens: 1000,
        contextWindow: 2000,
        compactionThreshold: 0.75,
      },
    });
    const event = await client.waitForEvent("context.changed");
    expect((event.payload as { sessionId: string }).sessionId).toBe(sessionId);

    const seqBefore = host.host.gateway.streamLog.boundary(`session:${sessionId}`);
    host.host.gateway.emitIntent({
      kind: "context-changed",
      conversationId: sessionId,
      context: { sessionId, version: 1, entries: "not-an-array" },
    });
    await waitUntil(() => logger.warnings.length > 0, 2000);
    expect(host.host.gateway.streamLog.boundary(`session:${sessionId}`)).toBe(seqBefore);

    host.host.gateway.emitIntent({
      kind: "module-event",
      type: "module.demo.changed",
      payload: { value: 1 },
    });
    const moduleEvent = await client.waitForEvent("module.demo.changed");
    expect(moduleEvent.payload).toEqual({ data: { value: 1 } });
    await client.close();
  });
});
