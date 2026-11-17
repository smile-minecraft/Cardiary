import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import type { ModuleHttpResponse } from "@cardiary/module-api";

import type { ModuleHostBridge } from "../../src/modules/contract.js";
import { TestClient, startTestHost, type TestHost } from "../helpers.js";

const hosts: TestHost[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) {
    await host.close();
  }
});

async function boot(): Promise<TestHost> {
  const host = await startTestHost();
  hosts.push(host);
  return host;
}

const httpUrl = (host: TestHost, path = "/v1/blobs/x"): string =>
  `http://127.0.0.1:${host.host.port}${path}`;

interface JsonError {
  readonly code: string;
}

async function jsonBody(response: Response): Promise<JsonError> {
  return (await response.json()) as JsonError;
}

/**
 * 單一 HTTP 路由的模組替身，用來證明「請求真的抵達功能路由」。
 * 只有 dispatchHttp 被閘道呼叫，其餘方法在這個測試裡用不到。
 */
class HttpRouteModules implements ModuleHostBridge {
  calls = 0;

  listModules() {
    return [];
  }

  activeToolBundles() {
    return [];
  }

  async setModuleEnabled() {
    throw new Error("測試只用 HTTP 路由");
  }

  hasExactHandler() {
    return false;
  }

  hasPrefixHandler() {
    return false;
  }

  async dispatchProtocol(): Promise<never> {
    throw new Error("測試只用 HTTP 路由");
  }

  async dispatchHttp(): Promise<ModuleHttpResponse | null> {
    this.calls += 1;
    return { status: 200, headers: { "content-type": "text/plain" }, body: "ok" };
  }
}

interface RawSocket {
  ws: WebSocket;
  frames: Array<Record<string, unknown>>;
  closed: boolean;
  closeCode: number | null;
  closeReason: string;
  close(): Promise<void>;
}

/** 自訂 Origin 的原始 WebSocket，用來模擬網頁Origin的 hello 與請求。 */
async function connectWithOrigin(url: string, origin: string): Promise<RawSocket> {
  const ws = new WebSocket(url, { origin });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const frames: Array<Record<string, unknown>> = [];
  const state: RawSocket = {
    ws,
    frames,
    closed: false,
    closeCode: null,
    closeReason: "",
    async close() {
      if (state.closed) return;
      await new Promise<void>((resolve) => {
        ws.once("close", () => resolve());
        ws.close();
      });
    },
  };
  ws.on("message", (data) => {
    frames.push(JSON.parse(data.toString()) as Record<string, unknown>);
  });
  ws.on("close", (code, reason) => {
    state.closed = true;
    state.closeCode = code;
    state.closeReason = reason.toString();
  });
  return state;
}

function helloFrame(token: string, id = "hello"): Record<string, unknown> {
  return {
    v: 1,
    kind: "request",
    id,
    type: "system.hello",
    payload: {
      protocol: { min: 1, max: 1 },
      client: { name: "test", version: "0", platform: "other", instanceId: "web" },
      auth: { token },
    },
  };
}

async function waitForFrame<T extends Record<string, unknown>>(
  socket: RawSocket,
  predicate: (frame: Record<string, unknown>) => boolean,
  ms = 3000,
): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const found = socket.frames.find(predicate);
    if (found) return found as T;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`等待 frame 逾時：${JSON.stringify(socket.frames)}`);
}

