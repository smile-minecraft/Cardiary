import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CardFileStore,
  CardIndexStore,
  LocalAssetStore,
  Storage,
  type Database,
} from "../../storage/src/index.js";
import { afterEach, describe, expect, it } from "vitest";

import { CardStateStore } from "../../host/src/modules/cards/state.js";
import { CardLibrary } from "../../host/src/modules/cards/library.js";
import {
  CardVectors,
  type CardEmbedder,
  type RetrievalProgress,
  type RetrievalStatus,
} from "../../host/src/modules/retrieval/vectors.js";
import { RetrievalService } from "../../host/src/modules/retrieval/service.js";
import type { SpawnRegistry } from "../../host/src/spawn/wrapper.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function newUlid(offset = 0): string {  let time = BigInt(Date.now() + offset);
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

/**
 * 決定性的假嵌入器：相同的文字永遠得到相同的向量。
 * `hold()` 之後卡片的嵌入呼叫會卡住，讓測試在重建期間做決定性觀察；
 * 以 `Instruct:` 開頭的查詢文字不受影響。
 */
function createFakeEmbedder(): {
  readonly embedder: CardEmbedder;
  hold(): void;
  release(): void;
} {
  let hold = false;
  const gates: Array<() => void> = [];
  const embedder: CardEmbedder = {
    embed(text: string): Promise<Float32Array> {
      const vector = fakeVector(text);
      if (!hold || text.startsWith("Instruct:")) return Promise.resolve(vector);
      return new Promise<Float32Array>((resolve) => {
        gates.push(() => resolve(vector));
      });
    },
    stop(): void {},
  };
  return {
    embedder,
    hold() {
      hold = true;
    },
    release() {
      hold = false;
      const pending = gates.splice(0, gates.length);
      for (const release of pending) release();
    },
  };
}

function fakeVector(text: string): Float32Array {
  const dimension = 16;
  const vector = new Float32Array(dimension);
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  let state = hash >>> 0;
  for (let index = 0; index < dimension; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    vector[index] = (state / 4294967296) * 2 - 1;
  }
  return vector;
}

const SPAWN = {} as unknown as SpawnRegistry;

interface Environment {
  readonly storage: Storage;
  readonly library: CardLibrary;
}

const folders: string[] = [];
const environments: Storage[] = [];

afterEach(async () => {
  for (const storage of environments.splice(0)) {
    try {
      storage.close();
    } catch {
      // 已經關閉；忽略。
    }
  }
  for (const folder of folders.splice(0)) {
    await rm(folder, { recursive: true, force: true });
  }
});

function openEnvironment(folder: string, initialize: boolean): Environment {
  const storage = Storage.open({ path: folder, ...(initialize ? { initialize: true } : {}) });
  environments.push(storage);
  const now = (): Date => new Date();
  const files = new CardFileStore({ layout: storage.layout, now });
  const index = (): CardIndexStore => new CardIndexStore({ db: storage.cache, now });
  const assets = (): LocalAssetStore =>
    new LocalAssetStore({ layout: storage.layout, index: index(), now });
  const state = new CardStateStore({ db: () => storage.state, now });
  const library = new CardLibrary({
    files,
    index,
    assets,
    state,
    now,
    emit: () => {},
  });
  return { storage, library };
}

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("條件等待逾時");
}

function vectorCount(cache: Database, model: string): number {
  const row = cache.get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM vec_cards WHERE model = ?",
    model,
  );
  return row === undefined ? 0 : Number(row.count);
}

function distinctModels(cache: Database): string[] {
  return cache
    .all<{ model: string }>("SELECT DISTINCT model FROM vec_cards ORDER BY model")
    .map((row) => row.model);
}

const CARD_BODIES: readonly string[] = [
  "手寫字練習的筆順和起筆收筆方式。",
  "手寫字考試的時間管理和心態調整。",
  "減速帶和路口的駕駛注意事項。",
  "手寫字作品的裝裱和保存方式。",
  "颱風前搬移花盆和固定招牌。",
  "手寫字課程的教材與進度安排。",
];

async function makeCards(library: CardLibrary): Promise<number> {
  let created = 0;
  for (const body of CARD_BODIES) {
    await library.create({
      kind: "note",
      title: `卡 ${newUlid(created + 1).slice(0, 6)}`,
      body: `${body}\n`,
    });
    created += 1;
  }
  return created;
}

