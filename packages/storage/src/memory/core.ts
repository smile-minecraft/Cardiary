/**
 * 核心記憶組與每日變動計數的存取；正本是 v4 的 `core_memory`／`core_memory_daily`。
 *
 * 一天最多變動一次（設計 §3）：增刪核心卡與寫入 `core_memory_daily.changed`
 * 必須在同一個資料庫交易裡完成，復原也遵守同一個人格與日期鍵。
 */

import type { Database, Queryable } from "../db.js";

/** 核心組變更的來源。 */
export type CoreMemorySource = "distillation" | "import" | "user";

/** 一筆核心組成員。 */
export interface CoreMemoryEntry {
  readonly persona: string;
  readonly cardId: string;
  readonly addedDay: string;
  readonly source: CoreMemorySource;
}

/** 人格＋日期的變動計數。 */
export interface CoreMemoryDaily {
  readonly persona: string;
  readonly day: string;
  readonly changed: boolean;
}

interface CoreRow {
  readonly persona: string;
  readonly card_id: string;
  readonly added_day: string;
  readonly source: string;
}

interface DailyRow {
  readonly persona: string;
  readonly day: string;
  readonly changed: number;
}

export interface CoreMemoryStoreOptions {
  readonly now?: () => Date;
}

export class CoreMemoryStore {
  readonly #db: Database;
  readonly #now: () => Date;

  constructor(db: Database, options: CoreMemoryStoreOptions = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
  }

  /** 列出核心組，固定順序 `added_day, card_id` 升冪（決定性）。 */
  list(persona: string): CoreMemoryEntry[] {
    return this.#db
      .all<CoreRow>(
        "SELECT * FROM core_memory WHERE persona = ? ORDER BY added_day ASC, card_id ASC",
        persona,
      )
      .map(toEntry);
  }

  add(input: {
    readonly persona: string;
    readonly cardId: string;
    readonly addedDay: string;
    readonly source: CoreMemorySource;
  }): boolean {
    return (
      this.#db.run(
        "INSERT OR IGNORE INTO core_memory (persona, card_id, added_day, source) VALUES (?, ?, ?, ?)",
        input.persona,
        input.cardId,
        input.addedDay,
        input.source,
      ).changes > 0
    );
  }

  remove(persona: string, cardId: string): boolean {
    return (
      this.#db.run("DELETE FROM core_memory WHERE persona = ? AND card_id = ?", persona, cardId)
        .changes > 0
    );
  }

  getDaily(persona: string, day: string): CoreMemoryDaily | null {
    const row = this.#db.get<DailyRow>(
      "SELECT * FROM core_memory_daily WHERE persona = ? AND day = ?",
      persona,
      day,
    );
    return row === undefined ? null : toDaily(row);
  }

  /** 標記今天已變動；與增刪在同一交易內呼叫。 */
  markChanged(tx: Queryable, persona: string, day: string): void {
    tx.run(
      `INSERT INTO core_memory_daily (persona, day, changed) VALUES (?, ?, 1)
       ON CONFLICT (persona, day) DO UPDATE SET changed = 1`,
      persona,
      day,
    );
  }

  /**
   * 在一次交易裡增／刪核心卡並記下當日變動。
   *
   * `add` 時回傳是否真的加入（主鍵去重）；`remove` 時回傳是否真的移除。
   * 沒變動就不標記每日計數，避免「嘗試加入已在組內的卡」也算一次變動。
   */
  change(input: {
    readonly persona: string;
    readonly day: string;
    readonly op: "add" | "remove";
    readonly cardId: string;
    readonly source?: CoreMemorySource;
  }): boolean {
    return this.#db.transaction((tx) => {
      const changed =
        input.op === "add"
          ? this.#addOn(tx, {
              persona: input.persona,
              cardId: input.cardId,
              addedDay: input.day,
              source: input.source ?? "distillation",
            })
          : this.#removeOn(tx, input.persona, input.cardId);
      if (changed) {
        this.markChanged(tx, input.persona, input.day);
      }
      return changed;
    });
  }

  #addOn(tx: Queryable, input: CoreMemoryEntry): boolean {
    return (
      tx.run(
        "INSERT OR IGNORE INTO core_memory (persona, card_id, added_day, source) VALUES (?, ?, ?, ?)",
        input.persona,
        input.cardId,
        input.addedDay,
        input.source,
      ).changes > 0
    );
  }

  #removeOn(tx: Queryable, persona: string, cardId: string): boolean {
    return (
      tx.run("DELETE FROM core_memory WHERE persona = ? AND card_id = ?", persona, cardId).changes >
      0
    );
  }

  /** 90 天保留：清掉早於 `beforeDay` 的每日計數；回傳刪除筆數。 */
  deleteOldDaily(beforeDay: string): number {
    return this.#db.run("DELETE FROM core_memory_daily WHERE day < ?", beforeDay).changes;
  }

  /** 目前時間的日期鍵（UTC，與領域層 `coreDayKey` 一致）。 */
  today(persona: string): string {
    void persona;
    return this.#now().toISOString().slice(0, 10);
  }
}

function toEntry(row: CoreRow): CoreMemoryEntry {
  return {
    persona: row.persona,
    cardId: row.card_id,
    addedDay: row.added_day,
    source: row.source as CoreMemorySource,
  };
}

function toDaily(row: DailyRow): CoreMemoryDaily {
  return { persona: row.persona, day: row.day, changed: row.changed === 1 };
}
