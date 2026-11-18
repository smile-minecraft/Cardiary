import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

/** 在沙盒裡執行一段 shell；回傳是否成功與失敗時的 stderr。 */
async function attempt(
  sandbox: CommandSandbox,
  script: string,
): Promise<{ readonly ok: boolean; readonly stderr: string }> {
  try {
    await run(sandbox.executable, ["-p", sandbox.profile, "/bin/sh", "-c", script]);
    return { ok: true, stderr: "" };
  } catch (error) {
    return { ok: false, stderr: stderrOf(error) };
  }
}

/** `execFile` 失敗時錯誤物件上的 stderr；不是那個形狀就回空字串。 */
function stderrOf(error: unknown): string {
  if (typeof error !== "object" || error === null || !("stderr" in error)) return "";
  return typeof error.stderr === "string" ? error.stderr : "";
}

/**
 * 外部代理服務用同一條 `createCommandSandbox` 路徑啟動代理。這裡用真的
 * `sandbox-exec` 驗證：Cardiary 六個正本區子目錄（`state`、`cards`、`assets`、
 * `boards`、`skills`、`modules`）寫不進、代理專屬的
 * `cache/agents/<session>/home` 寫得進，而且同一個工作階段的其他位置仍被拒。
 *
 * 每個受保護目錄都先建好並放一個 sentinel 檔。沒有這些目錄，shell 會先因為
 * 父目錄不存在而失敗，測試就分不出「sandbox 拒絕」和「路徑本來就不存在」。
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

      const protectedFolders = ["state", "cards", "assets", "boards", "skills", "modules"];
      for (const name of protectedFolders) {
        const dir = join(folderRoot, name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "sentinel.txt"), "original");
      }

      const sandbox = createCommandSandbox({
        workingDir: workspace,
        folderRoot,
        homeDir: userHome,
        agentHomeDir: agentHome,
      });
      expect(sandbox).not.toBeNull();

      // 六個正本區子目錄一律拒絕。新建檔案和覆寫既有檔案都要被 sandbox 拒絕，
      // 而且 stderr 必須是 sandbox 的 `Operation not permitted`，不是其他錯誤。
      for (const name of protectedFolders) {
        const target = join(folderRoot, name, "hacked.txt");
        const sentinel = join(folderRoot, name, "sentinel.txt");

        const create = await attempt(sandbox!, `printf x > '${target}'`);
        expect(create.ok, `${name} 應被拒：${create.stderr}`).toBe(false);
        expect(create.stderr, `${name} 應由 sandbox 拒絕`).toContain("Operation not permitted");
        expect(existsSync(target), `${name} 不應出現 hacked.txt`).toBe(false);

        const overwrite = await attempt(sandbox!, `printf x > '${sentinel}'`);
        expect(overwrite.ok, `${name} 的既有檔案應被拒：${overwrite.stderr}`).toBe(false);
        expect(overwrite.stderr, `${name} 應由 sandbox 拒絕`).toContain("Operation not permitted");
        expect(readFileSync(sentinel, "utf8"), `${name} 的 sentinel 不應被覆寫`).toBe("original");
      }

      // 代理自己的家目錄與工作目錄可以寫。
      const homeTarget = join(agentHome, "notes.txt");
      const homeWrite = await attempt(sandbox!, `printf ok > '${homeTarget}'`);
      expect(homeWrite.ok, homeWrite.stderr).toBe(true);
      expect(readFileSync(homeTarget, "utf8")).toBe("ok");

      const workspaceTarget = join(workspace, "notes.txt");
      const workspaceWrite = await attempt(sandbox!, `printf ok > '${workspaceTarget}'`);
      expect(workspaceWrite.ok, workspaceWrite.stderr).toBe(true);
      expect(readFileSync(workspaceTarget, "utf8")).toBe("ok");

      // 放行範圍只有 home，同一個工作階段的 session.json 仍然拒絕。
      const sessionFile = join(sessionDir, "session.json");
      const sessionWrite = await attempt(sandbox!, `printf x > '${sessionFile}'`);
      expect(sessionWrite.ok, sessionWrite.stderr).toBe(false);
      expect(sessionWrite.stderr).toContain("Operation not permitted");
      expect(existsSync(sessionFile)).toBe(false);
    });
  },
);
