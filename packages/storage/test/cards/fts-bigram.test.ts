import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CardIndexStore, type IndexedCard } from "../../src/cards/index-store.js";
import { openCacheDatabase } from "../../src/state-schema.js";
import { createTempRoot } from "../helpers/temp.js";

const card: IndexedCard = {
  cardId: "EXAMPLE-CARD",
  path: "cards/test.md",
  mtimeMs: 1,
  sizeBytes: 10,
  contentHash: "hash",
  revision: "rev",
  indexedAt: "2026-01-01T00:00:00.000Z",
  broken: false,
  kind: "note",
  title: "早餐",
  body: "手沖咖啡使用粗研磨",
  tags: ["食譜"],
  sources: [],
  links: [],
  persona: "default",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("中文全文索引", () => {
  it("兩字查詢能命中內文，單字查詢也能命中內文", () => {
    const temp = createTempRoot("fts-bigram");
    mkdirSync(join(temp.folder, "cache"), { recursive: true });
    const { db } = openCacheDatabase({ filePath: join(temp.folder, "cache", "index.sqlite") });
    try {
      const index = new CardIndexStore({ db });
      index.upsert(card);
      expect(index.search({ query: "咖啡" }).map((hit) => hit.card.cardId)).toEqual([card.cardId]);
      expect(index.search({ query: "啡" }).map((hit) => hit.card.cardId)).toEqual([card.cardId]);
    } finally {
      db.close();
      temp.cleanup();
    }
  });
});

describe("任一詞命中與種類過濾", () => {
  function openIndex() {
    const temp = createTempRoot("fts-any-term");
    mkdirSync(join(temp.folder, "cache"), { recursive: true });
    const { db } = openCacheDatabase({ filePath: join(temp.folder, "cache", "index.sqlite") });
    return {
      index: new CardIndexStore({ db }),
      close: () => {
        db.close();
        temp.cleanup();
      },
    };
  }

  const memory: IndexedCard = {
    ...card,
    cardId: "MEMORY-YARN",
    path: "cards/memory-yarn.md",
    kind: "memory",
    title: "套件管理偏好使用 Yarn",
    body: "使用者偏好所有前端與 Node.js 專案統一使用 Yarn 管理套件。",
    tags: [],
  };
  const sentence = "所有前端與 TypeScript 專案統一改用 pnpm 取代 Yarn 管理依賴。";

  it("整句帶標點的查詢：預設全部詞都要命中而找不到，anyTerm 依相關度找到", () => {
    const { index, close } = openIndex();
    try {
      index.upsert(memory);
      index.upsert({ ...card, cardId: "UNRELATED", path: "cards/unrelated.md" });
      expect(index.search({ query: sentence })).toEqual([]);
      const hits = index.search({ query: sentence, anyTerm: true });
      expect(hits.map((hit) => hit.card.cardId)).toEqual(["MEMORY-YARN"]);
      expect(hits[0]?.snippet).not.toContain("\u0001");
    } finally {
      close();
    }
  });

  it("anyTerm 不改變一般搜尋：多詞查詢仍要全部命中", () => {
    const { index, close } = openIndex();
    try {
      index.upsert(memory);
      expect(index.search({ query: "Yarn pnpm" })).toEqual([]);
      expect(
        index.search({ query: "Yarn pnpm", anyTerm: true }).map((hit) => hit.card.cardId),
      ).toEqual(["MEMORY-YARN"]);
    } finally {
      close();
    }
  });

  it("種類在上限之前過濾：同主題的筆記不會擠掉記憶卡", () => {
    const { index, close } = openIndex();
    try {
      for (let n = 0; n < 6; n += 1) {
        index.upsert({
          ...card,
          cardId: `NOTE-${n}`,
          path: `cards/note-${n}.md`,
          title: "套件管理工具切換決定",
          body: sentence,
          createdAt: `2026-01-0${n + 2}T00:00:00.000Z`,
        });
      }
      index.upsert(memory);
      const unfiltered = index.search({ query: sentence, anyTerm: true, limit: 5 });
      expect(unfiltered.map((hit) => hit.card.cardId)).not.toContain("MEMORY-YARN");
      const hits = index.search({ query: sentence, anyTerm: true, kinds: ["memory"], limit: 5 });
      expect(hits.map((hit) => hit.card.cardId)).toEqual(["MEMORY-YARN"]);
      // LIKE 路徑（單字查詢）也套用種類過濾。
      expect(
        index.search({ query: "用", kinds: ["memory"] }).map((hit) => hit.card.cardId),
      ).toEqual(["MEMORY-YARN"]);
    } finally {
      close();
    }
  });

  it("沒有任何可索引的詞時 anyTerm 退回一般行為", () => {
    const { index, close } = openIndex();
    try {
      index.upsert(memory);
      expect(index.search({ query: "。！？", anyTerm: true })).toEqual([]);
    } finally {
      close();
    }
  });
});
