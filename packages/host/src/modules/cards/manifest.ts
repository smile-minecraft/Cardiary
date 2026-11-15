import type { ModuleManifest } from "@cardiary/module-api";

/** 卡片庫模組；第一方模組與主機同一個行程。 */
export const manifest: ModuleManifest = {
  id: "cards",
  name: "卡片庫",
  version: "1.0.0",
  description: "卡片是資料夾裡的 Markdown 檔；提供 card.* 協定、卡片工具與外部編輯的重新索引。",
  hostApiVersion: "1",
  dependencies: [],
  permissions: ["cards:read", "cards:write"],
  settings: [],
};
