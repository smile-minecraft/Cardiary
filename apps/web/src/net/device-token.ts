/**
 * 裝置 Token 的儲存。
 *
 * 預設放 sessionStorage（關閉分頁就消失）；使用者勾「記住這個裝置」時才放
 * localStorage。兩個地方同時只會放一把 Token；登出會清掉兩邊。
 * Token 明文只活在瀏覽器儲存與 `system.hello` 的 payload 裡，不進 URL、
 * 不進 console、不進剪貼簿。
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DEVICE_TOKEN_KEY = "cardiary.deviceToken";
const INSTANCE_ID_KEY = "cardiary.instanceId";

export class DeviceTokenStore {
  readonly #session: KeyValueStorage;
  readonly #local: KeyValueStorage;

  constructor(session: KeyValueStorage, local: KeyValueStorage) {
    this.#session = session;
    this.#local = local;
  }

  /** 存 Token；記住裝置走 localStorage，否則 sessionStorage。另一邊一律清掉。 */
  save(token: string, remember: boolean): void {
    this.#session.removeItem(DEVICE_TOKEN_KEY);
    this.#local.removeItem(DEVICE_TOKEN_KEY);
    (remember ? this.#local : this.#session).setItem(DEVICE_TOKEN_KEY, token);
  }

  /** 讀 Token；localStorage 優先，沒有再看 sessionStorage。 */
  load(): string | null {
    return this.#local.getItem(DEVICE_TOKEN_KEY) ?? this.#session.getItem(DEVICE_TOKEN_KEY);
  }

  /** 登出：兩邊都清。 */
  clear(): void {
    this.#session.removeItem(DEVICE_TOKEN_KEY);
    this.#local.removeItem(DEVICE_TOKEN_KEY);
  }

  /**
   * 這次安裝穩定的隨機識別碼；只用於區分客戶端，不含個人資料。
   * 一律放 localStorage，讓重連時是同一個身分。
   */
  instanceId(randomUUID: () => string): string {
    const stored = this.#local.getItem(INSTANCE_ID_KEY);
    if (stored) return stored;
    const created = randomUUID();
    try {
      this.#local.setItem(INSTANCE_ID_KEY, created);
    } catch {
      // 寫不進去就用這次的值；重連會換一把新的，只影響區分，不影響功能。
    }
    return created;
  }
}

function storageOrThrow(name: "sessionStorage" | "localStorage"): KeyValueStorage {
  const storage = globalThis[name];
  if (!storage) {
    // 瀏覽器一定會有；測試環境用 DeviceTokenStore 自己注入替身。
    throw new Error(`找不到 ${name}`);
  }
  return storage;
}

/** 建立預設的 Token 儲存；瀏覽器環境呼叫。 */
export function defaultDeviceTokenStore(): DeviceTokenStore {
  return new DeviceTokenStore(storageOrThrow("sessionStorage"), storageOrThrow("localStorage"));
}
