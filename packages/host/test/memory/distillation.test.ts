import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  CardService,
  DistillationSourceCard,
  ExtractedMemoryItem,
  MemoryJudge,
} from "@cardiary/domain";
import { deterministicCardId, memoryContentHash } from "@cardiary/domain";
import type { ModuleLogger, NotificationInput } from "@cardiary/module-api";
import {
  CardFileStore,
  CardIndexStore,
  CardLifecycleStore,
  CoreMemoryStore,
  DistillationStore,
  INTERRUPTION_THRESHOLD_MS,
  LocalAssetStore,
  Storage,
  type Database,
} from "@cardiary/storage";
import { afterEach, describe, expect, it } from "vitest";

import { CardLibrary } from "../../src/modules/cards/library.js";
import { CardStateStore } from "../../src/modules/cards/state.js";
import { MemoryCardWriter } from "../../src/modules/memory/card-writer.js";
import { DistillationService } from "../../src/modules/memory/service.js";
import { undoItem, type UndoOutcome } from "../../src/modules/memory/undo.js";

/**
 * 蒸餾續跑的單元測試：真的狀態庫、卡片檔與通知替身。
 *
 * 這裡守住兩個續跑缺口：中斷後續跑的摘要要保留中斷前已完成的變更（且能逐項
 * 復原），以及合併結論要把來源歸零卡一併封存。提煉、比對與標題都用腳本化
 * 替身，時間由測試推進。
 */

const T0 = "2026-01-01T09:00:00.000Z";
const DAY = "2026-01-01";
const RESUME_AFTER_MS = INTERRUPTION_THRESHOLD_MS + 60_000;

/** 測試卡的固定 ULID；A、B 是同批兩張來源卡，S 是來源卡，M、P、OLD 是既有記憶卡。 */
const CARD_A = "01J00000000000000000000001";
const CARD_B = "01J00000000000000000000002";
const CARD_S = "01J00000000000000000000003";
const CARD_M = "01J00000000000000000000004";
const CARD_P = "01J00000000000000000000005";
const CARD_OLD = "01J00000000000000000000006";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

interface FakeNotifications {
  readonly created: Array<{ readonly notificationId: string; readonly input: NotificationInput }>;
  create(input: NotificationInput): Promise<{ readonly notificationId: string }>;
  get(notificationId: string): { readonly payloadJson: string } | null;
}

interface Fixture {
  readonly path: string;
  readonly storage: Storage;
  readonly library: CardLibrary;
  readonly runs: DistillationStore;
  readonly core: CoreMemoryStore;
  readonly lifecycle: CardLifecycleStore;
  readonly writer: MemoryCardWriter;
  readonly notifications: FakeNotifications;
  readonly clock: { now: Date };
  readonly service: DistillationService;
  /** 寫入來源卡檔案並重新索引；呼叫前先寫檔，再呼叫這個。 */
  seed(files: ReadonlyArray<readonly [string, string]>): Promise<void>;
  /** 把卡片的 marker 新鮮度歸零，讓它成為蒸餾候選。 */
  zero(cardIds: readonly string[]): void;
  lifecycleOf(cardId: string): string | null;
  undo(notificationId: string, itemId: string): Promise<UndoOutcome>;
}

