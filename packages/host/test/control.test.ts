import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { BrokerClient, BrokerCredentialSource } from "../src/control/broker.js";
import { ControlChannel } from "../src/control/channel.js";
import { LineWriter } from "../src/control/ndjson.js";
import { SilentLogger } from "../src/logging.js";

const TOKEN = "T".repeat(43);
const BROKER = "B".repeat(43);

interface Harness {
  readonly input: PassThrough;
  readonly lines: Array<Record<string, unknown>>;
  readonly channel: ControlChannel;
  readonly closed: string[];
}

function createHarness(options?: { readonly brokerTimeoutMs?: number }): Harness {
  const input = new PassThrough();
  const lines: Array<Record<string, unknown>> = [];
  const closed: string[] = [];
  const writer = new LineWriter((chunk, callback) => {
    lines.push(JSON.parse(chunk) as Record<string, unknown>);
    callback(null);
  });
  const channel = new ControlChannel({
    input,
    writer,
    token: TOKEN,
    brokerToken: BROKER,
    logger: new SilentLogger(),
    brokerTimeoutMs: options?.brokerTimeoutMs ?? 50,
    handshakeTimeoutMs: 500,
    onClose: (reason) => closed.push(reason),
  });
  channel.start();
  return { input, lines, channel, closed };
}

function write(input: PassThrough, frame: Record<string, unknown>): void {
  input.write(`${JSON.stringify(frame)}\n`);
}

async function waitUntil(check: () => boolean, ms = 1000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("等待逾時");
}

async function handshake(harness: Harness): Promise<void> {
  const ready = harness.channel.handshake();
  await waitUntil(() => harness.lines.some((line) => line.kind === "hello"));
  write(harness.input, {
    v: 1,
    kind: "hello-ack",
    role: "shell",
    auth: { token: TOKEN },
  });
  await ready;
}

