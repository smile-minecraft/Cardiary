import type { ModuleManifest } from "@cardiary/module-api";

/** 模型與一般設定模組；模型設定由主機解析，金鑰不經過這個模組。 */
export const manifest: ModuleManifest = {
  id: "settings",
  name: "模型與設定",
  version: "1.0.0",
  description: "system.models.* 與 system.settings.*；提供 models 服務給其他模組。",
  hostApiVersion: "1",
  dependencies: [],
  permissions: [],
  settings: [],
};
