import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ToolOutcome } from "@cardiary/engine-adapter";

import { SANDBOX_EXEC_PATH } from "../../../src/permissions/sandbox.js";
import { waitUntil } from "../../helpers.js";
import { makeLocalToolsHarness, type LocalToolsHarness } from "./support.js";

/**
 * `run_command` 的作業系統沙盒（`docs/design/permissions.md` 第 9 節）。
 *
 * 這裡直接呼叫工具，等於權限閘道已經回 `allow`：要證明的是即使解析器放行、
 * 使用者按了「一律允許」，保護路徑仍由 macOS 拒絕。前三次審查的繞過寫法
 * 各有一組測試，`state/cardiary.sqlite` 的內容從頭到尾不變。
 */
const available = process.platform === "darwin" && existsSync(SANDBOX_EXEC_PATH);

let harness: LocalToolsHarness | null = null;
const scratch: string[] = [];

afterEach(async () => {
  await harness?.cleanup();
  harness = null;
  for (const path of scratch.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

async function setup(options: { workingDir?: "folder" | "project"; homeDir?: string } = {}) {
  harness = await makeLocalToolsHarness({}, options);
  return harness;
}

/** 失敗必須是 sandbox 拒絕，而且訊息不含 OS 原文或路徑。 */
function expectSandboxDenied(outcome: ToolOutcome): void {
  expect(outcome.ok).toBe(false);
  expect(
    outcome.diagnostics?.some(
      (diagnostic) =>
        diagnostic.code === "permission-denied" && diagnostic.message === "sandbox-denied",
    ),
  ).toBe(true);
  const serialized = JSON.stringify(outcome);
  expect(serialized.toLowerCase()).not.toContain("operation not permitted");
  expect(serialized).not.toContain("sed:");
  expect(serialized).not.toContain("cp:");
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!available)("run_command 的作業系統沙盒", () => {
  it("巢狀 payload：cd state; sh -c sed -i 被 OS 拒絕，狀態檔不變", async () => {
    const h = await setup({ workingDir: "folder" });
    const stateDb = join(h.fixture.folder, "state", "cardiary.sqlite");
    const before = readFileSync(stateDb);
    expect(before.byteLength).toBeGreaterThan(0);

    const outcome = await h.run("run_command", {
      command: `cd state; sh -c "sed -i.bak 's#original#hacked#' cardiary.sqlite"`,
    });

    expectSandboxDenied(outcome);
    expect(readFileSync(stateDb).equals(before)).toBe(true);
    expect(existsSync(`${stateDb}.bak`)).toBe(false);
  });

  it("eval 與命令替換裡的寫入同樣被 OS 拒絕", async () => {
    const h = await setup({ workingDir: "folder" });
    const stateDb = join(h.fixture.folder, "state", "cardiary.sqlite");
    const before = readFileSync(stateDb);

    for (const command of [
      `eval "echo x > state/cardiary.sqlite"`,
      `echo "$(echo x > state/cardiary.sqlite)"`,
      `echo \`echo x > state/cardiary.sqlite\``,
    ]) {
      const outcome = await h.run("run_command", { command });
      expectSandboxDenied(outcome);
      expect(readFileSync(stateDb).equals(before)).toBe(true);
    }
  });

  it("cp -R payload/. 與 payload/* 到 state/ 被 OS 拒絕", async () => {
    const h = await setup({ workingDir: "folder" });
    const folder = h.fixture.folder;
    const stateDb = join(folder, "state", "cardiary.sqlite");
    const before = readFileSync(stateDb);
    mkdirSync(join(folder, "payload"), { recursive: true });
    writeFileSync(join(folder, "payload", "cardiary.sqlite"), "hacked");
    writeFileSync(join(folder, "payload", "notes.md"), "hacked");

    for (const command of ["cp -R payload/. state/", "cp -R payload/* state/"]) {
      const outcome = await h.run("run_command", { command });
      expectSandboxDenied(outcome);
      expect(readFileSync(stateDb).equals(before)).toBe(true);
      expect(existsSync(join(folder, "state", "notes.md"))).toBe(false);
    }

    const direct = await h.run("run_command", {
      command: "cp payload/cardiary.sqlite state/cardiary.sqlite",
    });
    expectSandboxDenied(direct);
    expect(readFileSync(stateDb).equals(before)).toBe(true);
  });

  it("括號與子殼層不是段落分隔，寫入 state 仍被 OS 拒絕", async () => {
    const h = await setup({ workingDir: "folder" });
    const stateDb = join(h.fixture.folder, "state", "cardiary.sqlite");
    const before = readFileSync(stateDb);

    for (const command of [
      "(echo x > state/cardiary.sqlite)",
      `cd state; (sed -i '' 's#original#hacked#' cardiary.sqlite)`,
    ]) {
      const outcome = await h.run("run_command", { command });
      expectSandboxDenied(outcome);
      expect(readFileSync(stateDb).equals(before)).toBe(true);
    }
  });

  it("正常命令、git status 與工作目錄寫入成功", async () => {
    const h = await setup({ workingDir: "folder" });
    const folder = h.fixture.folder;
    writeFileSync(join(folder, "notes.md"), "筆記\n");
    execFileSync("git", ["init", "-q", "."], { cwd: folder, stdio: "ignore" });

    const copied = await h.run("run_command", { command: "cp notes.md copy.md" });
    expect(copied.ok).toBe(true);
    expect(readFileSync(join(folder, "copy.md"), "utf8")).toBe("筆記\n");

    const cat = await h.run("run_command", { command: "cat notes.md" });
    expect(cat.ok).toBe(true);
    if (cat.ok) {
      const text = cat.content[0]?.type === "text" ? cat.content[0].text : "";
      expect(text).toContain("筆記");
    }

    const status = await h.run("run_command", { command: "git status --porcelain" });
    expect(status.ok).toBe(true);

    const written = await h.run("run_command", { command: "printf hi > new.txt" });
    expect(written.ok).toBe(true);
    expect(readFileSync(join(folder, "new.txt"), "utf8")).toBe("hi");

    const devnull = await h.run("run_command", { command: "ls > /dev/null && echo done" });
    expect(devnull.ok).toBe(true);
  });

  it("工作目錄在別處時，資料夾的 tmp 仍可寫入", async () => {
    const h = await setup({ workingDir: "project" });
    const outcome = await h.run("run_command", { command: `printf hi > "$TMPDIR/probe.txt"` });
    expect(outcome.ok).toBe(true);
    expect(readFileSync(join(h.fixture.folder, "tmp", "probe.txt"), "utf8")).toBe("hi");
  });

  it("憑證檔與家目錄的 .ssh 被拒絕讀取，一般檔案正常", async () => {
    const home = mkdtempSync(join(tmpdir(), "cardiary-sandbox-home-"));
    scratch.push(home);
    mkdirSync(join(home, ".ssh"), { recursive: true });
    writeFileSync(join(home, ".ssh", "id_ed25519"), "TOP-SECRET-KEY");
    const h = await setup({ workingDir: "folder", homeDir: home });
    writeFileSync(join(h.fixture.folder, ".env"), "SECRET=TOP-SECRET-VALUE");
    writeFileSync(join(h.fixture.folder, "notes.md"), "public");

    const env = await h.run("run_command", { command: "cat .env" });
    expectSandboxDenied(env);
    expect(JSON.stringify(env)).not.toContain("TOP-SECRET-VALUE");

    const ssh = await h.run("run_command", { command: `cat "$HOME/.ssh/id_ed25519"` });
    expectSandboxDenied(ssh);
    expect(JSON.stringify(ssh)).not.toContain("TOP-SECRET-KEY");

    const normal = await h.run("run_command", { command: "cat notes.md" });
    expect(normal.ok).toBe(true);
    if (normal.ok) {
      const text = normal.content[0]?.type === "text" ? normal.content[0].text : "";
      expect(text).toContain("public");
    }
  });

  it("sh -c、bash -lc、eval 與子殼層都不能逃出沙盒", async () => {
    const h = await setup({ workingDir: "folder" });
    const outside = h.fixture.outside;

    for (const command of [
      `sh -c "echo x > '${outside}/sh.txt'"`,
      `bash -lc "echo x > '${outside}/bash.txt'"`,
      `eval "echo x > '${outside}/eval.txt'"`,
      `(cd '${outside}' && echo x > subshell.txt)`,
    ]) {
      const outcome = await h.run("run_command", { command });
      expectSandboxDenied(outcome);
    }

    for (const name of ["sh.txt", "bash.txt", "eval.txt", "subshell.txt"]) {
      expect(existsSync(join(outside, name))).toBe(false);
    }
  });

  it("取消時整個 process group 結束，沒有孤兒", async () => {
    const h = await setup({ workingDir: "folder" });
    const controller = new AbortController();
    const pending = h.run(
      "run_command",
      { command: "sh -c 'echo $$ > nested.pid; sleep 30'" },
      { signal: controller.signal },
    );
    const pidFile = join(h.fixture.folder, "nested.pid");
    await waitUntil(() => existsSync(pidFile), 5000);
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    expect(Number.isInteger(pid)).toBe(true);

    controller.abort();
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    expect(outcome.diagnostics?.some((diagnostic) => diagnostic.code === "paused")).toBe(true);
    await waitUntil(() => !isRunning(pid), 5000);
    expect(isRunning(pid)).toBe(false);
  });
});

describe("sandbox 不可用", () => {
  it("沙盒不可用時明確失敗，不會退回無沙盒的執行", async () => {
    const h = await makeLocalToolsHarness({ sandbox: null });
    harness = h;

    const outcome = await h.run("run_command", { command: "echo ran > proof.txt" });

    expect(outcome.ok).toBe(false);
    expect(outcome.diagnostics?.[0]?.code).toBe("tool-unavailable");
    expect(JSON.stringify(outcome)).toContain("sandbox-unavailable");
    expect(existsSync(join(h.fixture.project, "proof.txt"))).toBe(false);
  });

  it("sandbox-exec 啟動失敗時同樣 fail closed", async () => {
    const h = await makeLocalToolsHarness({
      sandbox: { executable: "/nonexistent/sandbox-exec", profile: "(version 1)" },
    });
    harness = h;

    const outcome = await h.run("run_command", { command: "echo ran > proof.txt" });

    expect(outcome.ok).toBe(false);
    expect(outcome.diagnostics?.[0]?.code).toBe("tool-unavailable");
    expect(JSON.stringify(outcome)).toContain("sandbox-unavailable");
    expect(existsSync(join(h.fixture.project, "proof.txt"))).toBe(false);
  });
});
