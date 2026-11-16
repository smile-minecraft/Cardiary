/**
 * 裝置 Token 的儲存介面。
 *
 * v3 遷移（排程工作）才會建立 `device_tokens` 表；在那之前主機用
 * `MemoryDeviceTokenStore`，重啟後裝置需要重新配對。介面刻意保持非同步，
 * 正式實作換成 SQLite 時呼叫端不必改。
 *
 * 明文 Token 絕對不落地：這張表只放雜湊與顯示用的指紋。
 */

import type { DeviceTokenRecord } from "@cardiary/domain";

export const DEVICE_KINDS = ["web", "ios"] as const;
export type StoredDeviceKind = (typeof DEVICE_KINDS)[number];

/** 存進狀態資料庫的裝置紀錄；不含明文 Token。 */
export interface StoredDeviceToken extends DeviceTokenRecord {
  /** 使用者在配對當下看到的名稱；只供顯示。 */
  readonly deviceName: string;
  readonly deviceKind: StoredDeviceKind;
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
