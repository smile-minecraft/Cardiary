import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
} from "../test/support.js";

/**
 * 對話生命週期的協定契約：對真的主機行程跑，兩種組裝各跑一遍。
 *
 * `fake` 用記憶體引擎與真的卡片檔；`pi` 用 Pi Durable 與真的三個資料庫。
 * 這裡只驗生命週期訊息的線路行為與刪除後的資料夾狀態，不測模組內部：
 * 刪除走到哪一層、哪些表被刪、懸崖情況下如何補完，由儲存層與單元測試負責。
 */

interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

interface PreviewPayload {
  readonly sessionId: string;
  readonly subtreeSessionIds: readonly string[];
  readonly exclusiveCards: number;
  readonly sharedCards: number;
  readonly assets: number;
}

interface DeletePayload {
  readonly sessionId: string;
  readonly deletedSessionIds: readonly string[];
  readonly deletedCards: number;
  readonly deletedAssets: number;
}

interface LifecycleHarness {
  readonly service: SpawnedService;
  readonly client: ProtocolClient;
}

const harnesses: LifecycleHarness[] = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness === undefined) continue;
    await harness.client.close().catch(() => undefined);
    await harness.service.stop().catch(() => undefined);
  }
});

async function makeHarness(
  engine: "fake" | "pi",
  assistantText?: string,
): Promise<LifecycleHarness> {
  const service = await spawnService({
    engine,
    ...(assistantText === undefined ? {} : { scripts: [[{ kind: "text", text: assistantText }]] }),
  });
  const client = await connectAndHello(service);
  const subscribe = client.request("system.subscribe", {});
  await client.waitForReply(subscribe, 10_000);
  const harness = { service, client };
  harnesses.push(harness);
  return harness;
}

async function request<T = Record<string, unknown>>(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const id = client.request(type, payload);
  const reply = await client.waitForReply(id, 15_000);
  if (reply.kind === "error") {
    throw new Error(`${type} 失敗：${String(reply.code)} ${String(reply.message)}`);
  }
  return reply.payload as T;
}

/** 不丟錯；呼叫端自己判斷回應還是錯誤。 */
async function requestRaw(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = client.request(type, payload);
  return client.waitForReply(id, 15_000);
}

async function createSession(client: ProtocolClient, title: string): Promise<SessionSummary> {
  const payload = await request<{ session: SessionSummary }>(client, "session.create", {
    title,
    clientRequestId: `contract-${Math.random().toString(36).slice(2)}`,
  });
  return payload.session;
}

async function createNote(
  client: ProtocolClient,
  input: { readonly title: string; readonly body: string },
): Promise<string> {
  const payload = await request<{ card: { cardId: string } }>(client, "card.create", {
    kind: "note",
    title: input.title,
    body: input.body,
    clientRequestId: `contract-card-${Math.random().toString(36).slice(2)}`,
  });
  return payload.card.cardId;
}

/** 訂閱會話、送一則訊息，等這一輪完成；訊息與回覆都會落進引擎與事件日誌。 */
async function sendMessage(client: ProtocolClient, sessionId: string, text: string): Promise<void> {
  const subscribe = client.request("session.subscribe", { sessionId });
  await client.waitForReply(subscribe, 10_000);
  const send = await request(client, "session.send_message", {
    sessionId,
    text,
    delivery: "queue",
  });
  expect(send["disposition"]).toBe("started");
  await client.waitForEvent("stream.message_completed", 20_000);
}

/** 讓對話引用卡片：閘道把 `sessionId` 交給卡片模組，`card.get` 會記下引用。 */
function getCardInSession(
  client: ProtocolClient,
  cardId: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  return request(client, "card.get", { cardId, sessionId });
}

/** 遞迴列出資料夾裡的所有檔案（含 -wal／-shm）。 */
async function walkFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkFiles(full)));
      continue;
    }
    if (entry.isFile() || entry.isSymbolicLink()) {
      found.push(full);
    }
  }
  return found;
}

/** 整個資料夾找不到這段文字；找到時回傳檔案路徑，找不到回 null。 */
async function findInFolder(root: string, needle: string): Promise<string | null> {
  const expected = Buffer.from(needle, "utf8");
  for (const file of await walkFiles(root)) {
    const content = await readFile(file).catch(() => null);
    if (content === null) continue;
    if (content.includes(expected)) return file;
  }
  return null;
}

async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

/** 資料庫檔的實際佔用：主檔加 WAL／SHM；主檔常常還沒 checkpoint，只看主檔會誤判。 */
async function databaseBytes(path: string): Promise<number | null> {
  const sizes = await Promise.all([
    fileSize(path),
    fileSize(`${path}-wal`),
    fileSize(`${path}-shm`),
  ]);
  if (sizes.every((size) => size === null)) return null;
  return sizes.reduce((total, size) => total + (size ?? 0), 0);
}

function cardFile(harness: LifecycleHarness, cardId: string): string {
  return join(harness.service.folder.path, "cards", `${cardId}.md`);
}

