import { afterEach, describe, expect, it } from "vitest";

import {
  connect,
  connectAndHello,
  engineUnderTest,
  spawnService,
  waitUntil,
  type ProtocolClient,
  type SpawnedService,
  type TestFolder,
} from "../test/support.js";

/**
 * 遠端裝置配對的跨重啟契約：裝置 Token 存在狀態資料庫，重啟後不用重新配對。
 *
 * 假引擎是記憶體替身，這一組只在產品組裝跑。
 */

const running: SpawnedService[] = [];

afterEach(async () => {
  for (const service of running.splice(0)) {
    await service.stop().catch(() => undefined);
  }
});

function urlOf(service: SpawnedService): string {
  return `ws://127.0.0.1:${service.ready.clientPort}/v1/ws`;
}

async function boot(folder?: TestFolder): Promise<SpawnedService> {
  const service = await spawnService({
    control: true,
    engine: "pi",
    ...(folder === undefined ? {} : { folder }),
  });
  running.push(service);
  await enableRemoteAccess(service);
  return service;
}

/** 遠端存取預設關閉；比照設定頁，由本機客戶端寫入人類專屬設定後才接受配對。 */
async function enableRemoteAccess(service: SpawnedService): Promise<void> {
  const client = await connectAndHello(service);
  try {
    const id = client.request("system.settings.set", {
      changes: [{ key: "remote.accessEnabled", value: true }],
      clientRequestId: `remote-access-${Math.random().toString(36).slice(2)}`,
    });
    const reply = await client.waitForReply(id, 20_000);
    expect(reply.kind).toBe("response");
    expect((reply.payload as { applied?: Array<{ key: string; value: unknown }> }).applied).toEqual(
      [expect.objectContaining({ key: "remote.accessEnabled", value: true })],
    );
  } finally {
    await client.close();
  }
}

async function pair(service: SpawnedService): Promise<{ deviceId: string; deviceToken: string }> {
  const client = await connect(urlOf(service));
  try {
    const beginId = client.request("pairing.begin", { deviceName: "重啟測試手機", kind: "ios" });
    // 這個行程的第一則 WS frame 會先編譯協定 schema，等久一點。
    const begin = await client.waitForReply(beginId, 20_000);
    const pairingRequestId = (begin.payload as { pairingRequestId: string }).pairingRequestId;
    expect(pairingRequestId).toBeTruthy();
    const approved = await service.controlRequest("control.pairing.approve", { pairingRequestId });
    expect(approved.ok).toBe(true);
    const completeId = client.request("pairing.complete", { pairingRequestId });
    const complete = await client.waitForReply(completeId);
    return complete.payload as { deviceId: string; deviceToken: string };
  } finally {
    await client.close();
  }
}

interface DeviceListing {
  readonly devices: Array<{ deviceId?: string; deviceKind?: string; revokedAt?: string }>;
}

describe("遠端裝置跨重啟", () => {
  it.skipIf(engineUnderTest() === "fake")(
    "重啟後舊 Token 仍可 hello，裝置清單仍在，日誌沒有明文",
    async () => {
      const first = await boot();
      const paired = await pair(first);
      await first.stop();

      const second = await boot(first.folder);
      try {
        const listed = await second.controlRequest("control.devices.list");
        const devices = (listed.payload as unknown as DeviceListing).devices;
        expect(devices).toHaveLength(1);
        expect(devices[0]?.deviceId).toBe(paired.deviceId);

        const client = await connect(urlOf(second));
        try {
          const helloId = await client.hello(paired.deviceToken);
          const hello = await client.waitForReply(helloId);
          expect(hello.kind).toBe("response");
          expect(hello.type).toBe("system.hello");

          // Token 不只用來握手：重啟後的一般請求也要能用。
          const listId = client.request("session.list", {});
          const sessionList = await client.waitForReply(listId);
          expect(sessionList.kind).toBe("response");
          expect(sessionList.type).toBe("session.list");
          expect(Array.isArray((sessionList.payload as { sessions?: unknown }).sessions)).toBe(
            true,
          );
        } finally {
          await client.close();
        }

        const logs = [...second.stdoutLines(), second.stderr()].join("\n");
        expect(logs).not.toContain(paired.deviceToken);
      } finally {
        await second.stop();
      }
    },
    60_000,
  );

  it.skipIf(engineUnderTest() === "fake")(
    "撤銷後既有連線中斷，重啟後同一 Token 仍被拒",
    async () => {
      const first = await boot();
      const paired = await pair(first);

      const live = await connect(urlOf(first));
      const helloId = await live.hello(paired.deviceToken);
      await live.waitForReply(helloId);

      const revoked = await first.controlRequest("control.devices.revoke", {
        deviceId: paired.deviceId,
      });
      expect(revoked.ok).toBe(true);
      await waitUntil(() => live.closed, 5000);
      await first.stop();

      const second = await boot(first.folder);
      try {
        const listed = await second.controlRequest("control.devices.list");
        const devices = (listed.payload as unknown as DeviceListing).devices;
        expect(devices).toHaveLength(1);
        expect(typeof devices[0]?.revokedAt).toBe("string");

        const client: ProtocolClient = await connect(urlOf(second));
        try {
          await client.hello(paired.deviceToken);
          const rejected = await client.waitFor(
            (frame) => frame.kind === "error" && frame.code === "auth_invalid",
          );
          expect(rejected.code).toBe("auth_invalid");
        } finally {
          await client.close();
        }
      } finally {
        await second.stop();
      }
    },
    60_000,
  );
});
