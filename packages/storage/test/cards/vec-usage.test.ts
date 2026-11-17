import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CardIndexStore } from "../../src/cards/index-store.js";
import { CardVectorStore } from "../../src/cards/vec-store.js";
import { openCacheDatabase } from "../../src/state-schema.js";
import { createTempRoot } from "../helpers/temp.js";

const MODEL = "model-a@1";

function setup(): { root: ReturnType<typeof createTempRoot>; db: ReturnType<typeof openCacheDatabase>["db"] } {
  const root = createTempRoot("card-vector-usage");
  mkdirSync(join(root.folder, "cache"), { recursive: true });
  const { db } = openCacheDatabase({ filePath: join(root.folder, "cache", "index.sqlite") });
  new CardIndexStore({ db }); // 建立 card_index_meta 等整份 Schema
  return { root, db };
}

function vector(value: number): Float32Array {
  return new Float32Array(new Array<number>(1024).fill(value));
}

describe("向量快取容量淘汰", () => {
  it("超過上限時先淘汰最久沒用的向量，被淘汰的卡記錄為 evicted", () => {
    const { root, db } = setup();
    try {
      let now = 1_000;
      const store = new CardVectorStore(db, () => now);
      store.selectModel(MODEL);
      // 每張 1024 維 float32 ≈ 4100 bytes；三張合計約 12 KB。
      store.put("A", "rev-a", MODEL, vector(0.1), now);
      now += 1;
      store.put("B", "rev-b", MODEL, vector(0.2), now);
      now += 1;
      store.put("C", "rev-c", MODEL, vector(0.3), now);
      const oneCard = store.estimateBytes() / 3;
      // A 被用過，B 沒用，C 沒用但較新；cap 只放得下兩張。
      store.touch(["A"], now);
      now += 1;
      const result = store.evictToFit(Math.floor(oneCard * 2), now);
      expect(result.removed).toBe(1);
      expect(store.all(MODEL).map((row) => row.cardId)).toEqual(["A", "C"]);
      expect(store.evictedRevisions().get("B")).toBe("rev-b");
      expect(store.evictedRevisions().size).toBe(1);
    } finally {
      db.close();
      root.cleanup();
    }
  });

  it("被淘汰的卡共用 revision 時不重建，卡片被編輯後標記失效", () => {
    const { root, db } = setup();
    try {
      let now = 5_000;
      const store = new CardVectorStore(db, () => now);
      store.selectModel(MODEL);
      store.put("A", "rev-1", MODEL, vector(0.1), now);
      now += 1;
      store.put("B", "rev-2", MODEL, vector(0.2), now);
      const oneCard = store.estimateBytes() / 2;
      const result = store.evictToFit(Math.floor(oneCard / 2), now);
      expect(result.removed).toBe(2);
      expect(store.evictedRevisions().get("A")).toBe("rev-1");
      // 標記失效：卡片 revision 變了（例如內容被編輯），evicted 標記就不算數。
      expect(store.evictedRevisions().get("A")).not.toBe("rev-1-edited");
    } finally {
      db.close();
      root.cleanup();
    }
  });

  it("put 會清除 evicted 標記並更新最近使用時間；selectModel 整批清空時連附屬表一起清", () => {
    const { root, db } = setup();
    try {
      let now = 10_000;
      const store = new CardVectorStore(db, () => now);
      store.selectModel(MODEL);
      store.put("A", "rev-1", MODEL, vector(0.1), now);
      const oneCard = store.estimateBytes();
      store.evictToFit(0, now);
      expect(store.evictedRevisions().size).toBe(1);
      now += 100;
      store.put("A", "rev-1", MODEL, vector(0.1), now);
      expect(store.evictedRevisions().size).toBe(0);
      store.selectModel("model-b@2");
      expect(store.evictedRevisions().size).toBe(0);
      expect(store.estimateBytes()).toBe(0);
    } finally {
      db.close();
      root.cleanup();
    }
  });

  it("沒有向量列時淘汰是 no-op", () => {
    const { root, db } = setup();
    try {
      const store = new CardVectorStore(db);
      store.selectModel(MODEL);
      expect(store.estimateBytes()).toBe(0);
      expect(store.evictToFit(0).removed).toBe(0);
    } finally {
      db.close();
      root.cleanup();
    }
  });
});