describe("私有控制面（服務端）", () => {
  it("交握：hello 帶 brokerToken，hello-ack 驗控制 Token", async () => {
    const harness = createHarness();
    await handshake(harness);
    const hello = harness.lines.find((line) => line.kind === "hello");
    expect(hello?.auth).toEqual({ token: BROKER });
    expect(hello?.pid).toBe(process.pid);
    expect(harness.channel.handshakeDone).toBe(true);
  });

  it("缺 Token 或錯 Token：回 unauthorized、沒有 payload、關閉通道", async () => {
    const harness = createHarness();
    await handshake(harness);
    harness.channel.onRequest("control.health", async () => ({ state: "running" }));
    write(harness.input, {
      v: 1,
      kind: "request",
      id: "c1",
      route: "control.health",
      auth: { token: BROKER },
      payload: {},
    });
    await waitUntil(() => harness.lines.some((line) => line.replyTo === "c1"));
    const response = harness.lines.find((line) => line.replyTo === "c1");
    expect(response?.ok).toBe(false);
    expect((response?.error as { code: string }).code).toBe("unauthorized");
    expect(response?.payload).toBeUndefined();
    await waitUntil(() => harness.channel.closed);
    expect(harness.closed).toContain("unauthorized");
    const second = createHarness();
    await handshake(second);
    write(second.input, { v: 1, kind: "request", id: "c2", route: "control.health", payload: {} });
    await waitUntil(() => second.channel.closed);
  });

  it("缺 auth.token 回 unauthorized（不是 invalid_message）並關閉通道", async () => {
    const harness = createHarness();
    await handshake(harness);
    harness.channel.onRequest("control.health", async () => ({ state: "running" }));
    write(harness.input, {
      v: 1,
      kind: "request",
      id: "no-token",
      route: "control.health",
      payload: {},
    });
    await waitUntil(() => harness.lines.some((line) => line.replyTo === "no-token"));
    const response = harness.lines.find((line) => line.replyTo === "no-token");
    expect((response?.error as { code: string }).code).toBe("unauthorized");
    expect(response?.payload).toBeUndefined();
    await waitUntil(() => harness.channel.closed);
    expect(harness.closed).toContain("unauthorized");
  });

  it("路由白名單：未知路由回 unsupported_route，通道保留", async () => {
    const harness = createHarness();
    await handshake(harness);
    harness.channel.onRequest("control.health", async () => ({ state: "running" }));
    write(harness.input, {
      v: 1,
      kind: "request",
      id: "c1",
      route: "broker.keychain.list",
      auth: { token: TOKEN },
      payload: {},
    });
    await waitUntil(() => harness.lines.some((line) => line.replyTo === "c1"));
    expect(
      (harness.lines.find((line) => line.replyTo === "c1")?.error as { code: string }).code,
    ).toBe("unsupported_route");
    write(harness.input, {
      v: 1,
      kind: "request",
      id: "c2",
      route: "control.health",
      auth: { token: TOKEN },
      payload: {},
    });
    await waitUntil(() => harness.lines.some((line) => line.replyTo === "c2"));
    expect(harness.lines.find((line) => line.replyTo === "c2")?.ok).toBe(true);
    expect(harness.channel.closed).toBe(false);
  });

  it("同一路由的第二個在途請求回 busy", async () => {
    const harness = createHarness();
    await handshake(harness);
    let release: (() => void) | null = null;
    harness.channel.onRequest("control.pause", async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { state: "paused" };
    });
    write(harness.input, {
      v: 1,
      kind: "request",
      id: "c1",
      route: "control.pause",
      auth: { token: TOKEN },
      payload: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    write(harness.input, {
      v: 1,
      kind: "request",
      id: "c2",
      route: "control.pause",
      auth: { token: TOKEN },
      payload: {},
    });
    await waitUntil(() => harness.lines.some((line) => line.replyTo === "c2"));
    expect(
      (harness.lines.find((line) => line.replyTo === "c2")?.error as { code: string }).code,
    ).toBe("busy");
    release?.();
    await waitUntil(() => harness.lines.some((line) => line.replyTo === "c1"));
    expect(harness.lines.find((line) => line.replyTo === "c1")?.ok).toBe(true);
  });

  it("broker 回應的 replyTo 對不上在途請求時關閉通道", async () => {
    const harness = createHarness();
    await handshake(harness);
    write(harness.input, {
      v: 1,
      kind: "response",
      id: "x",
      replyTo: "nobody",
      auth: { token: TOKEN },
      ok: true,
      payload: {},
    });
    await waitUntil(() => harness.channel.closed);
    expect(harness.closed).toContain("invalid_message");
  });

  it("broker 請求逾時會拒絕，通道保留", async () => {
    const harness = createHarness({ brokerTimeoutMs: 30 });
    await handshake(harness);
    await expect(harness.channel.requestBroker("broker.folder.get", {})).rejects.toMatchObject({
      code: "timeout",
    });
    expect(harness.channel.closed).toBe(false);
  });

  it("代理路由：broker.keychain.get 只回單一項目，金鑰留在記憶體", async () => {
    const harness = createHarness({ brokerTimeoutMs: 2000 });
    await handshake(harness);
    const broker = new BrokerClient(harness.channel);
    const promise = broker.keychain("provider/openai/api-key");
    await waitUntil(() => harness.lines.some((line) => line.kind === "request"));
    const request = harness.lines.find((line) => line.kind === "request");
    expect(request?.route).toBe("broker.keychain.get");
    expect(request?.auth).toEqual({ token: BROKER });
    write(harness.input, {
      v: 1,
      kind: "response",
      id: "x",
      replyTo: request?.id,
      auth: { token: TOKEN },
      ok: true,
      payload: { found: true, value: "sk-test" },
    });
    await expect(promise).resolves.toEqual({ found: true, value: "sk-test" });
    const credentials = new BrokerCredentialSource(broker);
    const credentialPromise = credentials.resolve("provider/openai/api-key");
    await waitUntil(() => harness.lines.filter((line) => line.kind === "request").length >= 2);
    const second = harness.lines.filter((line) => line.kind === "request")[1];
    write(harness.input, {
      v: 1,
      kind: "response",
      id: "y",
      replyTo: second?.id,
      auth: { token: TOKEN },
      ok: true,
      payload: { found: true, value: "sk-test" },
    });
    await expect(credentialPromise).resolves.toEqual({
      provider: "openai",
      kind: "api-key",
      secret: "sk-test",
    });
  });

  it("hello 驗證前不送通知；之後的通知帶 brokerToken", async () => {
    const harness = createHarness();
    await harness.channel.notify("notify.fatal", { reason: "storage_io", detail: "x" });
    expect(harness.lines).toHaveLength(0);
    await handshake(harness);
    await harness.channel.notify("notify.maintenance", { lifecycle: "deleting", operationId: "1" });
    const notification = harness.lines.find((line) => line.kind === "notification");
    expect(notification?.auth).toEqual({ token: BROKER });
    expect(notification?.route).toBe("notify.maintenance");
  });

  it("壞 JSON 或缺欄位會關閉通道", async () => {
    const harness = createHarness();
    await handshake(harness);
    harness.input.write("not json\n");
    await waitUntil(() => harness.channel.closed);
    expect(harness.closed).toContain("invalid_message");
  });

  it("stdin 結束時通知呼叫端（stdin_end）", async () => {
    const harness = createHarness();
    await handshake(harness);
    harness.input.end();
    await waitUntil(() => harness.channel.closed);
    expect(harness.closed).toContain("stdin_end");
  });

  it("hello-ack 帶錯 Token 會關閉通道", async () => {
    const harness = createHarness();
    void harness.channel.handshake().catch(() => undefined);
    await waitUntil(() => harness.lines.some((line) => line.kind === "hello"));
    write(harness.input, { v: 1, kind: "hello-ack", role: "shell", auth: { token: BROKER } });
    await waitUntil(() => harness.channel.closed);
    expect(harness.closed).toContain("unauthorized");
  });
});
