import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CardIndexStore } from "../../src/cards/index-store.js";
import { CardVectorStore } from "../../src/cards/vec-store.js";
import { openCacheDatabase } from "../../src/state-schema.js";
import { createTempRoot } from "../helpers/temp.js";

describe("卡片向量快取", () => {
  it("刪卡會刪向量；切換模型會清空所有舊模型向量", () => {
    const temp = createTempRoot("card-vector");
    mkdirSync(join(temp.folder, "cache"), { recursive: true });
    const { db } = openCacheDatabase({ filePath: join(temp.folder, "cache", "index.sqlite") });
    try {
      const index = new CardIndexStore({ db });
      const vectors = new CardVectorStore(db);
      vectors.selectModel("model-a@1");
      vectors.put("ABC", "rev", "model-a@1", new Float32Array([0.5, 0.25]));
      expect([...vectors.all("model-a@1")[0]!.vector]).toEqual([0.5, 0.25]);
      index.remove("ABC");
      expect(vectors.all("model-a@1")).toEqual([]);
      vectors.put("ABC", "rev", "model-a@1", new Float32Array([1]));
      vectors.selectModel("model-b@2");
      expect(vectors.all("model-a@1")).toEqual([]);
      expect(vectors.all("model-b@2")).toEqual([]);
    } finally {
      db.close();
      temp.cleanup();
    }
  });
});
