import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyPermissionModeRequest,
  PermissionModeInputError,
  permissionModesState,
} from "../../src/gateway/permission-modes.js";
import { AgentPermissions } from "../../src/permissions/agent-permissions.js";

/**
 * `system.permissions.*` 的處理邏輯（規格第 11 章「M5 權限模式裁決」）。
 *
 * 全部允許沒有期限：開啟後重啟保留，直到人撤銷或緊急全部暫停。只有本機
 * client 連線能進到這裡：遠端裝置被拒的負面測試在 `test/remote/bypass.test.ts`，
 * 代理路徑的負面測試在 `contract-tests/permissions/agent-paths.test.ts`。
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cardiary-permission-modes-")));
  roots.push(root);
  const permissions = new AgentPermissions(root, { diagnostic: () => {} });
  const stateFile = join(root, "agent-permissions.json");
  const read = () => {
    try {
      return readFileSync(stateFile, "utf8");
    } catch {
      return null;
    }
  };
  return { root, permissions, read };
}

function grant(permissions: AgentPermissions, root: string, tools: string[] = ["write_file"]) {
  return applyPermissionModeRequest(permissions, "system.permissions.grant_allow_all", {
    tools,
    paths: [root],
  });
}

function inputError(action: () => unknown): PermissionModeInputError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(PermissionModeInputError);
    return error as PermissionModeInputError;
  }
  throw new Error("預期會丟 PermissionModeInputError");
}

describe("全部允許沒有期限", () => {
  it("開啟後狀態只有範圍，沒有期限欄位", () => {
    const { root, permissions } = setup();
    const granted = grant(permissions, root);
    expect(granted.changed).toBe(true);
    expect(granted.state.allowAll).toEqual({ tools: ["write_file"], paths: [root], domains: [] });
    expect(granted.state).not.toHaveProperty("defaultAllowAllMinutes");
    expect(granted.state).not.toHaveProperty("maxAllowAllMinutes");
  });

  it("重新載入正本（主機重啟）後仍然開著", () => {
    const { root, permissions } = setup();
    grant(permissions, root);
    const restarted = new AgentPermissions(root, { diagnostic: () => {} });
    expect(permissionModesState(restarted).allowAll).toEqual({
      tools: ["write_file"],
      paths: [root],
      domains: [],
    });
    expect(restarted.allowAll()?.tools).toEqual(["write_file"]);
  });

  it("撤銷後消失，重啟後也不會回來", () => {
    const { root, permissions } = setup();
    grant(permissions, root);
    applyPermissionModeRequest(permissions, "system.permissions.revoke_allow_all", {});
    expect(permissionModesState(permissions).allowAll).toBeUndefined();
    expect(new AgentPermissions(root).allowAll()).toBeNull();
  });

  it("再次開啟以新範圍覆寫，不疊加", () => {
    const { root, permissions } = setup();
    grant(permissions, root, ["write_file"]);
    grant(permissions, root, ["read_file"]);
    expect(permissionModesState(permissions).allowAll).toMatchObject({ tools: ["read_file"] });
  });
});

describe("輸入檢查", () => {
  it.each([
    ["沒有路徑也沒有網域", { tools: ["write_file"], paths: [] }, "paths"],
    ["缺 paths", { tools: ["write_file"] }, "paths"],
    ["缺工具", { paths: ["/tmp/x"] }, "tools"],
    ["工具是空陣列", { tools: [], paths: ["/tmp/x"] }, "tools"],
    ["工具含空字串", { tools: [""], paths: ["/tmp/x"] }, "tools"],
    // 相對路徑由 AgentPermissions 拒絕，整個授權包在 tools 欄位回報。
    ["相對路徑", { tools: ["write_file"], paths: ["relative/dir"] }, "tools"],
  ])("全部允許：%s 被拒，狀態與正本不變", (_label, payload, field) => {
    const { permissions, read } = setup();
    const before = read();
    const error = inputError(() =>
      applyPermissionModeRequest(permissions, "system.permissions.grant_allow_all", payload),
    );
    expect(error.field).toBe(field);
    expect(permissions.allowAll()).toBeNull();
    expect(read()).toBe(before);
  });

  it.each([
    ["不支援的類別", { category: "delete-files", enabled: true, paths: [] }, "category"],
    ["enabled 不是布林", { category: "create-card", enabled: "true", paths: [] }, "enabled"],
    ["paths 不是陣列", { category: "read-only-files", enabled: true, paths: "/tmp" }, "paths"],
    ["路徑類別給相對路徑", { category: "read-only-files", enabled: true, paths: ["x"] }, "paths"],
    ["非路徑類別帶路徑", { category: "create-card", enabled: true, paths: ["/tmp"] }, "paths"],
  ])("System One 類別：%s 被拒，類別不變", (_label, payload, field) => {
    const { permissions } = setup();
    const error = inputError(() =>
      applyPermissionModeRequest(permissions, "system.permissions.set_category", payload),
    );
    expect(error.field).toBe(field);
    expect(permissionModesState(permissions).categories).toEqual([]);
  });

  it("可委派網域：私有網段被拒，清單不變", () => {
    const { permissions } = setup();
    const error = inputError(() =>
      applyPermissionModeRequest(permissions, "system.permissions.set_domains", {
        domains: ["192.168.0.1"],
      }),
    );
    expect(error.field).toBe("domains");
    expect(permissionModesState(permissions).allowedDomains).toEqual([]);
  });
});

describe("get", () => {
  it("只讀：changed 是 false，正本與狀態都不變", () => {
    const { root, permissions, read } = setup();
    grant(permissions, root);
    const before = read();
    const stateBefore = permissionModesState(permissions);

    const result = applyPermissionModeRequest(permissions, "system.permissions.get", {});

    expect(result.changed).toBe(false);
    expect(result.state).toEqual(stateBefore);
    expect(read()).toBe(before);
  });

  it("預設全部關閉，沒有全部允許", () => {
    const { permissions } = setup();
    const { state } = applyPermissionModeRequest(permissions, "system.permissions.get", {});
    expect(state).toEqual({
      categories: [],
      availableCategories: expect.any(Array),
      allowedDomains: [],
    });
  });
});
