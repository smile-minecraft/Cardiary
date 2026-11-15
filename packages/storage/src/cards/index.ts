/**
 * 卡片庫的儲存層。
 *
 * - `files`：`cards/` 正本區的原子寫入與掃描。
 * - `index-store`：`cache/index.sqlite` 的可重建索引。
 * - `assets`：`assets/` 原檔的內容雜湊命名與引用計數。
 */
export * from "./assets.js";
export * from "./files.js";
export * from "./index-store.js";
