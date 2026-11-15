import type { ModuleManifest } from "@cardiary/module-api";

/** 對話生命週期；封存與刪除的協定訊息掛在 `session` 命名空間。 */
export const manifest: ModuleManifest = {
  id: "lifecycle",
  name: "對話生命週期",
  version: "1.0.0",
  description: "封存倒數、取消封存、摘要與刪除對話；專屬卡片與原檔的連帶清理。",
  hostApiVersion: "1",
  dependencies: [{ moduleId: "cards", versionRange: "^1.0.0" }],
  permissions: ["cards:read", "cards:write", "model:invoke"],
  settings: [
    {
      key: "freshness.halfLifeDays",
      title: "新鮮度半衰期（天）",
      description: "卡片沒有載入時，每過這麼多天新鮮度剩一半。",
      kind: "number",
      level: "free",
      defaultValue: 30,
      min: 1,
      max: 3650,
    },
    {
      key: "conversation.archiveCountdownDays",
      title: "封存倒數（天）",
      description: "封存後幾天刪除對話；倒數期間可以取消。上限與協定 schema 一致。",
      kind: "number",
      level: "free",
      defaultValue: 7,
      min: 1,
      max: 365,
    },
  ],
};
