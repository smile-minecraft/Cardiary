import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";

/**
 * 控制模式的完整組裝：殼（這裡是假的 broker 回答者）、控制通道、
 * 供應商模型來源與設定模組。用真的 Pi Durable 組裝，對假 OpenAI
 * 伺服器發請求，不需要真的金鑰。
 */

const HOST_ENTRY = new URL("../../dist/main.js", import.meta.url).pathname;
const SECRET = "sk-test-run-control-0001";

const children: ChildProcess[] = [];
const servers: FakeOpenAI[] = [];
const folders: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  for (const server of servers.splice(0)) {
    await server.close();
  }
  for (const folder of folders.splice(0)) {
    await rm(folder, { recursive: true, force: true });
  }
});

interface Spawned {
  readonly folder: string;
  readonly clientPort: number;
  readonly clientToken: string;
  readonly frames: readonly Record<string, unknown>[];
  readonly stdoutLines: readonly string[];
  readonly brokerRequests: readonly string[];
  askBroker(route: string, payload: Record<string, unknown>): void;
  stderrText(): string;
  stop(): Promise<void>;
}

async function spawnControl(server: FakeOpenAI, keychainFound = true): Promise<Spawned> {
  const folder = await mkdtemp(join(tmpdir(), "cardiary-model-run-"));
  folders.push(folder);
  await mkdir(join(folder, "tmp"), { recursive: true });
  const clientToken = "C".repeat(43);
  const controlToken = "T".repeat(43);
  const brokerToken = "B".repeat(43);
  const child = spawn(process.execPath, [HOST_ENTRY, "--engine", "pi", "--initialize-folder"], {
    env: {
      ...process.env,
      TMPDIR: join(folder, "tmp"),
      TMP: join(folder, "tmp"),
      TEMP: join(folder, "tmp"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  child.stdin?.write(
    `${JSON.stringify({
      type: "init",
      protocol: 1,
      token: controlToken,
      brokerToken,
      folder: { path: folder },
      clientToken,
    })}\n`,
  );
  const frames: Array<Record<string, unknown>> = [];
  const stdoutLines: string[] = [];
  let stderrText = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrText += chunk;
  });
  const brokerRequests: string[] = [];
  let clientPort: number | null = null;
  const lines = createInterface({ input: child.stdout });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`等不到 ready；stderr：${stderrText}`)),
      15_000,
    );
    lines.on("line", (line) => {
      stdoutLines.push(line);
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(line) as Record<string, unknown>;
      } catch {
        reject(new Error(`stdout 出現非 JSON：${line}`));
        return;
      }
      if (frame.type === "ready") {
        clientPort = Number(frame.clientPort);
        clearTimeout(timer);
        resolve();
        return;
      }
      if (frame.kind === "hello") {
        send({
          v: 1,
          kind: "hello-ack",
          role: "shell",
          auth: { token: controlToken },
        });
        return;
      }
      if (frame.kind === "request" && typeof frame.route === "string") {
        brokerRequests.push(frame.route);
        if (frame.route === "broker.keychain.get") {
          send({
            v: 1,
            kind: "response",
            id: `broker_${String(frame.id)}`,
            replyTo: frame.id,
            auth: { token: controlToken },
            ok: true,
            payload: keychainFound ? { found: true, value: SECRET } : { found: false },
          });
        }
      }
    });
    child.once("exit", (code) => reject(new Error(`服務提早結束：${code ?? "null"}`)));
  });
  function send(frame: Record<string, unknown>): void {
    child.stdin?.write(`${JSON.stringify(frame)}\n`);
  }
  await ready;
  if (clientPort === null) throw new Error("ready 沒有 clientPort");
  return {
    folder,
    clientPort,
    clientToken,
    frames,
    stdoutLines,
    brokerRequests,
    askBroker: (route, payload) => {
      send({
        v: 1,
        kind: "request",
        id: `test_${route}`,
        route,
        auth: { token: controlToken },
        payload,
      });
    },
    stderrText: () => stderrText,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 5_000);
          timer.unref?.();
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      lines.close();
    },
  };
}

async function connectWs(url: string, token: string, frames: Array<Record<string, unknown>>) {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  ws.on("message", (data) => {
    frames.push(JSON.parse(data.toString()) as Record<string, unknown>);
  });
  const request = (type: string, payload: Record<string, unknown>): string => {
    const id = `t_${frames.length}_${Math.random().toString(36).slice(2, 8)}`;
    ws.send(JSON.stringify({ v: 1, kind: "request", id, type, payload }));
    return id;
  };
  ws.send(
    JSON.stringify({
      v: 1,
      kind: "request",
      id: "hello",
      type: "system.hello",
      payload: {
        protocol: { min: 1, max: 1 },
        client: { name: "test", version: "0", platform: "other", instanceId: "test-control" },
        auth: { token },
      },
    }),
  );
  return { ws, frames, request, close: () => ws.close() };
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  ms = 10_000,
  debug?: () => string,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`等不到 ${label}${debug === undefined ? "" : `；${debug()}`}`);
}

