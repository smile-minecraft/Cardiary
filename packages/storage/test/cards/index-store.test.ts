import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CardIndexStore,
  type IndexedCard,
  type IndexedBrokenCard,
} from "../../src/cards/index-store.js";
import type { Database } from "../../src/db.js";
import { openCacheDatabase } from "../../src/state-schema.js";
import { createTempRoot, type TempRoot } from "../helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

const CARD_A = "01JCX8Q3W7Z9K5V2N4M6P8R0T1".toUpperCase();
const CARD_B = "01JCX8Q3W7Z9K5V2N4M6P8R0T2".toUpperCase();
const CARD_C = "card content sample".toUpperCase();

interface Fixture {
  readonly temp: TempRoot;
  readonly filePath: string;
  readonly store: CardIndexStore;
  readonly db: Database;
}

function setup(label = "cards-index"): Fixture {
  const temp = createTempRoot(label);
  cleanups.push(temp.cleanup);
  const opened = openFixture(temp);
  cleanups.push(() => opened.close());
  return { temp, ...opened };
}

function openFixture(temp: TempRoot): {
  filePath: string;
  store: CardIndexStore;
  db: Database;
  close: () => void;
} {
  const filePath = path.join(temp.folder, "cache", "index.sqlite");
  mkdirSync(path.dirname(filePath), { recursive: true });
  const { db } = openCacheDatabase({ filePath });
  return {
    filePath,
    store: new CardIndexStore({ db }),
    db,
    close: () => db.close(),
  };
}

function card(id: string, overrides: Partial<IndexedCard> = {}): IndexedCard {
  return {
    cardId: id,
    path: `cards/${id}.md`,
    mtimeMs: 1_700_000_000_000,
    sizeBytes: 100,
    contentHash: `hash-${id}`,
    indexedAt: "2026-11-15T00:00:00.000Z",
    broken: false,
    revision: `rev-${id}`,
    kind: "note",
    title: `標題 ${id.slice(-2)}`,
    body: "",
    tags: [],
    sources: [],
    links: [],
    persona: "default",
    createdAt: "2026-11-14T00:00:00.000Z",
    ...overrides,
  };
}

function brokenCard(id: string, reason = "frontmatter 沒有 id"): IndexedBrokenCard {
  return {
    cardId: id,
    path: `cards/${id}.md`,
    mtimeMs: 1,
    sizeBytes: 1,
    contentHash: `hash-${id}`,
    indexedAt: "2026-11-15T00:00:00.000Z",
    broken: true,
    brokenReason: reason,
  };
}

describe("卡片索引列", () => {
  it("寫入後讀得回 frontmatter 的重點欄位與檔案事實", () => {
    const { store } = setup();
    store.upsert(
      card(CARD_A, {
        title: "會議筆記",
        summary: "一兩句話",
        tags: ["專案A", "待辦"],
        sources: [CARD_B],
        assetId: "9f2c0d1e",
        supersedes: CARD_B,
        persona: "work",
        createdAt: "2026-11-13T01:00:00.000Z",
        updatedAt: "2026-11-14T02:00:00.000Z",
        revision: "rev-a",
        kind: "memory",
      }),
    );

    const row = store.get(CARD_A);
    expect(row).toEqual({
      cardId: CARD_A,
      path: `cards/${CARD_A}.md`,
      mtimeMs: 1_700_000_000_000,
      sizeBytes: 100,
      contentHash: `hash-${CARD_A}`,
      revision: "rev-a",
      kind: "memory",
      title: "會議筆記",
      summary: "一兩句話",
      createdAt: "2026-11-13T01:00:00.000Z",
      updatedAt: "2026-11-14T02:00:00.000Z",
      persona: "work",
      assetId: "9f2c0d1e",
      supersedes: CARD_B,
      broken: false,
      indexedAt: "2026-11-15T00:00:00.000Z",
    });
    expect(store.count()).toBe(1);
  });

  it("重複寫入同一張卡會換掉舊的標籤與連結，不會留下孤兒列", () => {
    const { store, db } = setup();
    store.upsert(card(CARD_A, { tags: ["舊"], links: [CARD_B] }));
    store.upsert(card(CARD_A, { tags: ["新"] }));

    expect(db.all("SELECT tag FROM card_tags WHERE card_id = ?", CARD_A)).toEqual([{ tag: "新" }]);
    expect(db.all("SELECT * FROM card_links WHERE from_card_id = ?", CARD_A)).toEqual([]);
  });

  it("格式不符的檔案只記檔案事實與原因，不列進一般列表", () => {
    const { store } = setup();
    store.upsert(card(CARD_A));
    store.upsert(brokenCard(CARD_B, "id 與檔名不符"));

    expect(store.list().items.map((row) => row.cardId)).toEqual([CARD_A]);
    const withBroken = store.list({ includeBroken: true }).items;
    expect(withBroken.map((row) => row.cardId).sort()).toEqual([CARD_A, CARD_B].sort());
    expect(store.get(CARD_B)?.brokenReason).toBe("id 與檔名不符");
  });
});

