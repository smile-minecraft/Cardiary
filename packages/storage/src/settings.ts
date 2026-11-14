import type { Database, Queryable } from "./db.js";
import { nowIso } from "./util.js";

/** 規格書第 11 章的三級設定。 */
export type SettingLevel = "free" | "approval" | "human-only";

export interface SettingRecord {
  readonly key: string;
  readonly value: string;
  readonly level: SettingLevel;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

interface SettingRow {
  readonly key: string;
  readonly value: string;
  readonly level: string;
  readonly updated_at: string;
  readonly updated_by: string;
}

export interface SetSettingInput {
  readonly key: string;
  readonly value: string;
  readonly level: SettingLevel;
  readonly updatedBy: string;
  readonly approvalId?: string;
  readonly now?: string;
}

export interface SettingDefault {
  readonly key: string;
  readonly value: string;
  readonly level: SettingLevel;
}

/** 可調參數的預設值；第一次啟動寫進 `settings`，之後以表為準。 */
export const DEFAULT_SETTINGS: readonly SettingDefault[] = [
  { key: "freshness.halfLifeDays", value: "30", level: "free" },
  { key: "conversation.archiveCountdownDays", value: "7", level: "free" },
  { key: "storage.cacheLimitBytes", value: String(2 * 1024 * 1024 * 1024), level: "free" },
  { key: "storage.logMaxBytes", value: String(50 * 1024 * 1024), level: "free" },
  { key: "storage.logRetainDays", value: "7", level: "free" },
  { key: "storage.retainDays", value: "30", level: "free" },
];

/** `settings` 與 `setting_changes` 的存取；代理的過濾在介面層，不在這裡。 */
export class SettingsStore {
  readonly #db: Database;
  readonly #now: () => Date;

  constructor(db: Database, options: { readonly now?: () => Date } = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
  }

  get(key: string): SettingRecord | null {
    const row = this.#db.get<SettingRow>("SELECT * FROM settings WHERE key = ?", key);
    return row === undefined ? null : rowToRecord(row);
  }

  list(): SettingRecord[] {
    return this.#db.all<SettingRow>("SELECT * FROM settings ORDER BY key").map(rowToRecord);
  }

  /** 寫入設定並在 `setting_changes` 留下變更紀錄。 */
  set(input: SetSettingInput, tx?: Queryable): SettingRecord {
    const now = input.now ?? nowIso(this.#now);
    const target = tx ?? this.#db;
    const apply = (): void => {
      const previous = target.get<SettingRow>("SELECT * FROM settings WHERE key = ?", input.key);
      target.run(
        `INSERT INTO settings (key, value, level, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           value = excluded.value,
           level = excluded.level,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
        input.key,
        input.value,
        input.level,
        now,
        input.updatedBy,
      );
      target.run(
        `INSERT INTO setting_changes (key, old_value, new_value, level, actor, approval_id, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        input.key,
        previous?.value ?? null,
        input.value,
        input.level,
        input.updatedBy,
        input.approvalId ?? null,
        now,
      );
    };
    if (tx === undefined) {
      this.#db.transaction(apply);
    } else {
      apply();
    }
    const record = this.get(input.key);
    if (record === null) {
      throw new Error(`settings 寫入後找不到 ${input.key}`);
    }
    return record;
  }

  /** 只補缺少的預設值，不覆寫使用者改過的值。 */
  seedDefaults(defaults: readonly SettingDefault[] = DEFAULT_SETTINGS): number {
    let inserted = 0;
    this.#db.transaction((tx) => {
      for (const entry of defaults) {
        const existing = tx.get<{ key: string }>(
          "SELECT key FROM settings WHERE key = ?",
          entry.key,
        );
        if (existing !== undefined) {
          continue;
        }
        tx.run(
          "INSERT INTO settings (key, value, level, updated_at, updated_by) VALUES (?, ?, ?, ?, 'system')",
          entry.key,
          entry.value,
          entry.level,
          nowIso(this.#now),
        );
        inserted += 1;
      }
    });
    return inserted;
  }

  /** 診斷：變更紀錄筆數。 */
  changeCount(): number {
    const row = this.#db.get<{ n: number }>("SELECT COUNT(*) AS n FROM setting_changes");
    return Number(row?.n ?? 0);
  }
}

function rowToRecord(row: SettingRow): SettingRecord {
  return {
    key: row.key,
    value: row.value,
    level: row.level as SettingLevel,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}
