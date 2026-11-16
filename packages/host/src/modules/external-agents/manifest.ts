import type { ModuleManifest } from "@cardiary/module-api";

/** 外部代理橋接模組；`agent.*` 與 `module.external-agents.*`。 */
export const manifest: ModuleManifest = {
  id: "external-agents",
  name: "外部代理",
  version: "1.0.0",
  description:
    "在 Cardiary 指揮 OpenCode 與 Claude Code：代理的進度回到狀態卡，代理提出的問題走原生審批；行程受沙盒限制，工作階段放在快取區。",
  hostApiVersion: "1",
  dependencies: [],
  permissions: ["files:read", "files:write", "external-agent:dispatch"],
  settings: [],
};
