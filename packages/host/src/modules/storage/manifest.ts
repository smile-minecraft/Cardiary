import type { ModuleManifest } from "@cardiary/module-api";

/** 儲存空間用量與清理；只處理可重建的區域。 */
export const manifest: ModuleManifest = {
  id: "storage",
  name: "儲存空間",
  version: "1.0.0",
  description: "storage.usage、storage.cleanup.preview 與 storage.cleanup.apply。",
  hostApiVersion: "1",
  dependencies: [],
  permissions: [],
  settings: [],
};
