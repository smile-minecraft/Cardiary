/**
 * 領域核心的公開入口。
 *
 * M1 的五個領域自各自的實作工作填入行為；M2 的領域（目前是遠端配對）由
 * 對應的實作工作加進來，公開出口仍然只有這個 barrel，跨套件的匯入一律走
 * `@cardiary/domain`。
 */

export * from "./cards/index.js";
export * from "./boards/index.js";
export * from "./context/index.js";
export * from "./dealing/index.js";
export * from "./emotion/index.js";
export * from "./distillation/index.js";
export * from "./documents/index.js";
export * from "./freshness/index.js";
export * from "./media/index.js";
export * from "./pairing/index.js";
export * from "./schedules/index.js";
export * from "./permissions/index.js";
export * from "./retrieval/index.js";
export * from "./system-one/index.js";
