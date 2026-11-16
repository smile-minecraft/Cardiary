import type { HostModule, ModuleManifest } from "@cardiary/module-api";
import { EmotionStore } from "@cardiary/storage";
import { HOST_SERVICE_NAMES } from "../contract.js";
import { EmotionService } from "./service.js";

const manifest: ModuleManifest = {
  id: "emotion",
  name: "情緒狀態",
  version: "1.0.0",
  description: "跨對話共享的情緒狀態。",
  hostApiVersion: "1",
  dependencies: [],
  permissions: [],
  settings: [],
};

export const hostModule: HostModule = {
  manifest,
  activate(context) {
    const store = new EmotionStore(context.services.paths.state, (message) =>
      context.services.logger.warn(message),
    );
    context.services.host.provide(
      HOST_SERVICE_NAMES.emotion,
      new EmotionService(store, () => context.services.clock.now()),
    );
  },
};