describe("列表與分頁", () => {
  it("依建立時間新到舊，種類、標籤與人格可以篩選", () => {
    const { store } = setup();
    store.upsert(
      card(CARD_A, {
        createdAt: "2026-11-10T00:00:00.000Z",
        kind: "note",
        tags: ["x"],
        persona: "a",
      }),
    );
    store.upsert(
      card(CARD_B, {
        createdAt: "2026-11-12T00:00:00.000Z",
        kind: "memory",
        tags: ["x", "y"],
        persona: "b",
      }),
    );
    store.upsert(
      card(CARD_C, {
        createdAt: "2026-11-11T00:00:00.000Z",
        kind: "note",
        tags: ["y"],
        persona: "a",
      }),
    );

    expect(store.list().items.map((row) => row.cardId)).toEqual([CARD_B, CARD_C, CARD_A]);
    expect(store.list({ kinds: ["note"] }).items.map((row) => row.cardId)).toEqual([
      CARD_C,
      CARD_A,
    ]);
    expect(store.list({ tags: ["x"] }).items.map((row) => row.cardId)).toEqual([CARD_B, CARD_A]);
    expect(store.list({ tags: ["x", "y"] }).items.map((row) => row.cardId)).toEqual([CARD_B]);
    expect(store.list({ persona: "a" }).items.map((row) => row.cardId)).toEqual([CARD_C, CARD_A]);
  });

  it("游標分頁不重複也不漏", () => {
    const { store } = setup();
    store.upsert(card(CARD_A, { createdAt: "2026-11-10T00:00:00.000Z" }));
    store.upsert(card(CARD_B, { createdAt: "2026-11-12T00:00:00.000Z" }));
    store.upsert(card(CARD_C, { createdAt: "2026-11-11T00:00:00.000Z" }));

    const first = store.list({ limit: 2 });
    expect(first.items.map((row) => row.cardId)).toEqual([CARD_B, CARD_C]);
    expect(first.nextCursor).toBeDefined();
    const second = store.list({ limit: 2, cursor: first.nextCursor as string });
    expect(second.items.map((row) => row.cardId)).toEqual([CARD_A]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("不合法的游標丟錯，不會默默從頭開始", () => {
    const { store } = setup();
    expect(() => store.list({ cursor: "not-a-cursor" })).toThrowError(/游標/);
  });
});

describe("被取代的卡", () => {
  it("預設不進列表與搜尋，明確要求時才出現", () => {
    const { store } = setup();
    store.upsert(card(CARD_A, { title: "舊版計畫", body: "專案時程表" }));
    store.upsert(card(CARD_B, { title: "新版計畫", supersedes: CARD_A }));

    expect(store.list().items.map((row) => row.cardId)).toEqual([CARD_B]);
    expect(
      store
        .list({ includeSuperseded: true })
        .items.map((row) => row.cardId)
        .sort(),
    ).toEqual([CARD_A, CARD_B].sort());
    expect(store.search({ query: "專案時程表" })).toEqual([]);
    expect(store.search({ query: "專案時程表", includeSuperseded: true })).toHaveLength(1);
    // 卡片本身還在，讀得到。
    expect(store.get(CARD_A)?.title).toBe("舊版計畫");
  });
});

describe("全文搜尋", () => {
  it("三個字元以上的中文查子字串", () => {
    const { store } = setup();
    store.upsert(card(CARD_A, { title: "會議筆記", body: "討論了卡片庫的索引設計與重建流程" }));
    store.upsert(card(CARD_B, { title: "購物清單", body: "牛奶、雞蛋、麵包" }));

    const hits = store.search({ query: "索引設計" });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.card.cardId).toBe(CARD_A);
    expect(hits[0]?.snippet).toContain("索引設計");
  });

  it("標題與標籤也搜得到，分數高的排前面", () => {
    const { store } = setup();
    store.upsert(card(CARD_A, { title: "卡片庫", body: "無關的內容" }));
    store.upsert(card(CARD_B, { title: "其他", body: "卡片庫 卡片庫 卡片庫", tags: ["卡片庫"] }));

    const hits = store.search({ query: "卡片庫" });
    expect(hits.map((hit) => hit.card.cardId).sort()).toEqual([CARD_A, CARD_B].sort());
    expect(hits[0]?.score).toBeGreaterThanOrEqual(hits[1]?.score ?? 0);
  });

  it("一至兩個字元改用 LIKE 掃標題與摘要", () => {
    const { store } = setup();
    store.upsert(card(CARD_A, { title: "會議", summary: "討論索引" }));
    store.upsert(card(CARD_B, { title: "購物", summary: "牛奶" }));

    const hits = store.search({ query: "會議" });
    expect(hits.map((hit) => hit.card.cardId)).toEqual([CARD_A]);
    expect(hits[0]?.snippet).toContain("會議");
    expect(store.search({ query: "牛" }).map((hit) => hit.card.cardId)).toEqual([CARD_B]);
    expect(store.search({ query: "奶" })).toHaveLength(1);
  });

  it("LIKE 的萬用字元被跳脫，不會變成全表命中", () => {
    const { store } = setup();
    store.upsert(card(CARD_A, { title: "進度 1%" }));
    store.upsert(card(CARD_B, { title: "進度" }));
    expect(store.search({ query: "%" }).map((hit) => hit.card.cardId)).toEqual([CARD_A]);
    expect(store.search({ query: "1%" }).map((hit) => hit.card.cardId)).toEqual([CARD_A]);
    expect(store.search({ query: "_" })).toHaveLength(0);
  });

  it("空查詢回空集合，broken 的卡不進搜尋", () => {
    const { store } = setup();
    store.upsert(brokenCard(CARD_A));
    expect(store.search({ query: "   " })).toEqual([]);
    expect(store.search({ query: "任何字" })).toEqual([]);
  });
});

describe("連結", () => {
  it("連到卡片 id 與標題都能解析，反向連結由索引算出", () => {
    const { store } = setup();
    store.upsert(card(CARD_B, { title: "設計文件" }));
    store.upsert(card(CARD_A, { title: "筆記", links: [CARD_B, "設計文件", "不存在的卡"] }));

    expect(store.outgoingLinks(CARD_A)).toEqual([CARD_B, CARD_B]);
    expect(store.backlinks(CARD_B)).toEqual([CARD_A]);
    expect(store.unresolvedLinks()).toEqual(["不存在的卡"]);
  });

  it("新卡的標題讓先前未解析的連結接上", () => {
    const { store } = setup();
    store.upsert(card(CARD_A, { title: "筆記", links: ["未來的卡"] }));
    expect(store.unresolvedLinks()).toEqual(["未來的卡"]);

    store.upsert(card(CARD_B, { title: "  未來的卡  " }));
    expect(store.unresolvedLinks()).toEqual([]);
    expect(store.backlinks(CARD_B)).toEqual([CARD_A]);
  });

  it("刪掉目標卡之後，指向它的連結變回未解析", () => {
    const { store } = setup();
    store.upsert(card(CARD_B, { title: "目標" }));
    store.upsert(card(CARD_A, { title: "來源", links: [CARD_B] }));
    store.remove(CARD_B);

    expect(store.unresolvedLinks()).toEqual([CARD_B]);
    expect(store.backlinks(CARD_B)).toEqual([]);
  });
});

describe("原檔引用", () => {
  it("兩張卡引用同一個原檔時計數是 2，刪一張變 1", () => {
    const { store } = setup();
    store.upsert(card(CARD_A, { assetId: "abc123" }));
    store.upsert(card(CARD_B, { assetId: "abc123" }));
    expect(store.assetRefCount("abc123")).toBe(2);
    expect(store.assetCards("abc123")).toEqual([CARD_A, CARD_B].sort());

    store.remove(CARD_A);
    expect(store.assetRefCount("abc123")).toBe(1);
    expect(store.assetCards("abc123")).toEqual([CARD_B]);
  });

  it("asset_meta 可以寫入、讀回與刪除", () => {
    const { store } = setup();
    store.putAssetMeta({
      assetId: "abc123",
      mediaType: "image/png",
      sizeBytes: 10,
      width: 4,
      height: 5,
    });
    expect(store.getAssetMeta("abc123")).toEqual({
      assetId: "abc123",
      mediaType: "image/png",
      sizeBytes: 10,
      width: 4,
      height: 5,
    });
    store.putAssetMeta({ assetId: "abc123", mediaType: "image/png", sizeBytes: 10 });
    expect(store.getAssetMeta("abc123")?.width).toBeUndefined();
    store.removeAssetMeta("abc123");
    expect(store.getAssetMeta("abc123")).toBeUndefined();
  });
});

describe("重建", () => {
  it("rebuild 清掉舊列再寫入，完成後才算就緒", () => {
    const { store } = setup();
    expect(store.isReady).toBe(false);
    store.upsert(card(CARD_A, { title: "舊資料" }));
    const result = store.rebuild([
      card(CARD_B, { title: "重建後", tags: ["t"], links: [CARD_C] }),
      card(CARD_C, { title: "目標" }),
      brokenCard(CARD_A, "壞掉"),
    ]);

    expect(result).toEqual({ indexed: 2, broken: 1 });
    expect(store.isReady).toBe(true);
    expect(store.count()).toBe(3);
    expect(store.get(CARD_A)?.broken).toBe(true);
    expect(store.get(CARD_A)?.title).toBe("");
    expect(store.backlinks(CARD_C)).toEqual([CARD_B]);
  });

  it("刪掉整個索引檔後重建，列表、搜尋與反向連結與刪除前相同", () => {
    const temp = createTempRoot("cards-rebuild");
    cleanups.push(temp.cleanup);
    const cards = [
      card(CARD_A, { title: "設計文件", body: "卡片庫的索引與重建", tags: ["設計"] }),
      card(CARD_B, { title: "會議筆記", links: ["設計文件"] }),
      card(CARD_C, { title: "別的", createdAt: "2026-11-15T00:00:00.000Z" }),
    ];
    const before = openFixture(temp);
    before.store.rebuild(cards);
    const snapshot = {
      list: before.store.list({ includeSuperseded: true }).items,
      search: before.store.search({ query: "索引與重建" }),
      backlinks: before.store.backlinks(CARD_A),
      tags: before.db.all("SELECT card_id, tag FROM card_tags ORDER BY card_id, tag"),
    };
    before.close();

    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(`${before.filePath}${suffix}`, { force: true });
    }
    const after = openFixture(temp);
    cleanups.push(() => after.close());
    expect(after.store.count()).toBe(0);
    after.store.rebuild(cards);

    expect(after.store.list({ includeSuperseded: true }).items).toEqual(snapshot.list);
    expect(after.store.search({ query: "索引與重建" })).toEqual(snapshot.search);
    expect(after.store.backlinks(CARD_A)).toEqual(snapshot.backlinks);
    expect(after.db.all("SELECT card_id, tag FROM card_tags ORDER BY card_id, tag")).toEqual(
      snapshot.tags,
    );
  });
});

describe("刪除後的殘留", () => {
  it("刪卡並 checkpoint 後，資料庫與 WAL 檔都找不到卡片內容", () => {
    const { store, filePath, db } = setup();
    const secret = "獨特內容片段-Zx9Qm7Vb2";
    store.upsert(card(CARD_A, { title: "要被刪掉的卡", body: secret }));
    store.upsert(card(CARD_B, { title: "留下來的卡", body: "普通內容" }));
    expect(readAllBytes(filePath).includes(Buffer.from(secret, "utf8"))).toBe(true);

    store.remove(CARD_A);
    db.close();
    cleanups.pop();

    const bytes = readAllBytes(filePath);
    expect(bytes.includes(Buffer.from(secret, "utf8"))).toBe(false);
    expect(bytes.includes(Buffer.from("要被刪掉的卡", "utf8"))).toBe(false);
    expect(statSync(filePath).isFile()).toBe(true);
  });
});

/** 讀主檔與 SQLite 側車檔的全部位元組。 */
function readAllBytes(filePath: string): Buffer {
  const chunks: Buffer[] = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${filePath}${suffix}`;
    try {
      const fd = openSync(target, "r");
      try {
        chunks.push(readFileSync(fd));
      } finally {
        closeSync(fd);
      }
    } catch {
      // 側車檔不存在時跳過。
    }
  }
  return Buffer.concat(chunks);
}
