/**
 * 記憶體實作的裝置 Token 儲存。
 *
 * 用途：
 * - 沒有狀態資料庫的組裝（例如 `assembly: "fake"` 的測試）。
 * - `storage` 由呼叫端注入、沒有持久資料庫時，閘道的預設值。
 *
 * 正式組裝使用 `SqliteDeviceTokenStore`；重啟後裝置仍然有效。
 */

import { revokeDeviceToken } from "@cardiary/domain";

import type { DeviceTokenStore, StoredDeviceToken } from "./store.js";

export class MemoryDeviceTokenStore implements DeviceTokenStore {
  readonly #byHash = new Map<string, StoredDeviceToken>();
  readonly #byId = new Map<string, StoredDeviceToken>();

  async insert(record: StoredDeviceToken): Promise<void> {
    if (this.#byId.has(record.deviceId)) {
      throw new Error(`裝置已存在：${record.deviceId}`);
    }
    this.#byHash.set(record.tokenHash, record);
    this.#byId.set(record.deviceId, record);
  }

  async findByHash(tokenHash: string): Promise<StoredDeviceToken | undefined> {
    return this.#byHash.get(tokenHash);
  }

  async findById(deviceId: string): Promise<StoredDeviceToken | undefined> {
    return this.#byId.get(deviceId);
  }

  async list(): Promise<readonly StoredDeviceToken[]> {
    return [...this.#byId.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  async revoke(deviceId: string, now: string): Promise<StoredDeviceToken | undefined> {
    const record = this.#byId.get(deviceId);
    if (!record) return undefined;
    const revoked: StoredDeviceToken = {
      ...revokeDeviceToken(record, now),
      deviceName: record.deviceName,
      deviceKind: record.deviceKind,
      ...(record.prefix === undefined ? {} : { prefix: record.prefix }),
    };
    this.#byHash.set(revoked.tokenHash, revoked);
    this.#byId.set(deviceId, revoked);
    return revoked;
  }
}
