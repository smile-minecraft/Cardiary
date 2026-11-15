import { mkdirSync } from "node:fs";

import {
  Database,
  FolderLayout,
  SettingsStore,
  openCacheDatabase,
  openStateDatabase,
} from "@cardiary/storage";

import type { CardEnvironment } from "../contract.js";
import type { PersistentStorage } from "../../storage/persistent.js";

/**
 * 卡片模組的儲存接線。
 *
 * 產品組裝直接共用 `PersistentStorage` 已經開好的狀態庫與快取；記憶體組裝
 * （契約測試、主機單元測試）另外開一份，讓 `cards/` 仍然是真實檔案，卡片
 * 索引與 `card_state` 也能真的落地。兩者的差別只有「誰負責關連線」。
 */

/** 產品組裝：狀態庫、快取與設定都由儲存層擁有。 */
export function persistentCardEnvironment(persistent: PersistentStorage): CardEnvironment {
  const storage = persistent.storage;
  return {
    layout: storage.layout,
    get state(): Database {
      return storage.state;
    },
    cache: () => storage.cache,
    get settings(): SettingsStore {
      return storage.settings;
    },
    ownsConnections: false,
    close: () => {
      // 連線由儲存層在暫停與關機時處理。
    },
  };
}

/**
 * 記憶體組裝：延後開啟 `state/cardiary.sqlite` 與 `cache/index.sqlite`。
 *
 * 只有卡片模組真的被載入並使用時才開檔，沒有模組的測試資料夾不會多出
 * 資料庫。關機時由 `bootstrap` 呼叫 `close()`。
 */
export class EphemeralCardEnvironment implements CardEnvironment {
  readonly layout: FolderLayout;
  readonly ownsConnections = true;
  readonly #now: () => Date;
  readonly #trace: ((operation: string) => void) | undefined;
  #state: Database | null = null;
  #cache: Database | null = null;
  #settings: SettingsStore | null = null;

  constructor(
    layout: FolderLayout,
    options: { readonly now?: () => Date; readonly trace?: (operation: string) => void } = {},
  ) {
    this.layout = layout;
    this.#now = options.now ?? (() => new Date());
    this.#trace = options.trace;
  }

  get state(): Database {
    return this.#openState();
  }

  cache(): Database {
    return this.#openCache();
  }

  get settings(): SettingsStore {
    this.#openState();
    // #openState 一定會建立 settings。
    return this.#settings as SettingsStore;
  }

  close(): void {
    const cache = this.#cache;
    const state = this.#state;
    this.#cache = null;
    this.#state = null;
    this.#settings = null;
    for (const database of [cache, state]) {
      if (database === null || database.isClosed) continue;
      try {
        database.checkpoint();
      } catch {
        // 快取與測試用的狀態庫可以重建；checkpoint 失敗不阻擋關閉。
      }
      database.close();
    }
  }

  #openState(): Database {
    if (this.#state !== null && !this.#state.isClosed) {
      return this.#state;
    }
    mkdirSync(this.layout.subfolderPath("state"), { recursive: true });
    mkdirSync(this.layout.subfolderPath("tmp"), { recursive: true });
    const handle = openStateDatabase({
      filePath: this.layout.absolute("state/cardiary.sqlite"),
      appVersion: "0.1.0",
      backupDirectory: this.layout.subfolderPath("tmp"),
      now: this.#now,
      layout: this.layout,
      ...(this.#trace === undefined ? {} : { trace: this.#trace }),
    });
    this.#state = handle.db;
    this.#settings = new SettingsStore(handle.db, { now: this.#now });
    return handle.db;
  }

  #openCache(): Database {
    if (this.#cache !== null && !this.#cache.isClosed) {
      return this.#cache;
    }
    mkdirSync(this.layout.subfolderPath("cache"), { recursive: true });
    const handle = openCacheDatabase({
      filePath: this.layout.absolute("cache/index.sqlite"),
      layout: this.layout,
      now: this.#now,
      ...(this.#trace === undefined ? {} : { trace: this.#trace }),
    });
    this.#cache = handle.db;
    return handle.db;
  }
}
