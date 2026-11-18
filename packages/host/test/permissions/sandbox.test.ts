import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  SANDBOX_EXEC_PATH,
  buildSandboxProfile,
  createCommandSandbox,
  type CommandSandbox,
} from "../../src/permissions/sandbox.js";

const run = promisify(execFile);

/**
 * profile 產生器的單元測試：順序、保護清單與跳脫。
 *
 * 大部分真正的 sandbox 行為（拒絕哪些操作）在 `modules/local-tools/sandbox.test.ts`
 * 用真的 `/bin/sh` 與 `sandbox-exec` 驗證；這裡只固定產生的文字，讓審查的人
 * 不必讀實作就能對照 `docs/design/permissions.md` 第 9.2 節。檔案後段另外用
 * 真的 `sandbox-exec` 驗證外部代理的 agent home 邊界。
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

let agentRoot = "";

afterEach(() => {
  if (agentRoot !== "") {
    rmSync(agentRoot, { recursive: true, force: true });
    agentRoot = "";
  }
});

/** 在沙盒裡執行一段 shell；成功回 true，被 sandbox 拒絕回 false。 */
async function attempt(sandbox: CommandSandbox, script: string): Promise<boolean> {
  try {
    await run(sandbox.executable, ["-p", sandbox.profile, "/bin/sh", "-c", script]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 外部代理服務用同一條 `createCommandSandbox` 路徑啟動代理。這裡用真的
 * `sandbox-exec` 驗證：Cardiary 正本區寫不進、代理專屬的
 * `cache/agents/<session>/home` 寫得進，而且同一個工作階段的其他位置仍被拒。
 */
describe.skipIf(process.platform !== "darwin" || !existsSync(SANDBOX_EXEC_PATH))(
  "外部代理的 sandbox-exec 邊界",
  () => {
    it("寫入正本區被拒，寫入專屬 agent home 與工作目錄成功", async () => {
      agentRoot = realpathSync(mkdtempSync(join(tmpdir(), "cardiary-agent-sandbox-")));
      const folderRoot = join(agentRoot, "Cardiary");
      const workspace = join(agentRoot, "project");
      const userHome = join(agentRoot, "user-home");
      const sessionDir = join(folderRoot, "cache", "agents", "agent-1");
      const agentHome = join(sessionDir, "home");
      for (const dir of [folderRoot, workspace, userHome, agentHome]) {
        mkdirSync(dir, { recursive: true });
      }

      const sandbox = createCommandSandbox({
        workingDir: workspace,
        folderRoot,
        homeDir: userHome,
        agentHomeDir: agentHome,
      });
      expect(sandbox).not.toBeNull();

      // 正本區（state/cards/assets/modules）一律拒絕，host 端也看不到檔案。
      for (const name of ["state", "cards", "assets", "modules"]) {
        const target = join(folderRoot, name, "hacked.txt");
        expect(await attempt(sandbox!, `printf x > '${target}'`), `${name} 應被拒`).toBe(false);
        expect(existsSync(target), `${name} 不應出現 hacked.txt`).toBe(false);
      }

      // 代理自己的家目錄與工作目錄可以寫。
      const homeTarget = join(agentHome, "notes.txt");
      expect(await attempt(sandbox!, `printf ok > '${homeTarget}'`)).toBe(true);
      expect(readFileSync(homeTarget, "utf8")).toBe("ok");

      const workspaceTarget = join(workspace, "notes.txt");
      expect(await attempt(sandbox!, `printf ok > '${workspaceTarget}'`)).toBe(true);
      expect(readFileSync(workspaceTarget, "utf8")).toBe("ok");

      // 放行範圍只有 home，同一個工作階段的 session.json 仍然拒絕。
      const sessionFile = join(sessionDir, "session.json");
      expect(await attempt(sandbox!, `printf x > '${sessionFile}'`)).toBe(false);
      expect(existsSync(sessionFile)).toBe(false);
    });
  },
);