async function makeFixture(): Promise<Fixture> {
  const path = await mkdtemp(join(tmpdir(), "cardiary-distillation-"));
  const storage = Storage.open({ path, initialize: true });
  const clock = { now: new Date(T0) };
  const now = (): Date => clock.now;
  const files = new CardFileStore({ layout: storage.layout, now });
  let cachedDatabase: Database | null = null;
  let cachedIndex: CardIndexStore | null = null;
  const index = (): CardIndexStore => {
    const database = storage.cache;
    if (cachedIndex === null || cachedDatabase !== database) {
      cachedDatabase = database;
      cachedIndex = new CardIndexStore({ db: database, now });
    }
    return cachedIndex;
  };
  const localAssets = new LocalAssetStore({ layout: storage.layout, index: index(), now });
  const library = new CardLibrary({
    files,
    index,
    assets: () => localAssets,
    state: new CardStateStore({ db: () => storage.state, now }),
    now,
  });
  const runs = new DistillationStore(storage.state, { now });
  const core = new CoreMemoryStore(storage.state, { now });
  const lifecycle = new CardLifecycleStore(storage.state, { now });
  const writer = new MemoryCardWriter({ cardsDirectory: storage.layout.absolute("cards"), now });

  const created: FakeNotifications["created"] = [];
  const notifications: FakeNotifications = {
    created,
    async create(input) {
      const notificationId = `ntf_test_${created.length + 1}`;
      created.push({ notificationId, input });
      return { notificationId };
    },
    get(notificationId) {
      const found = created.find((entry) => entry.notificationId === notificationId);
      return found === undefined
        ? null
        : { payloadJson: JSON.stringify(found.input.payload ?? {}) };
    },
  };

  const logger: ModuleLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const service = new DistillationService({
    cards: library as unknown as CardService,
    models: {
      async invoke() {
        throw new Error("這個測試不呼叫真的模型");
      },
    },
    runs,
    core,
    lifecycle,
    writer,
    rescanCards: () => library.rescan(),
    notifications,
    logger,
    now,
    // 預算刻意留得比一張卡小，核心組提議不會混進摘要。
    tokenBudget: () => 1,
  });

  const fixture: Fixture = {
    path,
    storage,
    library,
    runs,
    core,
    lifecycle,
    writer,
    notifications,
    clock,
    service,
    async seed(cards) {
      for (const [cardId, text] of cards) {
        await writeFile(join(path, "cards", `${cardId}.md`), text, "utf8");
      }
      await library.initialize();
    },
    zero(cardIds) {
      for (const cardId of cardIds) {
        storage.state.run(
          `INSERT INTO card_state (card_id, persona, freshness, freshness_at, lifecycle, updated_at)
           VALUES (?, 'default', 0, ?, 'live', ?)
           ON CONFLICT (card_id) DO UPDATE SET freshness = 0, lifecycle = 'live'`,
          cardId,
          clock.now.toISOString(),
          clock.now.toISOString(),
        );
      }
    },
    lifecycleOf(cardId) {
      const row = storage.state.get<{ lifecycle: string }>(
        "SELECT lifecycle FROM card_state WHERE card_id = ?",
        cardId,
      );
      return row?.lifecycle ?? null;
    },
    undo(notificationId, itemId) {
      return undoItem(
        {
          cards: library as unknown as CardService,
          runs,
          core,
          lifecycle,
          notifications,
          now,
        },
        notificationId,
        itemId,
      );
    },
  };

  cleanups.push(async () => {
    storage.close();
    await rm(path, { recursive: true, force: true });
  });
  return fixture;
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

function memoryCardFile(id: string, title: string, body: string): string {
  return cardFile({ id, title, body, kind: "memory" });
}

/** 依來源卡 id 給固定答案的提煉替身。 */
function scriptedDistiller(byCard: Readonly<Record<string, readonly ExtractedMemoryItem[]>>): {
  distill(cards: readonly DistillationSourceCard[]): Promise<unknown>;
} {
  return {
    async distill(cards) {
      const card = cards[0];
      if (card === undefined) return { items: [] };
      return { items: byCard[card.cardId] ?? [] };
    },
  };
}

/** 不與任何既有卡重複的比對替身。 */
const noMergeJudge: MemoryJudge = {
  sameAs: () => false,
  contradicts: () => false,
};

/** 標題用項目文字前段；讓輸出卡內容固定。 */
function simpleTitle(item: ExtractedMemoryItem): Promise<{ title: string; summary: string }> {
  return Promise.resolve({ title: item.text.slice(0, 20), summary: item.text });
}

function digestPayload(notification: { readonly input: NotificationInput }): {
  readonly runId: string;
  readonly day: string;
  readonly items: ReadonlyArray<Record<string, unknown>>;
} {
  return notification.input.payload as unknown as {
    readonly runId: string;
    readonly day: string;
    readonly items: ReadonlyArray<Record<string, unknown>>;
  };
}

describe("蒸餾續跑", () => {
  it("中斷後續跑產生完整摘要，每個項目都能逐項復原", async () => {
    const fx = await makeFixture();
    await fx.seed([
      [CARD_A, cardFile({ id: CARD_A, title: "茶", body: "我喜歡綠茶。" })],
      [CARD_B, cardFile({ id: CARD_B, title: "咖啡", body: "我喜歡咖啡。" })],
    ]);
    fx.zero([CARD_A, CARD_B]);

    const first: ExtractedMemoryItem = { type: "preference", text: "我喜歡綠茶。" };
    const second: ExtractedMemoryItem = { type: "preference", text: "我喜歡咖啡。" };
    const distiller = scriptedDistiller({ [CARD_A]: [first], [CARD_B]: [second] });
    let titleCalls = 0;
    const titler = async (
      item: ExtractedMemoryItem,
    ): Promise<{ title: string; summary: string }> => {
      titleCalls += 1;
      if (titleCalls === 2) {
        throw new Error("標題模型中斷");
      }
      return simpleTitle(item);
    };

    // 第一張卡處理完成後，第二張卡在產生標題時中斷：run 停在 running。
    await expect(
      fx.service.runForDay("default", DAY, { distiller, judge: noMergeJudge, titler }),
    ).rejects.toThrow("標題模型中斷");
    expect(fx.notifications.created).toHaveLength(0);

    fx.clock.now = new Date(Date.parse(T0) + RESUME_AFTER_MS);
    await fx.service.resumeInterrupted({ distiller, judge: noMergeJudge, titler });

    const notification = fx.notifications.created.at(-1);
    expect(notification).toBeDefined();
    const payload = digestPayload(notification!);
    expect(payload.day).toBe(DAY);

    // 中斷前完成的 created 與續跑新完成的 created 都在摘要裡，而且各一項。
    const createdItems = payload.items.filter((item) => item.action === "created");
    expect(createdItems).toHaveLength(2);
    expect(new Set(createdItems.map((item) => String(item.cardId))).size).toBe(2);
    expect(new Set(createdItems.map((item) => String(item.id))).size).toBe(2);

    const cold = payload.items.find((item) => item.action === "cold");
    expect([...(cold?.cardIds as string[])].sort()).toEqual([CARD_A, CARD_B].sort());
    expect(fx.lifecycleOf(CARD_A)).toBe("cold");
    expect(fx.lifecycleOf(CARD_B)).toBe("cold");

    // 逐項復原：刪掉該項的新卡，只把該項的來源卡改回 live。
    const sourceByCard = new Map(
      createdItems.map((item) => [String(item.cardId), String((item.sources as string[])[0])]),
    );
    for (const item of createdItems) {
      const outcome = await fx.undo(notification!.notificationId, String(item.id));
      expect(outcome.ok).toBe(true);
      expect(await fx.library.get(String(item.cardId))).toBeNull();
      expect(fx.lifecycleOf(sourceByCard.get(String(item.cardId))!)).toBe("live");
    }

    // 冷封存那一項也能單獨復原；兩張來源卡都回到 live。
    const coldUndo = await fx.undo(notification!.notificationId, String(cold?.id));
    expect(coldUndo.ok).toBe(true);
    expect(fx.lifecycleOf(CARD_A)).toBe("live");
    expect(fx.lifecycleOf(CARD_B)).toBe("live");
  });

  it("判斷為合併時，來源歸零卡一併冷封存", async () => {
    const fx = await makeFixture();
    await fx.seed([
      [CARD_S, cardFile({ id: CARD_S, title: "茶", body: "我喜歡綠茶。" })],
      [CARD_M, memoryCardFile(CARD_M, "green tea", "likes green tea")],
    ]);
    fx.zero([CARD_S]);

    const item: ExtractedMemoryItem = { type: "preference", text: "likes green tea" };
    const judge: MemoryJudge = {
      sameAs: () => true,
      contradicts: () => false,
    };

    await fx.service.runForDay("default", DAY, {
      distiller: scriptedDistiller({ [CARD_S]: [item] }),
      judge,
      titler: simpleTitle,
    });

    expect(fx.lifecycleOf(CARD_S)).toBe("cold");
    expect(fx.lifecycleOf(CARD_M)).not.toBe("cold");
    const notification = fx.notifications.created.at(-1)!;
    const payload = digestPayload(notification);
    const merged = payload.items.find((entry) => entry.action === "merged");
    expect(merged).toMatchObject({ mergedInto: CARD_M, sources: [CARD_S] });
    const cold = payload.items.find((entry) => entry.action === "cold");
    expect(cold?.cardIds).toEqual([CARD_S]);

    // 合併項目沒有可復原的副作用；冷封存可以單獨回復。
    expect((await fx.undo(notification.notificationId, String(merged?.id))).ok).toBe(true);
    expect((await fx.undo(notification.notificationId, String(cold?.id))).ok).toBe(true);
    expect(fx.lifecycleOf(CARD_S)).toBe("live");
  });

  it("跨批去重命中時，來源歸零卡一併冷封存", async () => {
    const fx = await makeFixture();
    await fx.seed([
      [CARD_S, cardFile({ id: CARD_S, title: "茶", body: "我喜歡綠茶。" })],
      [CARD_P, memoryCardFile(CARD_P, "綠茶", "green tea")],
    ]);
    fx.zero([CARD_S]);

    const item: ExtractedMemoryItem = { type: "preference", text: "green tea" };
    const hash = memoryContentHash(item);
    const prior = fx.runs.createRun({
      persona: "default",
      day: "2025-12-31",
      startedAt: new Date(Date.parse(T0) - 48 * 60 * 60 * 1000).toISOString(),
    });
    fx.runs.upsertItem({
      runId: prior.runId,
      itemKey: `${CARD_OLD}:merge:0`,
      batchId: prior.runId,
      persona: "default",
      sourceCardId: CARD_OLD,
      phase: "merge",
      status: "done",
      contentHash: hash,
      outputCardId: CARD_P,
      detailJson: JSON.stringify({ action: "merged", mergedInto: CARD_P }),
    });

    await fx.service.runForDay("default", DAY, {
      distiller: scriptedDistiller({ [CARD_S]: [item] }),
      judge: noMergeJudge,
      titler: simpleTitle,
    });

    expect(fx.lifecycleOf(CARD_S)).toBe("cold");
    const payload = digestPayload(fx.notifications.created.at(-1)!);
    expect(payload.items.find((entry) => entry.action === "merged")).toMatchObject({
      mergedInto: CARD_P,
      sources: [CARD_S],
    });
    expect(payload.items.find((entry) => entry.action === "cold")?.cardIds).toEqual([CARD_S]);
  });

  it("續跑摘要保留中斷前完成的取代項目，復原後新卡刪除、來源回復 live", async () => {
    const fx = await makeFixture();
    await fx.seed([
      [CARD_S, cardFile({ id: CARD_S, title: "茶", body: "我喜歡熱的綠茶。" })],
      [CARD_OLD, memoryCardFile(CARD_OLD, "舊的綠茶", "我喜歡便宜的綠茶。")],
    ]);
    fx.zero([CARD_S]);

    const item: ExtractedMemoryItem = { type: "preference", text: "我喜歡熱的綠茶。" };
    const hash = memoryContentHash(item);
    const run = fx.runs.createRun({
      persona: "default",
      day: DAY,
      startedAt: new Date(Date.parse(T0) - RESUME_AFTER_MS).toISOString(),
    });
    const outputId = deterministicCardId(`mem_${run.runId}_0_${hash.slice(0, 8)}`);
    await writeFile(
      join(fx.path, "cards", `${outputId}.md`),
      memoryCardFile(outputId, "熱綠茶", item.text),
      "utf8",
    );
    await fx.library.rescan();
    fx.runs.upsertItem({
      runId: run.runId,
      itemKey: `${CARD_S}:extract`,
      batchId: run.runId,
      persona: "default",
      sourceCardId: CARD_S,
      phase: "extract",
      status: "done",
      detailJson: JSON.stringify({ items: [item] }),
    });
    fx.runs.upsertItem({
      runId: run.runId,
      itemKey: `${CARD_S}:merge:0`,
      batchId: run.runId,
      persona: "default",
      sourceCardId: CARD_S,
      contentHash: hash,
      outputCardId: outputId,
      phase: "merge",
      status: "done",
      detailJson: JSON.stringify({
        action: "supersede",
        bodyHash: "ignored",
        supersedes: CARD_OLD,
        title: "熱綠茶",
        summary: item.text,
      }),
    });
    fx.runs.upsertItem({
      runId: run.runId,
      itemKey: `${CARD_S}:archive`,
      batchId: run.runId,
      persona: "default",
      sourceCardId: CARD_S,
      phase: "archive",
      status: "done",
    });

    const finished = await fx.service.resumeInterrupted({
      distiller: scriptedDistiller({}),
      judge: noMergeJudge,
      titler: simpleTitle,
    });
    expect(finished).toBeUndefined();

    const notification = fx.notifications.created.at(-1)!;
    const payload = digestPayload(notification);
    const superseded = payload.items.find((entry) => entry.action === "superseded");
    expect(superseded).toMatchObject({
      cardId: outputId,
      supersedes: CARD_OLD,
      sources: [CARD_S],
    });
    expect(fx.lifecycleOf(CARD_S)).toBe("cold");

    const outcome = await fx.undo(notification.notificationId, String(superseded?.id));
    expect(outcome.ok).toBe(true);
    expect(await fx.library.get(outputId)).toBeNull();
    expect(fx.lifecycleOf(CARD_S)).toBe("live");
  });
});
