/**
 * 權限判斷的領域核心。
 *
 * 純函式、不依賴引擎型別；精確定義見 `docs/design/permissions.md`。
 * 順序固定是「永遠禁止 → 自動放行 → 一律詢問」；`deny` 不會被白名單
 * 或任何權限模式推翻。
 */

export * from "./types.js";
export * from "./rules.js";
export * from "./paths.js";
export * from "./credentials.js";
export * from "./fs-rules.js";
export * from "./getopt.js";
export * from "./capabilities.js";
export * from "./commands.js";
export * from "./evaluate.js";
export * from "./delegation.js";
export * from "./domains.js";
