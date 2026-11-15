import type { ModuleManifest } from "@cardiary/module-api";

/** 本機檔案與終端機模組的描述檔。 */
export const manifest: ModuleManifest = {
  id: "local-tools",
  name: "本機檔案與終端機",
  version: "0.1.0",
  description: "讀檔、寫檔、列目錄與執行指令；每次呼叫都先過權限閘道。",
  hostApiVersion: "1",
  dependencies: [],
  permissions: ["files:read", "files:write", "terminal:execute"],
  settings: [],
};
