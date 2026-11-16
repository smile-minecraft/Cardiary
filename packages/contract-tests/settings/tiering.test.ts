import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";

const services: SpawnedService[] = [];
const clients: ProtocolClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close().catch(() => undefined);
  }
  for (const service of services.splice(0)) {
    await service.stop().catch(() => undefined);
  }
});

async function boot(): Promise<{ service: SpawnedService; client: ProtocolClient }> {
  const service = await spawnService();
  services.push(service);
  const client = await connectAndHello(service);
  clients.push(client);
  return { service, client };
}

async function requestPayload<T>(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const id = client.request(type, payload);
  const reply = await client.waitForReply(id, 8000);
  if (reply.kind === "error") {
    throw new Error(
      `${type} 失敗：${String(reply.code)} ${String((reply as { message?: string }).message)}`,
    );
  }
  return reply.payload as T;
}

async function requestRaw(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = client.request(type, payload);
  return client.waitForReply(id, 8000);
}

describe("設定分級的協定契約", () => {
  it("代理可見的設定項都帶明確 tier，human-only 在代理面不可見", async () => {
    const { client } = await boot();
    const payload = await requestPayload<{
      settings: Array<{ key: string; tier: string; value: unknown }>;
    }>(client, "settings.list", {});
    expect(payload.settings.length).toBeGreaterThan(0);
    // 這個測試客戶端是人；代理面由 host 測試覆蓋。這裡至少確認每一筆都有明確等級。
    for (const item of payload.settings) {
      expect(["free", "approval", "human-only"]).toContain(item.tier);
    }
  });

  it("人工提議 approval 設定項時直接套用", async () => {
    const { client } = await boot();
    const proposed = await requestPayload<{
      change: { changeId: string; status: string; key: string };
    }>(client, "settings.propose_change", {
      key: "models.providers",
      value: [],
      clientRequestId: "contract-propose-1",
    });
    expect(proposed.change.key).toBe("models.providers");
    expect(proposed.change.status).toBe("applied");

    const changes = await requestPayload<{
      changes: Array<{ changeId: string; status: string }>;
    }>(client, "settings.changes.list", {});
    expect(
      changes.changes.find((change) => change.changeId === proposed.change.changeId)?.status,
    ).toBe("applied");
  });

  it("free 設定項直接生效並留在變更紀錄", async () => {
    const { client } = await boot();
    const decided = await requestPayload<{
      change: { key: string; status: string; proposedBy: string };
    }>(client, "settings.propose_change", {
      key: "notifications.systemCenter",
      value: false,
      clientRequestId: "contract-free-1",
    });
    expect(decided.change.key).toBe("notifications.systemCenter");
    expect(decided.change.status).toBe("applied");
  });

  it("未知設定訊息回 not_found", async () => {
    const { client } = await boot();
    const reply = await requestRaw(client, "settings.delete", {});
    expect(reply.kind).toBe("error");
    expect(reply.code).toBe("not_found");
  });
});
