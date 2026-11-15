import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModuleServices, ToolBundleState, ToolRegistry } from "@cardiary/module-api";
import { describe, expect, it } from "vitest";

import {
  MemoryModuleEnablementSettings,
  loadFirstPartyModules,
  type LoadedModules,
} from "../../../src/modules/loader.js";
import { ProtocolHandlerError } from "../../../src/modules/contract.js";

class NoopTools implements ToolRegistry {
  async register(): Promise<void> {}

  async retire(): Promise<void> {}

  async list(): Promise<readonly ToolBundleState[]> {
    return [];
  }
}

const services = {
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

async function makeModuleRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cardiary-modules-"));
}

interface ModuleSourceOptions {
  readonly id: string;
  readonly version?: string;
  readonly hostApiVersion?: string;
  readonly dependencies?: readonly string[];
  readonly activate: string;
  readonly deactivate?: string;
  readonly exports?: string;
}

async function writeModule(root: string, options: ModuleSourceOptions): Promise<void> {
  await mkdir(join(root, options.id), { recursive: true });
  const dependencies = (options.dependencies ?? [])
    .map((moduleId) => `{ moduleId: ${JSON.stringify(moduleId)}, versionRange: "^1.0.0" }`)
    .join(", ");
  const source = `
export const hostModule = {
  manifest: {
    id: ${JSON.stringify(options.id)},
    name: ${JSON.stringify(options.id)},
    version: ${JSON.stringify(options.version ?? "1.0.0")},
    hostApiVersion: ${JSON.stringify(options.hostApiVersion ?? "1")},
    dependencies: [${dependencies}],
    permissions: [],
    settings: [],
  },
  async activate(context) {
    ${options.activate}
  },${options.deactivate === undefined ? "" : `\n  async deactivate(context) { ${options.deactivate} },`}
};
${options.exports ?? ""}
`;
  await writeFile(join(root, options.id, "index.js"), source);
}

async function load(
  root: string,
  options?: { readonly disabled?: readonly string[] },
): Promise<LoadedModules> {
  return loadFirstPartyModules({
    tools: new NoopTools(),
    services,
    events: { emit: () => {} },
    directory: root,
    settings: new MemoryModuleEnablementSettings(options?.disabled ?? []),
  });
}

const registerPrefix = (prefix: string): string =>
  `context.services.protocol.registerNamespace(${JSON.stringify(prefix)}, async (request) => ({ prefix: ${JSON.stringify(prefix)}, type: request.type }));`;

