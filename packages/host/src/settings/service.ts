import type { JSONValue, SettingItem, SettingLevel } from "@cardiary/protocol";

import {
  defaultSettingItem,
  settingDefinition,
  settingLevel,
  SETTING_DEFINITIONS,
} from "./catalog.js";

/**
 * 一般設定的讀寫。
 *
 * 值的權威是 `state/cardiary.sqlite` 的 `settings`；這裡只負責 JSON 轉換、
 * 分級與變更通知。寫入由儲存層的 `SettingsStore.set` 在同一個交易寫
 * `setting_changes`，金鑰不是設定值，也不會經過這裡。
 */

export interface SettingsRecord {
  readonly key: string;
  readonly value: string;
  readonly level: SettingLevel;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/** 儲存層 `SettingsStore` 的最小介面；測試可以給記憶體替身。 */
export interface SettingsStoreLike {
  get(key: string): SettingsRecord | null;
  list(): SettingsRecord[];
  set(input: StoreSettingInput): SettingsRecord;
  /**
   * 同一個交易寫多筆設定，任何一筆失敗都不生效。
   *
   * 兩鍵一組的模型設定（供應商與角色）靠這個方法保持原子；正式組裝由
   * `TransactionalSettingsStore` 用儲存層的交易實作。
   */
  setMany(inputs: readonly StoreSettingInput[]): SettingsRecord[];
}

/** 寫進儲存層的一筆設定；值已經轉成 JSON 字串。 */
export interface StoreSettingInput {
  readonly key: string;
  readonly value: string;
  readonly level: SettingLevel;
  readonly updatedBy: string;
}

/** 一次設定寫入；`level` 沒給時照目錄分級。 */
export interface SetSettingInput {
  readonly key: string;
  readonly value: JSONValue;
  readonly actor: string;
  readonly level?: SettingLevel;
}

export interface SettingsServiceOptions {
  readonly now?: () => Date;
  readonly updatedBy?: string;
}

export interface SetSettingResult {
  readonly item: SettingItem;
  readonly previous: JSONValue | undefined;
  readonly changedAt: string;
}

export class SettingsService {
  readonly #store: SettingsStoreLike;
  readonly #now: () => Date;
  readonly #updatedBy: string;
  readonly #listeners = new Set<(change: SettingsChange) => void>();

  constructor(store: SettingsStoreLike, options: SettingsServiceOptions = {}) {
    this.#store = store;
    this.#now = options.now ?? (() => new Date());
    this.#updatedBy = options.updatedBy ?? "system";
  }

  get(key: string): JSONValue | undefined {
    const record = this.#store.get(key);
    if (record === null) {
      return this.#defaultOf(key);
    }
    return parseValue(record.value);
  }

  getNumber(key: string, fallback: number): number {
    const value = this.get(key);
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  record(key: string): SettingsRecord | null {
    return this.#store.get(key);
  }

  list(): SettingItem[] {
    const items = new Map<string, SettingItem>();
    for (const record of this.#store.list()) {
      items.set(record.key, {
        key: record.key,
        value: parseValue(record.value),
        level: settingLevel(record.key, record.level),
        ...titleOf(record.key),
        updatedAt: record.updatedAt,
      });
    }
    for (const definition of SETTING_DEFINITIONS) {
      if (items.has(definition.key) || definition.defaultValue === undefined) continue;
      items.set(definition.key, defaultSettingItem(definition, this.#now().toISOString()));
    }
    return [...items.values()].sort((left, right) => left.key.localeCompare(right.key));
  }

  /** 寫入一筆設定；`actor` 是 `user:<deviceId>` 或 `agent:<conversationId>`。 */
  set(input: SetSettingInput): SetSettingResult {
    const previous = this.get(input.key);
    const record = this.#store.set(this.#storeInput(input));
    return this.#applied(record, previous);
  }

  /**
   * 同一個交易寫多筆設定。
   *
   * 一筆失敗就整批不生效；變更通知在寫入全部成功之後才送，監聽者不會
   * 看到半套狀態。
   */
  setMany(inputs: readonly SetSettingInput[]): SetSettingResult[] {
    if (inputs.length === 0) {
      return [];
    }
    const prepared = inputs.map((input) => ({
      previous: this.get(input.key),
      input: this.#storeInput(input),
    }));
    const records = this.#store.setMany(prepared.map((entry) => entry.input));
    if (records.length !== prepared.length) {
      throw new Error(`設定儲存回傳 ${records.length} 筆，預期 ${prepared.length} 筆`);
    }
    return prepared.map((entry, index) => {
      const record = records[index];
      if (record === undefined) {
        throw new Error(`設定儲存缺少第 ${index} 筆結果`);
      }
      return this.#applied(record, entry.previous);
    });
  }

  #storeInput(input: SetSettingInput): StoreSettingInput {
    const definition = settingDefinition(input.key);
    return {
      key: input.key,
      value: JSON.stringify(input.value),
      level: input.level ?? definition?.level ?? "human-only",
      updatedBy: input.actor.length > 0 ? input.actor : this.#updatedBy,
    };
  }

  /** 把一筆已寫入的紀錄轉成結果，並通知監聽者。 */
  #applied(record: SettingsRecord, previous: JSONValue | undefined): SetSettingResult {
    const item: SettingItem = {
      key: record.key,
      value: parseValue(record.value),
      level: settingLevel(record.key, record.level),
      ...titleOf(record.key),
      updatedAt: record.updatedAt,
    };
    const change: SettingsChange = {
      item,
      previous,
      changedAt: record.updatedAt,
      changedBy: record.updatedBy,
    };
    for (const listener of [...this.#listeners]) {
      try {
        listener(change);
      } catch {
        // 監聽者的錯誤不影響寫入結果。
      }
    }
    return { item, previous, changedAt: record.updatedAt };
  }

  onChange(listener: (change: SettingsChange) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #defaultOf(key: string): JSONValue | undefined {
    const definition = settingDefinition(key);
    return definition?.defaultValue as JSONValue | undefined;
  }
}

export interface SettingsChange {
  readonly item: SettingItem;
  readonly previous: JSONValue | undefined;
  readonly changedAt: string;
  readonly changedBy: string;
}

function parseValue(raw: string): JSONValue {
  try {
    return JSON.parse(raw) as JSONValue;
  } catch {
    // 壞掉的設定值原樣顯示，不讓介面因此看不到這一列。
    return raw;
  }
}

function titleOf(key: string): { readonly title?: string; readonly description?: string } {
  const definition = settingDefinition(key);
  if (definition === undefined) return {};
  return {
    title: definition.title,
    ...(definition.description === undefined ? {} : { description: definition.description }),
  };
}
