import type { ModuleManifest } from "@cardiary/module-api";

/** 每日蒸餾模組：提煉長久記憶、冷封存原卡、核心記憶組與逐項復原。 */
export const manifest: ModuleManifest = {
  id: "memory",
  name: "記憶蒸餾",
  version: "1.0.0",
  description: "每日蒸餾歸零卡片為長久記憶、維護核心記憶組、產生可復原的每日摘要。",
  hostApiVersion: "1",
  dependencies: [
    { moduleId: "cards", versionRange: "^1.0.0" },
    { moduleId: "context", versionRange: "^1.0.0", optional: true },
  ],
  permissions: ["cards:read", "cards:write", "model:invoke", "notifications:emit", "storage:maintain"],
  settings: [
    {
      key: "distillation.time",
      title: "每日蒸餾時間",
      description: "每日蒸餾觸發的當地時間（HH:MM）；預設 04:00。",
      kind: "string",
      level: "free",
      defaultValue: "04:00",
    },
    {
      key: "core.tokenBudget",
      title: "核心記憶 token 預算",
      description: "核心記憶組約可佔用的 token 上限；可調 400–1,500，預設 800。",
      kind: "number",
      level: "free",
      defaultValue: 800,
      min: 400,
      max: 1500,
    },
  ],
};
