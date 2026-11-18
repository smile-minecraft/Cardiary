import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { JSONObject } from "@cardiary/protocol";

import type { ControlChannel } from "../../src/control/channel.js";
import { REMOTE_ACCESS_SETTING_KEY, isLoopbackAddress } from "../../src/gateway/remote-access.js";
import { HOST_SERVICE_NAMES, type CardEnvironment } from "../../src/modules/contract.js";
import { registerRemoteControlRoutes } from "../../src/remote/control.js";
import type { RemoteStack } from "../../src/remote/stack.js";
import { TestClient, startTestHost, waitUntil, type TestHost } from "../helpers.js";

/** 設定模組從建置產物載入；`pnpm check` 會先建置再跑測試。 */
const MODULES_DIRECTORY = fileURLToPath(new URL("../../dist/modules", import.meta.url));

const hosts: TestHost[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) {
    await host.close();
  }
});

async function boot(): Promise<TestHost> {
  const host = await startTestHost({ modulesDirectory: MODULES_DIRECTORY });
  hosts.push(host);
  return host;
}

/** 直接寫入人的設定；重啟後由 catalog 的預設值（false）接手。 */
function setRemoteAccess(host: TestHost, enabled: boolean): void {
  host.host.hostServices.require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage).settings.set({
    key: REMOTE_ACCESS_SETTING_KEY,
    value: enabled ? "true" : "false",
    level: "human-only",
    updatedBy: "test",
  });
}

/** 模擬殼的控制通道：記下註冊的路由並直接呼叫，權限永遠是 shell-control。 */
function fakeControl(stack: RemoteStack, host: TestHost) {
  const handlers = new Map<string, (payload: JSONObject) => Promise<JSONObject>>();
  const channel = {
    onRequest: (route: string, handler: (payload: JSONObject) => Promise<JSONObject>) => {
      handlers.set(route, handler);
    },
  } as unknown as ControlChannel;
  registerRemoteControlRoutes(channel, stack, {
    closeDeviceConnections: (deviceId) => host.host.gateway.closeDeviceConnections(deviceId),
  });
  return {
    approve: (pairingRequestId: string) =>
      handlers.get("control.pairing.approve")!({ pairingRequestId } as JSONObject),
  };
}

async function pairDevice(host: TestHost): Promise<{ deviceToken: string }> {
  const control = fakeControl(host.host.gateway.remote, host);
  const device = await TestClient.connect(host.url);
  const beginId = device.request("pairing.begin", { deviceName: "測試手機", kind: "web" });
  const begin = (await device.waitForReply(beginId)).payload as { pairingRequestId: string };
  await control.approve(begin.pairingRequestId);
  const completeId = device.request("pairing.complete", {
    pairingRequestId: begin.pairingRequestId,
  });
  const complete = (await device.waitForReply(completeId)).payload as { deviceToken: string };
  await waitUntil(() => device.closed, 3000);
  await device.close();
  return complete;
}

describe("遠端存取開關", () => {
  it("關閉時拒絕配對，開啟後恢復", async () => {
    const host = await boot();

    const anonymous = await TestClient.connect(host.url);
    const rejectedId = anonymous.request("pairing.begin", {
      deviceName: "測試手機",
      kind: "web",
    });
    const rejected = await anonymous.waitForReply(rejectedId);
    expect(rejected.kind).toBe("error");
    expect(rejected.code).toBe("permission_denied");
    expect((rejected.details as { reason: string }).reason).toBe("remote_access_disabled");

    setRemoteAccess(host, true);
    const beginId = anonymous.request("pairing.begin", { deviceName: "測試手機", kind: "web" });
    const begin = await anonymous.waitForReply(beginId);
    expect(begin.kind).toBe("response");
    expect((begin.payload as { pairingRequestId: string }).pairingRequestId).toMatch(/^pair/);
    await anonymous.close();
  });

  it("關閉後既有裝置 Token 的 hello 被拒", async () => {
    const host = await boot();
    setRemoteAccess(host, true);
    const { deviceToken } = await pairDevice(host);
    setRemoteAccess(host, false);

    const client = await TestClient.connect(host.url);
    await client.hello(deviceToken);
    const error = await client.waitFor(
      (frame) => frame.kind === "error" && frame.code === "auth_invalid",
    );
    expect(error.code).toBe("auth_invalid");
    await client.close();
  });

  it("關閉後已認證的裝置請求被拒並關閉連線", async () => {
    const host = await boot();
    setRemoteAccess(host, true);
    const { deviceToken } = await pairDevice(host);

    const client = await TestClient.connect(host.url);
    const helloId = await client.hello(deviceToken);
    expect((await client.waitForReply(helloId)).kind).toBe("response");

    setRemoteAccess(host, false);
    const id = client.request("session.create", { clientRequestId: "cr-remote-off" });
    const reply = await client.waitForReply(id);
    expect(reply.code).toBe("permission_denied");
    expect((reply.details as { reason: string }).reason).toBe("remote_access_disabled");
    await waitUntil(() => client.closeCode !== null, 3000);
    expect(client.closeCode).toBe(1008);
    await client.close();
  });

  it("關閉時本機 clientToken 照常連線", async () => {
    const host = await boot();

    const client = await TestClient.connect(host.url);
    const helloId = await client.hello(host.token);
    expect((await client.waitForReply(helloId)).kind).toBe("response");
    const createId = client.request("session.create", { clientRequestId: "cr-local" });
    expect((await client.waitForReply(createId)).kind).toBe("response");
    await client.close();
  });
});

