import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

describe("儲存清理的協定契約", () => {
  it("usage 回正本、快取、暫存、日誌、狀態五類，正本不可清", async () => {
    const { client } = await boot();
    const payload = await requestPayload<{
      usage: Array<{ category: string; bytes: number; cleanableBytes: number }>;
    }>(client, "storage.usage", {});
    expect(payload.usage.map((item) => item.category)).toEqual([
      "cards",
      "assets",
      "cache",
      "state",
      "logs",
    ]);
    for (const item of payload.usage) {
      expect(item.bytes).toBeGreaterThanOrEqual(0);
      expect(item.cleanableBytes).toBeGreaterThanOrEqual(0);
      if (item.category === "cards" || item.category === "assets" || item.category === "state") {
        expect(item.cleanableBytes).toBe(0);
      }
    }
  });

  it("未知清理類別被拒絕，原始資料不清", async () => {
    const { client } = await boot();
    const id = client.request("storage.cleanup.preview", { categories: ["cards"] });
    const reply = await client.waitForReply(id, 8000);
    expect(reply.kind).toBe("error");
    expect(reply.code).toBe("invalid_message");
  });

  it("預覽後套用，實際刪除清單與預覽一致並留下紀錄", async () => {
    const { service, client } = await boot();
    const file = join(service.folder.path, "cache", "contract-cleanup.bin");
    await mkdir(join(service.folder.path, "cache"), { recursive: true });
    await writeFile(file, "cleanup-contract-data");

    const preview = await requestPayload<{
      targets: Array<{ category: string; items: number; bytes: number }>;
      totalBytes: number;
    }>(client, "storage.cleanup.preview", { categories: ["cache"] });
    expect(preview.totalBytes).toBeGreaterThan(0);

    const apply = await requestPayload<{
      targets: Array<{ category: string; items: number; bytes: number }>;
      totalBytes: number;
      recordId: string;
    }>(client, "storage.cleanup.apply", { categories: ["cache"] });
    expect(apply.targets).toEqual(preview.targets);
    expect(apply.totalBytes).toBe(preview.totalBytes);
    expect(apply.recordId).toBeTruthy();

    await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    const record = JSON.parse(
      await readFile(join(service.folder.path, "state", "storage-cleanup.json"), "utf8"),
    ) as { recordId: string; totalBytes: number };
    expect(record.recordId).toBe(apply.recordId);
    expect(record.totalBytes).toBe(apply.totalBytes);
  });
});
