import type { ModuleManifest } from "@cardiary/module-api";

/** 上下文模組；八層組裝、追加以外的卡片操作與壓縮都在這個模組。 */
export const manifest: ModuleManifest = {
  id: "context",
  name: "上下文",
  version: "1.0.0",
  description: "依八層順序組裝上下文、追加卡片、標記移除與壓縮；提供 context 服務。",
  hostApiVersion: "1",
  dependencies: [{ moduleId: "cards", versionRange: "^1.0.0" }],
  permissions: ["cards:read", "cards:write", "model:invoke"],
  settings: [
    {
      key: "context.compactionThreshold",
      title: "壓縮門檻",
      description: "上下文佔用達到可用預算的這個比例時壓縮；預設 0.75。",
      kind: "number",
      level: "free",
      defaultValue: 0.75,
      min: 0.1,
      max: 0.95,
    },
    {
      key: "context.reserveTokens",
      title: "保留給輸出的 token",
      description: "可用預算要扣掉的輸出保留量；預設 8192。",
      kind: "number",
      level: "free",
      defaultValue: 8192,
      min: 0,
      max: 131072,
    },
  ],
};
