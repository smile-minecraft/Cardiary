import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AssetStore, CardService } from "@cardiary/domain";
import type { ConversationSummary } from "@cardiary/engine-adapter";
import type { ProtocolEventEmitter, ProtocolEventIntent } from "@cardiary/module-api";
import {
  CardFileStore,
  CardIndexStore,
  FreshnessStore,
  LocalAssetStore,
  RequestDedupeStore,
  Storage,
  addDaysIso,
  byteSearch,
  type Database,
} from "@cardiary/storage";
import { afterEach, describe, expect, it } from "vitest";

import { ProtocolHandlerError } from "../../../src/modules/contract.js";
import { CardLibrary } from "../../../src/modules/cards/library.js";
import { CardStateStore } from "../../../src/modules/cards/state.js";
import { registerLifecycleProtocol } from "../../../src/modules/lifecycle/protocol.js";
import { SessionLifecycleService } from "../../../src/sessions/service.js";
import type { HostEngine } from "../../../src/engine/types.js";

/**
 * 對話生命週期服務的單元測試：真的狀態庫與卡片檔，引擎用可控制的小替身。
 *
 * 引擎替身只實作這個服務用到的四個方法；刪除的子樹、歷史與摘要內容都由
 * 測試直接安排，時間也由測試推進。
 */

const T0 = "2026-01-01T00:00:00.000Z";
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

class StubEngine {
  readonly conversations = new Map<string, ConversationSummary>();
  readonly messages = new Map<string, Array<{ role: "user" | "assistant"; text: string }>>();
  deleted: string[] = [];

  add(id: string, parent?: string): ConversationSummary {
    const summary: ConversationSummary = {
      id: id as never,
      title: `對話 ${id}`,
      purpose: "conversation",
      rootConversationId: (parent ?? id) as never,
      depth: parent === undefined ? 0 : 1,
      visibility: parent === undefined ? "listed" : "branch",
      permissionMode: "hard-rules",
      model: { provider: "test", model: "test" },
      state: "idle",
      origin:
        parent === undefined
          ? null
          : {
              kind: "user-fork",
              parentConversationId: parent as never,
              rootConversationId: parent as never,
              at: "cursor" as never,
              depth: 1,
            },
      toolBundles: [],
      createdAt: T0,
      updatedAt: T0,
      latestCursor: null,
    };
    this.conversations.set(id, summary);
    return summary;
  }

  say(conversationId: string, role: "user" | "assistant", text: string): void {
    const list = this.messages.get(conversationId) ?? [];
    list.push({ role, text });
    this.messages.set(conversationId, list);
  }

  async getConversation(id: string): Promise<ConversationSummary | null> {
    return this.conversations.get(id) ?? null;
  }

  async listConversations(): Promise<readonly ConversationSummary[]> {
    return [...this.conversations.values()];
  }

  async readConversationHistory(input: { readonly conversationId: string }): Promise<{
    readonly messages: Array<{
      readonly id: string;
      readonly role: "user" | "assistant";
      readonly content: Array<{ readonly type: "text"; readonly text: string }>;
      readonly createdAt: string;
      readonly cursor: string;
    }>;
    readonly nextBefore: null;
  }> {
    return {
      messages: (this.messages.get(input.conversationId) ?? []).map((message, index) => ({
        id: `message-${index}`,
        role: message.role,
        content: [{ type: "text", text: message.text }],
        createdAt: T0,
        cursor: `cursor-${index}`,
      })),
      nextBefore: null,
    };
  }

  async deleteConversation(id: string): Promise<void> {
    const targets = new Set<string>([id]);
    for (const conversation of this.conversations.values()) {
      if (conversation.origin?.parentConversationId === id) {
        targets.add(conversation.id);
      }
    }
    for (const target of targets) {
      this.conversations.delete(target);
      this.deleted.push(target);
    }
  }
}

interface Fixture {
  readonly folder: { readonly path: string };
  readonly storage: Storage;
  readonly engine: StubEngine;
  readonly library: CardLibrary;
  readonly assets: AssetStore;
  readonly localAssets: LocalAssetStore;
  readonly freshness: FreshnessStore;
  readonly service: SessionLifecycleService;
  readonly events: ProtocolEventIntent[];
  readonly status: { summaryFails: boolean; summarizeCalls: number };
  readonly clock: { now: Date };
  /** 用同一份儲存與引擎再建一個服務；測試「重啟」用。 */
  readonly buildService: (
    protocol: ProtocolEventEmitter,
    cards?: CardService,
  ) => SessionLifecycleService;
}

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
};

