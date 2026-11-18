import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  connectAndHello,
  engineUnderTest,
  makeFolder,
  spawnService,
  type ProtocolClient,
  type SpawnedService,
  type TestFolder,
} from "../test/support.js";

/**
 * 每日蒸餾的協定契約：對真的主機行程跑，不直接呼叫模組或領域函式。
 *
 * 卡仍然落地成資料夾裡的檔案，蒸餾由排程的 `distillation` 任務經掛鉤觸發；
 * 小模型用契約測試的環境變數接縫給固定回應（`CARDIARY_TEST_FAULTS=1` 才生效），
 * 種子卡的新鮮度由同一接縫歸零。兩者都不進正式產品路徑。
 *
 * 涵蓋：新鮮度歸零提煉成記憶卡且血緣指回原卡、原卡轉冷封存、重複合併不產生
 * 重複卡、每日摘要可逐項復原（含取代關係消失）、重啟續跑中斷與已完成的蒸餾、
 * 未交付的每日蒸餾排程在下次啟動補跑、維護清理未登記的快取、跨批去重排除已刪除
 * 的輸出卡、蒸餾後已載入上下文的位元組不變、核心組在第 3 層且不超預算。
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 測試用 ULID：時間主幹加隨機尾段，格式與產品相同。 */
function newUlid(): string {
  let time = BigInt(Date.now());
  const timePart = new Array<string>(10);
  for (let index = 9; index >= 0; index -= 1) {
    timePart[index] = CROCKFORD[Number(time & 31n)] as string;
    time >>= 5n;
  }
  const randomPart = new Array<string>(16);
  for (let index = 0; index < 16; index += 1) {
    randomPart[index] = CROCKFORD[Math.floor(Math.random() * 32)] as string;
  }
  return `${timePart.join("")}${randomPart.join("")}`;
}

interface SummaryItem {
  readonly id: string;
  readonly action: string;
  readonly cardId?: string;
  readonly sources?: readonly string[];
  readonly mergedInto?: string;
  readonly supersedes?: string;
  readonly cardIds?: readonly string[];
  readonly recovery: string;
}

interface Digest {
  readonly notification: {
    readonly notificationId: string;
    readonly kind: string;
    readonly title: string;
    readonly body: string;
    readonly payload: { readonly items?: readonly SummaryItem[] };
  };
}

const services: SpawnedService[] = [];
const clients: ProtocolClient[] = [];
const savedEnv: Record<string, string | undefined> = {};

function setSeam(model: Record<string, string>, zeroCardIds: readonly string[]): void {
  for (const key of ["CARDIARY_TEST_DISTILL_MODEL", "CARDIARY_TEST_DISTILL_ZERO"] as const) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  }
  process.env.CARDIARY_TEST_DISTILL_MODEL = JSON.stringify(model);
  process.env.CARDIARY_TEST_DISTILL_ZERO = zeroCardIds.join(",");
}

function cardFile(input: {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly kind?: string;
  readonly summary?: string;
}): string {
  return [
    "---",
    `id: ${input.id}`,
    `kind: ${input.kind ?? "note"}`,
    `title: ${input.title}`,
    ...(input.summary === undefined ? [] : [`summary: ${input.summary}`]),
    "created: 2026-01-01T00:00:00.000Z",
    "---",
    input.body,
  ].join("\n");
}

async function writeCards(folder: TestFolder, cards: readonly (readonly [string, string])[]) {
  const directory = join(folder.path, "cards");
  await mkdir(directory, { recursive: true });
  for (const [id, text] of cards) {
    await writeFile(join(directory, `${id}.md`), text, "utf8");
  }
}

async function requestPayload<T>(
  client: ProtocolClient,
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const id = client.request(type, payload);
  const reply = await client.waitForReply(id, 10_000);
  if (reply.kind === "error") {
    throw new Error(
      `${type} 失敗：${String((reply as { code?: string }).code)} ${String((reply as { message?: string }).message)}`,
    );
  }
  return reply.payload as T;
}

async function moduleRequest<T>(
  client: ProtocolClient,
  type: string,
  data: Record<string, unknown>,
): Promise<T> {
  const reply = await requestPayload<{ data: T }>(client, type, { data });
  return reply.data;
}

