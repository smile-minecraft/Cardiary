import type { ModuleManifest } from "@cardiary/module-api";

/** 匯入模組；來源轉接器與 `module.import.*`。 */
export const manifest: ModuleManifest = {
  id: "import",
  name: "匯入",
  version: "1.0.0",
  description:
    "從通用資料夾、Hermes 與 Alma 匯入人格、記憶與對話：先預覽、逐項勾選、寫成卡片，重跑同一來源不會重複。",
  hostApiVersion: "1",
  dependencies: [{ moduleId: "cards", versionRange: "^1.0.0" }],
  permissions: ["cards:read", "cards:write", "files:read", "files:write", "model:invoke"],
  settings: [],
};
