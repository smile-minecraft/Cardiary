import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";

import {
  CardFileStore,
  CardIndexStore,
  CardVectorStore,
  LocalAssetStore,
  Storage,
  type IndexedCard,
} from "../../storage/src/index.js";
import { CardLibrary } from "../../host/src/modules/cards/library.js";
import { CardStateStore } from "../../host/src/modules/cards/state.js";
import {
  CardVectors,
  type CardEmbedder,
  type RetrievalStatus,
} from "../../host/src/modules/retrieval/vectors.js";
import { RetrievalService } from "../../host/src/modules/retrieval/service.js";
import type { SpawnRegistry } from "../../host/src/spawn/wrapper.js";

/**
 * 一萬張卡的檢索延遲量測；預設不跑，避免成為常駐慢測試。
 *
 * `CARDIARY_RETRIEVAL_BENCH=1 pnpm vitest run packages/contract-tests/retrieval/performance.test.ts`
 *
 * 查詢嵌入與卡片向量都是決定性的假資料，沒有真的下載模型。量的是產品路徑
 * `RetrievalService.search`：全文索引、向量比對與 RRF 合併都在內。
 */
const ENABLED = process.env.CARDIARY_RETRIEVAL_BENCH === "1";
const CARD_COUNT = 10_000;
const DIMENSION = 1024;
const WARMUP_RUNS = 3;
const MEASURED_RUNS = 50;
const MODEL = "bench-model@1";
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

function cardId(index: number): string {
  const time = BigInt(Date.now() + index);
  const timePart = new Array<string>(10);
  let rest = time;
  for (let position = 9; position >= 0; position -= 1) {
    timePart[position] = CROCKFORD[Number(rest & 31n)] as string;
    rest >>= 5n;
  }
  const randomPart = new Array<string>(16);
  let state = (index + 1) * 2654435761;
  for (let position = 0; position < 16; position += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    randomPart[position] = CROCKFORD[state % 32] as string;
  }
  return `${timePart.join("")}${randomPart.join("")}`;
}

function fakeVector(text: string, dimension: number): Float32Array {
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

function fakeEmbedder(): CardEmbedder {
  return {
    embed: (text: string) => Promise.resolve(fakeVector(text, DIMENSION)),
    stop: () => {},
  };
}

function indexedCard(id: string, index: number): IndexedCard {
  return {
    cardId: id,
    path: `cards/${id}.md`,
    mtimeMs: 1_700_000_000_000 + index,
    sizeBytes: 200,
    contentHash: `hash-${id}`,
    indexedAt: "2026-11-18T00:00:00.000Z",
    broken: false,
    revision: `rev-${id}`,
    kind: "note",
    title: `手寫字卡片 ${index}`,
    summary: `第 ${index} 張練習卡`,
    body: `手寫字練習筆記 ${index}。橫豎撇捺與部首的練習內容。`,
    tags: index % 2 === 0 ? ["手寫"] : ["練習"],
    sources: [],
    links: [],
    persona: "default",
    createdAt: new Date(1_700_000_000_000 + index).toISOString(),
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  const rank = Math.ceil(sorted.length * fraction);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] as number;
}

describe.skipIf(!ENABLED)("一萬張卡的檢索延遲", () => {
  it(`產品路徑 p95 低於 250 ms（${CARD_COUNT} 張卡、${MEASURED_RUNS} 次）`, async () => {
    const folder = await mkdtemp(join(tmpdir(), "cardiary-retrieval-bench-"));
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

    const indexStore = index();
    const vectorStore = new CardVectorStore(storage.cache);
    // 先固定模型；selectModel 在模型不同時會整批刪除既有向量。
    vectorStore.selectModel(MODEL);
    const records: IndexedCard[] = [];
    for (let position = 0; position < CARD_COUNT; position += 1) {
      records.push(indexedCard(cardId(position), position));
    }
    const seedStarted = performance.now();
    storage.cache.transaction(() => {
      for (const record of records) {
        indexStore.upsert(record);
        vectorStore.put(
          record.cardId,
          record.revision,
          MODEL,
          fakeVector(`${record.title}\n${record.body}`, DIMENSION),
        );
      }
    });
    const seedMs = performance.now() - seedStarted;

    const statuses: RetrievalStatus[] = [];
    const vectors = new CardVectors({
      library,
      database: () => storage.cache,
      allowed: () => true,
      spawn: SPAWN,
      cache: join(folder, "cache"),
      modelKey: MODEL,
      warn: () => {},
      embedder: fakeEmbedder(),
      onStatus: (status) => statuses.push(status),
    });
    const service = new RetrievalService(library, vectors);

    // 第一次查詢會把索引載入記憶體；冷啟動成本另外記，不算進 p50/p95。
    const coldStarted = performance.now();
    await service.search({ query: "手寫字" }, "search");
    const coldMs = performance.now() - coldStarted;
    for (let run = 0; run < WARMUP_RUNS; run += 1) {
      await service.search({ query: "手寫字" }, "search");
    }

    const durations: number[] = [];
    for (let run = 0; run < MEASURED_RUNS; run += 1) {
      const started = performance.now();
      const result = await service.search({ query: "手寫字" }, "search");
      durations.push(performance.now() - started);
      expect(result.items.length).toBe(20);
    }
    durations.sort((a, b) => a - b);
    const p50 = percentile(durations, 0.5);
    const p95 = percentile(durations, 0.95);
    const report = {
      cards: CARD_COUNT,
      dimension: DIMENSION,
      runs: MEASURED_RUNS,
      seedMs: Math.round(seedMs),
      coldMs: Math.round(coldMs * 10) / 10,
      p50Ms: Math.round(p50 * 10) / 10,
      p95Ms: Math.round(p95 * 10) / 10,
      maxMs: Math.round((durations.at(-1) ?? 0) * 10) / 10,
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      status: statuses.at(-1)?.state,
    };
    console.log(`檢索延遲 ${JSON.stringify(report)}`);
    expect(p95).toBeLessThan(250);
  }, 300_000);
});
