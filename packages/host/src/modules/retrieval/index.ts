import type { HostModule } from "@cardiary/module-api";

import { HOST_SERVICE_NAMES, type CardEnvironment } from "../contract.js";
import type { SpawnRegistry } from "../../spawn/wrapper.js";
import type { CardLibrary } from "../cards/library.js";
import { RetrievalService } from "./service.js";
import { CardVectors } from "./vectors.js";
import { testEmbedder } from "./test-seam.js";

const CONSENT_KEY = "retrieval.allowModelDownload";

const active = new Set<CardVectors>();
const unsubscribers = new Set<() => void>();

/**
 * 模組的 settings 讀取器會擋掉 human-only 的值；主機在同一個資料庫讀原始值，
 * 才能同時做到「只有人能改」與「殼可以觀察」。
 */
function readConsent(cabinet: CardEnvironment): boolean {
  const raw = cabinet.settings.get(CONSENT_KEY)?.value;
  if (raw === undefined) return false;
  try {
    return JSON.parse(raw) === true;
  } catch {
    return false;
  }
}

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
        key: CONSENT_KEY,
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
    const emit = (intent: Parameters<typeof context.services.protocol.emit>[0]): void =>
      context.services.protocol.emit(intent);
    const allowed = (): boolean => readConsent(cabinet);
    const spawn = context.services.host.require<SpawnRegistry>(HOST_SERVICE_NAMES.spawn);
    // 契約測試接縫：只有 CARDIARY_TEST_FAULTS=1 時才會換成假嵌入器。
    const embedder = testEmbedder();
    const vectors = new CardVectors({
      ...(embedder === undefined ? {} : { embedder }),
      library: cards,
      database: () => cabinet.cache(),
      allowed,
      spawn,
      cache: context.services.paths.cache,
      warn: (message) => context.services.logger.warn("向量索引失敗", { message }),
      onProgress: (progress) =>
        emit({
          kind: "module-event",
          type: "module.retrieval.progress",
          payload: { ...progress },
        }),
      onStatus: (status) =>
        emit({
          kind: "module-event",
          type: "module.retrieval.status",
          payload: { ...status },
        }),
    });

    context.services.settings.onChange((change) => {
      if (change.key !== CONSENT_KEY) return;
      vectors.refresh();
    });
    // 卡片寫入與索引重建要讓常駐快照跟著更新；不能等到下一次查詢才發現。
    unsubscribers.add(cards.onChange((change) => vectors.cardChanged(change)));
    unsubscribers.add(cards.onRebuild(() => vectors.invalidate()));
    active.add(vectors);
    context.services.host.provide("retrieval", new RetrievalService(cards, vectors));
    // 啟用時就先回報目前狀態；不是 search 才知道要不要重建。
    vectors.refresh();
  },
  deactivate() {
    for (const unsubscribe of unsubscribers) unsubscribe();
    unsubscribers.clear();
    for (const vectors of active) vectors.stop();
    active.clear();
  },
};
