import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CardService } from "@cardiary/domain";
import type { ModelInvoker } from "@cardiary/module-api";
import { FreshnessStore } from "@cardiary/storage";
import { afterEach, describe, expect, it } from "vitest";

import { startHost, type RunningHost } from "../../../src/index.js";
import { HOST_SERVICE_NAMES, type CardEnvironment } from "../../../src/modules/contract.js";
import { MemoryModuleEnablementSettings } from "../../../src/modules/loader.js";
import type { SessionLifecycleService } from "../../../src/sessions/service.js";

/**
 * 封存倒數結束的整合測試：真的 Pi 組裝、真的事件與卡片檔，模型用替身。
 *
 * 模型用替身。模型接入的第一方 settings 模組也提供 `models` 服務；這個
 * harness 停用它，讓測試自己 provide（或不 provide）`models`，驗「有提供」
 * 與「沒有模型時延後刪除、不刪半套」。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = "2026-01-01T00:00:00.000Z";
/** 原始碼測試不經模組載入器；用建置後的模組目錄，才是真正的第一方模組。 */
const MODULES_DIRECTORY = fileURLToPath(new URL("../../../dist/modules", import.meta.url));
/** `pnpm test` 單獨跑時可能還沒建置；`pnpm check` 一定先 build。 */
const modulesBuilt = existsSync(MODULES_DIRECTORY);

interface Harness {
  readonly host: RunningHost;
  readonly folder: string;
  readonly clock: { now: Date };
  readonly cards: CardService;
  readonly sessions: SessionLifecycleService;
  readonly cabinet: CardEnvironment;
}

const running: RunningHost[] = [];

afterEach(async () => {
  while (running.length > 0) {
    const host = running.pop();
    if (host === undefined) continue;
    await host.service.shutdown("test").catch(() => undefined);
  }
});

async function makeHarness(): Promise<Harness> {
  const folder = await mkdtemp(join(tmpdir(), "cardiary-expiry-"));
  const clock = { now: new Date(T0) };
  const host = await startHost({
    assembly: "pi",
    folderPath: folder,
    initializeFolder: true,
    modulesDirectory: MODULES_DIRECTORY,
    clock: { now: () => clock.now },
    // 模型接入模組預設也提供 `models`；此 harness 停用它，由測試自己提供替身或完全不提供。
    moduleEnablement: new MemoryModuleEnablementSettings(["settings"]),
  });
  running.push(host);
  const cards = host.hostServices.require<CardService>(HOST_SERVICE_NAMES.cards);
  const sessions = host.hostServices.require<SessionLifecycleService>(HOST_SERVICE_NAMES.sessions);
  const cabinet = host.hostServices.require<CardEnvironment>(HOST_SERVICE_NAMES.cardStorage);
  return { host, folder, clock, cards, sessions, cabinet };
}

async function createConversation(harness: Harness, title: string): Promise<string> {
  const summary = await harness.host.engine.createConversation({
    title,
    purpose: "conversation",
    model: { provider: "test", model: "test" },
    systemContext: "你是測試助理。",
    toolBundles: [],
    permissionMode: "hard-rules",
  });
  return summary.id;
}

async function createReferencedCard(harness: Harness, conversationId: string): Promise<string> {
  const card = await harness.cards.create({
    kind: "note",
    title: "封存期間的卡片",
    body: "這張卡只被倒數中的對話引用。",
  });
  await harness.cards.get(card.cardId, { conversationId });
  return card.cardId;
}

function modelsReturning(text: string): ModelInvoker {
  return {
    async invoke() {
      return { text };
    },
  };
}

describe.skipIf(!modulesBuilt)("封存倒數結束（需先 build）", () => {
  it("摘要成功才刪對話；專屬卡片保留並歸零，摘要卡留在卡片庫", async () => {
    const harness = await makeHarness();
    const conversationId = await createConversation(harness, "要被摘要的對話");
    const cardId = await createReferencedCard(harness, conversationId);
    await harness.sessions.archive(conversationId, 1);

    harness.clock.now = new Date(Date.parse(T0) + 2 * DAY_MS);
    harness.host.hostServices.provide(HOST_SERVICE_NAMES.models, modelsReturning("這是摘要內容。"));
    expect(await harness.sessions.processDueArchives()).toBe(1);

    const summaries = await harness.cards.list({ kinds: ["summary"] });
    expect(summaries.items).toHaveLength(1);
    expect(summaries.items[0]?.title).toContain("對話摘要");
    expect(await harness.host.engine.getConversation(conversationId as never)).toBeNull();
    expect(
      harness.cabinet.state.get(
        "SELECT 1 AS one FROM conversations WHERE conversation_id = ?",
        conversationId,
      ),
    ).toBeUndefined();

    // 專屬卡片沒有被刪，只是失去引用而歸零。
    expect(existsSync(join(harness.folder, "cards", `${cardId}.md`))).toBe(true);
    const freshness = new FreshnessStore({
      db: harness.cabinet.state,
      now: () => harness.clock.now,
    });
    expect(freshness.get(cardId).freshness).toBe(0);
    expect(harness.sessions.dueArchives()).toHaveLength(0);
  });

  it("沒有 models 服務時摘要失敗：對話與卡片都還在，待重試", async () => {
    const harness = await makeHarness();
    const conversationId = await createConversation(harness, "沒有模型的對話");
    const cardId = await createReferencedCard(harness, conversationId);
    await harness.sessions.archive(conversationId, 1);

    harness.clock.now = new Date(Date.parse(T0) + 2 * DAY_MS);
    // 沒有提供 HOST_SERVICE_NAMES.models：模組呼叫時才發現，不能刪半套。
    expect(await harness.sessions.processDueArchives()).toBe(0);
    expect(harness.sessions.dueArchives()).toHaveLength(1);
    expect(await harness.host.engine.getConversation(conversationId as never)).not.toBeNull();
    expect(existsSync(join(harness.folder, "cards", `${cardId}.md`))).toBe(true);
    expect(await harness.cards.list({ kinds: ["summary"] })).toMatchObject({ items: [] });

    harness.host.hostServices.provide(
      HOST_SERVICE_NAMES.models,
      modelsReturning("補做的摘要內容。"),
    );
    expect(await harness.sessions.processDueArchives()).toBe(1);
    expect(await harness.host.engine.getConversation(conversationId as never)).toBeNull();
    expect(existsSync(join(harness.folder, "cards", `${cardId}.md`))).toBe(true);
  });
});
