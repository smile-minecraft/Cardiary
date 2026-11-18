import { afterEach, describe, expect, it, vi } from "vitest";

import type { JSONObject } from "@cardiary/protocol";

import type { ControlChannel } from "../../src/control/channel.js";
import { REMOTE_ACCESS_SETTING_KEY, isLoopbackAddress } from "../../src/gateway/remote-access.js";
import { HOST_SERVICE_NAMES, type CardEnvironment } from "../../src/modules/contract.js";
import { registerRemoteControlRoutes } from "../../src/remote/control.js";
import type { RemoteStack } from "../../src/remote/stack.js";
import { TestClient, startTestHost, waitUntil, type TestHost } from "../helpers.js";

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
    await waitUntil(() => client.closed, 3000);
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
