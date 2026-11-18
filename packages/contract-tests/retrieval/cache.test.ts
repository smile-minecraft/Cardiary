import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CardFileStore,
  CardIndexStore,
  CardVectorStore,
  LocalAssetStore,
  Storage,
  type Database,
} from "../../storage/src/index.js";
import { CardLibrary } from "../../host/src/modules/cards/library.js";
import { CardStateStore } from "../../host/src/modules/cards/state.js";
import { measureCache } from "../../host/src/modules/retrieval/cache-usage.js";
import { CardVectors, type CardEmbedder } from "../../host/src/modules/retrieval/vectors.js";
import { RetrievalService } from "../../host/src/modules/retrieval/service.js";
import type { SpawnRegistry } from "../../host/src/spawn/wrapper.js";

const MODEL = "cache-test@1";
const SPAWN = {} as unknown as SpawnRegistry;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const folders: string[] = [];
const storages: Storage[] = [];

afterEach(async () => {
  for (const storage of storages.splice(0)) {
    try {
      storage.close();
    } catch {
      // 已關閉；忽略。
    }
  }
  for (const folder of folders.splice(0)) {
    await rm(folder, { recursive: true, force: true });
  }
});

function newUlid(offset = 0): string {
  let time = BigInt(Date.now() + offset);
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

const EMBEDDER: CardEmbedder = {
  embed: (text: string) => Promise.resolve(fakeVector(text)),
  stop: () => {},
};

interface Fixture {
  readonly folder: string;
  readonly storage: Storage;
  readonly library: CardLibrary;
  readonly vectors: CardVectors;
  readonly service: RetrievalService;
  readonly statements: string[];
}

const fixtures: Fixture[] = [];

function trackingDatabase(db: Database, statements: string[]): Database {
  return new Proxy(db, {
    get(target, property) {
      if (property === "all" || property === "get" || property === "run" || property === "exec") {
        const method = target[property] as (sql: string, ...params: unknown[]) => unknown;
        return (sql: string, ...params: unknown[]) => {
          statements.push(sql);
          return method.call(target, sql, ...params);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function makeFixture(): Promise<Fixture> {
  const folder = await mkdtemp(join(tmpdir(), "cardiary-retrieval-cache-"));
  folders.push(folder);
  const storage = Storage.open({ path: folder, initialize: true });
  storages.push(storage);
  const now = (): Date => new Date();
  const index = (): CardIndexStore => new CardIndexStore({ db: storage.cache, now });
  const files = new CardFileStore({ layout: storage.layout, now });
  const assets = (): LocalAssetStore =>
    new LocalAssetStore({ layout: storage.layout, index: index(), now });
  const state = new CardStateStore({ db: () => storage.state, now });
  const library = new CardLibrary({ files, index, assets, state, now, emit: () => {} });
  await library.initialize();
  const statements: string[] = [];
  const tracked = trackingDatabase(storage.cache, statements);
  const vectors = new CardVectors({
    library,
    database: () => tracked,
    allowed: () => true,
    spawn: SPAWN,
    cache: join(folder, "cache"),
    modelKey: MODEL,
    warn: () => {},
    embedder: EMBEDDER,
  });
  // 與檢索模組的連接方式相同：卡片變更時增量更新，索引重建時重新載入。
  library.onChange((change) => vectors.cardChanged(change));
  library.onRebuild(() => vectors.invalidate());
  const service = new RetrievalService(library, vectors);
  const fixture: Fixture = { folder, storage, library, vectors, service, statements };
  fixtures.push(fixture);
  return fixture;
}

async function addCard(library: CardLibrary, body: string): Promise<string> {
  const card = await library.create({
    kind: "note",
    title: `卡 ${newUlid().slice(0, 6)}`,
    body: `${body}\n`,
  });
  return card.cardId;
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

function bulkReads(statements: readonly string[]): string[] {
  return statements.filter(
    (sql) =>
      sql.includes("SELECT card_id, revision, vector FROM vec_cards") ||
      sql.includes("SELECT * FROM card_index ORDER BY card_id"),
  );
}

describe("常駐向量索引", () => {
  it("暖機後搜尋不再全量讀取向量與卡片索引", async () => {
    const fixture = await makeFixture();
    for (let index = 0; index < 5; index += 1) {
      await addCard(fixture.library, `手寫字練習 ${index}。`);
    }
    fixture.vectors.refresh();
    await waitFor(() => vectorCount(fixture.storage.cache, MODEL) === 5);

    fixture.statements.length = 0;
    await fixture.service.search({ query: "手寫字" }, "search");
    await fixture.service.search({ query: "練習" }, "search");

    expect(bulkReads(fixture.statements)).toEqual([]);
  });

  it("新增與刪除卡片只增量更新，不必重新載入整份索引", async () => {
    const fixture = await makeFixture();
    await addCard(fixture.library, "手寫字基礎練習。");
    fixture.vectors.refresh();
    await waitFor(() => vectorCount(fixture.storage.cache, MODEL) === 1);

    fixture.statements.length = 0;
    const added = await addCard(fixture.library, "新增的書法練習內容。");
    await waitFor(() => vectorCount(fixture.storage.cache, MODEL) === 2);
    await fixture.service.search({ query: "書法" }, "search");
    expect(bulkReads(fixture.statements)).toEqual([]);

    await fixture.library.delete(added);
    await fixture.service.search({ query: "書法" }, "search");
    expect(bulkReads(fixture.statements)).toEqual([]);
    expect(vectorCount(fixture.storage.cache, MODEL)).toBe(1);
  });

  it("被全文搜尋找到的淘汰卡會重新排入重建", async () => {
    const fixture = await makeFixture();
    for (let index = 0; index < 3; index += 1) {
      await addCard(fixture.library, `手寫字淘汰測試 ${index}。`);
    }
    fixture.vectors.refresh();
    await waitFor(() => vectorCount(fixture.storage.cache, MODEL) === 3);

    // 模擬上次執行留下的容量淘汰：三張都進 evicted，revision 維持不變。
    const store = new CardVectorStore(fixture.storage.cache);
    const evicted = store.evictToFit(0);
    expect(evicted.removed).toBe(3);
    expect(vectorCount(fixture.storage.cache, MODEL)).toBe(0);
    expect(store.evictedRevisions().size).toBe(3);
    fixture.vectors.stop();

    // 新的一次載入看得到 evicted 標記；只載入不重建。
    let embeddings = 0;
    const counting: CardEmbedder = {
      embed: (text: string) => {
        embeddings += 1;
        return Promise.resolve(fakeVector(text));
      },
      stop: () => {},
    };
    const vectors = new CardVectors({
      library: fixture.library,
      database: () => fixture.storage.cache,
      allowed: () => true,
      spawn: SPAWN,
      cache: join(fixture.folder, "cache"),
      modelKey: MODEL,
      warn: () => {},
      embedder: counting,
    });
    const service = new RetrievalService(fixture.library, vectors);
    vectors.refresh();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    // evicted 但 revision 沒變：重新載入時不該重建，要等全文搜尋找到才排回重建。
    expect(embeddings).toBe(0);
    expect(vectorCount(fixture.storage.cache, MODEL)).toBe(0);

    const first = await service.search({ query: "手寫字" }, "search");
    expect(first.items.length).toBe(3);
    await waitFor(() => vectorCount(fixture.storage.cache, MODEL) === 3);
    expect(embeddings).toBeGreaterThanOrEqual(3);
    expect(new CardVectorStore(fixture.storage.cache).evictedRevisions().size).toBe(0);

    const after = await service.search({ query: "手寫字" }, "search");
    expect(after.items.map((item) => item.card.cardId).sort()).toEqual(
      first.items.map((item) => item.card.cardId).sort(),
    );
    vectors.stop();
  });

  it("容量上限把模型檔計入，超出預算時淘汰向量", async () => {
    const fixture = await makeFixture();
    for (let index = 0; index < 3; index += 1) {
      await addCard(fixture.library, `容量上限測試 ${index}。`);
    }
    fixture.vectors.refresh();
    await waitFor(() => vectorCount(fixture.storage.cache, MODEL) === 3);
    fixture.vectors.stop();

    // 模型權重不自動淘汰，但必須佔用 2 GB 的額度。
    const models = join(fixture.folder, "cache", "models");
    mkdirSync(models, { recursive: true });
    writeFileSync(join(models, "model.onnx"), Buffer.alloc(64 * 1024));
    const before = measureCache(join(fixture.folder, "cache"));
    expect(before.modelBytes).toBe(64 * 1024);

    const vectors = new CardVectors({
      library: fixture.library,
      database: () => fixture.storage.cache,
      allowed: () => true,
      spawn: SPAWN,
      cache: join(fixture.folder, "cache"),
      modelKey: MODEL,
      // 模型權重 64 KB 沒計入的話，這個預算下向量仍可以留著；
      // 計入之後非向量部分已超出上限，向量只能全部淘汰。
      maxCacheBytes: before.indexBytes + 1,
      warn: () => {},
      embedder: EMBEDDER,
    });
    vectors.refresh();

    expect(vectorCount(fixture.storage.cache, MODEL)).toBe(0);
    expect(new CardVectorStore(fixture.storage.cache).evictedRevisions().size).toBe(3);
    const status = vectors.status();
    expect(status.state).toBe("ready");
    expect(status.cache?.modelsBytes).toBe(64 * 1024);
    expect(status.cache?.maxBytes).toBe(before.indexBytes + 1);
    expect(status.cache?.overLimit).toBe(true);
    vectors.stop();
  });

  it("切換索引模型會清掉舊模型權重", async () => {
    const fixture = await makeFixture();
    await addCard(fixture.library, "模型切換測試。");
    fixture.vectors.refresh();
    await waitFor(() => vectorCount(fixture.storage.cache, MODEL) === 1);
    fixture.vectors.stop();

    const models = join(fixture.folder, "cache", "models");
    mkdirSync(join(models, "old-model"), { recursive: true });
    writeFileSync(join(models, "old-model", "weights.onnx"), Buffer.alloc(1024));

    const vectors = new CardVectors({
      library: fixture.library,
      database: () => fixture.storage.cache,
      allowed: () => true,
      spawn: SPAWN,
      cache: join(fixture.folder, "cache"),
      modelKey: "cache-test@2",
      warn: () => {},
      embedder: EMBEDDER,
    });
    vectors.refresh();

    expect(existsSync(models)).toBe(false);
    await waitFor(() => vectorCount(fixture.storage.cache, "cache-test@2") === 1);
    expect(vectorCount(fixture.storage.cache, MODEL)).toBe(0);
    vectors.stop();
  });
});
