import type { Database } from "../db.js";

export interface StoredVector {
  readonly cardId: string;
  readonly revision: string;
  readonly vector: Float32Array;
}

export class CardVectorStore {
  constructor(private readonly db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS vec_cards (
      card_id TEXT PRIMARY KEY, model TEXT NOT NULL, revision TEXT NOT NULL,
      vector BLOB NOT NULL
    ) STRICT`);
  }

  selectModel(model: string): void {
    this.db.transaction((tx) => {
      const previous = tx.get<{ value: string }>(
        "SELECT value FROM card_index_meta WHERE key = ?",
        "embedding.model",
      );
      if (previous?.value !== model) {
        tx.run("DELETE FROM vec_cards");
        tx.run(
          "INSERT INTO card_index_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
          "embedding.model",
          model,
        );
      }
    });
  }

  put(cardId: string, revision: string, model: string, vector: Float32Array): void {
    this.db.run(
      "INSERT INTO vec_cards (card_id, model, revision, vector) VALUES (?, ?, ?, ?) ON CONFLICT(card_id) DO UPDATE SET model=excluded.model, revision=excluded.revision, vector=excluded.vector",
      cardId,
      model,
      revision,
      Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
    );
  }

  all(model: string): StoredVector[] {
    return this.db
      .all<{ card_id: string; revision: string; vector: Uint8Array }>(
        "SELECT card_id, revision, vector FROM vec_cards WHERE model = ? ORDER BY card_id",
        model,
      )
      .map((row) => ({
        cardId: row.card_id,
        revision: row.revision,
        vector: new Float32Array(
          row.vector.buffer.slice(
            row.vector.byteOffset,
            row.vector.byteOffset + row.vector.byteLength,
          ),
        ),
      }));
  }
}
