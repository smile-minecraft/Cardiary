import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  CardService,
  CardQuery,
  DistillationSourceCard,
  ExtractedMemoryItem,
  MemoryJudge,
} from "@cardiary/domain";
import { deterministicCardId, estimateCoreMemoryTokens, memoryContentHash } from "@cardiary/domain";
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
import { DistillationService, type MemorySearch } from "../../src/modules/memory/service.js";
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

interface FixtureOptions {
  /** 核心組預算；預設刻意比一張卡小，核心組提議不會混進摘要。 */
  readonly tokenBudget?: () => number;
  /** 比對既有記憶的搜尋；預設走卡片服務的全文搜尋。 */
  readonly search?: (library: CardLibrary) => MemorySearch;
}

async function makeFixture(options: FixtureOptions = {}): Promise<Fixture> {
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
    ...(options.search === undefined ? {} : { search: options.search(library) }),
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
    tokenBudget: () => options.tokenBudget?.() ?? 1,
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

/** 測試卡的 ULID；N 開頭是同主題的雜訊筆記，C 開頭是同日多張來源卡。 */
const NOISE = Array.from({ length: 6 }, (_, n) => `01J000000000000000000000N${n}`);
const SOURCES = [
  "01J0000000000000000000C001",
  "01J0000000000000000000C002",
  "01J0000000000000000000C003",
];
const CARD_CORE = "01J0000000000000000000K001";

function setLifecycle(fx: Fixture, cardId: string, lifecycle: "live" | "cold"): void {
  fx.storage.state.run(
    `INSERT INTO card_state (card_id, persona, freshness, freshness_at, lifecycle, updated_at)
     VALUES (?, 'default', 0, ?, ?, ?)
     ON CONFLICT (card_id) DO UPDATE SET lifecycle = excluded.lifecycle`,
    cardId,
    fx.clock.now.toISOString(),
    lifecycle,
    fx.clock.now.toISOString(),
  );
}

/** 記下每次比對的候選；候選文字含 `needle` 時判定矛盾。 */
function recordingJudge(needle: string): MemoryJudge & {
  readonly compared: string[];
} {
  const compared: string[] = [];
  return {
    compared,
    sameAs: () => false,
    contradicts: (existing: string) => {
      compared.push(existing);
      return existing.includes(needle);
    },
  };
}

describe("比對既有記憶", () => {
  const yarnMemory = "使用者偏好所有前端與 Node.js 專案統一使用 Yarn 管理套件。";
  const pnpmItem: ExtractedMemoryItem = {
    type: "decision",
    text: "所有前端與 TypeScript 專案統一改用 pnpm 取代 Yarn 管理依賴。",
  };

  it("整句、用詞不同的新決定找得到冷封存的舊記憶並取代（Magpie D-SUP-01 重現）", async () => {
    const fx = await makeFixture();
    await fx.seed([
      [
        CARD_S,
        cardFile({
          id: CARD_S,
          title: "套件管理工具切換決定",
          body: "從本週起全面改用 pnpm 管理所有前端與 TypeScript 專案依賴，不再使用 Yarn。",
        }),
      ],
      [
        CARD_OLD,
        cardFile({
          id: CARD_OLD,
          kind: "memory",
          title: "套件管理偏好使用 Yarn",
          summary: "所有前端與 Node.js 專案統一使用 Yarn 管理套件",
          body: yarnMemory,
        }),
      ],
      // 同主題的筆記比舊記憶更像查詢句；種類要在上限之前過濾，才不會被擠掉。
      ...NOISE.map(
        (id) => [id, cardFile({ id, title: "套件管理工具切換決定", body: pnpmItem.text })] as const,
      ),
    ]);
    setLifecycle(fx, CARD_OLD, "cold");
    fx.zero([CARD_S]);
    const judge = recordingJudge("Yarn 管理套件");

    const run = await fx.service.runForDay("default", DAY, {
      distiller: scriptedDistiller({ [CARD_S]: [pnpmItem] }),
      judge,
      titler: simpleTitle,
    });

    expect(judge.compared.some((text) => text.includes("Yarn 管理套件"))).toBe(true);
    expect(JSON.parse(run!.statsJson ?? "{}")).toMatchObject({ created: 0, superseded: 1 });
    const payload = digestPayload(fx.notifications.created.at(-1)!);
    const superseded = payload.items.find((item) => item.action === "superseded");
    expect(superseded).toMatchObject({ supersedes: CARD_OLD, sources: [CARD_S] });
    expect(fx.lifecycle.getSupersededBy(CARD_OLD)).toBe(superseded?.cardId);
  });

  it("走注入的混合檢索：任一詞、含冷封存、只要記憶卡，並濾掉別的種類與人格", async () => {
    const queries: CardQuery[] = [];
    const fx = await makeFixture({
      search: (library) => async (query) => {
        queries.push(query);
        const page = await library.search({ ...query, kinds: undefined });
        // 語意一路不分人格與種類；服務自己要再守一次。
        return {
          items: page.items.flatMap((hit) => [
            hit,
            { ...hit, card: { ...hit.card, persona: "other" } },
          ]),
        };
      },
    });
    await fx.seed([
      [CARD_S, cardFile({ id: CARD_S, title: "套件", body: "改用 pnpm。" })],
      [
        CARD_OLD,
        cardFile({
          id: CARD_OLD,
          kind: "memory",
          title: "套件管理偏好使用 Yarn",
          body: yarnMemory,
        }),
      ],
      [CARD_A, cardFile({ id: CARD_A, title: "雜訊", body: yarnMemory })],
    ]);
    fx.zero([CARD_S]);
    const judge = recordingJudge("不會命中");

    await fx.service.runForDay("default", DAY, {
      distiller: scriptedDistiller({ [CARD_S]: [pnpmItem] }),
      judge,
      titler: simpleTitle,
    });

    expect(queries).toEqual([
      expect.objectContaining({
        query: pnpmItem.text,
        kinds: ["memory"],
        persona: "default",
        lifecycle: "all",
        includeSuperseded: false,
        anyTerm: true,
      }),
    ]);
    // 只有本人格的那張記憶卡進到判定；筆記與別的人格都被濾掉。
    expect(judge.compared).toHaveLength(1);
    expect(judge.compared[0]).toContain("Yarn");
  });
});

describe("核心組提議", () => {
  function itemFor(cardId: string): ExtractedMemoryItem {
    return { type: "fact", text: `這是來源卡 ${cardId} 的長期事實。` };
  }

  async function seedSources(fx: Fixture): Promise<void> {
    await fx.seed(SOURCES.map((id) => [id, cardFile({ id, title: id, body: itemFor(id).text })]));
    fx.zero(SOURCES);
  }

  const distiller = scriptedDistiller(Object.fromEntries(SOURCES.map((id) => [id, [itemFor(id)]])));

  it("同日多張新記憶卡最多加入一張，當日計數只記一次", async () => {
    const fx = await makeFixture({ tokenBudget: () => 800 });
    await seedSources(fx);

    const run = await fx.service.runForDay("default", DAY, {
      distiller,
      judge: noMergeJudge,
      titler: simpleTitle,
    });

    expect(JSON.parse(run!.statsJson ?? "{}")).toMatchObject({ created: 3, coreAdded: 1 });
    expect(fx.core.list("default")).toHaveLength(1);
    expect(fx.core.getDaily("default", DAY)?.changed).toBe(true);
    const payload = digestPayload(fx.notifications.created.at(-1)!);
    expect(payload.items.filter((item) => item.action === "core-added")).toHaveLength(1);
  });

  it("當天已有人手動變動核心組時，蒸餾不再加入", async () => {
    const fx = await makeFixture({ tokenBudget: () => 800 });
    await seedSources(fx);
    await fx.seed([[CARD_CORE, memoryCardFile(CARD_CORE, "既有核心", "既有核心卡。")]]);
    expect(
      fx.core.change({
        persona: "default",
        day: DAY,
        op: "add",
        cardId: CARD_CORE,
        source: "user",
      }),
    ).toBe(true);

    const run = await fx.service.runForDay("default", DAY, {
      distiller,
      judge: noMergeJudge,
      titler: simpleTitle,
    });

    expect(JSON.parse(run!.statsJson ?? "{}")).toMatchObject({ created: 3, coreAdded: 0 });
    expect(fx.core.list("default").map((entry) => entry.cardId)).toEqual([CARD_CORE]);
  });

  it("預算以既有成員與新卡累加估算；既有成員已接近預算時不加入", async () => {
    // 預算夾在 400–1,500；用下限 400。既有成員估算到 395，新卡再小也放不下；
    // 不累加既有成員（舊行為是當作 0）就會誤判成放得下。
    let longBody = "";
    while (estimateCoreMemoryTokens([{ title: "既有核心", body: longBody }]) < 395) {
      longBody += "核心組既有成員的完整內文。";
    }
    expect(estimateCoreMemoryTokens([{ title: "既有核心", body: longBody }])).toBeLessThanOrEqual(
      400,
    );
    const fx = await makeFixture({ tokenBudget: () => 400 });
    await fx.seed([
      [CARD_CORE, memoryCardFile(CARD_CORE, "既有核心", longBody)],
      [SOURCES[0]!, cardFile({ id: SOURCES[0]!, title: "來源", body: itemFor(SOURCES[0]!).text })],
    ]);
    fx.zero([SOURCES[0]!]);
    expect(
      fx.core.change({ persona: "default", day: "2025-12-31", op: "add", cardId: CARD_CORE }),
    ).toBe(true);

    const run = await fx.service.runForDay("default", DAY, {
      distiller,
      judge: noMergeJudge,
      titler: simpleTitle,
    });

    expect(JSON.parse(run!.statsJson ?? "{}")).toMatchObject({ created: 1, coreAdded: 0 });
    expect(fx.core.list("default").map((entry) => entry.cardId)).toEqual([CARD_CORE]);
    expect(fx.core.getDaily("default", DAY)?.changed ?? false).toBe(false);
  });

  it("新卡內文也算進預算：標題＋摘要放得下、加上內文放不下就不加入", async () => {
    const item: ExtractedMemoryItem = { type: "fact", text: "內文".repeat(245) };
    const titled = { title: "新記憶", summary: "摘要".repeat(300) };
    const withoutBody = estimateCoreMemoryTokens([titled]);
    const withBody = estimateCoreMemoryTokens([{ ...titled, body: item.text }]);
    expect(withoutBody).toBeLessThanOrEqual(400);
    expect(withBody).toBeGreaterThan(400);
    const fx = await makeFixture({ tokenBudget: () => 400 });
    await fx.seed([[SOURCES[0]!, cardFile({ id: SOURCES[0]!, title: "來源", body: "來源內文" })]]);
    fx.zero([SOURCES[0]!]);

    const run = await fx.service.runForDay("default", DAY, {
      distiller: scriptedDistiller({ [SOURCES[0]!]: [item] }),
      judge: noMergeJudge,
      titler: async () => titled,
    });

    expect(JSON.parse(run!.statsJson ?? "{}")).toMatchObject({ created: 1, coreAdded: 0 });
    expect(fx.core.list("default")).toEqual([]);
  });
});

describe("提煉重試", () => {
  /** 依序回傳給定結果的提煉替身；Error 代表丟例外。 */
  function flakyDistiller(outputs: readonly unknown[]): {
    readonly calls: string[];
    distill(cards: readonly DistillationSourceCard[]): Promise<unknown>;
  } {
    const calls: string[] = [];
    return {
      calls,
      async distill(cards) {
        calls.push(cards[0]?.cardId ?? "");
        const output = outputs[calls.length - 1];
        if (output instanceof Error) throw output;
        return output;
      },
    };
  }

  const item: ExtractedMemoryItem = { type: "preference", text: "我喜歡綠茶。" };

  it("第一次失敗會重試一次，成功就照常建立記憶卡", async () => {
    const fx = await makeFixture();
    await fx.seed([[CARD_S, cardFile({ id: CARD_S, title: "茶", body: "我喜歡綠茶。" })]]);
    fx.zero([CARD_S]);
    const distiller = flakyDistiller([new Error("provider down"), { items: [item] }]);

    const run = await fx.service.runForDay("default", DAY, {
      distiller,
      judge: noMergeJudge,
      titler: simpleTitle,
    });

    expect(distiller.calls).toEqual([CARD_S, CARD_S]);
    expect(run?.status).toBe("completed");
    expect(JSON.parse(run!.statsJson ?? "{}")).toMatchObject({ created: 1, failed: 0 });
    expect(fx.lifecycleOf(CARD_S)).toBe("cold");
    expect(fx.notifications.created.at(-1)?.input.title).not.toContain("失敗");
  });

  it("重試仍失敗：只試兩次，來源保留 live，摘要標明失敗數與卡片識別碼", async () => {
    const fx = await makeFixture();
    await fx.seed([
      [CARD_S, cardFile({ id: CARD_S, title: "茶", body: "我喜歡綠茶。" })],
      [CARD_A, cardFile({ id: CARD_A, title: "咖啡", body: "我喜歡咖啡。" })],
    ]);
    fx.zero([CARD_S, CARD_A]);
    const coffee: ExtractedMemoryItem = { type: "preference", text: "我喜歡咖啡。" };
    const calls: string[] = [];
    const distiller = {
      async distill(cards: readonly DistillationSourceCard[]): Promise<unknown> {
        const cardId = cards[0]?.cardId ?? "";
        calls.push(cardId);
        if (cardId === CARD_A) return { items: [coffee] };
        // 先丟例外，再回格式不對的輸出：兩種失敗都算一次嘗試。
        if (calls.filter((id) => id === CARD_S).length === 1) throw new Error("provider down");
        return { items: [{ type: "mood", text: "不合法" }] };
      },
    };

    const run = await fx.service.runForDay("default", DAY, {
      distiller,
      judge: noMergeJudge,
      titler: simpleTitle,
    });

    expect(calls.filter((id) => id === CARD_S)).toHaveLength(2);
    expect(run?.status).toBe("partial");
    expect(JSON.parse(run!.statsJson ?? "{}")).toMatchObject({ created: 1, failed: 1 });
    expect(fx.lifecycleOf(CARD_S)).toBe("live");
    expect(fx.lifecycleOf(CARD_A)).toBe("cold");
    expect(fx.runs.getItem(run!.runId, `${CARD_S}:extract`)).toMatchObject({ status: "failed" });
    const notification = fx.notifications.created.at(-1)!;
    expect(notification.input.title).toContain("失敗 1");
    expect(notification.input.body).toContain(CARD_S);
    expect(notification.input.body).not.toContain(`卡片 ${CARD_A}`);

    // 同一天再跑不重新呼叫模型。
    await fx.service.runForDay("default", DAY, {
      distiller,
      judge: noMergeJudge,
      titler: simpleTitle,
    });
    expect(calls.filter((id) => id === CARD_S)).toHaveLength(2);
  });

  it("第一次失敗後中斷，續跑只再試一次", async () => {
    const fx = await makeFixture();
    await fx.seed([[CARD_S, cardFile({ id: CARD_S, title: "茶", body: "我喜歡綠茶。" })]]);
    fx.zero([CARD_S]);
    const run = fx.runs.createRun({
      persona: "default",
      day: DAY,
      startedAt: new Date(Date.parse(T0) - RESUME_AFTER_MS).toISOString(),
    });
    fx.runs.upsertItem({
      runId: run.runId,
      itemKey: `${CARD_S}:extract`,
      batchId: run.runId,
      persona: "default",
      sourceCardId: CARD_S,
      phase: "extract",
      status: "pending",
      detailJson: JSON.stringify({ failedAttempts: 1 }),
    });
    const distiller = flakyDistiller([new Error("still down"), { items: [item] }]);

    await fx.service.resumeInterrupted({ distiller, judge: noMergeJudge, titler: simpleTitle });

    expect(distiller.calls).toEqual([CARD_S]);
    expect(fx.runs.getRun(run.runId)?.status).toBe("partial");
    expect(fx.runs.getItem(run.runId, `${CARD_S}:extract`)).toMatchObject({ status: "failed" });
    expect(fx.lifecycleOf(CARD_S)).toBe("live");
  });
});