function buildService(input: {
  readonly storage: Storage;
  readonly engine: StubEngine;
  readonly cards: CardService;
  readonly assets: AssetStore;
  readonly models: { invoke: () => Promise<{ text: string }> };
  readonly protocol: ProtocolEventEmitter;
  readonly clock: { now: Date };
}): SessionLifecycleService {
  return new SessionLifecycleService({
    layout: input.storage.layout,
    state: input.storage.state,
    cache: () => input.storage.cache,
    settings: input.storage.settings,
    engine: input.engine as unknown as HostEngine,
    cards: input.cards,
    assets: input.assets,
    models: input.models,
    protocol: input.protocol,
    logger,
    now: () => input.clock.now,
  });
}

/** 可替換的模型實作；預設回固定摘要，測試可換成由測試控制的延遲模型。 */
type ModelsOverride = { invoke: () => Promise<{ text: string }> };

/** 第一次呼叫會卡住的模型：`called` 在呼叫當下成立，`release()` 才放行摘要。 */
function makeDeferredModels(): {
  readonly models: ModelsOverride;
  readonly status: { summarizeCalls: number };
  readonly called: Promise<void>;
  release(): void;
} {
  let release!: () => void;
  let markCalled!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const called = new Promise<void>((resolve) => {
    markCalled = resolve;
  });
  const status = { summarizeCalls: 0 };
  const models = {
    async invoke(): Promise<{ text: string }> {
      status.summarizeCalls += 1;
      markCalled();
      await gate;
      return { text: "延遲摘要內容。" };
    },
  };
  return { models, status, called, release: () => release() };
}

async function makeFixture(modelsOverride?: ModelsOverride): Promise<Fixture> {
  // 空的暫存資料夾走首次初始化：建立九個子資料夾、兩個資料庫與 folder.json。
  const folder = { path: await mkdtemp(join(tmpdir(), "cardiary-lifecycle-")) };
  const storage = Storage.open({ path: folder.path, initialize: true });
  const clock = { now: new Date(T0) };
  const now = (): Date => clock.now;
  const files = new CardFileStore({ layout: storage.layout, now });
  let cachedDatabase: Database | null = null;
  let cachedIndex: CardIndexStore | null = null;
  const index = (): CardIndexStore => {
    const database = storage.cache;
    if (cachedIndex === null || cachedDatabase !== database) {
      cachedDatabase = database;
      cachedIndex = new CardIndexStore({ db: database, now });
    }
    return cachedIndex;
  };
  const localAssets = new LocalAssetStore({ layout: storage.layout, index: index(), now });
  const library = new CardLibrary({
    files,
    index,
    assets: () => localAssets,
    state: new CardStateStore({ db: () => storage.state, now }),
    now,
  });
  await library.initialize();
  const assets: AssetStore = {
    put: (input) => localAssets.put(input),
    read: async (blobId) => localAssets.read(blobId) ?? null,
    release: async (blobId) => localAssets.release(blobId) === "deleted",
  };
  const engine = new StubEngine();
  const events: ProtocolEventIntent[] = [];
  const status = { summaryFails: false, summarizeCalls: 0 };
  const models = {
    async invoke(): Promise<{ text: string }> {
      status.summarizeCalls += 1;
      if (status.summaryFails) {
        throw new Error("模型不可用");
      }
      return { text: "這是摘要內容。" };
    },
  };
  const protocol: ProtocolEventEmitter = {
    emit: (intent) => {
      events.push(intent);
    },
    registerNamespace: () => ({ dispose: () => {} }),
    registerHttpRoute: () => {
      throw new Error("生命週期模組不註冊 HTTP 路由");
    },
  };
  const service = buildService({
    storage,
    engine,
    cards: library as unknown as CardService,
    assets,
    models: modelsOverride ?? models,
    protocol,
    clock,
  });
  const freshness = new FreshnessStore({ db: storage.state, now });
  const fixture: Fixture = {
    folder,
    storage,
    engine,
    library,
    assets,
    localAssets,
    freshness,
    service,
    events,
    status,
    clock,
    buildService: (protocol, cards) =>
      buildService({
        storage,
        engine,
        cards: cards ?? (library as unknown as CardService),
        assets,
        models,
        protocol,
        clock,
      }),
  };
  cleanups.push(() => storage.close());
  return fixture;
}