const assemblyLine = ["fake", "pi"] as const;

for (const engine of assemblyLine) {
  describe(`生命週期契約（${engine} 組裝）`, () => {
    it("session.create→刪除預覽→session.delete；preview 與實際刪除一致，資料夾找不到內容", async () => {
      const conversationMarker = `CONVERSATION-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      // 助理回覆會落成 `stream.message_completed`，對話刪除後狀態庫才有東西可回收。
      const harness = await makeHarness(
        engine,
        `${conversationMarker} ${"對話內容 ".repeat(12_000)}`,
      );
      const { client } = harness;
      const exclusiveMarker = `EXCLUSIVE-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

      const owner = await createSession(client, "生命週期擁有者");
      const other = await createSession(client, "共享卡片的另一位");
      await sendMessage(
        client,
        owner.id,
        `${conversationMarker}-user ${"使用者訊息 ".repeat(12_000)}`,
      );

      // 專屬卡片：只有即將被刪除的那場對話引用。用多張撐大狀態庫，
      // 刪除後兩個資料庫才會真的縮小。
      const exclusiveCards: string[] = [];
      for (let index = 0; index < 24; index += 1) {
        const cardId = await createNote(client, {
          title: `專屬卡片 ${index}`,
          body: `${exclusiveMarker} 的第 ${index} 份內容\n${`${effectiveRow(exclusiveMarker, index)}\n`.repeat(24)}`,
        });
        await getCardInSession(client, cardId, owner.id);
        exclusiveCards.push(cardId);
      }
      const sharedMarker = `SHARED-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const sharedCard = await createNote(client, {
        title: "共享卡片",
        body: `${sharedMarker} 由兩場對話引用。`,
      });
      await getCardInSession(client, sharedCard, owner.id);
      await getCardInSession(client, sharedCard, other.id);

      const preview = await request<PreviewPayload>(client, "session.deletion_preview", {
        sessionId: owner.id,
      });
      expect(preview.subtreeSessionIds).toEqual([owner.id]);
      expect(preview.exclusiveCards).toBe(exclusiveCards.length);
      expect(preview.sharedCards).toBe(1);
      expect(preview.assets).toBe(0);

      const stateDb = join(harness.service.folder.path, "state", "cardiary.sqlite");
      const engineDb =
        engine === "pi" ? join(harness.service.folder.path, "state", "engine.sqlite") : null;
      const stateBefore = await databaseBytes(stateDb);
      const engineBefore = engineDb === null ? null : await databaseBytes(engineDb);

      // 預覽不能改任何狀態：專屬卡片檔還在。
      for (const cardId of exclusiveCards) {
        expect(existsSync(cardFile(harness, cardId))).toBe(true);
      }

      const deleteRequestId = `contract-delete-${Math.random().toString(36).slice(2)}`;
      const deleted = await request<DeletePayload>(client, "session.delete", {
        sessionId: owner.id,
        clientRequestId: deleteRequestId,
      });
      expect(deleted.deletedSessionIds).toEqual([owner.id]);
      expect(deleted.deletedCards).toBe(preview.exclusiveCards);
      expect(deleted.deletedAssets).toBe(0);

      // 專屬卡片從 cards/ 消失；共享卡片還在。
      for (const cardId of exclusiveCards) {
        expect(existsSync(cardFile(harness, cardId))).toBe(false);
      }
      expect(existsSync(cardFile(harness, sharedCard))).toBe(true);

      // 共享卡片仍然讀得到。
      const shared = await requestRaw(client, "card.get", { cardId: sharedCard });
      expect(shared.kind).toBe("response");

      // 整個資料夾（含 cards/、assets/、state/、cache/、tmp/、logs/ 與 -wal／-shm）
      // 找不到專屬卡片的內容與對話內容。
      expect(await findInFolder(harness.service.folder.path, exclusiveMarker)).toBeNull();
      expect(await findInFolder(harness.service.folder.path, conversationMarker)).toBeNull();

      if (engine === "pi") {
        const stateAfter = await databaseBytes(stateDb);
        const engineAfter = engineDb === null ? null : await databaseBytes(engineDb);
        expect(stateBefore).not.toBeNull();
        expect(stateAfter).not.toBeNull();
        expect(engineBefore).not.toBeNull();
        expect(engineAfter).not.toBeNull();
        expect(stateAfter as number).toBeLessThan(stateBefore as number);
        expect(engineAfter as number).toBeLessThan(engineBefore as number);
      }

      // 同一個 clientRequestId 重送回同一個結果，不會再刪一次。
      const resent = await request<DeletePayload>(client, "session.delete", {
        sessionId: owner.id,
        clientRequestId: deleteRequestId,
      });
      expect(resent).toEqual(deleted);
    }, 60_000);
  });
}

function effectiveRow(marker: string, index: number): string {
  return `${marker}-padding-${index}-${"0123456789abcdef".repeat(2)}`;
}
