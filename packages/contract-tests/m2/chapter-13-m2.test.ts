/**
 * 第 13 章五項驗收在 M2 的資料夾上重跑：同一個資料夾裡有向量索引、排程與通知。
 *
 * 對真的主機行程跑正式協定。向量用 `CARDIARY_TEST_EMBEDDER=fake` 的決定性假嵌入器
 * （只在 `CARDIARY_TEST_FAULTS=1` 時生效），向量照常寫進 `cache/index.sqlite` 的
 * `vec_cards`。M5 的 MCP 與外部代理組合在 `storage/chapter-13-composed.test.ts`。
 *
 * - 刪除對話後，整個資料夾（含 `-wal`／`-shm`）找不到對話與專屬卡片的內容，
 *   專屬卡的向量列與卡片 id 也不在快取區裡。
 * - 刪掉整個 `cache/` 後重啟：卡片、排程與通知讀得回來，向量索引重建。
 * - 排程跑完、主機關閉後 `tmp/` 是空的；資料夾以外沒有新增任何檔案。
 *
 * 拔插外接碟屬於手動驗收（`docs/acceptance/chapter-13.md`）。
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
  type TestFolder,
} from "../test/support.js";

const TEST_TIMEOUT = 60_000;
const EMBEDDER_ENV = { CARDIARY_TEST_EMBEDDER: "fake" };

const services: SpawnedService[] = [];
const clients: ProtocolClient[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  for (const service of services.splice(0)) await service.stop().catch(() => undefined);
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

interface Booted {
  readonly service: SpawnedService;
  readonly client: ProtocolClient;
}

async function boot(folder: TestFolder, initializeFolder: boolean): Promise<Booted> {
  const service = await spawnService({
    engine: "pi",
    // 第一回合給對話用，第二回合給排程的背景任務用。
    scripts: [[{ kind: "text", text: "好" }], [{ kind: "text", text: "排程已完成整理" }]],
    folder,
    initializeFolder,
    env: EMBEDDER_ENV,
  });
  services.push(service);
  const client = await connectAndHello(service);
  clients.push(client);
  await request(client, "system.subscribe", {});
  return { service, client };
}

async function shutdown(booted: Booted): Promise<void> {
  await booted.client.close().catch(() => undefined);
  clients.splice(clients.indexOf(booted.client), 1);
  await booted.service.stop().catch(() => undefined);
  services.splice(services.indexOf(booted.service), 1);
}

async function request<T = Record<string, unknown>>(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const reply = await client.waitForReply(client.request(type, payload), 20_000);
  if (reply.kind === "error") {
    throw new Error(`${type} 失敗：${String(reply.code)} ${String(reply.message)}`);
  }
  return reply.payload as T;
}

function requestId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

/** 人同意使用向量檢索（human-only 設定，本機客戶端才能改）。 */
async function allowVectors(client: ProtocolClient): Promise<void> {
  await request(client, "system.settings.set", {
    changes: [{ key: "retrieval.allowModelDownload", value: true }],
    clientRequestId: requestId("consent"),
  });
}

/** 唯讀打開快取索引，查某張卡的向量列數；資料庫不存在就是 0。 */
function vectorRows(folder: string, cardId?: string): number {
  const path = join(folder, "cache", "index.sqlite");
  if (!existsSync(path)) return 0;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row =
      cardId === undefined
        ? (db.prepare("SELECT count(*) AS n FROM vec_cards").get() as { n: number })
        : (db.prepare("SELECT count(*) AS n FROM vec_cards WHERE card_id = ?").get(cardId) as {
            n: number;
          });
    return Number(row.n);
  } catch {
    // 重建期間表可能還不存在。
    return 0;
  } finally {
    db.close();
  }
}

async function walkFiles(root: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(join(root, prefix), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : join(prefix, entry.name);
    if (entry.isDirectory()) found.push(...(await walkFiles(root, relative)));
    else found.push(relative);
  }
  return found;
}

