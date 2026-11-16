import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WebSocket } from "ws";
import type { JSONObject } from "@cardiary/protocol";

import { registerRemoteControlRoutes } from "../../src/remote/control.js";
import type { ControlChannel } from "../../src/control/channel.js";
import type { RemoteStack } from "../../src/remote/stack.js";
import { TestClient, startTestHost, waitUntil, type TestHost } from "../helpers.js";

const hosts: TestHost[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) {
    await host.close();
  }
});

async function boot(options?: Parameters<typeof startTestHost>[0]): Promise<TestHost> {
  const host = await startTestHost(options);
  hosts.push(host);
  return host;
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
    deny: (pairingRequestId: string) =>
      handlers.get("control.pairing.deny")!({ pairingRequestId } as JSONObject),
    list: () => handlers.get("control.devices.list")!({} as JSONObject),
    revoke: (deviceId: string) =>
      handlers.get("control.devices.revoke")!({ deviceId } as JSONObject),
  };
}

describe("遠端配對（未認證連線）", () => {
  it("未認證連線只能 pairing.begin／pairing.complete；其他請求被拒", async () => {
    const host = await boot();
    const anonymous = await TestClient.connect(host.url);
    const created = anonymous.request("session.create", {});
    const rejected = await anonymous.waitForReply(created);
    expect(rejected.code).toBe("not_authenticated");

    const beginId = anonymous.request("pairing.begin", {
      deviceName: "測試手機",
      kind: "web",
    });
    const beginReply = await anonymous.waitForReply(beginId);
    expect(beginReply.kind).toBe("response");
    const payload = beginReply.payload as { pairingRequestId: string; code: string };
    expect(payload.pairingRequestId).toMatch(/^pair/);
    expect(payload.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    await anonymous.close();
  });

  it("核准之前領取不到 Token；同連線核准後才領得到", async () => {
    const host = await boot();
    const stack = host.host.gateway.remote;
    const control = fakeControl(stack, host);
    const notices: unknown[] = [];
    stack.notifyPairingRequested = (notice) => notices.push(notice);

    const device = await TestClient.connect(host.url);
    const beginId = device.request("pairing.begin", {
      deviceName: "測試手機",
      kind: "web",
    });
    const beginReply = await device.waitForReply(beginId);
    const begin = beginReply.payload as { pairingRequestId: string; code: string };

    // 通知殼：含短碼與裝置名稱。
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      pairingRequestId: begin.pairingRequestId,
      deviceName: "測試手機",
      code: begin.code,
    });

    // 核准之前：領取被拒。
    const earlyId = device.request("pairing.complete", {
      pairingRequestId: begin.pairingRequestId,
    });
    const early = await device.waitForReply(earlyId);
    expect(early.code).toBe("conflict");
    expect((early.details as { reason: string }).reason).toBe("not-approved");

    // 殼核准（私有控制通道）。
    const approved = await control.approve(begin.pairingRequestId);
    expect(approved).toMatchObject({ status: "approved" });

    // 同連線領取：成功，並拿到裝置 Token。
    const completeId = device.request("pairing.complete", {
      pairingRequestId: begin.pairingRequestId,
    });
    const complete = await device.waitForReply(completeId);
    expect(complete.kind).toBe("response");
    const result = complete.payload as { deviceId: string; deviceToken: string };
    expect(result.deviceToken).toMatch(/^cdt_/);
    await waitUntil(() => device.closed, 3000);

    // Token 只顯示這一次：回應之後主機只存雜湊。
    const list = await control.list();
    const devices = (list as { devices: { deviceId: string; fingerprint: string }[] }).devices;
    expect(devices).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(result.deviceToken);

    await device.close();
  });

  it("換一條連線不能領取別人的配對請求", async () => {
    const host = await boot();
    const stack = host.host.gateway.remote;
    const control = fakeControl(stack, host);

    const first = await TestClient.connect(host.url);
    const second = await TestClient.connect(host.url);
    const beginId = first.request("pairing.begin", { deviceName: "A", kind: "web" });
    const begin = (await first.waitForReply(beginId)).payload as { pairingRequestId: string };
    await control.approve(begin.pairingRequestId);

    const stealId = second.request("pairing.complete", {
      pairingRequestId: begin.pairingRequestId,
    });
    const steal = await second.waitForReply(stealId);
    expect(steal.code).toBe("conflict");
    expect((steal.details as { reason: string }).reason).toBe("connection-mismatch");
    await first.close();
    await second.close();
  });

  it("公開協定上沒有核准入口：pairing.approve／control.pairing.approve 都失敗", async () => {
    const host = await boot();
    const stack = host.host.gateway.remote;
    const control = fakeControl(stack, host);

    const anonymous = await TestClient.connect(host.url);
    const beginId = anonymous.request("pairing.begin", { deviceName: "A", kind: "web" });
    const begin = (await anonymous.waitForReply(beginId)).payload as { pairingRequestId: string };

    for (const type of ["pairing.approve", "control.pairing.approve", "devices.revoke"]) {
      const id = anonymous.request(type, { pairingRequestId: begin.pairingRequestId });
      const reply = await anonymous.waitForReply(id);
      expect(reply.kind).toBe("error");
    }

    // 認證過的本機客戶端也沒有：分派不到核心或模組。
    const local = await TestClient.connect(host.url);
    const helloId = await local.hello(host.token);
    await local.waitForReply(helloId);
    const id = local.request("control.pairing.approve", {
      pairingRequestId: begin.pairingRequestId,
    });
    const reply = await local.waitForReply(id);
    expect(reply.code).toBe("unsupported");

    // 配對請求仍然只能等殼核准。
    const list = await control.list();
    expect((list as { devices: unknown[] }).devices).toHaveLength(0);
    await anonymous.close();
    await local.close();
  });

  it("拒絕之後領不到 Token；拒絕通知殼", async () => {
    const host = await boot();
    const stack = host.host.gateway.remote;
    const control = fakeControl(stack, host);

    const device = await TestClient.connect(host.url);
    const beginId = device.request("pairing.begin", { deviceName: "A", kind: "web" });
    const begin = (await device.waitForReply(beginId)).payload as { pairingRequestId: string };
    await control.deny(begin.pairingRequestId);
    const completeId = device.request("pairing.complete", {
      pairingRequestId: begin.pairingRequestId,
    });
    const complete = await device.waitForReply(completeId);
    expect(complete.code).toBe("conflict");
    expect((complete.details as { reason: string }).reason).toBe("unknown-or-closed");
    await device.close();
  });
});

