import { describe, expect, it } from "vitest";

import {
  ProtocolClient,
  ProtocolRequestError,
  reconnectDelay,
  type WebSocketFactory,
  type WebSocketLike,
} from "../src/net/protocol-client";

/** 記錄所有送出的 frame，並可注入伺服器回應。 */
class FakeSocket implements WebSocketLike {
  static sockets: FakeSocket[] = [];

  readonly sent: Array<Record<string, unknown>> = [];
  readonly url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeSocket.sockets.push(this);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  close(code = 1000, reason = ""): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

const factory: WebSocketFactory = (url) => new FakeSocket(url);

function latest(): FakeSocket {
  const socket = FakeSocket.sockets.at(-1);
  if (!socket) throw new Error("沒有建立 WebSocket");
  return socket;
}

function lastSent(socket: FakeSocket): Record<string, unknown> {
  const frame = socket.sent.at(-1);
  if (!frame) throw new Error("沒有送出 frame");
  return frame;
}

describe("ProtocolClient 配對模式", () => {
  it("沒有 Token 時不送 system.hello，只送 pairing.begin", async () => {
    FakeSocket.sockets = [];
    const ready: string[] = [];
    const client = new ProtocolClient({
      instanceId: "web-instance-1",
      clientVersion: "0.1.0",
      url: "ws://127.0.0.1:18580/v1/ws",
      createWebSocket: factory,
      handlers: { onReady: () => ready.push("ready") },
    });
    client.start();
    const socket = latest();
    socket.open();

    expect(ready).toEqual(["ready"]);
    expect(socket.sent).toHaveLength(0);

    const pending = client.request("pairing.begin", {
      deviceName: "我的手機",
      kind: "web",
    });
    const begin = lastSent(socket);
    expect(begin.type).toBe("pairing.begin");
    expect(begin.kind).toBe("request");
    expect(typeof begin.id).toBe("string");

    socket.receive({
      v: 1,
      kind: "response",
      replyTo: begin.id,
      type: "pairing.begin",
      payload: {
        pairingRequestId: "pair_1",
        code: "ABC123",
        expiresAt: "2026-11-16T11:00:00.000Z",
      },
    });
    await expect(pending).resolves.toMatchObject({
      pairingRequestId: "pair_1",
      code: "ABC123",
    });
  });

  it("核准前 pairing.complete 的 conflict 錯誤會拒絕請求", async () => {
    FakeSocket.sockets = [];
    const client = new ProtocolClient({
      instanceId: "web-instance-1",
      clientVersion: "0.1.0",
      createWebSocket: factory,
    });
    client.start();
    latest().open();

    const pending = client.request("pairing.complete", { pairingRequestId: "pair_1" });
    const complete = lastSent(latest());
    latest().receive({
      v: 1,
      kind: "error",
      replyTo: complete.id,
      code: "conflict",
      message: "無法領取配對結果。",
      details: { reason: "not-approved" },
      retryable: false,
    });

    await expect(pending).rejects.toMatchObject({
      code: "conflict",
      details: { reason: "not-approved" },
    });
  });

  it("核准後同一條連線可領到 Token", async () => {
    FakeSocket.sockets = [];
    const client = new ProtocolClient({
      instanceId: "web-instance-1",
      clientVersion: "0.1.0",
      createWebSocket: factory,
    });
    client.start();
    const socket = latest();
    socket.open();

    const pending = client.request<{ deviceToken: string }>("pairing.complete", {
      pairingRequestId: "pair_1",
    });
    const complete = lastSent(socket);
    socket.receive({
      v: 1,
      kind: "response",
      replyTo: complete.id,
      type: "pairing.complete",
      payload: {
        deviceId: "dev_1",
        deviceName: "我的手機",
        deviceToken: "device-token-plain",
      },
    });

    await expect(pending).resolves.toMatchObject({ deviceToken: "device-token-plain" });
    expect(socket.sent).toHaveLength(1);
  });
});

describe("ProtocolClient 驗證模式", () => {
  it("Token 放在 system.hello payload，連線網址不含 Token", () => {
    FakeSocket.sockets = [];
    const client = new ProtocolClient({
      token: "secret-device-token",
      instanceId: "web-instance-2",
      clientVersion: "0.1.2",
      url: "wss://example.test/v1/ws",
      createWebSocket: factory,
    });
    client.start();
    const socket = latest();
    socket.open();

    expect(socket.url).not.toContain("secret-device-token");
    expect(socket.sent).toHaveLength(1);
    const hello = lastSent(socket);
    expect(hello.type).toBe("system.hello");
    expect(hello.payload).toMatchObject({
      auth: { token: "secret-device-token" },
      protocol: { min: 1, max: 1 },
      client: {
        name: "Cardiary Web",
        platform: "web",
        instanceId: "web-instance-2",
        version: "0.1.2",
      },
    });
  });

  it("system.hello 成功後通知呼叫端 epoch 與 connectionId", () => {
    FakeSocket.sockets = [];
    let authenticated: unknown = null;
    const client = new ProtocolClient({
      token: "secret-device-token",
      instanceId: "web-instance-2",
      clientVersion: "0.1.0",
      createWebSocket: factory,
      handlers: { onAuthenticated: (info) => (authenticated = info) },
    });
    client.start();
    const socket = latest();
    socket.open();
    const hello = lastSent(socket);
    socket.receive({
      v: 1,
      kind: "response",
      replyTo: hello.id,
      type: "system.hello",
      payload: {
        protocol: { version: 1, min: 1, max: 1 },
        server: { name: "Cardiary", version: "0.1.0" },
        connectionId: "conn_1",
        limits: { maxFrameBytes: 1048576, replayWindow: 512, heartbeatSeconds: 20 },
        capabilities: { modules: true, files: false },
        epoch: "epoch-1",
      },
    });
    expect(authenticated).toMatchObject({ connectionId: "conn_1", epoch: "epoch-1" });
  });

  it("hello 被拒時通知 onHelloFailed，不當成一般請求失敗", () => {
    FakeSocket.sockets = [];
    let failed: ProtocolRequestError | null = null;
    const client = new ProtocolClient({
      token: "revoked-token",
      instanceId: "web-instance-2",
      clientVersion: "0.1.0",
      createWebSocket: factory,
      handlers: {
        onHelloFailed: (error) => {
          failed = error;
        },
      },
    });
    client.start();
    const socket = latest();
    socket.open();
    const hello = lastSent(socket);
    socket.receive({
      v: 1,
      kind: "error",
      replyTo: hello.id,
      code: "auth_invalid",
      message: "Token 不正確。",
      retryable: false,
    });
    expect(failed).toBeInstanceOf(ProtocolRequestError);
    expect((failed as unknown as ProtocolRequestError).code).toBe("auth_invalid");
  });
});

describe("ProtocolClient 事件與關閉", () => {
  it("事件原樣轉給 handlers.onEvent", () => {
    FakeSocket.sockets = [];
    const events: unknown[] = [];
    const client = new ProtocolClient({
      token: "t",
      instanceId: "i",
      clientVersion: "0.1.0",
      createWebSocket: factory,
      handlers: { onEvent: (event) => events.push(event) },
    });
    client.start();
    const socket = latest();
    socket.open();
    socket.receive({
      v: 1,
      kind: "event",
      type: "stream.text_delta",
      stream: "session:s1",
      seq: 1,
      emittedAt: "2026-11-16T10:00:00.000Z",
      payload: { sessionId: "s1", turnId: "turn1", messageId: "m1", delta: "哈" },
    });
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe("stream.text_delta");
  });

  it("關閉連線時拒絕所有等待中的請求", async () => {
    FakeSocket.sockets = [];
    const client = new ProtocolClient({
      token: "t",
      instanceId: "i",
      clientVersion: "0.1.0",
      createWebSocket: factory,
    });
    client.start();
    const socket = latest();
    socket.open();
    // 先讓 hello 完成，避免關閉被當成 hello 失敗。
    const hello = lastSent(socket);
    socket.receive({
      v: 1,
      kind: "response",
      replyTo: hello.id,
      type: "system.hello",
      payload: {
        protocol: { version: 1, min: 1, max: 1 },
        server: { name: "Cardiary", version: "0.1.0" },
        connectionId: "conn_1",
        limits: { maxFrameBytes: 1, replayWindow: 1, heartbeatSeconds: 20 },
        capabilities: { modules: true, files: false },
        epoch: "epoch-1",
      },
    });
    const pending = client.request("session.list", { limit: 10 });
    socket.close(1006, "network");
    await expect(pending).rejects.toMatchObject({ code: "connection_closed", retryable: true });
  });
});

describe("reconnectDelay", () => {
  it("從 250ms 起跳，逐次加倍，上限 5 秒", () => {
    expect(reconnectDelay(0)).toBe(250);
    expect(reconnectDelay(1)).toBe(500);
    expect(reconnectDelay(2)).toBe(1000);
    expect(reconnectDelay(20)).toBe(5000);
  });
});
