import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Harness, createRegistry, type Registry } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import {
  NodeSqliteDatabase,
  openNodeSqliteDatabase,
} from "@earendil-works/pi-durable/storage/sqlite/node";

import type { EngineEnvironment } from "../environment.js";
import { engineError } from "./errors.js";

/** 引擎資料庫的檔名；`stateDir` 底下固定這一個。 */
export const ENGINE_DATABASE_FILE = "engine.sqlite";

/** 引擎的儲存與 Harness；`suspend()`／`resume()` 共用同一個入口。 */
export class EngineSession {
  readonly #environment: EngineEnvironment;
  readonly #registry: Registry;
  readonly #models: () => unknown;
  #database: NodeSqliteDatabase | null = null;
  #harness: Harness | null = null;

  constructor(options: {
    readonly environment: EngineEnvironment;
    readonly registry: Registry;
    /**
     * 目前的模型集合；Harness 每次請求都重新讀，換模型不必重開。
     * 回傳值是引擎的模型集合，只在轉接層內部使用。
     */
    readonly models: () => unknown;
  }) {
    this.#environment = options.environment;
    this.#registry = options.registry;
    this.#models = options.models;
  }

  get databasePath(): string {
    return join(resolve(this.#environment.stateDir), ENGINE_DATABASE_FILE);
  }

  get database(): NodeSqliteDatabase {
    if (this.#database === null) {
      throw engineError("engine-closed", "引擎資料庫尚未開啟");
    }
    return this.#database;
  }

  get harness(): Harness {
    if (this.#harness === null) {
      throw engineError("engine-closed", "引擎尚未開啟");
    }
    return this.#harness;
  }

  get isOpen(): boolean {
    return this.#harness !== null;
  }

  /** Harness 使用的註冊表；轉接層在這裡安裝各 generation 的擴充。 */
  get registry(): Registry {
    return this.#registry;
  }

  /** 開檔案、套用 `secure_delete`、開 Harness。重複呼叫回傳同一個 Harness。 */
  async open(): Promise<Harness> {
    if (this.#harness !== null) {
      return this.#harness;
    }
    await mkdir(resolve(this.#environment.stateDir), { recursive: true });
    const database = await openNodeSqliteDatabase(this.databasePath, { busyTimeoutMs: 5000 });
    // secure_delete 是連線設定，不會寫進檔案；suspend/resume 重開時要重新套用。
    await database.exec("PRAGMA secure_delete = ON");
    const row = await database.get<{ secure_delete: number }>("PRAGMA secure_delete");
    if (row?.secure_delete !== 1) {
      await database.close();
      throw engineError("storage-unavailable", "引擎連線沒有套用 secure_delete=ON");
    }
    const storage = await SqliteStorage.open(database);
    this.#database = database;
    this.#harness = await Harness.open(
      storage,
      {
        models: () => this.#models() as never,
        registry: this.#registry,
      },
      BACKGROUND_CONTEXT,
    );
    return this.#harness;
  }

  /** checkpoint 後關閉 Harness 與連線；不刪任何資料。 */
  async close(): Promise<void> {
    const harness = this.#harness;
    const database = this.#database;
    this.#harness = null;
    this.#database = null;
    if (harness !== null) {
      try {
        await harness.close(BACKGROUND_CONTEXT);
      } catch {
        // close 失敗時仍要關掉連線，避免檔案被鎖住。
      }
    }
    if (database !== null) {
      try {
        await database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch {
        // 唯讀或已關閉的連線不做 checkpoint。
      }
      await database.close();
    }
  }

  /** 用引擎的連線執行一段 SQL；Harness 必須已關閉。 */
  async withRawDatabase<T>(body: (database: NodeSqliteDatabase) => Promise<T>): Promise<T> {
    const database = await openNodeSqliteDatabase(this.databasePath, { busyTimeoutMs: 5000 });
    try {
      await database.exec("PRAGMA secure_delete = ON");
      return await body(database);
    } finally {
      await database.close();
    }
  }
}

/** 建立給 Harness 用的空註冊表；轉接層之後安裝各 generation 的擴充。 */
export function createEngineRegistry(): Registry {
  return createRegistry();
}

/** 在背景脈絡下讀檔案；測試與工具共用。 */
export const ENGINE_CONTEXT = BACKGROUND_CONTEXT;
