import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  makeFolder,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
  type TestFolder,
} from "../test/support.js";

/**
 * 主機服務的記憶體上限（規格第 13 章「記憶體」）。
 *
 * RSS 超過上限時，主機走和 SIGTERM 相同的乾淨關閉，以結束碼 75 退出；殼看到 75 會重啟
 * （殼端行為由 `ServiceSupervisor` 負責）。這裡用測試專用的極低上限讓主機一啟動就超標，
 * 確認它確實以 75 退出、關閉是乾淨的（同一個資料夾重開後資料都在），以及：
 * - 預設上限下主機持續運作；
 * - 不在測試環境時，低於安全門檻的覆寫被忽略，主機也不會被打掉。
 */

const services: SpawnedService[] = [];
const clients: ProtocolClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  for (const service of services.splice(0)) await service.stop().catch(() => undefined);
});

async function boot(
  folder: TestFolder,
  env: Record<string, string> = {},
): Promise<{ service: SpawnedService; client: ProtocolClient }> {
  const service = await spawnService({ folder, env });
  services.push(service);
  const client = await connectAndHello(service);
  clients.push(client);
  return { service, client };
}

async function request(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const reply = await client.waitForReply(client.request(type, payload), 10_000);
  expect(reply.kind, `${type}: ${JSON.stringify(reply)}`).toBe("response");
  return reply.payload as Record<string, unknown>;
}

/** 在 `ms` 內行程結束就回結束碼，否則回 `"running"`。 */
function exitWithin(service: SpawnedService, ms: number): Promise<number | null | "running"> {
  return Promise.race([
    service.exited,
    new Promise<"running">((resolve) => setTimeout(() => resolve("running"), ms)),
  ]);
}

describe("主機記憶體上限", () => {
  it("超過上限就乾淨關閉並以結束碼 75 退出，同一個資料夾重開後資料都在", async () => {
    const folder = await makeFolder();
    const first = await boot(folder);
    const created = await request(first.client, "card.create", {
      kind: "note",
      title: "記憶體重啟前的卡",
      body: "重啟後要讀得回來",
      clientRequestId: `memory-${Math.random().toString(36).slice(2)}`,
    });
    const cardId = (created.card as { cardId: string }).cardId;
    await first.client.close();
    clients.splice(clients.indexOf(first.client), 1);
    await first.service.stop();
    services.splice(services.indexOf(first.service), 1);

    // 測試專用的 1 MB 上限：主機一量就超標。
    const limited = await spawnService({
      folder,
      env: { CARDIARY_MEMORY_LIMIT_MB: "1", CARDIARY_MEMORY_CHECK_MS: "50" },
    });
    services.push(limited);
    expect(await exitWithin(limited, 10_000)).toBe(75);
    expect(limited.stderr()).toContain("記憶體超過上限");

    // 乾淨關閉：同一個資料夾再開，卡片讀得回來。
    const reopened = await boot(folder);
    const card = await request(reopened.client, "card.get", { cardId });
    expect((card.card as { title: string }).title).toBe("記憶體重啟前的卡");
  }, 40_000);

  it("預設上限下主機持續運作", async () => {
    const { service } = await boot(await makeFolder(), { CARDIARY_MEMORY_CHECK_MS: "50" });
    expect(await exitWithin(service, 1_000)).toBe("running");
  }, 20_000);

  it("不在測試環境時，低於安全門檻的上限被忽略，主機不會被打掉", async () => {
    // 間隔用正式環境允許的最短 1 秒，讓監控在等待期間真的量過幾次。
    const { service } = await boot(await makeFolder(), {
      CARDIARY_TEST_FAULTS: "0",
      CARDIARY_MEMORY_LIMIT_MB: "1",
      CARDIARY_MEMORY_CHECK_MS: "1000",
    });
    expect(await exitWithin(service, 3_500)).toBe("running");
    expect(service.stderr()).toContain("CARDIARY_MEMORY_LIMIT_MB=1 低於 256 MB");
  }, 20_000);
});
