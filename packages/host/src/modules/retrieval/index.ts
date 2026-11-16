import type { HostModule } from "@cardiary/module-api";

import { HOST_SERVICE_NAMES, type CardEnvironment } from "../contract.js";
import type { SpawnRegistry } from "../../spawn/wrapper.js";
import type { CardLibrary } from "../cards/library.js";
import { RetrievalService } from "./service.js";
import { CardVectors } from "./vectors.js";

const active = new Set<CardVectors>();

export const hostModule: HostModule = {
  manifest: {
    id: "retrieval",
    name: "卡片檢索",
    version: "1.0.0",
    hostApiVersion: "1",
    dependencies: [{ moduleId: "cards", versionRange: "^1.0.0" }],
    permissions: ["cards:read"],
    settings: [
      {
        key: "retrieval.allowModelDownload",
        title: "允許下載本機嵌入模型",
        kind: "boolean",
        level: "human-only",
        defaultValue: false,
        description:
          "允許下載本機嵌入模型（約 600 MB，存在資料夾的 cache/）。未同意前不啟用向量檢索。",
      },
    ],
  },
  activate(context) {
    const cards = context.services.host.require<CardLibrary>(HOST_SERVICE_NAMES.cards);
    const cabinet = context.services.host.require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage);
    const allowed = (): boolean =>
      context.services.settings.get("retrieval.allowModelDownload") === true;
    const spawn = context.services.host.require<SpawnRegistry>(HOST_SERVICE_NAMES.spawn);
    const vectors = new CardVectors(
      cards,
      () => cabinet.cache(),
      allowed,
      spawn,
      context.services.paths.cache,
      (message) => context.services.logger.warn("向量索引失敗", { message }),
      (progress) => {
        context.services.protocol.emit({
          kind: "module-event",
          type: "module.retrieval.progress",
          payload: { progress: JSON.stringify(progress) },
        });
      },
    );

    context.services.settings.onChange((change) => {
      if (change.key === "retrieval.allowModelDownload" && change.nextValue !== true) {
        vectors.stop();
      }
    });
    active.add(vectors);
    context.services.host.provide("retrieval", new RetrievalService(cards, vectors));
  },
  deactivate() {
    for (const vectors of active) vectors.stop();
    active.clear();
  },
};
