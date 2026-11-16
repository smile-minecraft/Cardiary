import type { ModuleManifest } from "@cardiary/module-api";

/**
 * 白板模組；第一方模組與主機同一個行程。
 *
 * `boards.agentMode` 是代理碰白板的唯一開關：它決定新建立的對話能用到哪些
 * 白板工具。受限模式下代理只能建新卡並放進收件區；`full` 才能投影既有卡，
 * 而且投影一律要人類核准。設定切換只影響新對話，既有對話維持原本的工具組。
 */
export const manifest: ModuleManifest = {
  id: "boards",
  name: "白板",
  version: "1.0.0",
  description: "白板保存卡片的版面：投影、連線、分組與釘選；提供 board.* 協定與代理工具。",
  hostApiVersion: "1",
  dependencies: [{ moduleId: "cards", versionRange: "^1.0.0" }],
  permissions: ["cards:read", "cards:write"],
  settings: [
    {
      key: "boards.agentMode",
      title: "代理碰白板的範圍",
      description:
        "「只准建新卡到收件區」：代理不能投影既有卡片，只能建立新卡並放進收件區。" +
        "「完整」：代理可以投影既有卡片，每次投影都要你核准。" +
        "切換只影響之後新開的對話；已經開著的對話維持原本的工具，正在跑的動作也不受影響。",
      kind: "enum",
      level: "human-only",
      choices: ["respect-user-content", "full"],
      defaultValue: "respect-user-content",
    },
  ],
};
