import { readFileSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CardIndexStore } from "../../src/cards/index-store.js";
import { CardVectorStore } from "../../src/cards/vec-store.js";
import { openCacheDatabase } from "../../src/state-schema.js";
import { createTempRoot } from "../helpers/temp.js";

const MODEL = "model-a@1";

function readFolderBytes(root: string): Buffer {
  const chunks: Buffer[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const target = join(dir, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) chunks.push(readFileSync(target));
    }
  };
  walk(root);
  return Buffer.concat(chunks);
}

describe("刪卡回歸", () => {
  it("刪卡後三張向量表都沒有該卡，cache 也找不到該卡的文字", () => {
    const temp = createTempRoot("cards-delete-regression");
    try {
      const folder = join(temp.folder, "cache");
      mkdirSync(folder, { recursive: true });
      const { db } = openCacheDatabase({ filePath: join(folder, "index.sqlite") });
      try {
        const index = new CardIndexStore({ db });
        const vectors = new CardVectorStore(db);
        vectors.selectModel(MODEL);
        const secret = "unique-ciphertext-布袋熊-Zx9Qm7Vb2";
        index.upsert({
          cardId: "DEL0000000000000000000000000001",
          path: "cards/DEL1.md",
          mtimeMs: 1_700_000_000_000,
          sizeBytes: 100,
          contentHash: "hash-del-1",
          indexedAt: "2026-11-15T00:00:00.000Z",
          broken: false,
          revision: "rev-del-1",
          kind: "note",
          title: `標題 ${secret}`,
          body: secret,
          tags: [secret],
          sources: [],
          links: [],
          persona: "default",
          createdAt: "2026-11-14T00:00:00.000Z",
        });
        vectors.put(
          "DEL0000000000000000000000000001",
          "rev-del-1",
          MODEL,
          new Float32Array([0.5, 0.25]),
        );
        // 先淘汰，讓 vec_cards_evicted 與 vec_cards_usage 都有這張卡的列。
        const evicted = vectors.evictToFit(0);
        expect(evicted.removed).toBe(1);
        expect(vectors.evictedRevisions().get("DEL0000000000000000000000000001")).toBe("rev-del-1");

        index.remove("DEL0000000000000000000000000001");

        expect(
          db.get<{ n: number }>(
            "SELECT COUNT(*) AS n FROM vec_cards WHERE card_id = ?",
            "DEL0000000000000000000000000001",
          )?.n,
        ).toBe(0);
        expect(
          db.get<{ n: number }>(
            "SELECT COUNT(*) AS n FROM vec_cards_usage WHERE card_id = ?",
            "DEL0000000000000000000000000001",
          )?.n,
        ).toBe(0);
        expect(
          db.get<{ n: number }>(
            "SELECT COUNT(*) AS n FROM vec_cards_evicted WHERE card_id = ?",
            "DEL0000000000000000000000000001",
          )?.n,
        ).toBe(0);
        // 順帶確認 FTS 與標籤也清掉。
        expect(
          db.get<{ n: number }>(
            "SELECT COUNT(*) AS n FROM fts_cards WHERE card_id = ?",
            "DEL0000000000000000000000000001",
          )?.n,
        ).toBe(0);
        expect(
          db.get<{ n: number }>(
            "SELECT COUNT(*) AS n FROM card_tags WHERE card_id = ?",
            "DEL0000000000000000000000000001",
          )?.n,
        ).toBe(0);

        db.close();
        const bytes = readFolderBytes(folder);
        expect(bytes.includes(Buffer.from(secret, "utf8"))).toBe(false);
        expect(statSync(folder).isDirectory()).toBe(true);
      } finally {
        // db 可能已在上面關閉。
        try {
          db.close();
        } catch {
          // 已關閉。
        }
      }
    } finally {
      temp.cleanup();
    }
  });
});
