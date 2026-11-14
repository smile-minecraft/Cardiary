import { execFile, spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { promisify } from "node:util";
import { WebSocket } from "ws";

const run = promisify(execFile);

/**
 * 資料夾外零寫入的第二種量測：用 `sandbox-exec` 的白名單只允許寫
 * `<folder>`，跑一輪真的對話。
 *
 * `sandbox-exec` 已 deprecated 但可用（`docs/spec.md` 第 13 章）。任何越界
 * 寫入會出現在子行程的 stderr，測試就會失敗。
 */
const darwin = process.platform === "darwin";
const children: Array<ReturnType<typeof spawn>> = [];

afterEach(() => {
  for (const child of children.splice(0)) {
    child.kill("SIGTERM");
  }
});

async function runSandboxed(
  folder: string,
  scriptPath: string,
  profilePath: string,
): Promise<{
  readonly port: number;
  readonly token: string;
  readonly stderr: () => string;
}> {
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = resolve(here, "../dist/main.js");
  const child = spawn(
    "sandbox-exec",
    [
      "-f",
      profilePath,
      process.execPath,
      entry,
      "--engine",
      "pi",
      "--demo",
      "--initialize-folder",
      "--script",
      scriptPath,
      "--folder",
      folder,
    ],
    {
      env: {
        ...process.env,
        TMPDIR: join(folder, "tmp"),
        TMP: join(folder, "tmp"),
        TEMP: join(folder, "tmp"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.push(child);
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const ready = await new Promise<{ port: number; token: string }>((resolveReady, reject) => {
    let buffer = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const frame = JSON.parse(line) as {
          type?: string;
          clientPort?: number;
          clientToken?: string;
        };
        if (frame.type === "ready" && frame.clientPort !== undefined) {
          resolveReady({ port: frame.clientPort, token: frame.clientToken ?? "" });
        }
      } catch {
        reject(new Error(`stdout 出現非 JSON：${line}`));
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`服務提早結束（${code}）：${stderr}`)));
  });
  return { port: ready.port, token: ready.token, stderr: () => stderr };
}

describe.skipIf(!darwin || !existsSync("/usr/bin/sandbox-exec"))(
  "sandbox-exec 白名單（資料夾外零寫入）",
  () => {
    it("只允許寫資料夾時仍能完成一輪對話，stderr 沒有 deny", async () => {
      // `os.tmpdir()` 在 macOS 是 /var/...，實際路徑是 /private/var/...；
      // sandbox 的規則比對的是正規化後的路徑。
      const root = realpathSync(await mkdtemp(join(tmpdir(), "cardiary-sandbox-")));
      const folder = join(root, "Cardiary");
      await mkdir(folder, { recursive: true });
      const scriptPath = join(root, "script.json");
      await writeFile(scriptPath, JSON.stringify([[{ kind: "text", text: "沙盒回覆" }]]));
      const profilePath = join(root, "profile.sb");
      await writeFile(
        profilePath,
        [
          "(version 1)",
          "(allow default)",
          "(deny file-write*)",
          "(allow file-write*",
          `  (subpath "${folder}")`,
          '  (subpath "/dev")',
          ")",
          "",
        ].join("\n"),
      );

      // 正向對照：profile 必須真的擋住資料夾外的寫入，也要允許資料夾內的寫入。
      // 只 grep stderr 的話，profile 寫壞了也可能看起來「沒有 deny」。
      const outside = join(root, "outside.txt");
      const outsideAttempt = await run("sandbox-exec", [
        "-f",
        profilePath,
        "/bin/sh",
        "-c",
        `printf x > '${outside}'`,
      ]).then(
        () => "written",
        () => "denied",
      );
      expect(outsideAttempt).toBe("denied");
      expect(existsSync(outside)).toBe(false);

      const service = await runSandboxed(folder, scriptPath, profilePath);
      expect(service.token.length).toBe(43);

      // 反向對照：同一個 profile 允許寫資料夾（服務啟動後才寫，避免影響初始化）。
      const inside = join(folder, "inside.txt");
      const insideAttempt = await run("sandbox-exec", [
        "-f",
        profilePath,
        "/bin/sh",
        "-c",
        `printf x > '${inside}'`,
      ]).then(
        () => "written",
        () => "denied",
      );
      expect(insideAttempt).toBe("written");

      const ws = new WebSocket(`ws://127.0.0.1:${service.port}/v1/ws`);
      await new Promise<void>((resolveOpen, reject) => {
        ws.once("open", () => resolveOpen());
        ws.once("error", reject);
      });
      const frames: Array<Record<string, unknown>> = [];
      ws.on("message", (data) => {
        frames.push(JSON.parse(data.toString()) as Record<string, unknown>);
      });
      const send = (frame: Record<string, unknown>): void => {
        ws.send(JSON.stringify(frame));
      };
      const waitFor = async (
        predicate: (frame: Record<string, unknown>) => boolean,
        ms = 20_000,
      ): Promise<Record<string, unknown>> => {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          const found = frames.find(predicate);
          if (found) return found;
          await new Promise((resolveTick) => setTimeout(resolveTick, 20));
        }
        throw new Error(`等待 frame 逾時；已收到 ${frames.length} 則`);
      };

      send({
        v: 1,
        kind: "request",
        id: "1",
        type: "system.hello",
        payload: {
          protocol: { min: 1, max: 1 },
          client: { name: "sandbox", version: "0", platform: "other", instanceId: "s1" },
          auth: { token: service.token },
        },
      });
      await waitFor((frame) => frame.replyTo === "1");
      send({
        v: 1,
        kind: "request",
        id: "2",
        type: "session.create",
        payload: { clientRequestId: "sandbox-1" },
      });
      const created = await waitFor((frame) => frame.replyTo === "2");
      const sessionId = (created.payload as { session: { id: string } }).session.id;
      send({
        v: 1,
        kind: "request",
        id: "3",
        type: "session.subscribe",
        payload: { sessionId },
      });
      await waitFor((frame) => frame.replyTo === "3");
      send({
        v: 1,
        kind: "request",
        id: "4",
        type: "session.send_message",
        payload: { sessionId, text: "沙盒測試", delivery: "queue", clientMessageId: "sb-1" },
      });
      await waitFor((frame) => frame.replyTo === "4");
      const completed = await waitFor(
        (frame) =>
          frame.type === "stream.message_completed" &&
          (frame.payload as { entry: { text: string } }).entry.text === "沙盒回覆",
      );
      expect(completed.type).toBe("stream.message_completed");
      await new Promise<void>((resolveClose) => {
        ws.once("close", () => resolveClose());
        ws.close();
      });
      expect(service.stderr()).not.toContain("deny file-write");
    }, 60_000);
  },
);
