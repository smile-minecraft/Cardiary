import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SpawnRegistry, InvalidStdioError } from "../src/spawn/wrapper.js";
import { constantTimeEqual, generateToken, isValidToken, tokenFingerprint } from "../src/tokens.js";

function run(
  command: string,
  args: readonly string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => resolve({ stdout, stderr, code }));
  });
}

describe("Token 與連線邊界", () => {
  it("Token 格式與常數時間比較", () => {
    const token = generateToken();
    expect(isValidToken(token)).toBe(true);
    expect(token).toHaveLength(43);
    expect(isValidToken("short")).toBe(false);
    expect(isValidToken("!".repeat(43))).toBe(false);
    expect(constantTimeEqual(token, token)).toBe(true);
    expect(constantTimeEqual(token, generateToken())).toBe(false);
    expect(constantTimeEqual(token, `${token.slice(0, 42)}x`)).toBe(false);
    expect(constantTimeEqual(token, 42)).toBe(false);
    expect(tokenFingerprint(token)).toMatch(/^[0-9a-f]{8}$/);
    expect(tokenFingerprint(token)).not.toContain(token.slice(0, 8));
  });
});

describe("共用 spawn wrapper", () => {
  it("要求 inherit 時丟 invalid_stdio，且不啟動子行程", () => {
    const registry = new SpawnRegistry();
    expect(() =>
      registry.spawn({
        command: "/bin/sh",
        args: ["-c", "sleep 5"],
        stdio: ["inherit", "pipe", "pipe"],
      }),
    ).toThrow(InvalidStdioError);
    expect(registry.runningCount).toBe(0);
  });

  it("子行程的 /dev/fd 沒有控制通道，stdio 是自己的 pipe", async () => {
    const registry = new SpawnRegistry();
    const probe = `
      const fs = require("node:fs");
      const entries = fs.readdirSync("/dev/fd");
      const sockets = entries.filter((fd) => {
        try {
          return fs.fstatSync(Number(fd)).isSocket();
        } catch {
          return false;
        }
      });
      process.stdout.write(JSON.stringify({ entries, sockets }));
    `;
    const child = registry.spawn({
      command: process.execPath,
      args: ["-e", probe],
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    for await (const chunk of child.stdout ?? []) {
      output += chunk.toString();
    }
    await child.exited;
    const parsed = JSON.parse(output) as { entries: string[]; sockets: string[] };
    // 服務的 stdin／stdout 是 socketpair；子行程只拿到自己的 0、1、2，
    // 沒有任何額外的 socket（控制通道若外流，這裡會多一個）。
    expect([...parsed.sockets].sort()).toEqual(["0", "1", "2"]);
  });

  it("取消時對整個 process group 送訊號，孫行程也會結束", async () => {
    const registry = new SpawnRegistry();
    const child = registry.spawn({
      command: "/bin/sh",
      args: ["-c", "sleep 30 & sleep 30 & wait"],
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pgid = await new Promise<number>((resolve) => {
      const ps = spawn("ps", ["-o", "pgid=", "-p", String(child.pid)], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      ps.stdout.on("data", (chunk) => {
        out += chunk.toString();
      });
      ps.on("exit", () => resolve(Number.parseInt(out.trim(), 10)));
    });
    expect(pgid).toBe(child.pid);
    const before = await run("ps", ["-eo", "pgid="]);
    const countBefore = before.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((value) => value === String(pgid)).length;
    expect(countBefore).toBeGreaterThanOrEqual(2);
    const terminated = await registry.cancelAll(100);
    expect(terminated).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = await run("ps", ["-eo", "pgid="]);
    const countAfter = after.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((value) => value === String(pgid)).length;
    expect(countAfter).toBe(0);
  });

  it("只有 wrapper 可以匯入 node:child_process", async () => {
    const root = new URL("../src/", import.meta.url).pathname;
    const files: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
        } else if (entry.name.endsWith(".ts")) {
          files.push(path);
        }
      }
    };
    await walk(root);
    const offenders: string[] = [];
    for (const file of files) {
      const content = await readFile(file, "utf8");
      if (content.includes("node:child_process") && !file.endsWith("spawn/wrapper.ts")) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("stdout 執行期守門", () => {
  it("非協定輸出被導到 stderr，stdout 只有協定 frame", async () => {
    const moduleUrl = new URL("../dist/control/stdoutGuard.js", import.meta.url).href;
    const script = `
      const { installStdoutGuard } = await import(${JSON.stringify(moduleUrl)});
      const sink = installStdoutGuard();
      console.log("console leak");
      process.stdout.write("raw leak\\n");
      await sink.writeLine('{"type":"ready"}');
      await sink.flush();
      process.exit(0);
    `;
    const result = await run(process.execPath, ["--input-type=module", "-e", script]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('{"type":"ready"}');
    expect(result.stderr).toContain("[stdout-guard]");
    expect(result.stderr).toContain("console leak");
    expect(result.stderr).toContain("raw leak");
  });
});
