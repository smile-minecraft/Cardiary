/**
 * 遠端存取的設定鍵與判斷。
 *
 * 設定頁的開關寫入 `remote.accessEnabled`（human-only，預設 false）；
 * 閘道在配對、裝置 Token 認證與每個裝置請求前讀取當下值，
 * 所以切換會立刻生效，不必重啟服務。
 */
export const REMOTE_ACCESS_SETTING_KEY = "remote.accessEnabled";

/** 只需要讀單一設定值的來源；正式的儲存與測試替身都符合。 */
export interface RemoteAccessSettingSource {
  get(key: string): { readonly value: string } | null;
}

/** 讀取遠端存取開關；沒有資料列或值不是 true 都視為關閉。 */
export function isRemoteAccessEnabled(source: RemoteAccessSettingSource): boolean {
  const record = source.get(REMOTE_ACCESS_SETTING_KEY);
  if (record === null) return false;
  try {
    return JSON.parse(record.value) === true;
  } catch {
    return false;
  }
}

/**
 * 判斷 TCP 對端位址是否為 loopback。
 *
 * 閘道只綁 `127.0.0.1`，所以正常情況下來源一定是 loopback；
 * 這個檢查是額外的防線，避免未來誤綁其他介面時把遠端存取暴露出去。
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  if (address === "::1") return true;
  if (address.startsWith("::ffff:")) return isLoopbackAddress(address.slice("::ffff:".length));
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address);
}