describe("向量索引的跨重啟整合", () => {
  it("cache 刪除後重建：重建期間退回全文，完成後結果與重建前一致", async () => {
    const folder = await mkdtemp(join(tmpdir(), "cardiary-retrieval-cache-"));
    folders.push(folder);
    const fake = createFakeEmbedder();

    // 第一次開啟：建立卡片、讓向量索引完整建好，並記下基準結果。
    const first = openEnvironment(folder, true);
    await first.library.initialize();
    const count = await makeCards(first.library);
    expect(count).toBe(CARD_BODIES.length);
    const baselineStatuses: RetrievalStatus[] = [];
    const baselineProgress: RetrievalProgress[] = [];
    const firstVectors = new CardVectors({
      library: first.library,
      database: () => first.storage.cache,
      allowed: () => true,
      spawn: SPAWN,
      cache: join(folder, "cache"),
      modelKey: "model-a@1",
      warn: () => {},
      embedder: fake.embedder,
      onStatus: (status) => baselineStatuses.push(status),
      onProgress: (progress) => baselineProgress.push(progress),
    });
    const firstService = new RetrievalService(first.library, firstVectors);
    firstVectors.refresh();
    await waitFor(() => vectorCount(first.storage.cache, "model-a@1") === count, 5000);
    const baseline = await firstService.search({ query: "手寫字" }, "search");
    expect(baseline.items.length).toBeGreaterThan(0);
    expect(baselineStatuses.map((status) => status.state)).toContain("ready");
    expect(baselineProgress.some((p) => p.phase === "index" && p.total === count)).toBe(true);

    // 關閉後刪除 cache：向量索引應全部重建，正本卡片保留。
    first.storage.close();
    environments.splice(environments.indexOf(first.storage), 1);
    await rm(join(folder, "cache"), { recursive: true, force: true });
    expect(existsSync(join(folder, "cache"))).toBe(false);

    // 重開：必須用全新的 Storage 與索引物件，不能重用舊的。
    const second = openEnvironment(folder, false);
    await second.library.initialize();
    const statuses: RetrievalStatus[] = [];
    const progress: RetrievalProgress[] = [];
    fake.hold();
    const vectors = new CardVectors({
      library: second.library,
      database: () => second.storage.cache,
      allowed: () => true,
      spawn: SPAWN,
      cache: join(folder, "cache"),
      modelKey: "model-a@1",
      warn: () => {},
      embedder: fake.embedder,
      onStatus: (status) => statuses.push(status),
      onProgress: (progressEvent) => progress.push(progressEvent),
    });
    expect(vectorCount(second.storage.cache, "model-a@1")).toBe(0);
    const service = new RetrievalService(second.library, vectors);

    // 重建期間：查詢立即回傳全文結果，向量為空，不等待重建。
    const during = await service.search({ query: "手寫字" }, "search");
    const fullTextOnly = await new RetrievalService(second.library).search(
      { query: "手寫字" },
      "search",
    );
    expect(during.items.map((item) => item.card.cardId)).toEqual(
      fullTextOnly.items.map((item) => item.card.cardId),
    );
    expect(vectorCount(second.storage.cache, "model-a@1")).toBe(0);
    expect(
      statuses.some(
        (status) => status.state === "building" && status.fallback === "fts" && status.total === count,
      ),
    ).toBe(true);

    // 放行：等重建完成後再比對結果。
    fake.release();
    await waitFor(() => vectorCount(second.storage.cache, "model-a@1") === count, 5000);
    const after = await service.search({ query: "手寫字" }, "search");
    expect(after.items.map((item) => item.card.cardId)).toEqual(
      baseline.items.map((item) => item.card.cardId),
    );
    expect(after.items.map((item) => item.score)).toEqual(
      baseline.items.map((item) => item.score),
    );
    expect(statuses.at(-1)?.state).toBe("ready");
    expect(progress.some((p) => p.phase === "index" && p.completed === count)).toBe(true);
  });

  it("嵌入模型切換後整批重算，vec_cards 不混用兩個模型", async () => {
    const folder = await mkdtemp(join(tmpdir(), "cardiary-retrieval-model-"));
    folders.push(folder);
    const fake = createFakeEmbedder();

    const first = openEnvironment(folder, true);
    await first.library.initialize();
    const count = await makeCards(first.library);
    const firstVectors = new CardVectors({
      library: first.library,
      database: () => first.storage.cache,
      allowed: () => true,
      spawn: SPAWN,
      cache: join(folder, "cache"),
      modelKey: "model-a@1",
      warn: () => {},
      embedder: fake.embedder,
    });
    const firstService = new RetrievalService(first.library, firstVectors);
    firstVectors.refresh();
    await waitFor(() => vectorCount(first.storage.cache, "model-a@1") === count, 5000);
    expect(distinctModels(first.storage.cache)).toEqual(["model-a@1"]);
    const baseline = await firstService.search({ query: "手寫字" }, "search");

    // 切換模型：舊向量應立即清空，全部重建為新模型。
    const statuses: RetrievalStatus[] = [];
    fake.hold();
    const switched = new CardVectors({
      library: first.library,
      database: () => first.storage.cache,
      allowed: () => true,
      spawn: SPAWN,
      cache: join(folder, "cache"),
      modelKey: "model-b@1",
      warn: () => {},
      embedder: fake.embedder,
      onStatus: (status) => statuses.push(status),
    });
    switched.refresh();
    expect(vectorCount(first.storage.cache, "model-a@1")).toBe(0);
    expect(vectorCount(first.storage.cache, "model-b@1")).toBe(0);

    fake.release();
    await waitFor(() => vectorCount(first.storage.cache, "model-b@1") === count, 5000);
    expect(distinctModels(first.storage.cache)).toEqual(["model-b@1"]);
    expect(statuses.some((status) => status.state === "building")).toBe(true);
    expect(statuses.at(-1)?.state).toBe("ready");

    const service = new RetrievalService(first.library, switched);
    const after = await service.search({ query: "手寫字" }, "search");
    expect(after.items.map((item) => item.card.cardId)).toEqual(
      baseline.items.map((item) => item.card.cardId),
    );
    expect(after.items.map((item) => item.score)).toEqual(
      baseline.items.map((item) => item.score),
    );
  });
});