/** 整個資料夾找不到這段文字；找到時回傳檔案路徑，找不到回 null。 */
async function findInFolder(root: string, needle: string): Promise<string | null> {
  const expected = Buffer.from(needle, "utf8");
  for (const relative of await walkFiles(root)) {
    const content = await readFile(join(root, relative)).catch(() => null);
    if (content?.includes(expected)) return relative;
  }
  return null;
}

async function listTree(root: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(join(root, prefix), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : join(prefix, entry.name);
    found.push(relative);
    if (entry.isDirectory()) found.push(...(await listTree(root, relative)));
  }
  return found;
}

async function eventually(check: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("條件等待逾時");
}

/** 在獨立的根目錄下建資料夾，資料夾外的快照才不會被其他測試干擾。 */
async function isolatedFolder(): Promise<{ root: string; folder: TestFolder }> {
  const root = await mkdtemp(join(tmpdir(), "cardiary-m2-ch13-"));
  tempDirs.push(root);
  const path = join(root, "Cardiary");
  await mkdir(path);
  return { root, folder: { path, folderId: "" } };
}

async function createCard(client: ProtocolClient, title: string, body: string): Promise<string> {
  const created = await request<{ card: { cardId: string } }>(client, "card.create", {
    kind: "note",
    title,
    body,
    clientRequestId: requestId("card"),
  });
  return created.card.cardId;
}

interface ScheduleList {
  readonly schedules: Array<{ scheduleId: string; name: string }>;
}

interface NotificationList {
  readonly notifications: Array<{ notificationId: string; kind: string; title?: string }>;
}

