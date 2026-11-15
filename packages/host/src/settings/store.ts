import type { Database, SettingsStore } from "@cardiary/storage";

import type { SettingsRecord, SettingsStoreLike, StoreSettingInput } from "./service.js";

/**
 * 把儲存層的 `SettingsStore` 接成 `SettingsService` 的介面。
 *
 * 單筆 `set` 沿用儲存層自己的交易；`setMany` 用同一個資料庫交易寫多鍵，
 * 任何一筆失敗都整批回滾，不會留下半套模型設定。變更紀錄
 * （`setting_changes`）也在同一個交易裡。
 */
export class TransactionalSettingsStore implements SettingsStoreLike {
  readonly #db: Database;
  readonly #store: SettingsStore;

  constructor(db: Database, store: SettingsStore) {
    this.#db = db;
    this.#store = store;
  }

  get(key: string): SettingsRecord | null {
    return this.#store.get(key);
  }

  list(): SettingsRecord[] {
    return this.#store.list();
  }

  set(input: StoreSettingInput): SettingsRecord {
    return this.#store.set(input);
  }

  setMany(inputs: readonly StoreSettingInput[]): SettingsRecord[] {
    return this.#db.transaction((tx) => inputs.map((input) => this.#store.set(input, tx)));
  }
}
