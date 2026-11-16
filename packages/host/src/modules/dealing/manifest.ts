import type { ModuleManifest } from "@cardiary/module-api";

/** 開局發牌；新對話第一則訊息把挑好的卡裝進第 4 層。 */
export const manifest: ModuleManifest = {
  id: "dealing",
  name: "開局發牌",
  version: "1.0.0",
  description:
    "新對話的第一則訊息以混合檢索取候選卡，由 System One 逐卡判斷相關性，依門檻與 token 預算把卡裝進上下文第 4 層。",
  hostApiVersion: "1",
  // `context` 已經硬性相依於 cards；這裡不再直接宣告 cards，避免停用 cards 時
  // 連鎖停用造成 diamond（dealing 被 deactivate 兩次）。啟用順序仍保證 cards 已活著。
  dependencies: [
    { moduleId: "context", versionRange: "^1.0.0" },
    { moduleId: "retrieval", versionRange: "^1.0.0" },
  ],
  permissions: ["cards:read", "model:invoke"],
  settings: [
    {
      key: "dealing.budgetTokens",
      title: "發牌 token 預算",
      description:
        "開局發牌最多裝入第 4 層的 token 數；核心記憶組不計入。預設 1500，可調範圍 500–3000。",
      kind: "number",
      level: "free",
      defaultValue: 1500,
      min: 500,
      max: 3000,
    },
  ],
};
