import type { ModuleManifest } from "@cardiary/module-api";

/** 多模態模組；圖片與音訊匯入、原檔 HTTP 與翻牌。 */
export const manifest: ModuleManifest = {
  id: "media",
  name: "多模態",
  version: "1.0.0",
  description:
    "圖片與音訊匯入成卡片：原檔以內容雜湊存進 assets/，文字替身放進卡片內文，代理翻牌才載入原檔。",
  hostApiVersion: "1",
  dependencies: [{ moduleId: "cards", versionRange: "^1.0.0" }],
  permissions: ["cards:read", "cards:write", "files:read", "files:write", "model:invoke"],
  settings: [],
};
