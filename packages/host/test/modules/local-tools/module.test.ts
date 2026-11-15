import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModuleDeactivationContext } from "@cardiary/module-api";

import { ApprovalAllowlistStore } from "../../../src/permissions/allowlist.js";
import type { ToolPermissionGate } from "@cardiary/engine-adapter";
import {
  createLocalToolsModule,
  hostModule,
  LOCAL_TOOLS_BUNDLE_ID,
  LOCAL_TOOLS_SERVICES,
} from "../../../src/modules/local-tools/index.js";

import { activationContext } from "./support.js";
import { openPermissionFixture, type PermissionFixture } from "../../permissions/support.js";

let fixture: PermissionFixture | null = null;

afterEach(() => {
  fixture?.cleanup();
  fixture = null;
});

const deactivation: ModuleDeactivationContext = { reason: "user" };
const toolNames = ["read_file", "write_file", "list_directory", "run_command"];

function allowlist(): ApprovalAllowlistStore {
  if (fixture === null) {
    throw new Error("fixture 還沒開");
  }
  return new ApprovalAllowlistStore(fixture.storage.state);
}

describe("模組的啟用", () => {
  it("註冊一個具名工具組，含四個工具，並掛上 after-turn 掛鉤", async () => {
    fixture = openPermissionFixture();
    const activation = activationContext({ paths: { root: fixture.folder } });
    const module = createLocalToolsModule({
      workingDir: fixture.project,
      folderRoot: fixture.folder,
      allowlist: allowlist(),
      registry: fixture.storage.registry,
    });

    await module.activate(activation.context);

    expect(activation.bundles).toHaveLength(1);
    const bundle = activation.bundles[0];
    expect(bundle?.bundleId).toBe(LOCAL_TOOLS_BUNDLE_ID);
    expect(bundle?.label).toBe("本機檔案與終端機");
    expect(bundle?.tools.map((tool) => tool.name)).toEqual(toolNames);
    expect(activation.hooks.map((hook) => hook.point)).toContain("after-turn");
    await module.deactivate!(deactivation);
  });

  it("有白名單服務時提供硬規則閘道", async () => {
    fixture = openPermissionFixture();
    const activation = activationContext({ paths: { root: fixture.folder } });
    const module = createLocalToolsModule({
      workingDir: fixture.project,
      folderRoot: fixture.folder,
      allowlist: allowlist(),
      registry: fixture.storage.registry,
    });

    await module.activate(activation.context);

    const gate = activation.context.services.host.get<ToolPermissionGate>(
      LOCAL_TOOLS_SERVICES.permissionGate,
    );
    expect(gate).toBeDefined();
    writeFileSync(join(fixture.project, "notes.md"), "notes");
    const read = await gate!.evaluate({
      conversationId: "c1",
      turnId: "t1",
      toolCallId: "call-1",
      toolName: "read_file",
      input: { path: "notes.md" },
      replay: "safe",
      permissionMode: "hard-rules",
    });
    expect(read).toEqual({ kind: "allow" });
    const write = await gate!.evaluate({
      conversationId: "c1",
      turnId: "t1",
      toolCallId: "call-2",
      toolName: "write_file",
      input: { path: "notes.md", content: "x" },
      replay: "unsafe",
      permissionMode: "hard-rules",
    });
    expect(write.kind).toBe("ask-human");
    await module.deactivate!(deactivation);
  });

  it("沒有白名單服務時仍然註冊工具組，只是不提供硬規則閘道", async () => {
    fixture = openPermissionFixture();
    const warnings: string[] = [];
    const activation = activationContext({ paths: { root: fixture.folder } });
    const module = createLocalToolsModule({
      workingDir: fixture.project,
      folderRoot: fixture.folder,
      logger: {
        warn: (message) => {
          warnings.push(message);
        },
      },
    });

    await module.activate(activation.context);

    expect(activation.bundles).toHaveLength(1);
    expect(
      activation.context.services.host.get(LOCAL_TOOLS_SERVICES.permissionGate),
    ).toBeUndefined();
    expect(warnings.some((message) => message.includes("白名單"))).toBe(true);
    await module.deactivate!(deactivation);
  });
});

describe("模組的停用", () => {
  it("停用時不自行銷毀註冊；銷毀責任在載入器", async () => {
    fixture = openPermissionFixture();
    const activation = activationContext({ paths: { root: fixture.folder } });
    const module = createLocalToolsModule({
      workingDir: fixture.project,
      folderRoot: fixture.folder,
      allowlist: allowlist(),
      registry: fixture.storage.registry,
    });

    await module.activate(activation.context);
    expect(activation.disposed).toHaveLength(0);
    expect(activation.bundles.length + activation.hooks.length).toBe(2);

    await module.deactivate!(deactivation);
    expect(activation.disposed).toHaveLength(0);

    await module.deactivate!(deactivation);
    expect(activation.disposed).toHaveLength(0);
  });

  it("進入點從主機服務取得白名單並提供閘道，停用後不留註冊", async () => {
    fixture = openPermissionFixture();
    const activation = activationContext({ paths: { root: fixture.folder } });
    activation.context.services.host.provide(LOCAL_TOOLS_SERVICES.allowlist, allowlist());
    writeFileSync(join(fixture.folder, "notes.md"), "notes");

    await hostModule.activate(activation.context);

    expect(activation.bundles).toHaveLength(1);
    const gate = activation.context.services.host.get<ToolPermissionGate>(
      LOCAL_TOOLS_SERVICES.permissionGate,
    );
    expect(gate).toBeDefined();
    const read = await gate!.evaluate({
      conversationId: "c1",
      turnId: "t1",
      toolCallId: "call-1",
      toolName: "read_file",
      input: { path: "notes.md" },
      replay: "safe",
      permissionMode: "hard-rules",
    });
    expect(read).toEqual({ kind: "allow" });

    await hostModule.deactivate!(deactivation);
    expect(activation.disposed).toHaveLength(0);
  });
});
