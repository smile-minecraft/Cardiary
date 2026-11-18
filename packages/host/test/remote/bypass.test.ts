import { afterEach, describe, expect, it } from "vitest";

import type { JSONObject } from "@cardiary/protocol";

import type { ControlChannel } from "../../src/control/channel.js";
import { REMOTE_ACCESS_SETTING_KEY } from "../../src/gateway/remote-access.js";
import { HOST_SERVICE_NAMES, type CardEnvironment } from "../../src/modules/contract.js";
import { registerRemoteControlRoutes } from "../../src/remote/control.js";
import { TestClient, startTestHost, waitUntil, type TestHost } from "../helpers.js";

/**
 * 遠端存取的繞過嘗試（工作 work-3c3f121d 的審查補強）。
 *
 * 遠端裝置經加密通道轉送，抵達主機時一律是 loopback；通道或代理加上的標頭
 * 不能授權任何事，認證只看裝置 Token。這裡補三類既有測試沒有涵蓋的路徑：
 * 偽造的轉送與 Tailscale 標頭、配對領取後的重放、已配對裝置改權限相關的
 * 僅限人類設定。
 */

const hosts: TestHost[] = [];

afterEach(async () => {
  while (hosts.length > 0) await hosts.pop()?.close();
});

const FORGED_HEADERS: Record<string, string> = {
  "x-forwarded-for": "127.0.0.1",
  "x-real-ip": "127.0.0.1",
  forwarded: "for=127.0.0.1;proto=https",
  "tailscale-user-login": "owner@example.com",
  "tailscale-user-name": "Owner",
  "x-cardiary-client": "macos",
};

async function boot(remoteAccess: boolean): Promise<TestHost> {
  const host = await startTestHost();
  hosts.push(host);
  host.host.hostServices.require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage).settings.set({
    key: REMOTE_ACCESS_SETTING_KEY,
    value: remoteAccess ? "true" : "false",
    level: "human-only",
    updatedBy: "test",
  });
  return host;
}

function approveVia(host: TestHost): (pairingRequestId: string) => Promise<JSONObject> {
  const handlers = new Map<string, (payload: JSONObject) => Promise<JSONObject>>();
  const channel = {
    onRequest: (route: string, handler: (payload: JSONObject) => Promise<JSONObject>) => {
      handlers.set(route, handler);
    },
  } as unknown as ControlChannel;
  registerRemoteControlRoutes(channel, host.host.gateway.remote, {
    closeDeviceConnections: (deviceId) => host.host.gateway.closeDeviceConnections(deviceId),
  });
  return (pairingRequestId) =>
    handlers.get("control.pairing.approve")!({ pairingRequestId } as JSONObject);
}

async function pair(host: TestHost): Promise<{ pairingRequestId: string; deviceToken: string }> {
  const approve = approveVia(host);
  const device = await TestClient.connect(host.url);
  const begin = (await device.waitForReply(
    device.request("pairing.begin", { deviceName: "繞過測試手機", kind: "web" }),
  )) as unknown as { payload: { pairingRequestId: string } };
  const pairingRequestId = begin.payload.pairingRequestId;
  await approve(pairingRequestId);
  const complete = (await device.waitForReply(
    device.request("pairing.complete", { pairingRequestId }),
  )) as unknown as { payload: { deviceToken: string } };
  await waitUntil(() => device.closed, 3000);
  await device.close();
  return { pairingRequestId, deviceToken: complete.payload.deviceToken };
}

describe("遠端存取的繞過嘗試", () => {
  it("偽造的轉送與 Tailscale 標頭不能取代 Token：未認證請求照樣被拒", async () => {
    const host = await boot(true);
    const client = await TestClient.connect(host.url, { headers: FORGED_HEADERS });
    const reply = await client.waitForReply(client.request("session.list", {}));
    expect(reply.kind).toBe("error");
    expect(reply.code).toBe("not_authenticated");
    await client.close();
  });

  it("遠端存取關閉時，偽造標頭也不能開始配對", async () => {
    const host = await boot(false);
    const client = await TestClient.connect(host.url, { headers: FORGED_HEADERS });
    const reply = await client.waitForReply(
      client.request("pairing.begin", { deviceName: "偽造", kind: "web" }),
    );
    expect(reply.code).toBe("permission_denied");
    expect((reply.details as { reason?: string } | undefined)?.reason).toBe(
      "remote_access_disabled",
    );
    await client.close();
  });

  it("偽造標頭加上錯誤 Token 的 hello 不會認證", async () => {
    const host = await boot(true);
    const client = await TestClient.connect(host.url, { headers: FORGED_HEADERS });
    await client.hello(`cdt_${"x".repeat(43)}`);
    const error = await client.waitFor(
      (frame) => frame.kind === "error" && frame.code === "auth_invalid",
    );
    expect(error.code).toBe("auth_invalid");
    const listed = await client.waitForReply(client.request("session.list", {})).catch(() => null);
    expect(listed === null || listed.kind === "error").toBe(true);
    await client.close();
  });

  it("Token 已領取後，換一條連線重送同一個 pairing.complete 拿不到第二把 Token", async () => {
    const host = await boot(true);
    const { pairingRequestId, deviceToken } = await pair(host);
    expect(deviceToken).toMatch(/^cdt_/);

    const replay = await TestClient.connect(host.url);
    const reply = await replay.waitForReply(
      replay.request("pairing.complete", { pairingRequestId }),
    );
    expect(reply.kind).toBe("error");
    expect(JSON.stringify(reply)).not.toContain("cdt_");
    await replay.close();
  });

  it.each(["permissions.mode", "permissions.allowlist", REMOTE_ACCESS_SETTING_KEY])(
    "已配對的遠端裝置不能修改僅限人類的 %s",
    async (key) => {
      const host = await boot(true);
      const { deviceToken } = await pair(host);
      const client = await TestClient.connect(host.url);
      await client.waitForReply(await client.hello(deviceToken));
      const reply = await client.waitForReply(
        client.request("system.settings.set", {
          clientRequestId: `remote-${key}`,
          changes: [{ key, value: key === REMOTE_ACCESS_SETTING_KEY ? false : "allow-all" }],
        }),
      );
      expect(reply.code).toBe("permission_denied");
      expect((reply.details as { reason: string }).reason).toBe("human_only");
      await client.close();
      const stored = host.host.hostServices
        .require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage)
        .settings.get(key);
      if (key === REMOTE_ACCESS_SETTING_KEY) {
        expect(stored?.value).toBe("true");
      } else {
        expect(stored).toBeNull();
      }
    },
  );
});
