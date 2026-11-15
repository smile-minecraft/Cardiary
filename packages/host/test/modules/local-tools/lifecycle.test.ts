import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeToolRegistry } from "@cardiary/engine-fake";
import type { ModuleRuntimeServices } from "../../../src/modules/contract.js";
import { HostModuleRegistry, HostServiceRegistryImpl } from "../../../src/modules/registry.js";
import {
  LOCAL_TOOLS_BUNDLE_ID,
  LOCAL_TOOLS_SERVICES,
  createLocalToolsModule,
} from "../../../src/modules/local-tools/index.js";
import { ApprovalAllowlistStore } from "../../../src/permissions/allowlist.js";

import { openPermissionFixture, type PermissionFixture } from "../../permissions/support.js";

/**
 * 載入器的銷毀契約：停用與重載時由主機呼叫註冊 handle 的 dispose 一次，
 * 模組不在停用路徑自行銷毀。
 *
 * 這一組用真的 `HostModuleRegistry`；工具組退休就是「handle 被銷毀」的
 * 可觀察結果：舊 generation 解析不到工具，重新啟用換一個新 generation。
 */

let fixture: PermissionFixture;
let hostServices: HostServiceRegistryImpl;
let tools: FakeToolRegistry;

beforeEach(() => {
  fixture = openPermissionFixture();
  hostServices = new HostServiceRegistryImpl();
  tools = new FakeToolRegistry(() => 0);
  hostServices.provide(
    LOCAL_TOOLS_SERVICES.allowlist,
    new ApprovalAllowlistStore(fixture.storage.state),
  );
  hostServices.provide(LOCAL_TOOLS_SERVICES.fileRegistry, fixture.storage.registry);
});

afterEach(() => {
  fixture.cleanup();
});

function registry(): HostModuleRegistry {
  const services: ModuleRuntimeServices = {
    models: { invoke: async () => ({ text: "" }) },
    backgroundTasks: {
      run: async () => ({ conversationId: "c1", status: "completed", summary: null }),
    },
    storage: {
      dataDir: join(fixture.folder, "modules", "local-tools"),
      cacheDir: join(fixture.folder, "cache"),
      tempDir: join(fixture.folder, "tmp"),
    },
    paths: {
      root: fixture.folder,
      cards: join(fixture.folder, "cards"),
      assets: join(fixture.folder, "assets"),
      boards: join(fixture.folder, "boards"),
      skills: join(fixture.folder, "skills"),
      state: join(fixture.folder, "state"),
      modules: join(fixture.folder, "modules"),
      cache: join(fixture.folder, "cache"),
      tmp: join(fixture.folder, "tmp"),
      logs: join(fixture.folder, "logs"),
    },
    settings: {
      get: () => undefined,
      getLevel: () => "human-only",
      onChange: () => () => undefined,
    },
    secrets: { withSecret: async (_ref, use) => use("") },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    clock: { now: () => new Date("2026-11-15T00:00:00.000Z") },
  };
  return new HostModuleRegistry({
    tools,
    services,
    events: { emit: () => undefined },
    hostServices,
  });
}

function module() {
  return createLocalToolsModule({
    workingDir: fixture.folder,
    folderRoot: fixture.folder,
  });
}

describe("載入器與本機工具模組的銷毀契約", () => {
  it("啟用註冊工具組；停用由主機退役，重複停用不會再銷毀一次", async () => {
    const host = registry();
    await host.load(module());
    const active = await host.activate("local-tools");
    expect(active.state).toBe("active");

    const bundles = (await tools.list()).filter(
      (bundle) => bundle.bundleId === LOCAL_TOOLS_BUNDLE_ID,
    );
    expect(bundles).toHaveLength(1);
    const generation = bundles[0]!.generation;
    const pin = [{ bundleId: LOCAL_TOOLS_BUNDLE_ID, generation }];
    expect(tools.resolve(pin, "read_file")?.name).toBe("read_file");

    const inactive = await host.deactivate("local-tools");
    expect(inactive.state).toBe("inactive");
    expect(tools.resolve(pin, "read_file")).toBeNull();

    await expect(host.deactivate("local-tools")).rejects.toMatchObject({ code: "not-active" });
    expect(tools.resolve(pin, "read_file")).toBeNull();
  });

  it("重載先撤銷舊註冊，再配發新的 generation", async () => {
    const host = registry();
    await host.load(module());
    await host.activate("local-tools");
    const first = (await tools.list()).find((bundle) => bundle.bundleId === LOCAL_TOOLS_BUNDLE_ID);
    expect(first).toBeDefined();

    const reloaded = await host.reload("local-tools");
    expect(reloaded.identity.generation).toBeGreaterThan(first!.generation);
    expect(reloaded.timing.activeConversations).toBe("next-compaction");

    const oldPin = [{ bundleId: LOCAL_TOOLS_BUNDLE_ID, generation: first!.generation }];
    const newPin = [{ bundleId: LOCAL_TOOLS_BUNDLE_ID, generation: reloaded.identity.generation }];
    expect(tools.resolve(oldPin, "write_file")).toBeNull();
    expect(tools.resolve(newPin, "write_file")?.name).toBe("write_file");
  });
});
