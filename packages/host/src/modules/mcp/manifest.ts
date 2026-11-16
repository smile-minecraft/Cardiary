import type { ModuleManifest } from "@cardiary/module-api";

/** MCP 模組：設定由人審批，工具由對話按需載入。 */
export const manifest: ModuleManifest = {
  id: "mcp",
  name: "MCP 伺服器",
  version: "0.1.0",
  description: "以人工審批的方式連接 MCP 伺服器，工具在對話用到時才載入。",
  hostApiVersion: "1",
  dependencies: [],
  permissions: ["mcp:connect", "network:outbound", "notifications:emit"],
  settings: [],
};
