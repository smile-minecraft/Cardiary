import { describe, expect, it } from "vitest";

import {
  ModuleLifecycleFailure,
  createModuleHost,
  type HostModule,
  type ModuleServices,
  type ToolBundle,
  type ToolBundleId,
  type ToolBundleState,
  type ToolGeneration,
  type ToolRegistry,
} from "../src/index.js";

/** 記錄註冊與退役的假工具註冊表；不需要引擎。 */
class RecordingRegistry implements ToolRegistry {
  readonly bundles = new Map<string, ToolBundle>();
  readonly retired = new Set<string>();
  readonly pinned = new Map<string, number>();

  async register(bundle: ToolBundle): Promise<void> {
    this.bundles.set(`${bundle.bundleId}@${bundle.generation}`, bundle);
    this.retired.delete(`${bundle.bundleId}@${bundle.generation}`);
  }

  async retire(bundleId: ToolBundleId, generation: ToolGeneration): Promise<void> {
    this.retired.add(`${bundleId}@${generation}`);
  }

  async list(): Promise<readonly ToolBundleState[]> {
    return [...this.bundles.values()].map((bundle) => ({
      bundleId: bundle.bundleId,
      generation: bundle.generation,
      pinnedByConversations: this.pinned.get(`${bundle.bundleId}@${bundle.generation}`) ?? 0,
    }));
  }
}

const services = {
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  clock: { now: () => new Date() },
} as unknown as ModuleServices;

function moduleOf(version: string, toolText: string): HostModule {
  return {
    manifest: {
      id: "test.module",
      name: "測試模組",
      version,
      hostApiVersion: "1",
      dependencies: [],
      permissions: ["cards:read"],
      settings: [{ key: "mode", title: "模式", kind: "string" }],
    },
    activate(context) {
      context.registerToolBundle({
        bundleId: "mod.tools",
        label: "測試工具",
        tools: [
          {
            name: "mod-echo",
            description: "回傳文字",
            replay: "safe",
            parameters: { type: "object", properties: {}, additionalProperties: false },
            async execute() {
              return { ok: true, content: [{ type: "text", text: toolText }] };
            },
          },
        ],
      });
    },
  };
}

describe("模組註冊表", () => {
  it("載入、啟用、停用後工具退役、重新啟用恢復", async () => {
    const tools = new RecordingRegistry();
    const host = createModuleHost({ tools, services, hostApiVersion: "1" });
    const module = moduleOf("1.0.0", "v1");
    const loaded = await host.load(module);
    expect(loaded.state).toBe("loaded");
    // 未標明等級的設定補上安全預設。
    const manifestSetting = module.manifest.settings[0] as { level?: string };
    expect(manifestSetting.level).toBe("human-only");

    const activated = await host.activate("test.module");
    expect(activated.state).toBe("active");
    expect(activated.identity.generation).toBe(1);
    expect(tools.bundles.has("mod.tools@1")).toBe(true);
    expect(tools.retired.has("mod.tools@1")).toBe(false);

    const deactivated = await host.deactivate("test.module");
    expect(deactivated.state).toBe("inactive");
    expect(tools.retired.has("mod.tools@1")).toBe(true);

    // 重新啟用同一個版本：恢復可用。
    const reactivated = await host.activate("test.module");
    expect(reactivated.identity.generation).toBeGreaterThan(1);
    expect(tools.retired.has(`mod.tools@${reactivated.identity.generation}`)).toBe(false);
  });

  it("重載配發新 generation，並對進行中的對話預告變更", async () => {
    const tools = new RecordingRegistry();
    const staged: {
      conversationId: string;
      pins: readonly { bundleId: string; generation: number }[];
    }[] = [];
    const host = createModuleHost({
      tools,
      services,
      hostApiVersion: "1",
      listPinnedConversations: async () => ["conv-1", "conv-2"],
      stageConversationUpdate: async (conversationId, pins) => {
        staged.push({ conversationId, pins });
      },
    });
    await host.load(moduleOf("1.0.0", "v1"));
    const first = await host.activate("test.module");
    const result = await host.reload("test.module", moduleOf("1.1.0", "v2"));
    expect(result.identity.generation).toBeGreaterThan(first.identity.generation);
    expect(result.identity.version).toBe("1.1.0");
    expect(result.timing).toEqual({
      newConversations: "immediate",
      activeConversations: "next-compaction",
    });
    expect(result.stagedConversationIds).toEqual(["conv-1", "conv-2"]);
    expect(staged).toHaveLength(2);
    expect(staged[0]?.pins[0]?.generation).toBe(result.identity.generation);
    // 重載不退役舊版：舊 generation 留給已釘選的進行中對話。
    expect(tools.retired.has(`mod.tools@${first.identity.generation}`)).toBe(false);
  });

  it("相依性與描述檔錯誤回對應的錯誤碼", async () => {
    const tools = new RecordingRegistry();
    const host = createModuleHost({ tools, services, hostApiVersion: "1" });
    const broken: HostModule = {
      ...moduleOf("1.0.0", "x"),
      manifest: { ...moduleOf("1.0.0", "x").manifest, id: "broken", version: "not-semver" },
    };
    await expect(host.load(broken)).rejects.toBeInstanceOf(ModuleLifecycleFailure);
    await expect(host.load(broken)).rejects.toMatchObject({ code: "invalid-manifest" });

    const dependent: HostModule = {
      ...moduleOf("1.0.0", "x"),
      manifest: {
        ...moduleOf("1.0.0", "x").manifest,
        id: "dependent",
        dependencies: [{ moduleId: "missing", versionRange: "^1.0.0" }],
      },
    };
    await expect(host.load(dependent)).rejects.toMatchObject({ code: "dependency-missing" });

    await host.load(moduleOf("1.0.0", "x"));
    await host.activate("test.module");
    await expect(host.unload("test.module")).rejects.toMatchObject({ code: "already-active" });
    await host.deactivate("test.module");
    await host.unload("test.module");
    expect(host.list()).toHaveLength(0);
  });
});
