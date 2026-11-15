import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SANDBOX_EXEC_PATH,
  buildSandboxProfile,
  createCommandSandbox,
} from "../../src/permissions/sandbox.js";

/**
 * profile 產生器的單元測試：順序、保護清單與跳脫。
 *
 * 真正的 sandbox 行為（拒絕哪些操作）在 `modules/local-tools/sandbox.test.ts`
 * 用真的 `/bin/sh` 與 `sandbox-exec` 驗證；這裡只固定產生的文字，讓審查的人
 * 不必讀實作就能對照 `docs/design/permissions.md` 第 9.2 節。
 */
describe("sandbox profile", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cardiary-profile-")));
  const workingDir = join(root, "project");
  const folderRoot = join(root, "Cardiary");
  const homeDir = join(root, "home");
  const appBundlePath = join(root, "Cardiary.app");
  const profile = buildSandboxProfile({ workingDir, folderRoot, homeDir, appBundlePath });

  it("先允許工作目錄與 tmp，再把正本區蓋回拒絕", () => {
    const denyAll = profile.indexOf("(deny file-write*)");
    const allow = profile.indexOf("(allow file-write* ");
    const denyProtected = profile.indexOf(`(deny file-write* (subpath "${folderRoot}/state")`);
    expect(denyAll).toBeGreaterThanOrEqual(0);
    expect(allow).toBeGreaterThan(denyAll);
    expect(denyProtected).toBeGreaterThan(allow);
  });

  it("寫入只放行工作目錄、tmp 與 /dev/null", () => {
    expect(profile).toContain(`(subpath "${workingDir}")`);
    expect(profile).toContain(`(subpath "${folderRoot}/tmp")`);
    expect(profile).toContain('(allow file-write-data (literal "/dev/null"))');
  });

  it("正本區、資料夾描述檔、系統目錄與 App bundle 都拒絕寫入", () => {
    for (const name of ["state", "cards", "assets", "boards", "skills", "modules"]) {
      expect(profile).toContain(`(subpath "${folderRoot}/${name}")`);
    }
    expect(profile).toContain(`(literal "${folderRoot}/folder.json")`);
    for (const path of ["/System", "/Library", "/usr", "/etc", "/private/etc"]) {
      expect(profile).toContain(`(subpath "${path}")`);
    }
    expect(profile).toContain(`(subpath "${appBundlePath}")`);
    expect(profile).toContain(`(subpath "${homeDir}/Library/Application Support/com.cardiary")`);
  });

  it("憑證目錄拒絕整個讀取，憑證檔名只拒絕讀內容", () => {
    for (const name of [".ssh", ".aws", ".gnupg"]) {
      expect(profile).toContain(`(subpath "${homeDir}/${name}")`);
    }
    expect(profile).toContain(`(subpath "${homeDir}/Library/Keychains")`);
    expect(profile).toContain("(deny file-read-data file-read-xattr (regex ");
    expect(profile).toContain("\\\\.env");
    expect(profile).toContain("auth\\\\.json");
  });

  it("路徑中的引號與反斜線會跳脫", () => {
    const quoted = buildSandboxProfile({
      workingDir: `${root}/a"b\\c`,
      folderRoot,
      homeDir,
    });
    expect(quoted).toContain(`(subpath "${root}/a\\"b\\\\c")`);
  });
});

describe.skipIf(process.platform !== "darwin")("sandbox 可用性", () => {
  it("macOS 上有 sandbox-exec 時建立得起來", () => {
    const sandbox = createCommandSandbox({
      workingDir: "/tmp",
      folderRoot: "/tmp",
      homeDir: "/tmp",
    });
    expect(sandbox).not.toBeNull();
    expect(sandbox!.executable).toBe(SANDBOX_EXEC_PATH);
    expect(sandbox!.profile).toContain("(version 1)");
  });
});
