import type { ModuleManifest } from "@cardiary/module-api";

/**
 * 排程與通知模組。
 *
 * 到時間執行的背景任務（`schedule`／`heartbeat` 兩種）、通知流、通知轉卡，
 * 以及給人用的 `module.scheduler.*` 管理訊息；代理只能以工具 `schedule_propose`
 * 提議排程，核准後才存在。提供 `notifications` 服務給蒸餾等模組建立通知。
 */
export const manifest: ModuleManifest = {
  id: "scheduler",
  name: "排程與通知",
  version: "1.0.0",
  description:
    "排程與 Heartbeat 執行、通知流與轉卡；代理提議走審批；`module.scheduler.*` 供人類管理。",
  hostApiVersion: "1",
  dependencies: [{ moduleId: "cards", versionRange: "^1.0.0" }],
  permissions: ["cards:read", "cards:write", "model:invoke"],
  settings: [
    {
      key: "notifications.systemCenter",
      title: "系統通知中心",
      description: "收到新通知時在 macOS 通知中心顯示；通知流本身不受這個設定影響。",
      kind: "boolean",
      level: "free",
      defaultValue: true,
    },
  ],
};