interface ProtocolCapture {
  readonly protocol: ProtocolEventEmitter;
  call(type: string, payload: Record<string, unknown>): Promise<unknown>;
}

/** 捕捉生命週期處理器，讓測試直接以線路形狀呼叫；事件照樣轉發。 */
function makeProtocolCapture(events: ProtocolEventIntent[] = []): ProtocolCapture {
  let handler:
    ((request: { type: string; payload: unknown; clientId: string }) => Promise<unknown>) | null =
    null;
  const protocol: ProtocolEventEmitter = {
    emit: (intent) => {
      events.push(intent);
    },
    registerNamespace: (_prefix, registered) => {
      handler = registered as never;
      return { dispose: () => {} };
    },
    registerHttpRoute: () => {
      throw new Error("生命週期模組不註冊 HTTP 路由");
    },
  };
  return {
    protocol,
    call: (type, payload) => handler?.({ type, payload, clientId: "test" }) as Promise<unknown>,
  };
}

/** 以狀態庫的 `request_dedupe` 註冊處理器；重啟後新實例讀同一個資料庫。 */
function registerProtocol(
  fixture: Fixture,
  service: SessionLifecycleService,
  capture: ProtocolCapture,
): void {
  registerLifecycleProtocol({
    service,
    protocol: capture.protocol,
    dedupe: new RequestDedupeStore(fixture.storage.state, { now: () => fixture.clock.now }),
    now: () => fixture.clock.now,
  });
}

function cardPath(fixture: Fixture, cardId: string): string {
  return join(fixture.folder.path, "cards", `${cardId}.md`);
}

async function makeCard(
  fixture: Fixture,
  input: { title: string; conversationId: string; withAsset?: boolean },
): Promise<{ cardId: string; blobId?: string }> {
  let assetBlobId: string | undefined;
  if (input.withAsset === true) {
    const put = await fixture.localAssets.put({
      bytes: Buffer.from(`asset-${input.title}`),
      mediaType: "image/png",
      extension: "png",
    });
    assetBlobId = put.blobId;
  }
  const card = await fixture.library.create({
    kind: input.withAsset === true ? "image" : "note",
    title: input.title,
    body: `${input.title} 的內容`,
    ...(assetBlobId === undefined ? {} : { assetBlobId }),
  });
  await fixture.library.get(card.cardId, { conversationId: input.conversationId });
  return { cardId: card.cardId, ...(assetBlobId === undefined ? {} : { blobId: assetBlobId }) };
}

