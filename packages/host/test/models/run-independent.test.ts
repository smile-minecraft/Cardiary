import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { startFakeOpenAI, type FakeOpenAI } from "./fake-openai.js";

/**
 * 無殼的獨立模式（`--folder`）：沒有控制通道、沒有 broker。
 *
 * 服務照常啟動並提供客戶端協定；模型設定可以存，但任何需要金鑰的供應商
 * 都取不到憑證，回合以 `credential_missing` 結束，且不會送出請求。
 */

const HOST_ENTRY = new URL("../../dist/main.js", import.meta.url).pathname;

const children: ChildProcess[] = [];
const servers: FakeOpenAI[] = [];
const folders: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
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
  }
  for (const server of servers.splice(0)) {
    await server.close();
  }
  for (const folder of folders.splice(0)) {
    await rm(folder, { recursive: true, force: true });
  }
});

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

describe("沒有殼的獨立模式", () => {
  it("服務照常啟動；沒有憑證來源時回合以 credential_missing 結束，不送出請求", async () => {
    const server = await startFakeOpenAI({ chat: () => ({ kind: "text", text: "不該出現" }) });
    servers.push(server);
    const folderPath = await mkdtemp(join(tmpdir(), "cardiary-independent-"));
    folders.push(folderPath);
    await mkdir(join(folderPath, "state"), { recursive: true });
    await mkdir(join(folderPath, "tmp"), { recursive: true });
    const child = spawn(
      process.execPath,
      [HOST_ENTRY, "--engine", "pi", "--folder", folderPath, "--initialize-folder"],
      {
        env: {
          ...process.env,
          TMPDIR: join(folderPath, "tmp"),
          TMP: join(folderPath, "tmp"),
          TEMP: join(folderPath, "tmp"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    children.push(child);
    let stderrText = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrText += chunk;
    });
    const lines = createInterface({ input: child.stdout });
    const ready = await new Promise<{ clientPort: number; clientToken: string }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`等不到 ready；stderr：${stderrText}`)),
          15_000,
        );
        lines.on("line", (line) => {
          let frame: Record<string, unknown>;
          try {
            frame = JSON.parse(line) as Record<string, unknown>;
          } catch {
            clearTimeout(timer);
            reject(new Error(`stdout 出現非 JSON：${line}`));
            return;
          }
          if (frame.type === "ready") {
            clearTimeout(timer);
            resolve({
              clientPort: Number(frame.clientPort),
              clientToken: String(frame.clientToken),
            });
          }
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`服務提早結束：${code ?? "null"}`));
        });
      },
    );

    const frames: Array<Record<string, unknown>> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${ready.clientPort}/v1/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    ws.on("message", (data) => {
      frames.push(JSON.parse(data.toString()) as Record<string, unknown>);
    });
    const request = (id: string, type: string, payload: Record<string, unknown>): void => {
      ws.send(JSON.stringify({ v: 1, kind: "request", id, type, payload }));
    };
    const replied = (id: string): boolean => frames.some((frame) => frame.replyTo === id);
    const replyOf = (id: string): Record<string, unknown> | undefined =>
      frames.find((frame) => frame.replyTo === id);

    request("hello", "system.hello", {
      protocol: { min: 1, max: 1 },
      client: { name: "test", version: "0", platform: "other", instanceId: "test-independent" },
      auth: { token: ready.clientToken },
    });
    await waitFor(
      () => replied("hello"),
      "system.hello 回應",
      10_000,
      () => JSON.stringify(frames.at(-1)),
    );

    request("set", "system.models.set", {
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
        { role: "main", mode: "model", ref: { providerId: "vendor", modelId: "vendor-model" } },
      ],
      clientRequestId: "set-independent",
    });
    await waitFor(
      () => replied("set"),
      "system.models.set 回應",
      10_000,
      () => JSON.stringify(frames.at(-1)),
    );
    expect(replyOf("set")?.kind).not.toBe("error");

    request("create", "session.create", { clientRequestId: "session-independent" });
    await waitFor(
      () => replied("create"),
      "session.create 回應",
      10_000,
      () => JSON.stringify(frames.at(-1)),
    );
    const sessionId = (replyOf("create")?.payload as { session?: { id?: string } } | undefined)
      ?.session?.id;
    expect(sessionId).toBeDefined();

    request("subscribe", "session.subscribe", { sessionId });
    await waitFor(() => replied("subscribe"), "session.subscribe 回應", 10_000);
    request("message", "session.send_message", {
      sessionId,
      text: "你好",
      delivery: "queue",
      clientMessageId: "message-independent",
    });
    await waitFor(
      () => replied("message"),
      "session.send_message 回應",
      10_000,
      () => JSON.stringify(frames.at(-1)),
    );
    await waitFor(
      () =>
        frames.some(
          (frame) =>
            frame.kind === "event" &&
            frame.type === "stream.turn_state" &&
            (frame.payload as { state?: string } | undefined)?.state === "failed",
        ),
      "回合失敗",
      10_000,
      () => JSON.stringify(frames.at(-1)),
    );
    const failed = frames.find(
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
    expect(server.requests).toHaveLength(0);
    ws.close();
    lines.close();
  }, 30_000);
});