describe("第 13 章驗收：M2 資料夾（向量索引、排程與通知）", () => {
  it(
    "刪除對話後整個資料夾找不到內容，專屬卡的向量也一起消失",
    async () => {
      const { folder } = await isolatedFolder();
      const booted = await boot(folder, true);
      await allowVectors(booted.client);

      const marker = `M2CH13-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const created = await request<{ session: { id: string } }>(booted.client, "session.create", {
        title: "第 13 章 M2 對話",
        clientRequestId: requestId("session"),
      });
      const sessionId = created.session.id;
      await request(booted.client, "session.subscribe", { sessionId });
      await request(booted.client, "session.send_message", {
        sessionId,
        text: `${marker} 的使用者訊息`,
        delivery: "queue",
      });
      await booted.client.waitForEvent("stream.message_completed", 30_000);
      // 第一則訊息之後才建：開局發牌只在第一則訊息時把卡載入對話，這張卡不會變成專屬卡。
      const keptId = await createCard(booted.client, "保留的卡", "不屬於任何對話，刪除後仍要在");
      const exclusiveId = await createCard(booted.client, "專屬卡", `${marker} 的卡片內容`);
      // 在這場對話裡讀過，才算這場對話的專屬卡。
      await request(booted.client, "card.get", { cardId: exclusiveId, sessionId });

      await eventually(
        () => vectorRows(folder.path, exclusiveId) > 0 && vectorRows(folder.path, keptId) > 0,
      );
      expect(await findInFolder(folder.path, marker)).not.toBeNull();

      const preview = await request<{ exclusiveCards: number }>(
        booted.client,
        "session.deletion_preview",
        { sessionId },
      );
      expect(preview.exclusiveCards).toBe(1);
      await request(booted.client, "session.delete", {
        sessionId,
        clientRequestId: requestId("delete"),
      });

      await eventually(() => vectorRows(folder.path, exclusiveId) === 0);
      // 含 -wal／-shm 與向量表所在的快取庫，整個資料夾都找不到對話與卡片的內容。
      expect(await findInFolder(folder.path, marker)).toBeNull();
      // 快取區（全文與向量索引）裡連專屬卡的 id 都不剩。狀態庫的事件日誌會留下
      // 「卡片建立」事件的 id 與修訂雜湊，不含內容，不在這裡檢查。
      expect(await findInFolder(join(folder.path, "cache"), exclusiveId)).toBeNull();
      // 不屬於這場對話的卡與它的向量不受影響。
      expect(vectorRows(folder.path, keptId)).toBeGreaterThan(0);
      await request(booted.client, "card.get", { cardId: keptId });

      await shutdown(booted);
      // 重啟後仍找不到。
      const again = await boot(folder, false);
      expect(await findInFolder(folder.path, marker)).toBeNull();
      await shutdown(again);
    },
    TEST_TIMEOUT,
  );

  it(
    "排程跑完產生通知；刪掉整個 cache/ 後重啟，卡片、排程與通知都在，向量索引重建；tmp/ 為空、資料夾外零新檔",
    async () => {
      const { root, folder } = await isolatedFolder();
      const before = await listTree(root);

      const first = await boot(folder, true);
      await allowVectors(first.client);
      const cardId = await createCard(first.client, "M2 記憶卡", "向量索引重建後仍搜尋得到");
      await eventually(() => vectorRows(folder.path, cardId) > 0);

      await request(first.client, "module.scheduler.create", {
        data: {
          name: "第 13 章排程",
          kind: "once",
          spec: { at: "2020-01-01T00:00:00.000Z" },
          task: { type: "agent", prompt: "整理今天的卡片" },
        },
      });
      let notificationId = "";
      await eventually(async () => {
        const listed = await request<NotificationList>(first.client, "notification.list", {});
        const found = listed.notifications.find((item) => item.title?.includes("第 13 章排程"));
        notificationId = found?.notificationId ?? "";
        return notificationId !== "";
      }, 20_000);
      const schedules = await request<{ data: ScheduleList } | ScheduleList>(
        first.client,
        "module.scheduler.list",
        { data: {} },
      );
      const scheduleIds = scheduleIdsOf(schedules);
      expect(scheduleIds.length).toBeGreaterThan(0);

      await shutdown(first);
      // 主機關閉後暫存區是空的。
      expect(await walkFiles(join(folder.path, "tmp"))).toEqual([]);

      // 刪掉整個快取區（含 index.sqlite 與向量表）。
      await rm(join(folder.path, "cache"), { recursive: true, force: true });
      expect(existsSync(join(folder.path, "cache"))).toBe(false);

      const second = await boot(folder, false);
      await allowVectors(second.client);
      // 正本讀得回來：卡片、排程、通知。
      const card = await request<{ card: { cardId: string; title: string } }>(
        second.client,
        "card.get",
        { cardId },
      );
      expect(card.card.title).toBe("M2 記憶卡");
      const listedAgain = await request<NotificationList>(second.client, "notification.list", {});
      expect(listedAgain.notifications.map((item) => item.notificationId)).toContain(
        notificationId,
      );
      const schedulesAgain = scheduleIdsOf(
        await request<{ data: ScheduleList } | ScheduleList>(
          second.client,
          "module.scheduler.list",
          { data: {} },
        ),
      );
      expect(schedulesAgain).toEqual(scheduleIds);
      // 快取區重建，向量索引補回這張卡。
      await eventually(() => vectorRows(folder.path, cardId) > 0, 20_000);
      const hits = await request<{ hits: Array<{ card: { cardId: string } }> }>(
        second.client,
        "card.search",
        { query: "向量索引重建", limit: 5 },
      );
      expect(hits.hits.map((hit) => hit.card.cardId)).toContain(cardId);

      await shutdown(second);
      expect(await walkFiles(join(folder.path, "tmp"))).toEqual([]);

      const after = await listTree(root);
      const outside = after
        .filter((entry) => !before.includes(entry))
        .filter((entry) => entry !== "Cardiary" && !entry.startsWith("Cardiary/"));
      expect(outside).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});

/** 模組協定的回應可能包在 `data` 裡；兩種形狀都接受。 */
function scheduleIdsOf(payload: { data: ScheduleList } | ScheduleList): string[] {
  const list = "data" in payload ? payload.data : payload;
  return list.schedules.map((schedule) => schedule.scheduleId).sort();
}
