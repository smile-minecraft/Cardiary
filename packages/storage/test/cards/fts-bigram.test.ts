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