async function scanForSecret(root: string, secret: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      const content = await readFile(path);
      if (content.includes(secret)) found.push(path);
    }
  }
  await walk(root);
  return found;
}

describe("控制模式端到端", () => {
  it("設定模型後，對話由真實供應商請求回應；金鑰只經 broker.keychain.get 取得", async () => {
    const server = await startFakeOpenAI({ chat: () => ({ kind: "text", text: "真實回覆" }) });
    servers.push(server);
    const spawned = await spawnControl(server);
    try {
      const wsFrames: Array<Record<string, unknown>> = [];
      const client = await connectWs(
        `ws://127.0.0.1:${spawned.clientPort}/v1/ws`,
        spawned.clientToken,
        wsFrames,
      );
      await waitFor(() => wsFrames.some((frame) => frame.replyTo === "hello"), "system.hello 回應");
      const setId = client.request("system.models.set", {
        providers: [
          {
            providerId: "vendor",
            kind: "api-key",
            displayName: "假供應商",
            baseUrl: server.baseUrl,
            credentialRef: "cardiary/provider/vendor",
            models: [{ modelId: "vendor-model", contextWindow: 32_768, input: ["text"] }],
          },
        ],
        roles: [
          {
            role: "main",
            mode: "model",
            ref: { providerId: "vendor", modelId: "vendor-model" },
          },
        ],
        clientRequestId: "models-set-1",
      });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === setId),
        "system.models.set 回應",
      );
      const setReply = wsFrames.find((frame) => frame.replyTo === setId);
      expect(JSON.stringify(setReply)).not.toContain(SECRET);

      const createId = client.request("session.create", { clientRequestId: "session-1" });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === createId),
        "session.create 回應",
      );
      const createReply = wsFrames.find((frame) => frame.replyTo === createId);
      const sessionId = ((createReply?.payload as { session?: { id?: string } } | undefined)
        ?.session?.id ?? "") as string;
      expect(sessionId).not.toBe("");
      const subscribeId = client.request("session.subscribe", { sessionId });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === subscribeId),
        "session.subscribe 回應",
      );
      const sendId = client.request("session.send_message", {
        sessionId,
        text: "你好",
        delivery: "queue",
        clientMessageId: "message-1",
      });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === sendId),
        "session.send_message 回應",
        10_000,
        () => JSON.stringify(wsFrames.at(-1)),
      );
      const sendReply = wsFrames.find((frame) => frame.replyTo === sendId);
      if (sendReply?.kind === "error") {
        throw new Error(`send_message 失敗：${JSON.stringify(sendReply)}`);
      }
      await waitFor(
        () =>
          wsFrames.some(
            (frame) => frame.kind === "event" && frame.type === "stream.message_completed",
          ),
        "串流回覆完成",
        10_000,
        () => wsFrames.map((frame) => String(frame.type ?? frame.kind)).join(","),
      );

      expect(spawned.brokerRequests).toContain("broker.keychain.get");
      const completion = server.requests.find((request) =>
        request.path.endsWith("/chat/completions"),
      );
      expect(completion?.headers.authorization).toBe(`Bearer ${SECRET}`);
      expect(completion?.body.model).toBe("vendor-model");
      expect(await scanForSecret(spawned.folder, SECRET)).toEqual([]);
      expect(spawned.stdoutLines.join("\n")).not.toContain(SECRET);
      expect(spawned.stderrText()).not.toContain(SECRET);
      client.close();
    } finally {
      await spawned.stop();
    }
  }, 30_000);

  it("讀不到金鑰時，回合以 unavailable 與 credential_missing 結束，不送出請求", async () => {
    const server = await startFakeOpenAI({ chat: () => ({ kind: "text", text: "不該出現" }) });
    servers.push(server);
    const spawned = await spawnControl(server, false);
    try {
      const wsFrames: Array<Record<string, unknown>> = [];
      const client = await connectWs(
        `ws://127.0.0.1:${spawned.clientPort}/v1/ws`,
        spawned.clientToken,
        wsFrames,
      );
      await waitFor(() => wsFrames.some((frame) => frame.replyTo === "hello"), "system.hello 回應");
      const setId = client.request("system.models.set", {
        providers: [
          {
            providerId: "vendor",
            kind: "api-key",
            displayName: "假供應商",
            baseUrl: server.baseUrl,
            credentialRef: "cardiary/provider/vendor",
            models: [{ modelId: "vendor-model", contextWindow: 32_768, input: ["text"] }],
          },
        ],
        roles: [
          {
            role: "main",
            mode: "model",
            ref: { providerId: "vendor", modelId: "vendor-model" },
          },
        ],
        clientRequestId: "models-set-no-key",
      });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === setId),
        "system.models.set 回應",
      );
      const createId = client.request("session.create", { clientRequestId: "session-2" });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === createId),
        "session.create 回應",
      );
      const createReply = wsFrames.find((frame) => frame.replyTo === createId);
      const sessionId = ((createReply?.payload as { session?: { id?: string } } | undefined)
        ?.session?.id ?? "") as string;
      const subscribeId = client.request("session.subscribe", { sessionId });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === subscribeId),
        "session.subscribe 回應",
      );
      const sendId = client.request("session.send_message", {
        sessionId,
        text: "你好",
        delivery: "queue",
        clientMessageId: "message-2",
      });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === sendId),
        "session.send_message 回應",
      );
      await waitFor(
        () =>
          wsFrames.some(
            (frame) =>
              frame.kind === "event" &&
              frame.type === "stream.turn_state" &&
              (frame.payload as { state?: string } | undefined)?.state === "failed",
          ),
        "回合失敗",
        10_000,
        () => wsFrames.map((frame) => String(frame.type ?? frame.kind)).join(","),
      );
      const failed = wsFrames.find(
        (frame) =>
          frame.kind === "event" &&
          frame.type === "stream.turn_state" &&
          (frame.payload as { state?: string } | undefined)?.state === "failed",
      );
      expect(failed?.payload).toMatchObject({
        state: "failed",
        error: {
          code: "unavailable",
          retryable: false,
          details: { reason: "credential_missing" },
        },
      });
      expect(spawned.brokerRequests).toContain("broker.keychain.get");
      expect(server.requests).toHaveLength(0);
      client.close();
    } finally {
      await spawned.stop();
    }
  }, 30_000);

  it("供應商回 401 並回顯金鑰時，資料夾、輸出與事件都找不到金鑰", async () => {
    const encoded = encodeURIComponent(SECRET);
    const server = await startFakeOpenAI({
      chat: () => ({
        kind: "status",
        status: 401,
        body: JSON.stringify({
          error: {
            message: `Incorrect API key provided: ${SECRET}. Authorization: Bearer ${SECRET}; encoded=${encoded}`,
          },
        }),
        headers: { "x-echo-authorization": `Bearer ${SECRET}` },
      }),
    });
    servers.push(server);
    const spawned = await spawnControl(server);
    try {
      const wsFrames: Array<Record<string, unknown>> = [];
      const client = await connectWs(
        `ws://127.0.0.1:${spawned.clientPort}/v1/ws`,
        spawned.clientToken,
        wsFrames,
      );
      await waitFor(() => wsFrames.some((frame) => frame.replyTo === "hello"), "system.hello 回應");
      const setId = client.request("system.models.set", {
        providers: [
          {
            providerId: "vendor",
            kind: "api-key",
            displayName: "假供應商",
            baseUrl: server.baseUrl,
            credentialRef: "cardiary/provider/vendor",
            models: [{ modelId: "vendor-model", contextWindow: 32_768, input: ["text"] }],
          },
        ],
        roles: [
          {
            role: "main",
            mode: "model",
            ref: { providerId: "vendor", modelId: "vendor-model" },
          },
        ],
        clientRequestId: "models-set-echo",
      });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === setId),
        "system.models.set 回應",
      );
      const createId = client.request("session.create", { clientRequestId: "session-echo" });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === createId),
        "session.create 回應",
      );
      const createReply = wsFrames.find((frame) => frame.replyTo === createId);
      const sessionId = ((createReply?.payload as { session?: { id?: string } } | undefined)
        ?.session?.id ?? "") as string;
      const subscribeId = client.request("session.subscribe", { sessionId });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === subscribeId),
        "session.subscribe 回應",
      );
      const sendId = client.request("session.send_message", {
        sessionId,
        text: "你好",
        delivery: "queue",
        clientMessageId: "message-echo",
      });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === sendId),
        "session.send_message 回應",
      );
      await waitFor(
        () =>
          wsFrames.some(
            (frame) =>
              frame.kind === "event" &&
              frame.type === "stream.turn_state" &&
              (frame.payload as { state?: string } | undefined)?.state === "failed",
          ),
        "回合失敗",
        10_000,
        () => JSON.stringify(wsFrames.at(-1)),
      );
      const failed = wsFrames.find(
        (frame) =>
          frame.kind === "event" &&
          frame.type === "stream.turn_state" &&
          (frame.payload as { state?: string } | undefined)?.state === "failed",
      );
      expect(failed?.payload).toMatchObject({
        state: "failed",
        error: {
          code: "unavailable",
          retryable: false,
          details: { reason: "credential_invalid" },
        },
      });
      expect(spawned.brokerRequests).toContain("broker.keychain.get");
      expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET}`);

      expect(await scanForSecret(spawned.folder, SECRET)).toEqual([]);
      expect(await scanForSecret(spawned.folder, encoded)).toEqual([]);
      expect(spawned.stdoutLines.join("\n")).not.toContain(SECRET);
      expect(spawned.stdoutLines.join("\n")).not.toContain(encoded);
      expect(spawned.stderrText()).not.toContain(SECRET);
      expect(spawned.stderrText()).not.toContain(encoded);
      const events = JSON.stringify(wsFrames);
      expect(events).not.toContain(SECRET);
      expect(events).not.toContain(encoded);
      client.close();
    } finally {
      await spawned.stop();
    }
  }, 30_000);

  it("供應商額度用盡時，閘道把回合失敗轉成 rate_limited 並帶等待時間", async () => {
    const server = await startFakeOpenAI({
      chat: () => ({
        kind: "status",
        status: 429,
        // 這是 OpenAI 額度用盡的實際字樣；Pi 的引擎不重試這一種。
        body: JSON.stringify({ error: { message: "insufficient_quota: exceeded your quota" } }),
        headers: { "retry-after": "3" },
      }),
    });
    servers.push(server);
    const spawned = await spawnControl(server);
    try {
      const wsFrames: Array<Record<string, unknown>> = [];
      const client = await connectWs(
        `ws://127.0.0.1:${spawned.clientPort}/v1/ws`,
        spawned.clientToken,
        wsFrames,
      );
      await waitFor(() => wsFrames.some((frame) => frame.replyTo === "hello"), "system.hello 回應");
      const setId = client.request("system.models.set", {
        providers: [
          {
            providerId: "vendor",
            kind: "api-key",
            displayName: "假供應商",
            baseUrl: server.baseUrl,
            credentialRef: "cardiary/provider/vendor",
            models: [{ modelId: "vendor-model", contextWindow: 32_768, input: ["text"] }],
          },
        ],
        roles: [
          {
            role: "main",
            mode: "model",
            ref: { providerId: "vendor", modelId: "vendor-model" },
          },
        ],
        clientRequestId: "models-set-quota",
      });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === setId),
        "system.models.set 回應",
      );
      const createId = client.request("session.create", { clientRequestId: "session-quota" });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === createId),
        "session.create 回應",
      );
      const createReply = wsFrames.find((frame) => frame.replyTo === createId);
      const sessionId = ((createReply?.payload as { session?: { id?: string } } | undefined)
        ?.session?.id ?? "") as string;
      const subscribeId = client.request("session.subscribe", { sessionId });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === subscribeId),
        "session.subscribe 回應",
      );
      const sendId = client.request("session.send_message", {
        sessionId,
        text: "你好",
        delivery: "queue",
        clientMessageId: "message-quota",
      });
      await waitFor(
        () => wsFrames.some((frame) => frame.replyTo === sendId),
        "session.send_message 回應",
      );
      await waitFor(
        () =>
          wsFrames.some(
            (frame) =>
              frame.kind === "event" &&
              frame.type === "stream.turn_state" &&
              (frame.payload as { state?: string } | undefined)?.state === "failed",
          ),
        "回合失敗",
        10_000,
        () => JSON.stringify(wsFrames.at(-1)),
      );
      const failed = wsFrames.find(
        (frame) =>
          frame.kind === "event" &&
          frame.type === "stream.turn_state" &&
          (frame.payload as { state?: string } | undefined)?.state === "failed",
      );
      expect(failed?.payload).toMatchObject({
        state: "failed",
        error: {
          code: "rate_limited",
          retryable: true,
          details: { reason: "quota_exceeded", retryAfterMs: 3_000 },
        },
      });
      expect(spawned.stdoutLines.join("\n")).not.toContain(SECRET);
      expect(spawned.stderrText()).not.toContain(SECRET);
      client.close();
    } finally {
      await spawned.stop();
    }
  }, 30_000);
});
