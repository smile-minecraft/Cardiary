import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
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

interface SandboxedService {
  readonly port: number;
  readonly token: string;
  readonly stderr: () => string;
}

async function runSandboxed(
  folder: string,
  scriptPath: string,
  profilePath: string,
  options: { readonly demo: boolean },
): Promise<SandboxedService> {
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
      ...(options.demo ? ["--demo"] : []),
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

/** 最小協定客戶端；sandbox 測試只需要請求、事件與逾時等待。 */
async function connectClient(service: SandboxedService) {
  const ws = new WebSocket(`ws://127.0.0.1:${service.port}/v1/ws`);
  await new Promise<void>((resolveOpen, reject) => {
    ws.once("open", () => resolveOpen());
    ws.once("error", reject);
  });
  const frames: Array<Record<string, unknown>> = [];
  ws.on("message", (data) => {
    frames.push(JSON.parse(data.toString()) as Record<string, unknown>);
  });
  let counter = 0;
  const send = (type: string, payload: Record<string, unknown>): string => {
    const id = String(++counter);
    ws.send(JSON.stringify({ v: 1, kind: "request", id, type, payload }));
    return id;
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
  const request = async (
    type: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const id = send(type, payload);
    return waitFor((frame) => frame.replyTo === id);
  };
  const hello = await request("system.hello", {
    protocol: { min: 1, max: 1 },
    client: { name: "sandbox", version: "0", platform: "other", instanceId: "s1" },
    auth: { token: service.token },
  });
  expect(hello.kind).toBe("response");
  return {
    frames,
    request,
    waitFor,
    async close() {
      await new Promise<void>((resolveClose) => {
        ws.once("close", () => resolveClose());
        ws.close();
      });
    },
  };
}

type Client = Awaited<ReturnType<typeof connectClient>>;

async function openSession(client: Client, clientRequestId: string): Promise<string> {
  const created = await client.request("session.create", { clientRequestId });
  const sessionId = (created.payload as { session: { id: string } }).session.id;
  await client.request("session.subscribe", { sessionId });
  return sessionId;
}

async function sendMessage(
  client: Client,
  sessionId: string,
  text: string,
  clientMessageId: string,
): Promise<void> {
  await client.request("session.send_message", {
    sessionId,
    text,
    delivery: "queue",
    clientMessageId,
  });
}

/** 核准或拒絕一筆審批；sandbox 測試的審批都是本機工具發出的。 */
async function decide(
  client: Client,
  approvalId: string,
  optionId: "approve" | "deny" | "always",
): Promise<Record<string, unknown>> {
  return client.request("approval.decide", { approvalId, optionId });
}

/**
 * 依序核准審批，直到累積 `count` 個工具結果。
 *
 * 產品引擎在同一個回合裡連續執行腳本中的工具呼叫，審批會一個接一個出現；
 * 這裡不假設「一個訊息一個回合」。
 */
async function runTools(
  client: Client,
  count: number,
): Promise<readonly Record<string, unknown>[]> {
  let decided = 0;
  for (;;) {
    const approvals = client.frames.filter((frame) => frame.type === "approval.requested");
    const results = () => client.frames.filter((frame) => frame.type === "stream.tool_result");
    if (results().length >= count) return results();
    await client.waitFor(
      () =>
        client.frames.filter((frame) => frame.type === "approval.requested").length > decided ||
        client.frames.filter((frame) => frame.type === "stream.tool_result").length >= count,
    );
    const next = client.frames.filter((frame) => frame.type === "approval.requested");
    if (next.length > decided) {
      const latest = next[next.length - 1]!;
      await decide(client, (latest.payload as { approvalId: string }).approvalId, "approve");
      decided = next.length;
      continue;
    }
    if (approvals.length === 0) {
      await client.waitFor(
        () => client.frames.filter((frame) => frame.type === "approval.requested").length > 0,
      );
    }
  }
}

async function writeProfile(root: string, folder: string): Promise<string> {
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
  return profilePath;
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
      const profilePath = await writeProfile(root, folder);

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

      const service = await runSandboxed(folder, scriptPath, profilePath, { demo: true });
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

      const client = await connectClient(service);
      try {
        const sessionId = await openSession(client, "sandbox-1");
        await sendMessage(client, sessionId, "沙盒測試", "sb-1");
        const completed = await client.waitFor(
          (frame) =>
            frame.type === "stream.message_completed" &&
            (frame.payload as { entry: { text: string } }).entry.text === "沙盒回覆",
        );
        expect(completed.type).toBe("stream.message_completed");
      } finally {
        await client.close();
      }
      expect(service.stderr()).not.toContain("deny file-write");
    }, 60_000);

    it("跑過真實的檔案工具後，資料夾外仍然沒有寫入", async () => {
      const root = realpathSync(await mkdtemp(join(tmpdir(), "cardiary-sandbox-tools-")));
      const folder = join(root, "Cardiary");
      await mkdir(folder, { recursive: true });
      const scriptPath = join(root, "script.json");
      // `run_command` 自己會在子行程外層套 sandbox-exec；macOS 不支援巢狀沙盒
      // （第二層會得到 sandbox_apply: Operation not permitted），所以這一輪只量
      // 服務層級的寫入。指令工具的越界寫入由本機工具自己的沙盒測試涵蓋。
      await writeFile(
        scriptPath,
        JSON.stringify([
          [
            {
              kind: "tool",
              toolName: "write_file",
              input: { path: "notes/output.txt", content: "沙盒寫入" },
            },
            {
              kind: "tool",
              toolName: "write_file",
              input: { path: "notes/second.txt", content: "第二次" },
            },
          ],
        ]),
      );
      const profilePath = await writeProfile(root, folder);
      await mkdir(join(folder, "notes"), { recursive: true });

      const service = await runSandboxed(folder, scriptPath, profilePath, { demo: false });
      const client = await connectClient(service);
      try {
        const sessionId = await openSession(client, "sandbox-tools");
        await sendMessage(client, sessionId, "跑工具", "sbt-1");
        const results = await runTools(client, 2);

        expect((results[0]!.payload as { status: string }).status).toBe("ok");
        expect((results[1]!.payload as { status: string }).status).toBe("ok");
        expect(readFileSync(join(folder, "notes/output.txt"), "utf8")).toBe("沙盒寫入");
        expect(readFileSync(join(folder, "notes/second.txt"), "utf8")).toBe("第二次");
        expect(service.stderr()).not.toContain("deny file-write");
      } finally {
        await client.close();
      }
    }, 90_000);
  },
);
