/**
 * 遠端配對的共用堆疊：裝置 Token 儲存、配對請求代管、現在時間與殼的通知。
 *
 * 閘道預設自己建一份記憶體版；產品組裝在 `startHost` 換上狀態資料庫的
 * `SqliteDeviceTokenStore`，重啟後已配對裝置仍然有效。殼的組合根可以經
 * `gateway.remote` 接上 `notifyPairingRequested`，讓配對請求送到殼顯示
 * 核准視窗。
 */

import { MemoryDeviceTokenStore, type DeviceTokenStore } from "@cardiary/storage";

import { PairingRegistry, type PairingNotice } from "./pairings.js";

export interface RemoteStack {
  readonly devices: DeviceTokenStore;
  readonly pairings: PairingRegistry;
  /** RFC 3339 現在時間；測試可以換掉。 */
  now(): string;
  /**
   * 配對請求通知殼的出口；殼還沒接上時是 `undefined`。
   *
   * 送不出去不影響配對流程本身，請求會留在待處理直到過期。
   */
  notifyPairingRequested?: ((notice: PairingNotice) => void) | undefined;
}

export function createRemoteStack(overrides?: {
  readonly devices?: DeviceTokenStore;
  readonly pairings?: PairingRegistry;
  readonly now?: () => string;
}): RemoteStack {
  return {
    devices: overrides?.devices ?? new MemoryDeviceTokenStore(),
    pairings: overrides?.pairings ?? new PairingRegistry(),
    now: overrides?.now ?? (() => new Date().toISOString()),
    notifyPairingRequested: undefined,
  };
}
