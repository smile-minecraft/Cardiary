/**
 * 載入器的停用／啟用恢復行為。
 *
 * 這些案例用最小的假模組直接驗載入器：必要相依被停用時，模組停在
 * inactive；重新啟用相依後自動恢復；啟動失敗的模組可以重試，成功後
 * 等待它的模組一起回來。
 */

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

interface DependencySource {
  readonly moduleId: string;
  readonly optional?: boolean;
}

interface ModuleSourceOptions {
  readonly id: string;
  readonly dependencies?: readonly DependencySource[];
  readonly activate: string;
  readonly deactivate?: string;
}

async function makeModuleRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cardiary-loader-enablement-"));
}

async function writeModule(root: string, options: ModuleSourceOptions): Promise<void> {
  await mkdir(join(root, options.id), { recursive: true });
  const dependencies = (options.dependencies ?? [])
    .map(
      (dependency) =>
        `{ moduleId: ${JSON.stringify(dependency.moduleId)}, versionRange: "^1.0.0"${dependency.optional === true ? ", optional: true" : ""} }`,
    )
    .join(", ");
  const source = `
export const hostModule = {
  manifest: {
    id: ${JSON.stringify(options.id)},
    name: ${JSON.stringify(options.id)},
    version: "1.0.0",
    hostApiVersion: "1",
    dependencies: [${dependencies}],
    permissions: [],
    settings: [],
  },
  async activate(context) {
    ${options.activate}
  },${options.deactivate === undefined ? "" : `\n  async deactivate() { ${options.deactivate} },`}
};
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

function states(
  modules: LoadedModules,
): Map<string, { enabled: boolean; state: string; failure: string | null }> {
  return new Map(
    modules
      .listModules()
      .map((info) => [
        info.moduleId,
        { enabled: info.enabled, state: info.state, failure: info.failure ?? null },
      ]),
  );
}

describe("第一方模組載入器的恢復行為", () => {
  it("必要相依被停用：相依模組停在 inactive，不是 failed；啟用相依後一起恢復", async () => {
    const root = await makeModuleRoot();
    await writeModule(root, {
      id: "provider",
      activate: `context.services.host.provide("test.enablement.shared", { value: 7 });`,
    });
    await writeModule(root, {
      id: "consumer",
      dependencies: [{ moduleId: "provider" }],
      activate: `const service = context.services.host.require("test.enablement.shared");
        if (service.value !== 7) throw new Error("沒拿到服務");`,
    });

    const modules = await load(root, { disabled: ["provider"] });
    const before = states(modules);
    expect(before.get("provider")).toEqual({ enabled: false, state: "inactive", failure: null });
    expect(before.get("consumer")).toEqual({ enabled: true, state: "inactive", failure: null });

    const provider = await modules.setModuleEnabled("provider", true);
    expect(provider.enabled).toBe(true);
    expect(provider.state).toBe("active");

    const after = states(modules);
    expect(after.get("consumer")).toEqual({ enabled: true, state: "active", failure: null });
    await modules.deactivateAll();
  });

  it("遞移相依：啟用最底層後，中間層與最上層依序恢復", async () => {
    const root = await makeModuleRoot();
    await writeModule(root, {
      id: "base",
      activate: `context.services.host.provide("test.enablement.base", { value: 1 });`,
    });
    await writeModule(root, {
      id: "middle",
      dependencies: [{ moduleId: "base" }],
      activate: `context.services.host.require("test.enablement.base");
        context.services.host.provide("test.enablement.middle", { value: 2 });`,
    });
    await writeModule(root, {
      id: "leaf",
      dependencies: [{ moduleId: "middle" }],
      activate: `context.services.host.require("test.enablement.middle");`,
    });

    const modules = await load(root, { disabled: ["base"] });
    const before = states(modules);
    expect(before.get("middle")?.state).toBe("inactive");
    expect(before.get("leaf")?.state).toBe("inactive");
    expect(before.get("middle")?.failure).toBeNull();
    expect(before.get("leaf")?.failure).toBeNull();

    await modules.setModuleEnabled("base", true);
    const after = states(modules);
    expect(after.get("base")?.state).toBe("active");
    expect(after.get("middle")?.state).toBe("active");
    expect(after.get("leaf")?.state).toBe("active");
    await modules.deactivateAll();
  });

  it("相依模組啟動失敗：上層停在 inactive；重試成功後上層自動恢復", async () => {
    const root = await makeModuleRoot();
    await writeModule(root, {
      id: "flaky",
      activate: `globalThis.__cardiaryLoaderFlakyAttempts =
          (globalThis.__cardiaryLoaderFlakyAttempts ?? 0) + 1;
        if (globalThis.__cardiaryLoaderFlakyAttempts === 1) throw new Error("第一次啟動失敗");
        context.services.host.provide("test.enablement.flaky", { value: 3 });`,
    });
    await writeModule(root, {
      id: "waits-flaky",
      dependencies: [{ moduleId: "flaky" }],
      activate: `const service = context.services.host.require("test.enablement.flaky");
        if (service.value !== 3) throw new Error("沒拿到服務");`,
    });

    const modules = await load(root);
    const before = states(modules);
    expect(before.get("flaky")).toEqual({
      enabled: true,
      state: "failed",
      failure: "第一次啟動失敗",
    });
    expect(before.get("waits-flaky")).toEqual({
      enabled: true,
      state: "inactive",
      failure: null,
    });

    // enabled 已經是 true 的 failed 模組，再啟用一次時要重試，不能提早返回。
    const retried = await modules.setModuleEnabled("flaky", true);
    expect(retried.enabled).toBe(true);
    expect(retried.state).toBe("active");

    const after = states(modules);
    expect(after.get("waits-flaky")).toEqual({
      enabled: true,
      state: "active",
      failure: null,
    });
    await modules.deactivateAll();
  });

  it("選用相依被停用：不連帶停用，也不阻擋啟動", async () => {
    const root = await makeModuleRoot();
    await writeModule(root, {
      id: "optional-provider",
      activate: `context.services.host.provide("test.enablement.optional", { value: 9 });`,
    });
    await writeModule(root, {
      id: "optional-consumer",
      dependencies: [{ moduleId: "optional-provider", optional: true }],
      activate: `const service = context.services.host.get("test.enablement.optional");
        if (service !== undefined) throw new Error("選用依賴不應先存在");`,
    });

    const modules = await load(root, { disabled: ["optional-provider"] });
    const before = states(modules);
    expect(before.get("optional-provider")).toEqual({
      enabled: false,
      state: "inactive",
      failure: null,
    });
    expect(before.get("optional-consumer")).toEqual({
      enabled: true,
      state: "active",
      failure: null,
    });

    await modules.setModuleEnabled("optional-provider", false);
    expect(states(modules).get("optional-consumer")?.state).toBe("active");

    await modules.setModuleEnabled("optional-provider", true);
    const after = states(modules);
    expect(after.get("optional-provider")?.state).toBe("active");
    expect(after.get("optional-consumer")?.state).toBe("active");
    await modules.deactivateAll();
  });
});
