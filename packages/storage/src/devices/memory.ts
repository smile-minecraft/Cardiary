/**
 * 記憶體實作的裝置 Token 儲存。
 *
 * 用途：
 * - v3 遷移還沒有進 main 時，主機用它跑起配對流程與測試。
 * - 正式實作接上 `device_tokens` 表之前，重啟會讓所有已配對裝置失效，
 *   這是已知限制，寫在 PR 裡。
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
    };
    this.#byHash.set(revoked.tokenHash, revoked);
    this.#byId.set(deviceId, revoked);
    return revoked;
  }
}