async function connectAuthed(url: string, token: string): Promise<TestClient> {
  const client = await TestClient.connect(url);
  const helloId = await client.hello(token);
  expect((await client.waitForReply(helloId)).kind).toBe("response");
  const subscribeId = client.request("system.subscribe", {});
  expect((await client.waitForReply(subscribeId)).kind).toBe("response");
  return client;
}

describe("遠端存取關閉時切斷裝置", () => {
  it("人關掉開關時，已連線的裝置立刻被關閉且不再收到事件", async () => {
    const host = await boot();
    setRemoteAccess(host, true);
    const { deviceToken } = await pairDevice(host);
    const device = await connectAuthed(host.url, deviceToken);
    const local = await connectAuthed(host.url, host.token);

    const offId = local.request("system.settings.set", {
      changes: [{ key: REMOTE_ACCESS_SETTING_KEY, value: false }],
      clientRequestId: "cr-remote-off",
    });
    const off = await local.waitForReply(offId);
    expect(off.kind).toBe("response");

    await waitUntil(() => device.closeCode !== null, 3000);
    expect(device.closeCode).toBe(1008);
    expect(device.closeReason).toBe("remote_access_disabled");

    const before = device.frames.length;
    await host.host.gateway.emitSystemStatus();
    await local.waitForEvent("system.status");
    expect(device.frames.length).toBe(before);
    await local.close();
  });

  it("開關關閉後，廣播不再送給仍連線的裝置並切斷連線", async () => {
    const host = await boot();
    setRemoteAccess(host, true);
    const { deviceToken } = await pairDevice(host);
    const device = await connectAuthed(host.url, deviceToken);
    const local = await connectAuthed(host.url, host.token);

    // 直接寫儲存，不經過會主動斷線的 system.settings.set 路徑，
    // 單獨驗證廣播前的開關檢查。
    setRemoteAccess(host, false);
    await host.host.gateway.emitSystemStatus();
    await local.waitForEvent("system.status");

    await waitUntil(() => device.closeCode !== null, 3000);
    expect(device.closeCode).toBe(1008);
    expect(device.closeReason).toBe("remote_access_disabled");
    expect(
      device.frames.some((frame) => frame.kind === "event" && frame.type === "system.status"),
    ).toBe(false);
    await local.close();
  });

  it("關閉後 HTTP 裝置 Token 被拒", async () => {
    const host = await boot();
    setRemoteAccess(host, true);
    const { deviceToken } = await pairDevice(host);
    const url = `http://127.0.0.1:${host.host.port}/v1/remote-check`;
    const headers = { authorization: `Bearer ${deviceToken}` };

    const enabled = await fetch(url, { headers });
    expect(enabled.status).toBe(404);

    setRemoteAccess(host, false);
    const disabled = await fetch(url, { headers });
    expect(disabled.status).toBe(401);
    expect(await disabled.json()).toMatchObject({ code: "auth_invalid" });
  });
});

describe("isLoopbackAddress", () => {
  it("只接受 loopback 位址", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.10.0.5")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("10.0.0.5")).toBe(false);
    expect(isLoopbackAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});
