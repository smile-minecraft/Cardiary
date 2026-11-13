import type { JsonValue } from "./json.js";

/** 取消訂閱或釋放資源。 */
export type Unsubscribe = () => void;

/** 時間來源；測試時可換成假時鐘，讓逾時與排程不是真的等待。 */
export interface Clock {
  now(): Date;
}

/** 轉接層的日誌介面；由主機服務提供實作，轉接層不自行決定輸出位置。 */
export interface EngineLogger {
  debug(message: string, fields?: { readonly [key: string]: JsonValue }): void;
  info(message: string, fields?: { readonly [key: string]: JsonValue }): void;
  warn(message: string, fields?: { readonly [key: string]: JsonValue }): void;
  error(message: string, fields?: { readonly [key: string]: JsonValue }): void;
}