/** 建一個到期的蒸餾排程；建立的 poke 會讓排程器立刻跑一次蒸餾。 */
async function triggerDistillation(client: ProtocolClient): Promise<void> {
  await moduleRequest(client, "module.scheduler.create", {
    name: "契約測試蒸餾",
    kind: "once",
    spec: { at: "2020-01-01T00:00:00.000Z" },
    task: { type: "distillation" },
  });
}

async function boot(cards: readonly (readonly [string, string])[]): Promise<{
  service: SpawnedService;
  client: ProtocolClient;
}> {
  const folder = await makeFolder();
  await writeCards(folder, cards);
  const service = await spawnService({ folder });
  services.push(service);
  const client = await connectAndHello(service);
  clients.push(client);
  const subscribe = client.request("system.subscribe", {});
  await client.waitForReply(subscribe);
  return { service, client };
}

async function waitForDigest(client: ProtocolClient): Promise<Digest> {
  const event = await client.waitFor(
    (frame) =>
      frame.kind === "event" &&
      frame.type === "notification.changed" &&
      (frame.payload as { notification?: { kind?: string } })?.notification?.kind ===
        "distillation",
    20_000,
  );
  return event.payload as unknown as Digest;
}

async function cardText(folder: TestFolder, cardId: string): Promise<string> {
  return readFile(join(folder.path, "cards", `${cardId}.md`), "utf8");
}

async function memoryCardCount(folder: TestFolder): Promise<number> {
  const directory = join(folder.path, "cards");
  const names = await readdir(directory).catch(() => [] as string[]);
  let count = 0;
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const text = await readFile(join(directory, name), "utf8").catch(() => "");
    if (/^kind: memory$/m.test(text)) count += 1;
  }
  return count;
}

async function createSession(client: ProtocolClient): Promise<string> {
  const payload = await requestPayload<{ session: { id: string } }>(client, "session.create", {
    clientRequestId: `cr-${Math.random().toString(36).slice(2)}`,
  });
  return payload.session.id;
}

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close().catch(() => undefined);
  }
  for (const service of services.splice(0)) {
    await service.stop().catch(() => undefined);
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(savedEnv)) delete savedEnv[key];
});

const EXTRACT = JSON.stringify({
  items: [{ type: "fact", text: "使用者偏好在週末整理儲藏室" }],
});
const TITLE = JSON.stringify({ title: "週末整理偏好", summary: "使用者傾向週末整理儲藏室" });

