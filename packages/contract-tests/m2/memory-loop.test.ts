/**
 * M2 記憶閉環端到端契約測試。
 *
 * 對真的主机行程與協定跑：建卡 → 新鮮度歸零 → 每日蒸餾 → 原卡冷封存、
 * 記憶卡帶血緣 → 摘要通知 → 通知轉卡 → 開新對話，第一則訊息把記憶卡
 * 發進上下文（第 4 層），並確認送進模型的系統前綴真的包含它。
 *
 * 蒸餾與時間沒有對外協定；這裡用 `CARDIARY_TEST_FAULTS=1` 才註冊的
 * `module.memory.test`／`module.context.test` 接縫注入，其餘全部走正式協定。
 */

import { readFile } from "node:fs/promises";
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
  const service = await spawnService({
    engine: "pi",
    scripts: [[{ kind: "text", text: "收到" }], [{ kind: "text", text: "新對話回覆" }]],
  });
  services.push(service);
  const client = await connectAndHello(service);
  clients.push(client);
  const subscribed = client.request("system.subscribe", {});
  await client.waitForReply(subscribed, 8000);
  return { service, client };
}

async function request<T>(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const reply = await client.waitForReply(client.request(type, payload), 10_000);
  if (reply.kind === "error") {
    throw new Error(`${type} 失敗：${String(reply.code)} ${String(reply.message ?? "")}`);
  }
  return reply.payload as T;
}

async function pollUntil<T>(check: () => Promise<T | undefined>, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("條件等待逾時");
}

async function moduleRequest<T>(
  client: ProtocolClient,
  type: string,
  data: Record<string, unknown>,
): Promise<T> {
  const reply = await request<{ data: T }>(client, type, { data });
  return reply.data;
}

async function createCard(client: ProtocolClient, title: string, body: string): Promise<string> {
  const created = await request<{ card: { cardId: string } }>(client, "card.create", {
    kind: "note",
    title,
    body,
    clientRequestId: `m2-create-${Math.random().toString(36).slice(2)}`,
  });
  return created.card.cardId;
}

async function createSession(client: ProtocolClient): Promise<string> {
  const created = await request<{ session: { id: string } }>(client, "session.create", {
    clientRequestId: `m2-session-${Math.random().toString(36).slice(2)}`,
  });
  await client.waitForReply(client.request("session.subscribe", { sessionId: created.session.id }));
  return created.session.id;
}

describe("M2 記憶閉環（真主机行程 + 協定）", () => {
  it("卡片老化→蒸餾→冷封存與血緣→每日摘要→通知轉卡→新對話發牌", async () => {
    const { service, client } = await boot();
    const marker = Math.random().toString(36).slice(2, 8);
    const sourceId = await createCard(
      client,
      `原始筆記 ${marker}`,
      "作者的長期偏好：只用繁體中文。",
    );
    const before = await request<{ card: { freshness: number; lifecycle: string } }>(
      client,
      "card.get",
      { cardId: sourceId },
    );
    expect(before.card.freshness).toBe(100);
    expect(before.card.lifecycle).toBe("live");

    // 老化：測試接縫把新鮮度歸零（正式路徑是封存倒數結束）。
    await moduleRequest(client, "module.memory.test.zero-freshness", {});
    await pollUntil(async () => {
      const got = await request<{ card: { freshness: number } }>(client, "card.get", {
        cardId: sourceId,
      });
      return got.card.freshness === 0 ? true : undefined;
    }, 5000);

    // 蒸餾：腳本化模型提煉一條長期記憶。
    const memoryTitle = `長期記憶 ${marker}`;
    const memoryText = `作者偏好繁體中文（${marker}）`;
    const distilled = await moduleRequest<{
      run: { runId: string; status: string; stats: string } | null;
    }>(client, "module.memory.test.run-daily", {
      itemText: memoryText,
      title: memoryTitle,
      summary: "自原始筆記提煉",
    });
    expect(distilled.run).not.toBeNull();
    expect(["completed", "partial"]).toContain(distilled.run?.status);

    // 原卡冷封存；記憶卡出現並帶血緣（sources 指回原卡）。
    await pollUntil(async () => {
      const got = await request<{ card: { lifecycle: string } }>(client, "card.get", {
        cardId: sourceId,
      });
      return got.card.lifecycle === "cold" ? true : undefined;
    }, 5000);
    const searchMemory = () =>
      request<{ hits: Array<{ card: { cardId: string; title: string } }> }>(client, "card.search", {
        query: memoryTitle,
      });
    let memory: { card: { cardId: string; title: string } } | undefined;
    for (let attempt = 0; attempt < 50 && memory === undefined; attempt += 1) {
      const searched = await searchMemory();
      memory = searched.hits.find((hit) => hit.card.title === memoryTitle);
      if (memory === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    expect(memory, "蒸餾記憶卡沒有進索引").toBeDefined();
    const memoryId = memory?.card.cardId ?? "";
    const file = await readFile(join(service.folder.path, "cards", `${memoryId}.md`), "utf8");
    expect(file).toContain(`sources:`);
    expect(file).toContain(sourceId);

    // 每日摘要通知：蒸餾產生一則 distillation 通知，可轉成卡片。
    await client.waitFor(
      (frame) =>
        frame.type === "notification.changed" &&
        (frame.payload as { notification?: { kind?: string } }).notification?.kind ===
          "distillation",
      10_000,
    );
    const listed = await request<{
      notifications: Array<{ notificationId: string; kind: string }>;
    }>(client, "notification.list", {});
    const summary = listed.notifications.find((item) => item.kind === "distillation");
    expect(summary).toBeDefined();
    const converted = await request<{
      card: { cardId: string };
      deduped: boolean;
    }>(client, "notification.create_card", { notificationId: summary?.notificationId });
    expect(converted.deduped).toBe(false);
    const again = await request<{ deduped: boolean }>(client, "notification.create_card", {
      notificationId: summary?.notificationId,
    });
    expect(again.deduped).toBe(true);

    // 新對話：第一則訊息把記憶卡發進第 4 層。
    const sessionId = await createSession(client);
    await request(client, "session.send_message", {
      sessionId,
      text: memoryTitle,
      delivery: "queue",
      clientMessageId: `m2-msg-${marker}`,
    });
    await client.waitForEvent("stream.message_completed", 15_000);
    const view = await request<{
      context: { entries: Array<{ layer: string; cardId?: string }> };
    }>(client, "context.get", { sessionId });
    const opening = view.context.entries.filter((entry) => entry.layer === "opening-memory");
    expect(opening.map((entry) => entry.cardId)).toContain(memoryId);

    // 模型收到的系統前綴（第 3／4 層）真的包含這張記憶卡。
    const assembled = await moduleRequest<{ systemContext: string }>(
      client,
      "module.context.test.system-context",
      { sessionId },
    );
    expect(assembled.systemContext).toContain(memoryTitle);
    expect(assembled.systemContext).toContain(memoryText);
  }, 90_000);
});
