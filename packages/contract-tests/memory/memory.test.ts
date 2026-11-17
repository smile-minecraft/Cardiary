import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
 * 每日蒸餾的協定契約：對真的主機行程跑，不直接呼叫模組或領域函式。
 *
 * 卡仍然落地成資料夾裡的檔案，蒸餾由排程的 `distillation` 任務經掛鉤觸發；
 * 小模型用契約測試的環境變數接縫給固定回應（`CARDIARY_TEST_FAULTS=1` 才生效），
 * 種子卡的新鮮度由同一接縫歸零。兩者都不進正式產品路徑。
 *
 * 涵蓋：新鮮度歸零提煉成記憶卡且血緣指回原卡、原卡轉冷封存、重複合併不產生
 * 重複卡、每日摘要可逐項復原、中斷續跑不重複產卡、核心組在第 3 層且不超預算。
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

async function boot(
  cards: readonly (readonly [string, string])[],
  options: Parameters<typeof spawnService>[0] = {},
): Promise<{
  service: SpawnedService;
  client: ProtocolClient;
}> {
  const folder = await makeFolder();
  await writeCards(folder, cards);
  const service = await spawnService({ folder, ...options });
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
    // 建立對話需要主力模型；Pi 組裝沒有設定模組的模型時，用腳本化模型接上。
    const { client } = await boot(
      [[sourceId, cardFile({ id: sourceId, title: "日常筆記", body: "週末想整理儲藏室。" })]],
      { scripts: [[{ kind: "text", text: "好的" }]] },
    );

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