describe("對話生命週期", () => {
  it("封存開始倒數、事件送到兩邊；取消封存保留當下的值", async () => {
    const fixture = await makeFixture();
    fixture.engine.add("conv-1");
    const card = await makeCard(fixture, { title: "封存卡", conversationId: "conv-1" });

    const archive = await fixture.service.archive("conv-1");
    expect(archive).toEqual({ archivedAt: T0, purgeAt: addDaysIso(T0, 7) });
    expect(
      fixture.storage.state.get("SELECT * FROM conversations WHERE conversation_id = 'conv-1'"),
    ).toBeDefined();
    const archivedEvent = fixture.events.find(
      (event) => event.kind === "session-lifecycle" && event.event === "archived",
    );
    expect(archivedEvent).toBeDefined();

    fixture.clock.now = new Date(addDaysIso(T0, 3.5));
    expect(fixture.service.dueArchives()).toEqual([]);
    expect(fixture.freshness.compute(card.cardId, addDaysIso(T0, 3.5))).toBeCloseTo(50, 6);

    const unarchive = await fixture.service.unarchive("conv-1");
    expect(unarchive.unarchived).toBe(true);
    expect(fixture.freshness.get(card.cardId).freshness).toBeCloseTo(50, 6);
    expect(
      fixture.events.some(
        (event) => event.kind === "session-lifecycle" && event.event === "unarchived",
      ),
    ).toBe(true);
  });

  it("預覽的專屬卡片數與實際刪除數一致；共享、釘選卡片與被引用原檔保留", async () => {
    const fixture = await makeFixture();
    fixture.engine.add("conv-1");
    fixture.engine.add("conv-2", "conv-1");
    const exclusive = await makeCard(fixture, {
      title: "專屬卡",
      conversationId: "conv-1",
      withAsset: true,
    });
    await fixture.library.get(exclusive.cardId, { conversationId: "conv-2" });
    const shared = await makeCard(fixture, {
      title: "共享卡",
      conversationId: "conv-1",
      withAsset: true,
    });
    await fixture.library.get(shared.cardId, { conversationId: "conv-9" });
    const pinned = await makeCard(fixture, {
      title: "釘選卡",
      conversationId: "conv-1",
      withAsset: true,
    });
    fixture.storage.state.run("UPDATE card_state SET pinned = 1 WHERE card_id = ?", pinned.cardId);

    const preview = await fixture.service.preview("conv-1");
    expect([...preview.subtreeSessionIds].sort()).toEqual(["conv-1", "conv-2"]);
    expect(preview.exclusiveCards).toBe(1);
    expect(preview.sharedCards).toBe(2);
    expect(preview.assets).toBe(1);

    const result = await fixture.service.delete("conv-1");
    expect(result.deletedCards).toBe(preview.exclusiveCards);
    expect(result.deletedSessionIds.sort()).toEqual(["conv-1", "conv-2"]);
    expect(result.deletedAssets).toBe(1);

    expect(existsSync(cardPath(fixture, exclusive.cardId))).toBe(false);
    expect(existsSync(cardPath(fixture, shared.cardId))).toBe(true);
    expect(existsSync(cardPath(fixture, pinned.cardId))).toBe(true);
    expect(existsSync(join(fixture.folder.path, "assets", `${shared.blobId}.png`))).toBe(true);
    expect(existsSync(join(fixture.folder.path, "assets", `${pinned.blobId}.png`))).toBe(true);
    const deletedEvent = fixture.events.find(
      (event) => event.kind === "session-lifecycle" && event.event === "deleted",
    );
    expect(deletedEvent).toMatchObject({
      payload: { sessionId: "conv-1", deletedCards: 1, deletedAssets: 1 },
    });
  });

  it("倒數結束先產生摘要卡再刪對話；專屬卡片保留並歸零", async () => {
    const fixture = await makeFixture();
    fixture.engine.add("conv-1");
    fixture.engine.say("conv-1", "user", "幫我整理會議");
    fixture.engine.say("conv-1", "assistant", "整理好了");
    const exclusive = await makeCard(fixture, { title: "專屬卡", conversationId: "conv-1" });
    const shared = await makeCard(fixture, { title: "共享卡", conversationId: "conv-9" });
    await fixture.library.get(shared.cardId, { conversationId: "conv-1" });
    await fixture.service.archive("conv-1", 1);

    fixture.clock.now = new Date(addDaysIso(T0, 2));
    expect(await fixture.service.processDueArchives()).toBe(1);

    const summary = fixture.storage.cache.get<{ card_id: string; kind: string }>(
      "SELECT card_id, kind FROM card_index WHERE kind = 'summary'",
    );
    expect(summary?.kind).toBe("summary");
    expect(summary).toBeDefined();
    const summaryCard = await fixture.library.get(summary?.card_id as string);
    expect(summaryCard?.body).toContain("摘要內容");
    expect(
      fixture.storage.state.get(
        "SELECT 1 AS one FROM conversations WHERE conversation_id = 'conv-1'",
      ),
    ).toBeUndefined();
    expect(fixture.engine.conversations.has("conv-1")).toBe(false);
    // 專屬卡片沒有被刪，只是歸零；共享卡片仍按一般規則。
    expect(existsSync(cardPath(fixture, exclusive.cardId))).toBe(true);
    expect(fixture.freshness.get(exclusive.cardId).freshness).toBe(0);
    expect(existsSync(cardPath(fixture, shared.cardId))).toBe(true);
    expect(fixture.freshness.get(shared.cardId).freshness).toBeGreaterThan(0);
  });

  it("摘要失敗時對話與卡片都還在，記下待重試；下一次成功才刪", async () => {
    const fixture = await makeFixture();
    fixture.engine.add("conv-1");
    const card = await makeCard(fixture, { title: "等待卡", conversationId: "conv-1" });
    await fixture.service.archive("conv-1", 1);
    fixture.clock.now = new Date(addDaysIso(T0, 2));
    fixture.status.summaryFails = true;

    expect(await fixture.service.processDueArchives()).toBe(0);
    expect(fixture.service.dueArchives()).toHaveLength(1);
    expect(fixture.engine.conversations.has("conv-1")).toBe(true);
    expect(existsSync(cardPath(fixture, card.cardId))).toBe(true);
    expect(
      fixture.storage.cache.get("SELECT 1 AS one FROM card_index WHERE kind = 'summary'"),
    ).toBeUndefined();

    fixture.status.summaryFails = false;
    expect(await fixture.service.processDueArchives()).toBe(1);
    expect(fixture.engine.conversations.has("conv-1")).toBe(false);
    expect(fixture.status.summarizeCalls).toBe(2);
  });

  it("摘要進行中取消封存：對話與卡片都還在，不清半套", async () => {
    const deferred = makeDeferredModels();
    const fixture = await makeFixture(deferred.models);
    fixture.engine.add("conv-1");
    fixture.engine.say("conv-1", "user", "幫我整理會議");
    const card = await makeCard(fixture, { title: "倒數卡", conversationId: "conv-1" });
    await fixture.service.archive("conv-1", 1);
    fixture.clock.now = new Date(addDaysIso(T0, 2));

    const purge = fixture.service.processDueArchives();
    await deferred.called;
    const unarchive = await fixture.service.unarchive("conv-1");
    expect(unarchive.unarchived).toBe(true);
    deferred.release();

    expect(await purge).toBe(0);
    expect(fixture.engine.conversations.has("conv-1")).toBe(true);
    expect(existsSync(cardPath(fixture, card.cardId))).toBe(true);
    expect(fixture.storage.state.get("SELECT 1 AS one FROM conversation_cards")).toBeDefined();
    // 摘要產生的卡片沒有留在卡片庫，也沒有記到對話列。
    expect(
      fixture.storage.cache.get("SELECT 1 AS one FROM card_index WHERE kind = 'summary'"),
    ).toBeUndefined();
    expect(
      fixture.storage.state.get(
        "SELECT archive_summary_card_id FROM conversations WHERE conversation_id = 'conv-1'",
      ),
    ).toEqual({ archive_summary_card_id: null });
  });

  it("並行呼叫 processDueArchives 不會產生兩張摘要卡", async () => {
    const deferred = makeDeferredModels();
    const fixture = await makeFixture(deferred.models);
    fixture.engine.add("conv-1");
    fixture.engine.say("conv-1", "user", "幫我整理會議");
    await makeCard(fixture, { title: "並行卡", conversationId: "conv-1" });
    await fixture.service.archive("conv-1", 1);
    fixture.clock.now = new Date(addDaysIso(T0, 2));

    const first = fixture.service.processDueArchives();
    const second = fixture.service.processDueArchives();
    await deferred.called;
    deferred.release();

    const [processedFirst, processedSecond] = await Promise.all([first, second]);
    expect(processedFirst + processedSecond).toBe(1);
    expect(deferred.status.summarizeCalls).toBe(1);
    const summaryCount = fixture.storage.cache.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM card_index WHERE kind = 'summary'",
    );
    expect(Number(summaryCount?.n)).toBe(1);
  });

  it("協定處理器回傳線路形狀，重送的刪除回同一個結果", async () => {
    const fixture = await makeFixture();
    fixture.engine.add("conv-1");
    const card = await makeCard(fixture, { title: "協定卡", conversationId: "conv-1" });
    const capture = makeProtocolCapture(fixture.events);
    registerProtocol(fixture, fixture.service, capture);
    const invoke = capture.call;

    const preview = (await invoke("session.deletion_preview", { sessionId: "conv-1" })) as {
      exclusiveCards: number;
    };
    expect(preview.exclusiveCards).toBe(1);

    const first = (await invoke("session.delete", {
      sessionId: "conv-1",
      clientRequestId: "delete-1",
    })) as { deletedCards: number };
    const second = (await invoke("session.delete", {
      sessionId: "conv-1",
      clientRequestId: "delete-1",
    })) as { deletedCards: number };
    expect(second).toEqual(first);
    expect(existsSync(cardPath(fixture, card.cardId))).toBe(false);

    await expect(
      invoke("session.archive", { sessionId: "conv-1", purgeAfterDays: 0 }),
    ).rejects.toThrow(ProtocolHandlerError);
  });

  it("刪除的 clientRequestId 記在 request_dedupe：重啟後同鍵重送得到同一結果", async () => {
    const fixture = await makeFixture();
    fixture.engine.add("conv-1");
    await makeCard(fixture, { title: "重啟卡", conversationId: "conv-1" });

    const first = makeProtocolCapture(fixture.events);
    registerProtocol(fixture, fixture.service, first);
    const deleted = (await first.call("session.delete", {
      sessionId: "conv-1",
      clientRequestId: "delete-restart",
    })) as { deletedCards: number; deletedSessionIds: string[] };

    const row = fixture.storage.state.get<{ state: string; response_json: string | null }>(
      "SELECT state, response_json FROM request_dedupe WHERE key = ?",
      "session-delete:delete-restart",
    );
    expect(row?.state).toBe("completed");
    expect(row?.response_json).toContain('"deletedCards":1');

    // 模擬重啟：新的服務與新的去重讀取器，同一個狀態庫與引擎。
    const restarted = fixture.buildService(makeProtocolCapture().protocol);
    const second = makeProtocolCapture();
    registerProtocol(fixture, restarted, second);
    const resent = await second.call("session.delete", {
      sessionId: "conv-1",
      clientRequestId: "delete-restart",
    });
    expect(resent).toEqual(deleted);
    // 沒有再刪一次：引擎只收到一次刪除。
    expect(fixture.engine.deleted).toEqual(["conv-1"]);

    // `pending` 中的鍵重送不重做，回 conflict（pending）。
    new RequestDedupeStore(fixture.storage.state, { now: () => fixture.clock.now }).claim(
      "session-delete:delete-pending",
      "send-message",
    );
    await expect(
      second.call("session.delete", {
        sessionId: "conv-2",
        clientRequestId: "delete-pending",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("一張卡先被 A 封存、B 再引用並封存：新鮮度不會回春", async () => {
    const fixture = await makeFixture();
    fixture.engine.add("conv-1");
    fixture.engine.add("conv-2");
    const card = await makeCard(fixture, { title: "兩對話卡", conversationId: "conv-1" });

    await fixture.service.archive("conv-1");
    fixture.clock.now = new Date(addDaysIso(T0, 3));
    // 只有 A 引用、A 已封存：線性下降，7 天倒數走了 3 天。
    expect(fixture.library.freshnessOf(card.cardId)).toBeCloseTo((100 * 4) / 7, 4);

    // B 引用（只是讀取，不是載入）：切回平時衰減，但要用當下的值當起點。
    await fixture.library.get(card.cardId, { conversationId: "conv-2" });
    expect(fixture.library.freshnessOf(card.cardId)).toBeCloseTo((100 * 4) / 7, 4);

    // B 封存：錨點是封存當下的有效值，不是從舊錨點重算。
    await fixture.service.archive("conv-2");
    expect(fixture.library.freshnessOf(card.cardId)).toBeCloseTo((100 * 4) / 7, 4);

    // 再過一天，往最早結束的倒數（A 的 7 天）下降。
    fixture.clock.now = new Date(addDaysIso(T0, 4));
    expect(fixture.library.freshnessOf(card.cardId)).toBeCloseTo((100 * 3) / 7, 4);
  });

  it("封存倒數上限是 365 天，與線路 schema 一致", async () => {
    const fixture = await makeFixture();
    fixture.engine.add("conv-1");
    fixture.engine.add("conv-2");

    const archived = await fixture.service.archive("conv-1", 365);
    expect(archived.purgeAt).toBe(addDaysIso(T0, 365));
    await expect(fixture.service.archive("conv-2", 366)).rejects.toMatchObject({
      code: "invalid_message",
    });
    await expect(fixture.service.archive("conv-2", 0)).rejects.toMatchObject({
      code: "invalid_message",
    });

    const capture = makeProtocolCapture(fixture.events);
    registerProtocol(fixture, fixture.service, capture);
    await expect(
      capture.call("session.archive", { sessionId: "conv-2", purgeAfterDays: 366 }),
    ).rejects.toMatchObject({ code: "invalid_message" });
    const viaWire = (await capture.call("session.archive", {
      sessionId: "conv-2",
      purgeAfterDays: 365,
    })) as { archive: { purgeAt: string } };
    expect(viaWire.archive.purgeAt).toBe(addDaysIso(T0, 365));
  });

  it("卡片刪除失敗時保留刪除意圖；啟動恢復補刪卡片檔", async () => {
    const fixture = await makeFixture();
    fixture.engine.add("conv-1");
    const card = await makeCard(fixture, { title: "刪一半", conversationId: "conv-1" });
    const failingCards = new Proxy(fixture.library as unknown as CardService, {
      get(target, property) {
        if (property === "delete") {
          return async (): Promise<never> => {
            throw new Error("模擬卡片刪除失敗");
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const service = fixture.buildService(makeProtocolCapture().protocol, failingCards);

    await expect(service.delete("conv-1")).rejects.toMatchObject({ code: "unavailable" });
    const intent = fixture.storage.state.get<{ phase: string; card_ids: string }>(
      "SELECT phase, card_ids FROM conversation_deletions WHERE root_id = 'conv-1'",
    );
    expect(intent?.phase).toBe("vacuum");
    expect(JSON.parse(intent?.card_ids ?? "[]") as string[]).toContain(card.cardId);
    expect(existsSync(cardPath(fixture, card.cardId))).toBe(true);

    // 啟動恢復：只補卡片檔與壓縮，不重跑已經完成的刪列。
    expect(await fixture.storage.deletions.recoverAtStartup()).toBe(1);
    expect(existsSync(cardPath(fixture, card.cardId))).toBe(false);
    expect(
      fixture.storage.state.get(
        "SELECT 1 AS one FROM conversation_deletions WHERE root_id = 'conv-1'",
      ),
    ).toBeUndefined();
  });

  it("刪除中斷後依意圖恢復：卡片檔、原檔與索引列都清掉，清單看不到幽靈卡", async () => {
    const fixture = await makeFixture();
    fixture.engine.add("conv-1");
    const card = await makeCard(fixture, {
      title: "帶原檔的卡片",
      conversationId: "conv-1",
      withAsset: true,
    });
    const assetPath = join(fixture.folder.path, "assets", `${card.blobId}.png`);
    const failingCards = new Proxy(fixture.library as unknown as CardService, {
      get(target, property) {
        if (property === "delete") {
          return async (): Promise<never> => {
            throw new Error("模擬卡片刪除失敗");
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const service = fixture.buildService(makeProtocolCapture().protocol, failingCards);
    await expect(service.delete("conv-1")).rejects.toMatchObject({ code: "unavailable" });
    expect(existsSync(cardPath(fixture, card.cardId))).toBe(true);
    expect(existsSync(assetPath)).toBe(true);
    expect(
      fixture.storage.cache.get("SELECT 1 AS one FROM card_index WHERE card_id = ?", card.cardId),
    ).toBeDefined();

    // 和主機啟動的刪除恢復一樣：先確定引擎刪完，再移除意圖（補刪卡片與原檔）。
    await fixture.engine.deleteConversation("conv-1");
    fixture.storage.deletions.removeIntent("conv-1");

    expect(existsSync(cardPath(fixture, card.cardId))).toBe(false);
    expect(existsSync(assetPath)).toBe(false);
    expect(
      fixture.storage.state.get(
        "SELECT 1 AS one FROM conversation_deletions WHERE root_id = 'conv-1'",
      ),
    ).toBeUndefined();
    const listed = await fixture.library.list({});
    expect(listed.items.map((item) => item.cardId)).not.toContain(card.cardId);
    expect(byteSearch(fixture.folder.path, ["帶原檔的卡片 的內容", "asset-帶原檔的卡片"])).toEqual(
      [],
    );
  });
});
