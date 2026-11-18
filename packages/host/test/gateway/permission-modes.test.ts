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
 * 契約測試控制不了主機時鐘，到期後的讀取在這裡用指定的 `now` 驗。只有本機
 * client 連線能進到這裡：遠端裝置被拒的負面測試在 `test/remote/bypass.test.ts`，
 * 代理路徑的負面測試在 `contract-tests/permissions/agent-paths.test.ts`。
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const MINUTE = 60_000;

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

function grant(permissions: AgentPermissions, root: string, minutes?: number) {
  return applyPermissionModeRequest(
    permissions,
    "system.permissions.grant_allow_all",
    { tools: ["write_file"], paths: [root], ...(minutes === undefined ? {} : { minutes }) },
    T0,
  );
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

describe("全部允許的到期", () => {
  it("預設 15 分鐘：到期前一毫秒還在，剛好到期與之後讀取都沒有 allowAll", () => {
    const { root, permissions } = setup();
    const granted = grant(permissions, root);
    expect(granted.changed).toBe(true);
    expect(granted.state.allowAll).toMatchObject({
      tools: ["write_file"],
      paths: [root],
      expiresAt: new Date(T0 + 15 * MINUTE).toISOString(),
    });

    const read = (now: number) =>
      applyPermissionModeRequest(permissions, "system.permissions.get", {}, now).state;
    expect(read(T0 + 15 * MINUTE - 1).allowAll).toBeDefined();
    expect(read(T0 + 15 * MINUTE).allowAll).toBeUndefined();
    expect(read(T0 + 15 * MINUTE + 1).allowAll).toBeUndefined();
    expect(permissions.allowAllFor(T0 + 15 * MINUTE)).toBeNull();
  });

  it("上限 60 分鐘：60 分鐘後一樣失效", () => {
    const { root, permissions } = setup();
    grant(permissions, root, 60);
    expect(permissionModesState(permissions, T0 + 60 * MINUTE - 1).allowAll).toBeDefined();
    expect(permissionModesState(permissions, T0 + 60 * MINUTE).allowAll).toBeUndefined();
  });

  it("到期後撤銷不會讓舊授權回來，重新開啟才有新的期限", () => {
    const { root, permissions } = setup();
    grant(permissions, root, 1);
    const later = T0 + 5 * MINUTE;
    expect(permissionModesState(permissions, later).allowAll).toBeUndefined();
    applyPermissionModeRequest(permissions, "system.permissions.revoke_allow_all", {}, later);
    expect(permissionModesState(permissions, later).allowAll).toBeUndefined();
  });
});

describe("輸入檢查", () => {
  it.each([
    ["零分鐘", { tools: ["write_file"], paths: ["/tmp/x"], minutes: 0 }, "minutes"],
    ["超過 60 分鐘", { tools: ["write_file"], paths: ["/tmp/x"], minutes: 61 }, "minutes"],
    ["小數分鐘", { tools: ["write_file"], paths: ["/tmp/x"], minutes: 1.5 }, "minutes"],
    ["分鐘是字串", { tools: ["write_file"], paths: ["/tmp/x"], minutes: "15" }, "minutes"],
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
      applyPermissionModeRequest(permissions, "system.permissions.grant_allow_all", payload, T0),
    );
    expect(error.field).toBe(field);
    expect(permissions.allowAllFor(T0)).toBeNull();
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
      applyPermissionModeRequest(permissions, "system.permissions.set_category", payload, T0),
    );
    expect(error.field).toBe(field);
    expect(permissionModesState(permissions, T0).categories).toEqual([]);
  });

  it("可委派網域：私有網段被拒，清單不變", () => {
    const { permissions } = setup();
    const error = inputError(() =>
      applyPermissionModeRequest(
        permissions,
        "system.permissions.set_domains",
        { domains: ["192.168.0.1"] },
        T0,
      ),
    );
    expect(error.field).toBe("domains");
    expect(permissionModesState(permissions, T0).allowedDomains).toEqual([]);
  });
});

describe("get", () => {
  it("只讀：changed 是 false，正本與狀態都不變", () => {
    const { root, permissions, read } = setup();
    grant(permissions, root);
    const before = read();
    const stateBefore = permissionModesState(permissions, T0);

    const result = applyPermissionModeRequest(permissions, "system.permissions.get", {}, T0);

    expect(result.changed).toBe(false);
    expect(result.state).toEqual(stateBefore);
    expect(read()).toBe(before);
  });

  it("預設全部關閉，回報預設 15 分鐘與上限 60 分鐘", () => {
    const { permissions } = setup();
    const { state } = applyPermissionModeRequest(permissions, "system.permissions.get", {}, T0);
    expect(state).toMatchObject({
      categories: [],
      allowedDomains: [],
      defaultAllowAllMinutes: 15,
      maxAllowAllMinutes: 60,
    });
    expect(state.allowAll).toBeUndefined();
  });
});
