/**
 * 引擎的儲存與執行環境；由主機服務指定，轉接層不得自行決定。
 *
 * Pi Durable 的 SQLite 位置可以完全指定；但 `bash` 工具的大輸出會跟著
 * 子行程的 `TMPDIR` 走。轉接層要把 `TMPDIR` 指到 `tempDir`，
 * 主機服務負責在啟動時清空這個資料夾。
 */
export interface EngineEnvironment {
  /** 引擎狀態（SQLite 等）；屬於 Cardiary 的正本區。 */
  readonly stateDir: string;
  /** 引擎暫存；位於 Cardiary 的 tmp 區，啟動時清空。 */
  readonly tempDir: string;
  /** 工具預設的工作目錄。 */
  readonly defaultWorkingDir: string;
  /** 提供給工具子行程的 HOME；省略時沿用主機服務的環境。 */
  readonly homeDir?: string;
  /** 自訂 shell；省略時用引擎的預設值。 */
  readonly shellPath?: string;
  /** 額外環境變數；轉接層會再覆寫暫存相關變數。 */
  readonly env?: Readonly<Record<string, string>>;
}
