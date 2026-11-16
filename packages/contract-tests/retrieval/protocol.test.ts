import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";

let service: SpawnedService;
let client: ProtocolClient;

beforeAll(async () => {
  service = await spawnService();
  client = await connectAndHello(service);
}, 20_000);

afterAll(async () => {
  await client?.close();
  await service?.stop();
});

async function request<T>(type: string, payload: Record<string, unknown>): Promise<T> {
  const reply = await client.waitForReply(client.request(type, payload));
  if (reply.kind === "error") throw new Error(`${type}: ${String(reply.message)}`);
  return reply.payload as T;
}

describe("主機檢索", () => {
  it("預設未同意下載，卡片搜尋使用檢索服務的 RRF 分數", async () => {
    const settings = await request<{ settings: { key: string; value: unknown }[] }>(
      "system.settings.get",
      {},
    );
    expect(
      settings.settings.find((item) => item.key === "retrieval.allowModelDownload")?.value,
    ).toBe(false);
    const created = await request<{ card: { cardId: string } }>("card.create", {
      kind: "note",
      title: "retrieval unique title",
      body: "semantic proof",
      clientRequestId: "retrieval-create",
    });
    const result = await request<{ hits: { card: { cardId: string }; score: number }[] }>(
      "card.search",
      { query: "semantic" },
    );
    const match = result.hits.find((item) => item.card.cardId === created.card.cardId);
    expect(match?.score).toBeCloseTo(1 / 61);
    expect(existsSync(join(service.folder.path, "cache", "models"))).toBe(false);
  });
});