describe("第一方模組載入器", () => {
  it("掃描目錄、兩個模組註冊不同前綴、重複前綴使後者 failed", async () => {
    const root = await makeModuleRoot();
    await writeModule(root, { id: "alpha", activate: registerPrefix("alpha") });
    await writeModule(root, { id: "beta", activate: registerPrefix("alpha") });
    await writeModule(root, { id: "gamma", activate: registerPrefix("gamma") });

    const modules = await load(root);
    const infos = modules.listModules();
    expect(infos.map((info) => info.moduleId)).toEqual(["alpha", "beta", "gamma"]);
    expect(infos.map((info) => info.state)).toEqual(["active", "failed", "active"]);
    expect(infos[1]?.failure).toContain("alpha");
    expect(infos[0]?.protocolPrefixes).toEqual(["alpha"]);
    expect(modules.hasPrefixHandler("alpha.list")).toBe(true);
    expect(modules.hasPrefixHandler("gamma.list")).toBe(true);
    await modules.deactivateAll();
  });

  it("停用的模組仍載入但不啟用；重新啟用才註冊", async () => {
    const root = await makeModuleRoot();
    await writeModule(root, { id: "gamma", activate: registerPrefix("gamma") });
    const modules = await load(root, { disabled: ["gamma"] });

    const before = modules.listModules()[0];
    expect(before?.enabled).toBe(false);
    expect(before?.state).toBe("inactive");
    expect(modules.hasPrefixHandler("gamma.list")).toBe(false);

    const enabled = await modules.setModuleEnabled("gamma", true);
    expect(enabled.enabled).toBe(true);
    expect(enabled.state).toBe("active");
    expect(modules.hasPrefixHandler("gamma.list")).toBe(true);

    const disabled = await modules.setModuleEnabled("gamma", false);
    expect(disabled.state).toBe("inactive");
    expect(modules.hasPrefixHandler("gamma.list")).toBe(false);
    // 同一個狀態重複設定是安全的，不會重新啟用。
    expect((await modules.setModuleEnabled("gamma", false)).state).toBe("inactive");
    await modules.deactivateAll();
  });

  it("一個模組壞掉不影響其他：import 失敗與描述檔不合法都只影響自己", async () => {
    const root = await makeModuleRoot();
    await writeModule(root, { id: "healthy", activate: registerPrefix("healthy") });
    await writeModule(root, {
      id: "throws",
      activate: "throw new Error('啟動失敗');",
    });
    await writeModule(root, {
      id: "wrong-api",
      hostApiVersion: "2",
      activate: registerPrefix("wrong"),
    });
    await mkdir(join(root, "broken-import"), { recursive: true });
    await writeFile(join(root, "broken-import", "index.js"), "throw new Error('匯入失敗');\n");

    const modules = await load(root);
    const byId = new Map(modules.listModules().map((info) => [info.moduleId, info]));
    expect(byId.get("healthy")?.state).toBe("active");
    expect(byId.get("throws")?.state).toBe("failed");
    expect(byId.get("throws")?.failure).toBe("啟動失敗");
    expect(byId.get("wrong-api")?.state).toBe("failed");
    expect(byId.get("wrong-api")?.failure).toContain("主機介面");
    expect(byId.get("broken-import")?.state).toBe("failed");
    expect(byId.get("broken-import")?.failure).toBe("匯入失敗");
    await modules.deactivateAll();
  });

  it("相依模組先啟用；缺少相依的模組 failed", async () => {
    const root = await makeModuleRoot();
    const orderFile = join(root, "order.txt");
    await writeModule(root, {
      id: "base",
      activate: `await (await import("node:fs/promises")).appendFile(${JSON.stringify(orderFile)}, "base\\n");`,
    });
    await writeModule(root, {
      id: "uses-base",
      dependencies: ["base"],
      activate: `await (await import("node:fs/promises")).appendFile(${JSON.stringify(orderFile)}, "uses-base\\n");`,
    });
    await writeModule(root, {
      id: "orphan",
      dependencies: ["missing"],
      activate: registerPrefix("orphan"),
    });

    const modules = await load(root);
    const byId = new Map(modules.listModules().map((info) => [info.moduleId, info]));
    expect(byId.get("base")?.state).toBe("active");
    expect(byId.get("uses-base")?.state).toBe("active");
    expect(byId.get("orphan")?.state).toBe("failed");
    expect(byId.get("orphan")?.failure).toContain("missing");
    const order = await import("node:fs/promises").then((fs) => fs.readFile(orderFile, "utf8"));
    expect(order.trim().split("\n")).toEqual(["base", "uses-base"]);
    await modules.deactivateAll();
  });

  it("相依模組先提供服務，後面的模組在啟用時拿得到", async () => {
    const root = await makeModuleRoot();
    await writeModule(root, {
      id: "provider",
      activate: `context.services.host.provide("test.shared", { value: 42 });`,
    });
    await writeModule(root, {
      id: "consumer",
      dependencies: ["provider"],
      activate: `const service = context.services.host.require("test.shared");
        if (service.value !== 42) throw new Error("沒拿到服務");`,
    });
    const modules = await load(root);
    const byId = new Map(modules.listModules().map((info) => [info.moduleId, info]));
    expect(byId.get("provider")?.state).toBe("active");
    expect(byId.get("consumer")?.state).toBe("active");
    expect(modules.hostServices.get<{ value: number }>("test.shared")).toEqual({ value: 42 });
    await modules.deactivateAll();
    expect(modules.hostServices.get("test.shared")).toBeUndefined();
  });

  it("沒有登記的型別回 not_found；HTTP 沒有路由回 null", async () => {
    const root = await makeModuleRoot();
    await writeModule(root, {
      id: "blobs",
      activate: `context.services.protocol.registerHttpRoute({
        method: "GET",
        path: "/v1/blobs/",
        handle: async (request) => ({ status: 200, body: new TextEncoder().encode(request.url.pathname) }),
      });`,
    });
    const modules = await load(root);
    await expect(
      modules.dispatchProtocol({ type: "card.list", payload: {}, clientId: "test" }),
    ).rejects.toBeInstanceOf(ProtocolHandlerError);

    const url = new URL("http://127.0.0.1/v1/blobs/abc");
    const response = await modules.dispatchHttp({
      method: "GET",
      url,
      headers: {},
      body: (async function* () {})(),
    });
    const body = response?.body;
    expect(response?.status).toBe(200);
    expect(body instanceof Uint8Array ? new TextDecoder().decode(body) : null).toBe(
      "/v1/blobs/abc",
    );
    expect(
      await modules.dispatchHttp({
        method: "POST",
        url,
        headers: {},
        body: (async function* () {})(),
      }),
    ).toBeNull();
    await modules.deactivateAll();
  });
});