/** 等連線被伺服器以 error frame 拒絕，或 close/error 事件，兩者都算拒絕證據。 */
async function waitForRejection(socket: RawSocket, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (
      socket.closed ||
      socket.frames.some((frame) => frame.kind === "error") ||
      socket.frames.some(
        (frame) => frame.code === "not_authenticated" || frame.code === "auth_invalid",
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(` Origin 拒絕沒有發生；收到的 frame：${JSON.stringify(socket.frames)}`);
}

describe("MCP 網頁 Origin 隔離：HTTP", () => {
  it("Origin:null 即使帶有效 Token 也被 403 拒絕，功能路由完全沒有被呼叫", async () => {
    const host = await boot();
    const modules = new HttpRouteModules();
    host.host.gateway.setModuleHost(modules);

    const response = await fetch(httpUrl(host), {
      method: "POST",
      headers: { origin: "null", authorization: `Bearer ${host.token}` },
    });
    expect(response.status).toBe(403);
    expect((await jsonBody(response)).code).toBe("permission_denied");
    expect(modules.calls).toBe(0);

    // 對照：移除 Origin 後，同樣的 Token 與路徑能抵達功能路由。
    const allowed = await fetch(httpUrl(host), {
      method: "POST",
      headers: { authorization: `Bearer ${host.token}` },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe("ok");
    expect(modules.calls).toBe(1);
  });

  it("合法 loopback Origin 但沒有或錯誤 Token 時回 401，功能路由不被呼叫", async () => {
    const host = await boot();
    const modules = new HttpRouteModules();
    host.host.gateway.setModuleHost(modules);
    const origin = `http://127.0.0.1:${host.host.port}`;

    const missing = await fetch(httpUrl(host), { method: "POST", headers: { origin } });
    expect(missing.status).toBe(401);
    expect((await jsonBody(missing)).code).toBe("auth_invalid");

    const wrong = await fetch(httpUrl(host), {
      method: "POST",
      headers: { origin, authorization: `Bearer ${"B".repeat(43)}` },
    });
    expect(wrong.status).toBe(401);
    expect((await jsonBody(wrong)).code).toBe("auth_invalid");
    expect(modules.calls).toBe(0);

    // 對照：loopback Origin 加有效 Token 能到功能路由。
    const allowed = await fetch(httpUrl(host), {
      method: "POST",
      headers: { origin, authorization: `Bearer ${host.token}` },
    });
    expect(allowed.status).toBe(200);
    expect(modules.calls).toBe(1);
  });

  it("跨站 Origin 即使帶有效 Token 也被 403 拒絕，功能路由不被呼叫", async () => {
    const host = await boot();
    const modules = new HttpRouteModules();
    host.host.gateway.setModuleHost(modules);

    const response = await fetch(httpUrl(host), {
      method: "POST",
      headers: { origin: "https://evil.example", authorization: `Bearer ${host.token}` },
    });
    expect(response.status).toBe(403);
    expect((await jsonBody(response)).code).toBe("permission_denied");
    expect(modules.calls).toBe(0);

    const allowed = await fetch(httpUrl(host), {
      method: "POST",
      headers: { authorization: `Bearer ${host.token}` },
    });
    expect(allowed.status).toBe(200);
    expect(modules.calls).toBe(1);
  });

  it("合法 loopback + 有效 Token 能到既有路由：404/not_found 代表 server 正常運作", async () => {
    const host = await boot();
    const origin = `http://127.0.0.1:${host.host.port}`;
    const response = await fetch(httpUrl(host, "/v1/does-not-exist"), {
      headers: { origin, authorization: `Bearer ${host.token}` },
    });
    expect(response.status).toBe(404);
    expect((await jsonBody(response)).code).toBe("not_found");
  });
});

describe("MCP 網頁 Origin 隔離：WebSocket", () => {
  it("Origin:null 即使 hello 帶有效 Token 也被拒絕，沒有認證、沒有事件", async () => {
    const host = await boot();
    const socket = await connectWithOrigin(host.url, "null");
    socket.ws.send(JSON.stringify(helloFrame(host.token)));
    await waitForRejection(socket);

    expect(socket.frames.some((frame) => frame.kind === "event")).toBe(false);
    const authenticated = socket.frames.some(
      (frame) => frame.kind === "response" && frame.replyTo === "hello",
    );
    expect(authenticated).toBe(false);
    await socket.close();
  });

  it("跨站 Origin 即使 hello 帶有效 Token 也被拒絕，不能建立 session 或收到事件", async () => {
    const host = await boot();
    const socket = await connectWithOrigin(host.url, "https://evil.example");
    socket.ws.send(JSON.stringify(helloFrame(host.token)));
    await waitForRejection(socket);

    socket.ws.send(
      JSON.stringify({ v: 1, kind: "request", id: "create", type: "session.create", payload: {} }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(socket.frames.some((frame) => frame.kind === "event")).toBe(false);
    expect(
      socket.frames.some((frame) => frame.kind === "response" && frame.replyTo === "create"),
    ).toBe(false);
    await socket.close();
  });

  it("合法 loopback Origin 但 hello 帶錯 Token 不會認證", async () => {
    const host = await boot();
    const origin = `http://127.0.0.1:${host.host.port}`;
    const socket = await connectWithOrigin(host.url, origin);
    socket.ws.send(JSON.stringify(helloFrame("B".repeat(43))));
    const error = await waitForFrame<{ code: string }>(
      socket,
      (frame) => frame.kind === "error" && frame.code === "auth_invalid",
    );
    expect(error.code).toBe("auth_invalid");
    expect(socket.frames.some((frame) => frame.kind === "event")).toBe(false);
    await socket.close();
  });

  it("合法 loopback Origin 與有效 Token 可以 hello 並建立 session 作為對照", async () => {
    const host = await boot();
    const origin = `http://127.0.0.1:${host.host.port}`;
    const socket = await connectWithOrigin(host.url, origin);
    socket.ws.send(JSON.stringify(helloFrame(host.token)));
    const hello = await waitForFrame<{ kind: string; replyTo: string }>(
      socket,
      (frame) => frame.kind === "response" && frame.replyTo === "hello",
    );
    expect(hello.kind).toBe("response");

    socket.ws.send(
      JSON.stringify({
        v: 1,
        kind: "request",
        id: "create",
        type: "session.create",
        payload: { clientRequestId: "cr-origin-ok" },
      }),
    );
    const created = await waitForFrame<{ kind: string; replyTo: string; payload?: unknown }>(
      socket,
      (frame) => frame.kind === "response" && frame.replyTo === "create",
    );
    expect(created.kind).toBe("response");
    expect((created.payload as { session?: { id?: string } } | undefined)?.session?.id).toBeTypeOf(
      "string",
    );
    await socket.close();
  });

  it("正常 TestClient（沒有 Origin）仍可 hello，證明拒絕來自 Origin 而非 host 沒啟動", async () => {
    const host = await boot();
    const client = await TestClient.connect(host.url);
    const requestId = await client.hello(host.token);
    const reply = await client.waitForReply(requestId);
    expect(reply.kind).toBe("response");
    await client.close();
  });
});
