/**
 * `device_tokens` 表的 SQLite 實作。
 *
 * 用狀態資料庫既有的連線；不擁有關閉責任，也不改 schema 版本。明文 Token
 * 不寫進資料庫：`token_hash` 是配對流程已經算好的雜湊，`prefix` 只用來給人
 * 辨認是哪一台裝置。
 *
 * `device_tokens` 沒有裝置種類欄位，而且不能加欄位（schema 版本不變），所以
 * 從資料庫讀出來的紀錄是 `unknown`。為了讓還沒重啟的主機繼續顯示種類，本
 * 實例會記住自己插入過的種類。
 */

import type { Database } from "../db.js";

import type { DeviceTokenStore, StoredDeviceKind, StoredDeviceToken } from "./store.js";

const COLUMNS =
  "id, token_hash, prefix, fingerprint, device_name, created_at, expires_at, revoked_at";

interface Row {
  readonly id: string;
  readonly token_hash: string;
  readonly prefix: string;
  readonly fingerprint: string;
  readonly device_name: string;
  readonly created_at: string;
  readonly expires_at: string | null;
  readonly revoked_at: string | null;
}

export class SqliteDeviceTokenStore implements DeviceTokenStore {
  readonly #db: Database;
  readonly #kinds = new Map<string, StoredDeviceKind>();

  constructor(database: Database) {
    this.#db = database;
  }

  async insert(record: StoredDeviceToken): Promise<void> {
    if (record.prefix === undefined || record.prefix.length === 0) {
      throw new Error(`裝置紀錄缺少顯示前綴：${record.deviceId}`);
    }
    try {
      this.#db.run(
        `INSERT INTO device_tokens
           (id, token_hash, prefix, fingerprint, device_name, created_at, expires_at, revoked_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        record.deviceId,
        record.tokenHash,
        record.prefix,
        record.fingerprint,
        record.deviceName,
        record.createdAt,
        record.expiresAt ?? null,
        record.revokedAt ?? null,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("device_tokens.id")) {
        throw new Error(`裝置已存在：${record.deviceId}`, { cause: error });
      }
      if (message.includes("device_tokens.token_hash")) {
        throw new Error(`裝置 Token 雜湊已存在：${record.deviceId}`, { cause: error });
      }
      throw error;
    }
    this.#kinds.set(record.deviceId, record.deviceKind);
  }

  async findByHash(tokenHash: string): Promise<StoredDeviceToken | undefined> {
    const row = this.#db.get<Row>(
      `SELECT ${COLUMNS} FROM device_tokens WHERE token_hash = ?`,
      tokenHash,
    );
    return row === undefined ? undefined : this.#toRecord(row);
  }

  async findById(deviceId: string): Promise<StoredDeviceToken | undefined> {
    const row = this.#rowById(deviceId);
    return row === undefined ? undefined : this.#toRecord(row);
  }

  async list(): Promise<readonly StoredDeviceToken[]> {
    return this.#db
      .all<Row>(`SELECT ${COLUMNS} FROM device_tokens ORDER BY created_at ASC, id ASC`)
      .map((row) => this.#toRecord(row));
  }

  async revoke(deviceId: string, now: string): Promise<StoredDeviceToken | undefined> {
    const existing = this.#rowById(deviceId);
    if (existing === undefined) {
      return undefined;
    }
    if (existing.revoked_at === null) {
      // 先讀再寫；`revoked_at IS NULL` 讓重複撤銷保留第一次的時間。
      this.#db.run(
        "UPDATE device_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        now,
        deviceId,
      );
    }
    const updated = this.#rowById(deviceId);
    return updated === undefined ? undefined : this.#toRecord(updated);
  }

  #rowById(deviceId: string): Row | undefined {
    return this.#db.get<Row>(`SELECT ${COLUMNS} FROM device_tokens WHERE id = ?`, deviceId);
  }

  #toRecord(row: Row): StoredDeviceToken {
    return {
      deviceId: row.id,
      tokenHash: row.token_hash,
      fingerprint: row.fingerprint,
      createdAt: row.created_at,
      ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
      ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
      deviceName: row.device_name,
      deviceKind: this.#kinds.get(row.id) ?? "unknown",
      prefix: row.prefix,
    };
  }
}
