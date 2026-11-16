/**
 * 領域核心的公開入口。
 *
 * 每個 M1 領域各有一個子目錄；由各自的實作工作填入行為，這個 barrel 不再
 * 變動。跨套件的匯入一律走 `@cardiary/domain`。
 */

export * from "./cards/index.js";
export * from "./context/index.js";
export * from "./dealing/index.js";
export * from "./distillation/index.js";
export * from "./freshness/index.js";
export * from "./media/index.js";
export * from "./permissions/index.js";
export * from "./retrieval/index.js";
export * from "./system-one/index.js";