describe("每日蒸餾的協定契約", () => {
  it("module.memory.undo 的回應包在 data 欄位（模組協定 schema）", async () => {
    const { client } = await boot([]);
    const id = client.request("module.memory.undo", {
      data: { notificationId: "", itemId: "" },
    });
    const reply = await client.waitForReply(id, 10_000);
    expect(reply.kind).toBe("response");
    expect((reply.payload as { data?: unknown }).data).toEqual({
      ok: false,
      reason: "invalid-input",
    });
  }, 20_000);

  it("新鮮度歸零的卡被蒸餾後轉冷封存，記憶卡 sources 指回原卡", async () => {
    const sourceId = newUlid();
    setSeam(
      {
        記憶蒸餾提煉: EXTRACT,
        記憶蒸餾重複判定: "否",
        記憶蒸餾矛盾判定: "否",
        記憶蒸餾標題: TITLE,
      },
      [sourceId],
    );
    const source = cardFile({ id: sourceId, title: "日常筆記", body: "週末想整理儲藏室。" });
    const { service, client } = await boot([[sourceId, source]]);

    await triggerDistillation(client);
    const digest = await waitForDigest(client);
    const created = digest.notification.payload.items?.find((item) => item.action === "created");
    const cold = digest.notification.payload.items?.find((item) => item.action === "cold");

    expect(created?.sources).toEqual([sourceId]);
    expect(typeof created?.cardId).toBe("string");
    expect(cold?.cardIds).toContain(sourceId);

    const memoryCardId = created?.cardId ?? "";
    const memoryText = await cardText(service.folder, memoryCardId);
    expect(memoryText).toMatch(/^kind: memory$/m);
    expect(memoryText).toMatch(/sources:/);
    expect(memoryText).toContain(sourceId);

    // 原卡檔一個字都沒變；冷封存只改狀態庫。
    expect(await cardText(service.folder, sourceId)).toBe(source);

    const listed = await requestPayload<{
      card: { lifecycle: string };
    }>(client, "card.get", { cardId: sourceId });
    expect(listed.card.lifecycle).toBe("cold");
  }, 40_000);

  it("與既有記憶重複時合併，不產生重複卡", async () => {
    const sourceId = newUlid();
    const memoryId = newUlid();
    setSeam(
      {
        記憶蒸餾提煉: EXTRACT,
        記憶蒸餾重複判定: "是",
        記憶蒸餾矛盾判定: "否",
        記憶蒸餾標題: TITLE,
      },
      [sourceId],
    );
    const existing = cardFile({
      id: memoryId,
      title: "週末整理偏好",
      summary: "使用者偏好在週末整理儲藏室",
      body: "使用者偏好在週末整理儲藏室。",
      kind: "memory",
    });
    const { service, client } = await boot([
      [sourceId, cardFile({ id: sourceId, title: "日常筆記", body: "週末想整理儲藏室。" })],
      [memoryId, existing],
    ]);

    await triggerDistillation(client);
    const digest = await waitForDigest(client);
    const merged = digest.notification.payload.items?.find((item) => item.action === "merged");
    const created = digest.notification.payload.items?.find((item) => item.action === "created");

    expect(merged?.mergedInto).toBe(memoryId);
    expect(merged?.sources).toEqual([sourceId]);
    expect(created).toBeUndefined();

    // 沒有新記憶卡，既有記憶卡的內容也沒被覆寫。
    const produced = await readdir(join(service.folder.path, "cards")).catch(() => [] as string[]);
    expect(produced.filter((name) => name.startsWith("mem_"))).toEqual([]);
    expect(await cardText(service.folder, memoryId)).toBe(existing);
  }, 40_000);

  it("矛盾時新卡 supersedes 舊卡，舊卡仍可追溯", async () => {
    const sourceId = newUlid();
    const memoryId = newUlid();
    setSeam(
      {
        記憶蒸餾提煉: EXTRACT,
        記憶蒸餾重複判定: "否",
        記憶蒸餾矛盾判定: "是",
        記憶蒸餾標題: TITLE,
      },
      [sourceId],
    );
    // 文字重疊才會被全文檢索列為比對候選，才會問到矛盾判定。
    const oldMemory = cardFile({
      id: memoryId,
      title: "週末整理偏好",
      summary: "使用者偏好在週末整理儲藏室",
      body: "使用者偏好在週末整理儲藏室。",
      kind: "memory",
    });
    const { service, client } = await boot([
      [sourceId, cardFile({ id: sourceId, title: "日常筆記", body: "週末想整理儲藏室。" })],
      [memoryId, oldMemory],
    ]);

    await triggerDistillation(client);
    const digest = await waitForDigest(client);
    const superseded = digest.notification.payload.items?.find(
      (item) => item.action === "superseded",
    );

    expect(superseded?.supersedes).toBe(memoryId);
    expect(superseded?.sources).toEqual([sourceId]);

    const newCardId = superseded?.cardId ?? "";
    const newMemoryText = await cardText(service.folder, newCardId);
    expect(newMemoryText).toContain(`supersedes: ${memoryId}`);

    // 舊卡沒被改寫、沒被刪除，仍可被 card.get 取回（可追溯）。
    expect(await cardText(service.folder, memoryId)).toBe(oldMemory);
    const old = await requestPayload<{ card: { cardId: string; supersededBy?: string } }>(
      client,
      "card.get",
      { cardId: memoryId },
    );
    expect(old.card.cardId).toBe(memoryId);

    // 逐項復原 superseded：新卡被刪除，取代關係消失，舊卡一個字都沒變。
    const undone = await moduleRequest<{ ok: boolean }>(client, "module.memory.undo", {
      notificationId: digest.notification.notificationId,
      itemId: superseded?.id ?? "",
    });
    expect(undone.ok).toBe(true);
    await expect(cardText(service.folder, newCardId)).rejects.toThrow();
    expect(await cardText(service.folder, memoryId)).toBe(oldMemory);
  }, 40_000);

  it("每日摘要的每一項可個別復原，卡片、取代與冷封存回到蒸餾前", async () => {
    const sourceId = newUlid();
    setSeam(
      {
        記憶蒸餾提煉: EXTRACT,
        記憶蒸餾重複判定: "否",
        記憶蒸餾矛盾判定: "否",
        記憶蒸餾標題: TITLE,
      },
      [sourceId],
    );
    const source = cardFile({ id: sourceId, title: "日常筆記", body: "週末想整理儲藏室。" });
    const { service, client } = await boot([[sourceId, source]]);

    await triggerDistillation(client);
    const digest = await waitForDigest(client);
    const items = digest.notification.payload.items ?? [];
    const created = items.find((item) => item.action === "created");
    expect(created?.cardId).toBeTypeOf("string");
    expect(await memoryCardCount(service.folder)).toBe(1);

    // 逐項復原：.created 刪掉記憶卡並把原卡還原為 live；cold 再uncold 一次。
    // core-added 因「一天最多變動一次」在當日會被順延（deferred），属預期。
    for (const item of items) {
      const result = await moduleRequest<{ ok: boolean; deferred?: boolean }>(
        client,
        "module.memory.undo",
        { notificationId: digest.notification.notificationId, itemId: item.id },
      );
      expect(result.ok).toBe(true);
    }

    expect(await memoryCardCount(service.folder)).toBe(0);
    const restored = await requestPayload<{ card: { lifecycle: string } }>(client, "card.get", {
      cardId: sourceId,
    });
    expect(restored.card.lifecycle).toBe("live");
    expect(await cardText(service.folder, sourceId)).toBe(source);
  }, 40_000);

  it("重啟後再觸發同日蒸餾不會重複產卡", async () => {
    const sourceId = newUlid();
    setSeam(
      {
        記憶蒸餾提煉: EXTRACT,
        記憶蒸餾重複判定: "否",
        記憶蒸餾矛盾判定: "否",
        記憶蒸餾標題: TITLE,
      },
      [sourceId],
    );
    const source = cardFile({ id: sourceId, title: "日常筆記", body: "週末想整理儲藏室。" });
    const folder = await makeFolder();
    await writeCards(folder, [[sourceId, source]]);

    const first = await spawnService({ folder });
    services.push(first);
    const firstClient = await connectAndHello(first);
    clients.push(firstClient);
    await firstClient.waitForReply(firstClient.request("system.subscribe", {}));
    await triggerDistillation(firstClient);
    await waitForDigest(firstClient);
    expect(await memoryCardCount(folder)).toBe(1);

    // 關掉再開同一個資料夾；中斷的 run 會在啟動時續跑，已完成的同日 run 略過。
    await firstClient.close();
    await first.stop();
    const restarted = await spawnService({ folder });
    services.push(restarted);
    const client = await connectAndHello(restarted);
    clients.push(client);
    await client.waitForReply(client.request("system.subscribe", {}));

    // 再觸發一次同日蒸餾：既有 run 已完成，runForDay 直接回傳，不重複產卡。
    await triggerDistillation(client);
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    expect(await memoryCardCount(folder)).toBe(1);
    expect(await cardText(folder, sourceId)).toBe(source);
  }, 50_000);

  it("復原取代項後取代關係消失，新舊卡與原卡檔皆原樣", async () => {
    const sourceId = newUlid();
    const memoryId = newUlid();
    setSeam(
      {
        記憶蒸餾提煉: EXTRACT,
        記憶蒸餾重複判定: "否",
        記憶蒸餾矛盾判定: "是",
        記憶蒸餾標題: TITLE,
      },
      [sourceId],
    );
    const oldMemory = cardFile({
      id: memoryId,
      title: "週末整理偏好",
      summary: "使用者偏好在週末整理儲藏室",
      body: "使用者偏好在週末整理儲藏室。",
      kind: "memory",
    });
    const { service, client } = await boot([
      [sourceId, cardFile({ id: sourceId, title: "日常筆記", body: "週末想整理儲藏室。" })],
      [memoryId, oldMemory],
    ]);

    await triggerDistillation(client);
    const digest = await waitForDigest(client);
    const superseded = digest.notification.payload.items?.find(
      (item) => item.action === "superseded",
    );
    const newCardId = superseded?.cardId ?? "";
    expect(typeof newCardId).toBe("string");

    // 復原前：索引裡就有取代關係，card.get 讀得到。
    const beforeUndo = await requestPayload<{ card: { supersededBy?: string } }>(
      client,
      "card.get",
      { cardId: memoryId },
    );
    expect(beforeUndo.card.supersededBy).toBe(newCardId);

    const undone = await moduleRequest<{ ok: boolean }>(client, "module.memory.undo", {
      notificationId: digest.notification.notificationId,
      itemId: superseded?.id ?? "",
    });
    expect(undone.ok).toBe(true);

    // 復原後：取代關係消失（新卡檔已刪除，索引列也一起消失），舊卡原樣。
    const afterUndo = await requestPayload<{ card: { supersededBy?: string } }>(
      client,
      "card.get",
      { cardId: memoryId },
    );
    expect(afterUndo.card.supersededBy).toBeUndefined();
    expect(await cardText(service.folder, memoryId)).toBe(oldMemory);
    await expect(cardText(service.folder, newCardId)).rejects.toThrow();
  }, 40_000);

  it("蒸餾完成後再呼叫 system-context，已載入上下文的位元組不變", async () => {
    const sourceId = newUlid();
    const memoryId = newUlid();
    setSeam(
      {
        記憶蒸餾提煉: EXTRACT,
        記憶蒸餾重複判定: "是",
        記憶蒸餾矛盾判定: "否",
        記憶蒸餾標題: TITLE,
      },
      [sourceId],
    );
    // 重複合併不產生新卡，也不變動核心組；systemContext 應該前後一致。
    // 帶基岩與人格種子卡，第一次組裝就會把它們固定載入，比對才有內容意義。
    const bedrockId = newUlid();
    const personaId = newUlid();
    const existing = cardFile({
      id: memoryId,
      title: "週末整理偏好",
      summary: "使用者偏好在週末整理儲藏室",
      body: "使用者偏好在週末整理儲藏室。",
      kind: "memory",
    });
    const { client } = await boot([
      [sourceId, cardFile({ id: sourceId, title: "日常筆記", body: "週末想整理儲藏室。" })],
      [memoryId, existing],
      [
        bedrockId,
        cardFile({
          id: bedrockId,
          title: "基石",
          body: "使用者偏好的整理方式：先分類再丟棄。",
          kind: "bedrock",
        }),
      ],
      [
        personaId,
        cardFile({
          id: personaId,
          title: "人格",
          body: "你是謹慎整理檔案的助手。",
          kind: "persona",
        }),
      ],
    ]);

    const sessionId = await createSession(client);
    const before = await moduleRequest<{ systemContext: string }>(
      client,
      "module.context.test.system-context",
      { sessionId },
    );
    expect(before.systemContext).toContain("先分類再丟棄");
    expect(before.systemContext).toContain("謹慎整理檔案的助手");

    await triggerDistillation(client);
    const digest = await waitForDigest(client);
    expect(
      digest.notification.payload.items?.find((item) => item.action === "merged"),
    ).toBeDefined();

    const after = await moduleRequest<{ systemContext: string }>(
      client,
      "module.context.test.system-context",
      { sessionId },
    );
    expect(after.systemContext).toBe(before.systemContext);
  }, 40_000);

  it("中斷的蒸餾在服務重啟後續跑，記憶卡恰好產生一張", async () => {
    const sourceId = newUlid();
    setSeam(
      {
        記憶蒸餾提煉: EXTRACT,
        記憶蒸餾重複判定: "否",
        記憶蒸餾矛盾判定: "否",
        記憶蒸餾標題: TITLE,
      },
      [],
    );
    const source = cardFile({ id: sourceId, title: "日常筆記", body: "週末想整理儲藏室。" });
    const folder = await makeFolder();
    await writeCards(folder, [[sourceId, source]]);

    // 第一個行程：只種一筆「提煉已完成、還沒合併」的中斷 run，然後關閉。
    const first = await spawnService({ folder });
    services.push(first);
    const firstClient = await connectAndHello(first);
    clients.push(firstClient);
    await firstClient.waitForReply(firstClient.request("system.subscribe", {}));
    const seeded = await moduleRequest<{ ok: boolean }>(
      firstClient,
      "module.memory.test.seed-interrupted-run",
      { sourceCardId: sourceId },
    );
    expect(seeded.ok).toBe(true);
    await firstClient.close();
    await first.stop();

    // 第二個行程：啟動時續跑中斷的 run；種卡的新鮮度要在啟動前歸零。
    setSeam(
      {
        記憶蒸餾提煉: EXTRACT,
        記憶蒸餾重複判定: "否",
        記憶蒸餾矛盾判定: "否",
        記憶蒸餾標題: TITLE,
      },
      [sourceId],
    );
    const restarted = await spawnService({ folder });
    services.push(restarted);
    const client = await connectAndHello(restarted);
    clients.push(client);
    await client.waitForReply(client.request("system.subscribe", {}));

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && (await memoryCardCount(folder)) !== 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    expect(await memoryCardCount(folder)).toBe(1);

    const restored = await requestPayload<{ card: { lifecycle: string } }>(client, "card.get", {
      cardId: sourceId,
    });
    expect(restored.card.lifecycle).toBe("cold");
    expect(await cardText(folder, sourceId)).toBe(source);
  }, 50_000);

  it("未交付的每日蒸餾在服務重啟時補跑一次", async () => {
    const sourceId = newUlid();
    setSeam(
      {
        記憶蒸餾提煉: EXTRACT,
        記憶蒸餾重複判定: "否",
        記憶蒸餾矛盾判定: "否",
        記憶蒸餾標題: TITLE,
      },
      [sourceId],
    );
    const source = cardFile({ id: sourceId, title: "日常筆記", body: "週末想整理儲藏室。" });
    const folder = await makeFolder();
    await writeCards(folder, [[sourceId, source]]);

    const first = await spawnService({ folder });
    services.push(first);
    const firstClient = await connectAndHello(first);
    clients.push(firstClient);
    await firstClient.waitForReply(firstClient.request("system.subscribe", {}));
    const seeded = await moduleRequest<{ ok: boolean }>(
      firstClient,
      "module.memory.test.seed-overdue-distillation",
      {},
    );
    expect(seeded.ok).toBe(true);
    await firstClient.close();
    await first.stop();

    // 啟動時排程器的立即 tick 會搶到這筆早已過期的每日排程並補跑一次。
    const restarted = await spawnService({ folder });
    services.push(restarted);
    const client = await connectAndHello(restarted);
    clients.push(client);
    await client.waitForReply(client.request("system.subscribe", {}));

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && (await memoryCardCount(folder)) !== 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    expect(await memoryCardCount(folder)).toBe(1);
  }, 50_000);

  it("維護作業清掉未登記的快取檔，並回報兩個資料庫的大小", async () => {
    const sourceId = newUlid();
    setSeam(
      {
        記憶蒸餾提煉: EXTRACT,
        記憶蒸餾重複判定: "否",
        記憶蒸餾矛盾判定: "否",
        記憶蒸餾標題: TITLE,
      },
      [sourceId],
    );
    const { service, client } = await boot([
      [sourceId, cardFile({ id: sourceId, title: "日常筆記", body: "週末想整理儲藏室。" })],
    ]);

    await triggerDistillation(client);
    await waitForDigest(client);

    const cacheDirectory = join(service.folder.path, "cache");
    const unregistered = join(cacheDirectory, "contract-unregistered.bin");
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(unregistered, "not registered in the registry", "utf8");

    const report = await moduleRequest<{
      ok: boolean;
      scan: { removedUnregistered: number; violations: readonly { kind: string }[] };
      stateSizeBefore: number;
      stateSizeAfter: number;
      engineSizeBefore: number;
      engineSizeAfter: number;
    }>(client, "module.memory.test.maintenance-daily", {});

    if (engineUnderTest() === "fake") {
      // 記憶體組裝沒有引擎庫與檔案登記簿，主機不提供每日維護；
      // 接縫必須回報可序列化的 no-maintenance 狀態而不是假裝成功。
      // 完整行為由 packages/storage 的單元測試（registry.test.ts 與
      // deletion.test.ts 的每日維護案例）以及 pi 組裝的契約測試把關。
      expect(report.ok).toBe(false);
      expect((report as unknown as { reason: string }).reason).toBe("no-maintenance");
      expect(await readFile(unregistered, "utf8")).toBe("not registered in the registry");
      return;
    }

    expect(report.ok).toBe(true);
    expect(report.scan.removedUnregistered).toBeGreaterThanOrEqual(1);
    await expect(readFile(unregistered)).rejects.toThrow();
    for (const size of [
      report.stateSizeBefore,
      report.stateSizeAfter,
      report.engineSizeBefore,
      report.engineSizeAfter,
    ]) {
      expect(Number.isFinite(size)).toBe(true);
    }
  }, 50_000);

  it("跨批去重：輸出卡已刪除時，相同內容產生新卡而不是併進已刪的卡", async () => {
    const sourceA = newUlid();
    const sourceB = newUlid();
    setSeam(
      {
        記憶蒸餾提煉: EXTRACT,
        記憶蒸餾重複判定: "否",
        記憶蒸餾矛盾判定: "否",
        記憶蒸餾標題: TITLE,
      },
      [sourceA],
    );
    const { service, client } = await boot([
      [sourceA, cardFile({ id: sourceA, title: "第一批筆記", body: "週末想整理儲藏室。" })],
      [sourceB, cardFile({ id: sourceB, title: "第二批筆記", body: "週末想整理儲藏室。" })],
    ]);

    // 第一批：蒸餾產生記憶卡 N。
    await triggerDistillation(client);
    const digest = await waitForDigest(client);
    const created = digest.notification.payload.items?.find((item) => item.action === "created");
    const outputId = created?.cardId ?? "";
    expect(typeof outputId).toBe("string");
    expect(await memoryCardCount(service.folder)).toBe(1);

    // 刪掉這張輸出卡；後續批次的相同內容不得折進它。
    const deleted = await requestPayload<{ cardId: string }>(client, "card.delete", {
      cardId: outputId,
      clientRequestId: `del-${Math.random().toString(36).slice(2)}`,
    });
    expect(deleted.cardId).toBe(outputId);
    expect(await memoryCardCount(service.folder)).toBe(0);

    // 關閉行程並種一筆中斷的 run（sourceB 的內容雜湊與 N 相同），
    // 重開機時續跑；已刪除的輸出卡不得被跨批去重折進去。
    // 一天一個 run：同一天已有完成的 run，同一天再建只會回傳既有紀錄、
    // 續跑永遠找不到中斷的 batch，所以把中斷的批次種在前一天。
    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const seeded = await moduleRequest<{ ok: boolean }>(
      client,
      "module.memory.test.seed-interrupted-run",
      { sourceCardId: sourceB, itemText: "使用者偏好在週末整理儲藏室", day: yesterday },
    );
    expect(seeded.ok).toBe(true);
    await client.close();
    await service.stop();

    setSeam(
      {
        記憶蒸餾提煉: EXTRACT,
        記憶蒸餾重複判定: "否",
        記憶蒸餾矛盾判定: "否",
        記憶蒸餾標題: TITLE,
      },
      [sourceB],
    );
    const restarted = await spawnService({ folder: service.folder });
    services.push(restarted);
    const restartedClient = await connectAndHello(restarted);
    clients.push(restartedClient);
    await restartedClient.waitForReply(restartedClient.request("system.subscribe", {}));

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && (await memoryCardCount(service.folder)) !== 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    expect(await memoryCardCount(service.folder)).toBe(1);
    await expect(cardText(service.folder, outputId)).rejects.toThrow();
  }, 60_000);

  it("核心記憶在第 3 層載入且不超過 token 預算", async () => {
    const sourceId = newUlid();
    setSeam(
      {
        記憶蒸餾提煉: EXTRACT,
        記憶蒸餾重複判定: "否",
        記憶蒸餾矛盾判定: "否",
        記憶蒸餾標題: TITLE,
      },
      [sourceId],
    );
    const { client } = await boot([
      [sourceId, cardFile({ id: sourceId, title: "日常筆記", body: "週末想整理儲藏室。" })],
    ]);

    await triggerDistillation(client);
    const digest = await waitForDigest(client);
    const coreAdded = digest.notification.payload.items?.find(
      (item) => item.action === "core-added",
    );
    expect(coreAdded?.cardId).toBeTypeOf("string");

    const sessionId = await createSession(client);
    // 核心記憶進的是第 3 層固定前綴 systemContext，不是 context.get 的 entries。
    const assembled = await moduleRequest<{
      systemContext: string;
      sections: readonly { layer: string; title: string; text: string }[];
    }>(client, "module.context.test.system-context", { sessionId });

    const coreSection = assembled.sections.find((section) => section.layer === "core-memory");
    expect(coreSection).toBeDefined();
    expect(assembled.systemContext).toContain(coreSection?.text ?? "");
    expect(assembled.systemContext).toContain("週末整理偏好");
    expect(assembled.systemContext).toContain("使用者傾向週末整理儲藏室");

    const view = await requestPayload<{
      context: { usedTokens: number; budgetTokens: number };
    }>(client, "context.get", { sessionId });
    expect(view.context.usedTokens).toBeLessThanOrEqual(view.context.budgetTokens);
  }, 40_000);
});
