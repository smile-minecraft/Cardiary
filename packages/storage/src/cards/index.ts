/**
 * 卡片庫的儲存層。
 *
 * - `files`：`cards/` 正本區的原子寫入與掃描。
 * - `index-store`：`cache/index.sqlite` 的可重建索引。
 * - `asset-scan`：`cards/` 與 `assets/` 的掃描與原檔刪除規則，回收共用。
 * - `assets`：`assets/` 原檔的內容雜湊命名與引用計數。
 */
export * from "./asset-scan.js";
export * from "./assets.js";
export * from "./files.js";
export * from "./index-store.js";
