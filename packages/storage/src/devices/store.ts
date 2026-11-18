/**
 * 裝置 Token 的儲存介面。
 *
 * 狀態資料庫從 v3 起有 `device_tokens` 表；正式組裝用
 * `SqliteDeviceTokenStore`，沒有狀態資料庫的組裝與測試用
 * `MemoryDeviceTokenStore`。介面刻意保持非同步，呼叫端不必知道背後是
 * 哪一種。
 *
 * 明文 Token 絕對不落地：這張表只放雜湊與 8 碼顯示前綴（`cdt_` 加八碼，
 * 推不回 Token，只給人辨認），不含明文。
 */

import type { DeviceTokenRecord } from "@cardiary/domain";

export const DEVICE_KINDS = ["web", "ios"] as const;
/** 裝置種類；從狀態資料庫讀回時可能是 `unknown`（資料表沒有種類欄位）。 */
export type StoredDeviceKind = (typeof DEVICE_KINDS)[number] | "unknown";

/** 存進狀態資料庫的裝置紀錄；不含明文 Token。 */
export interface StoredDeviceToken extends DeviceTokenRecord {
  /** 使用者在配對當下看到的名稱；只供顯示。 */
  readonly deviceName: string;
  readonly deviceKind: StoredDeviceKind;
  /** 顯示用前綴（`cdt_` 加八碼）；推不回 Token，只給人辨認。 */
  readonly prefix?: string;
}

export interface DeviceTokenStore {
  /** 新裝置；`deviceId` 重複時拋 `Error`。 */
  insert(record: StoredDeviceToken): Promise<void>;
  findByHash(tokenHash: string): Promise<StoredDeviceToken | undefined>;
  findById(deviceId: string): Promise<StoredDeviceToken | undefined>;
  /** 依建立時間由舊到新。 */
  list(): Promise<readonly StoredDeviceToken[]>;
  /**
   * 撤銷裝置；已撤銷的紀錄原樣回傳（重複撤銷是安全的）。
   * 找不到時回 `undefined`。
   */
  revoke(deviceId: string, now: string): Promise<StoredDeviceToken | undefined>;
}