describe("裝置 Token 認證與撤銷", () => {
  async function pairDevice(host: TestHost, name = "測試手機") {
    const stack = host.host.gateway.remote;
    const control = fakeControl(stack, host);
    const device = await TestClient.connect(host.url);
    const beginId = device.request("pairing.begin", { deviceName: name, kind: "web" });
    const begin = (await device.waitForReply(beginId)).payload as { pairingRequestId: string };
    await control.approve(begin.pairingRequestId);
    const completeId = device.request("pairing.complete", {
      pairingRequestId: begin.pairingRequestId,
    });
    const complete = (await device.waitForReply(completeId)).payload as {
      deviceId: string;
      deviceToken: string;
    };
    await waitUntil(() => device.closed, 3000);
    await device.close();
    return { ...complete, control };
  }

  it("配對後的裝置可以 hello、建立會話；錯誤裝置 Token 不行", async () => {
    const host = await boot();
    const { deviceToken } = await pairDevice(host);

    const client = await TestClient.connect(host.url);
    const helloId = await client.hello(deviceToken);
    const hello = await client.waitForReply(helloId);
    expect(hello.kind).toBe("response");
    expect(hello.type).toBe("system.hello");

    const createId = client.request("session.create", { clientRequestId: "cr-1" });
    const created = await client.waitForReply(createId);
    expect(created.kind).toBe("response");

    const wrong = await TestClient.connect(host.url);
    await wrong.hello(`cdt_${"A".repeat(43)}`);
    const wrongError = await wrong.waitFor(
      (frame) => frame.kind === "error" && frame.code === "auth_invalid",
    );
    expect(wrongError.code).toBe("auth_invalid");
    await client.close();
    await wrong.close();
  });

  it("撤銷之後既有連線被關閉，重連也被拒", async () => {
    const host = await boot();
    const { deviceToken, deviceId, control } = await pairDevice(host);

    const client = await TestClient.connect(host.url);
    const helloId = await client.hello(deviceToken);
    await client.waitForReply(helloId);
    // 撤銷；既有連線應立刻被關閉。
    const revoked = await control.revoke(deviceId);
    expect(revoked).toMatchObject({ revoked: true, closedConnections: 1 });
    await waitUntil(() => client.closed, 3000);
    expect(client.closeCode).toBe(1008);

    const again = await TestClient.connect(host.url);
    await again.hello(deviceToken);
    const againError = await again.waitFor(
      (frame) => frame.kind === "error" && frame.code === "auth_invalid",
    );
    expect(againError.code).toBe("auth_invalid");
    await again.close();
  });

  it("撤銷一台裝置不影響另一台", async () => {
    const host = await boot();
    const first = await pairDevice(host, "裝置一");
    const second = await pairDevice(host, "裝置二");
    await first.control.revoke(first.deviceId);

    const client = await TestClient.connect(host.url);
    const helloId = await client.hello(second.deviceToken);
    expect((await client.waitForReply(helloId)).kind).toBe("response");
    await client.close();
  });

  it("遠端裝置不能修改僅限人類的設定", async () => {
    const host = await boot();
    const { deviceToken } = await pairDevice(host);

    const client = await TestClient.connect(host.url);
    const helloId = await client.hello(deviceToken);
    await client.waitForReply(helloId);
    // settings 模組在測試組裝裡不一定啟用；閘道先攔下僅限人類的鍵。
    const id = client.request("system.settings.set", {
      clientRequestId: "cr-remote-1",
      changes: [{ key: "retrieval.allowModelDownload", value: true }],
    });
    const reply = await client.waitForReply(id);
    expect(reply.code).toBe("permission_denied");
    expect((reply.details as { reason: string }).reason).toBe("human_only");
    await client.close();
  });
});
