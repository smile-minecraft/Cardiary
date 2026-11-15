import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encodeSummaryFooter, parseSummaryFooter } from "@cardiary/domain";

import { ContextAssembler } from "../../src/context/assembler.js";
import { ContextCompactor } from "../../src/context/compactor.js";
import { ContextServiceImpl } from "../../src/context/service.js";
import { ContextStore } from "../../src/context/store.js";
import {
  createContextFixture,
  createConversation,
  send,
  StubModels,
  type ContextFixture,
} from "./support.js";

let fixture: ContextFixture;

beforeEach(async () => {
  fixture = await createContextFixture();
});

afterEach(() => {
  fixture.close();
});

function build(options: {
  readonly keepRecentTokens?: number;
  readonly window?: number;
  readonly models?: StubModels;
  /** 省略時用固定時間；要驗時間先後的測試給真的時鐘。 */
  readonly now?: () => Date;
}): {
  store: ContextStore;
  assembler: ContextAssembler;
  compactor: ContextCompactor;
  models: StubModels;
  service: ContextServiceImpl;
  events: { kind: string; payload?: unknown; context?: unknown }[];
} {
  const store = new ContextStore(fixture.db);
  const events: { kind: string; payload?: unknown; context?: unknown }[] = [];
  const now = options.now ?? (() => new Date("2026-11-15T04:00:00.000Z"));
  const assembler = new ContextAssembler({
    store,
    cards: fixture.cards,
    budget: () => ({
      contextWindow: options.window ?? 100_000,
      reserveTokens: 0,
      compactionThreshold: 0.75,
    }),
    now,
    timeZone: "Asia/Taipei",
  });
  const models = options.models ?? new StubModels();
  const compactor = new ContextCompactor({
    store,
    assembler,
    engine: fixture.engine,
    cards: fixture.cards,
    models,
    now,
    keepRecentTokens: () => options.keepRecentTokens ?? 0,
    emit: (intent) => events.push(intent),
  });
  const service = new ContextServiceImpl({
    store,
    assembler,
    compactor,
    engine: fixture.engine,
    models,
    protocol: { emit: () => {} },
    now,
    settingNumber: (_key, fallback) => fallback,
    contextWindow: () => options.window ?? 100_000,
  });
  return { store, assembler, compactor, models, service, events };
}

describe("壓縮", () => {
  it("摘要成短期記憶卡、記錄血緣、丟棄逐字稿並套用移除標記", async () => {
    const session = await createConversation(fixture.engine);
    await send(fixture.engine, session, "訊息 1");
    await send(fixture.engine, session, "訊息 2");
    await send(fixture.engine, session, "訊息 3");

    const note = fixture.cards.add({ kind: "note", title: "筆記", body: "內容。" });
    const { store, assembler, compactor, models, events } = build({});
    await assembler.addCard(session, note.cardId);
    await assembler.removeCard(session, note.cardId);
    store.recordUsage({
      conversationId: session,
      turnId: "turn_3",
      inputTokens: 700,
      outputTokens: 40,
      cacheReadTokens: 200,
      cacheWriteTokens: 0,
      requestTokens: 900,
      recordedAt: "2026-11-15T03:00:00.000Z",
    });
    const before = await assembler.view(session);
    expect(before.entries.some((entry) => entry.state === "pending-removal")).toBe(true);

    const outcome = await compactor.compact(session, { trigger: "manual" });
    expect(outcome.compacted).toBe(true);
    expect(outcome.summaryCardId).toBeDefined();
    expect(models.requests[0]?.role).toBe("small");
    expect(models.requests[0]?.maxOutputTokens).toBeGreaterThanOrEqual(4_096);

    const summary = await fixture.cards.get(outcome.summaryCardId ?? "");
    expect(summary?.frontmatter.kind).toBe("summary");
    const footer = parseSummaryFooter(summary?.body ?? "");
    expect(footer?.conversationId).toBe(session);
    expect(footer?.fromCursor).not.toBe("");
    // 摘要卡也要記一次對話載入：刪除對話時它才會被當成專屬卡片帶走。
    expect(fixture.cards.loads).toContainEqual({
      conversationId: session,
      cardId: outcome.summaryCardId,
    });

    const after = await assembler.view(session);
    expect(after.entries.some((entry) => entry.cardId === note.cardId)).toBe(false);
    expect(after.usedTokens).toBe(
      after.entries.reduce((sum, entry) => sum + entry.tokenEstimate, 0),
    );
    expect(after.usedTokens).toBeLessThan(before.usedTokens);
    expect(after.entries.some((entry) => entry.layer === "short-term-memory")).toBe(true);

    expect(fixture.engine.readContextStart(session)).toBeGreaterThan(0);
    expect(events.some((event) => event.kind === "context-changed")).toBe(true);
    const compacted = events.find((event) => event.kind === "context-compacted");
    expect((compacted?.payload as { summaryCardId?: string })?.summaryCardId).toBe(
      outcome.summaryCardId,
    );

    // 重跑同一個範圍：沿用同一張摘要卡，不產生第二張。
    const countBefore = fixture.cards.count;
    const second = await compactor.compact(session, { trigger: "recovery" });
    expect(second.summaryCardId).toBe(outcome.summaryCardId);
    expect(fixture.cards.count).toBe(countBefore);

    // 對話能繼續：下一個請求看得到摘要，被摘要的訊息不再送進模型。
    await send(fixture.engine, session, "繼續");
    const snapshot = fixture.engine.readPromptLog(session).at(-1);
    const requestTexts = snapshot?.messages.map((message) => message.text).join("\n") ?? "";
    // 摘要在第 5 層的固定前綴裡；被摘要的訊息不再進模型請求。
    expect(snapshot?.systemContext).toContain("前面在處理卡片與測試");
    expect(requestTexts).not.toContain("訊息 1");
    void store;
  });

  it("壓縮後送出的前綴不含被移除的卡片", async () => {
    const session = await createConversation(fixture.engine);
    await send(fixture.engine, session, "訊息 1");
    await send(fixture.engine, session, "訊息 2");
    await send(fixture.engine, session, "訊息 3");
    const note = fixture.cards.add({ kind: "note", title: "筆記", body: "內容。" });
    const { assembler, compactor } = build({});
    await assembler.addCard(session, note.cardId);
    await assembler.removeCard(session, note.cardId);

    const outcome = await compactor.compact(session, { trigger: "manual" });
    expect(outcome.compacted).toBe(true);

    await send(fixture.engine, session, "繼續");
    const snapshot = fixture.engine.readPromptLog(session).at(-1);
    expect(snapshot?.systemContext).toContain("前面在處理卡片與測試");
    expect(snapshot?.systemContext).not.toContain("筆記");
  });

  it("摘要失敗不刪資料，標記與逐字稿都留著，可以重試", async () => {
    const session = await createConversation(fixture.engine);
    await send(fixture.engine, session, "訊息 1");
    await send(fixture.engine, session, "訊息 2");
    await send(fixture.engine, session, "訊息 3");
    const note = fixture.cards.add({ kind: "note", title: "筆記", body: "內容。" });
    const models = new StubModels();
    models.fail = true;
    const { store, assembler, compactor } = build({ models });
    await assembler.addCard(session, note.cardId);
    await assembler.removeCard(session, note.cardId);

    const outcome = await compactor.compact(session, { trigger: "manual" });
    expect(outcome).toEqual({ compacted: false, reason: "summary-failed" });
    expect(fixture.engine.readContextStart(session)).toBe(0);
    const view = await assembler.view(session);
    expect(view.entries.some((entry) => entry.cardId === note.cardId)).toBe(true);
    expect(store.interrupted()).toEqual([]);

    models.fail = false;
    const retry = await compactor.compact(session, { trigger: "manual" });
    expect(retry.compacted).toBe(true);
    expect(
      (await assembler.view(session)).entries.some((entry) => entry.cardId === note.cardId),
    ).toBe(false);
  });

  it("假引擎的固定前綴依層順序；前一輪訊息是下一輪的前綴", async () => {
    fixture.cards.add({ kind: "bedrock", title: "基岩", body: "規則。" });
    fixture.cards.add({ kind: "persona", title: "人格", body: "直接。" });
    const memory = fixture.cards.add({ kind: "memory", title: "記憶", body: "喜歡茶。" });
    const note = fixture.cards.add({ kind: "note", title: "筆記", body: "排程。" });
    const session = await createConversation(fixture.engine);
    const { assembler } = build({});
    await assembler.addCard(session, memory.cardId);
    await assembler.addCard(session, note.cardId);
    const assembled = await assembler.assemble(session);
    await fixture.engine.configureConversationContext(session, assembled.systemContext);

    for (let index = 1; index <= 3; index += 1) {
      await send(fixture.engine, session, `訊息 ${index}`);
    }
    const snapshots = fixture.engine.readPromptLog(session);
    expect(snapshots).toHaveLength(3);
    const systemContext = snapshots[0]?.systemContext ?? "";
    const order = ["基岩", "人格", "記憶", "筆記"].map((title) => systemContext.indexOf(title));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
    for (let index = 1; index < snapshots.length; index += 1) {
      const previous = snapshots[index - 1]?.messages ?? [];
      const next = snapshots[index]?.messages ?? [];
      expect(previous.length).toBeGreaterThan(0);
      expect(previous.length).toBeLessThanOrEqual(next.length);
      expect(
        previous.every((message, position) => {
          const other = next[position];
          return (
            other !== undefined && other.cursor === message.cursor && other.text === message.text
          );
        }),
      ).toBe(true);
    }
  });

  it("中斷的壓縮在重啟後補做，完成後清掉標記", async () => {
    const session = await createConversation(fixture.engine);
    await send(fixture.engine, session, "訊息 1");
    await send(fixture.engine, session, "訊息 2");
    await send(fixture.engine, session, "訊息 3");
    const { store, compactor } = build({});
    store.ensure(session, {
      contextWindow: 100_000,
      budgetTokens: 100_000,
      compactionThreshold: 0.75,
      reserveTokens: 0,
    });
    store.setCompactionInProgress(session, true);
    expect(store.interrupted()).toContain(session);

    await compactor.recoverInterrupted();
    expect(store.interrupted()).toEqual([]);
    expect(store.read(session)?.lastCompactedAt).toBeDefined();
  });

  it("用量達到門檻時自動排入壓縮", async () => {
    const session = await createConversation(fixture.engine);
    await send(fixture.engine, session, "訊息 1");
    await send(fixture.engine, session, "訊息 2");
    await send(fixture.engine, session, "訊息 3");

    const store = new ContextStore(fixture.db);
    const models = new StubModels();
    const events: { kind: string }[] = [];
    let service: ContextServiceImpl | null = null;
    const assembler = new ContextAssembler({
      store,
      cards: fixture.cards,
      budget: () =>
        service?.budget() ?? {
          contextWindow: 20,
          reserveTokens: 0,
          compactionThreshold: 0.75,
        },
      now: () => new Date("2026-11-15T04:00:00.000Z"),
      timeZone: "Asia/Taipei",
    });
    const compactor = new ContextCompactor({
      store,
      assembler,
      engine: fixture.engine,
      cards: fixture.cards,
      models,
      now: () => new Date("2026-11-15T04:00:00.000Z"),
      keepRecentTokens: () => 0,
      emit: (intent) => events.push(intent),
    });
    service = new ContextServiceImpl({
      store,
      assembler,
      compactor,
      engine: fixture.engine,
      models,
      protocol: { emit: () => {} },
      now: () => new Date("2026-11-15T04:00:00.000Z"),
      settingNumber: (key, fallback) =>
        key === "context.reserveTokens"
          ? 0
          : key === "context.compactionThreshold"
            ? 0.75
            : fallback,
      contextWindow: () => 20,
    });

    await service.recordUsage(session, "turn_3");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (models.requests.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(models.requests).toHaveLength(1);
    const view = await assembler.view(session);
    expect(view.entries.some((entry) => entry.layer === "short-term-memory")).toBe(true);
    expect(events.some((event) => event.kind === "context-compacted")).toBe(true);
  });

  it("第二次壓縮只摘要上次摘要之後的訊息，摘要卡不重疊", async () => {
    const long = (index: number): string => `訊息 ${index}：${"內容".repeat(100)}`;
    const session = await createConversation(fixture.engine);
    await send(fixture.engine, session, long(1));
    await send(fixture.engine, session, long(2));
    await send(fixture.engine, session, long(3));

    // 每次呼叫時鐘往前一秒：用量一定早於後面的壓縮，順序可重現。
    let tick = 0;
    const clock = (): Date => new Date(Date.UTC(2026, 10, 15, 4, 0, tick++));
    const { store, assembler, compactor, models } = build({
      keepRecentTokens: 0,
      now: clock,
    });
    const first = await compactor.compact(session, { trigger: "manual" });
    expect(first.compacted).toBe(true);
    const firstFooter = parseSummaryFooter(
      (await fixture.cards.get(first.summaryCardId ?? ""))?.body ?? "",
    );
    expect(firstFooter).not.toBeNull();

    await send(fixture.engine, session, long(4));
    await send(fixture.engine, session, long(5));
    await send(fixture.engine, session, long(6));
    const history = await fixture.engine.readConversationHistory({
      conversationId: session as never,
      limit: 200,
    });
    const firstEnd = history.messages.findIndex(
      (message) => message.cursor === firstFooter?.toCursor,
    );
    expect(firstEnd).toBeGreaterThanOrEqual(0);

    const usage = fixture.engine.readConversationUsage(session as never);
    expect(usage).not.toBeNull();
    store.recordUsage({
      conversationId: session,
      turnId: usage?.turnId ?? "turn_6",
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cacheReadTokens: usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
      requestTokens: usage?.requestTokens ?? 0,
      recordedAt: clock().toISOString(),
    });
    const beforeSecond = await assembler.view(session);
    const requestsBefore = models.requests.length;

    const second = await compactor.compact(session, { trigger: "manual" });
    expect(second.compacted).toBe(true);
    expect(second.summaryCardId).not.toBe(first.summaryCardId);
    const secondFooter = parseSummaryFooter(
      (await fixture.cards.get(second.summaryCardId ?? ""))?.body ?? "",
    );
    // 新的摘要從上一張的最後一則之後開始；兩張卡涵蓋的訊息不重疊。
    expect(secondFooter?.fromCursor).toBe(history.messages[firstEnd + 1]?.cursor);
    expect(secondFooter?.toCursor).not.toBe(firstFooter?.toCursor);
    expect(fixture.cards.count).toBe(2);

    // 第二次摘要的逐字稿只看得到上次摘要之後的內容。
    const secondPrompt = models.requests[requestsBefore]?.prompt ?? "";
    expect(secondPrompt).toContain("訊息 4");
    expect(secondPrompt).not.toContain("訊息 1");
    expect(secondPrompt).not.toContain("訊息 2");
    expect(secondPrompt).not.toContain("訊息 3");

    // 壓縮後的用量比壓縮前下降；壓縮後再讀視圖，數字也和壓縮結果一致。
    expect(beforeSecond.usedTokens).toBeGreaterThan(0);
    expect(second.afterTokens ?? Number.POSITIVE_INFINITY).toBeLessThan(beforeSecond.usedTokens);
    const afterView = await assembler.view(session);
    expect(afterView.usedTokens).toBeLessThan(beforeSecond.usedTokens);
  });

  it("沒有新內容時再壓縮不新增摘要卡", async () => {
    const session = await createConversation(fixture.engine);
    await send(fixture.engine, session, "訊息 1");
    await send(fixture.engine, session, "訊息 2");
    await send(fixture.engine, session, "訊息 3");

    const { compactor, models } = build({ keepRecentTokens: 0 });
    const first = await compactor.compact(session, { trigger: "manual" });
    expect(first.compacted).toBe(true);
    const cardsBefore = fixture.cards.count;
    const requestsBefore = models.requests.length;

    const again = await compactor.compact(session, { trigger: "manual" });
    expect(again).toEqual({ compacted: false, reason: "nothing-to-compact" });
    expect(fixture.cards.count).toBe(cardsBefore);
    expect(models.requests).toHaveLength(requestsBefore);
  });
});

describe("第 5 層裡不是本場對話的摘要卡", () => {
  const long = (index: number): string => `訊息 ${index}：${"內容".repeat(100)}`;

  it("加入別場的摘要卡再標記移除：壓縮照常執行，移除標記一併套用", async () => {
    const session = await createConversation(fixture.engine);
    const other = await createConversation(fixture.engine);
    for (let index = 1; index <= 3; index += 1) {
      await send(fixture.engine, session, long(index));
    }
    const foreign = fixture.cards.add({
      kind: "summary",
      title: "別場的摘要",
      body: `別場的對話摘要。\n\n${encodeSummaryFooter({
        conversationId: other,
        fromCursor: "conv-other-1",
        toCursor: "conv-other-9",
        keepFromCursor: "conv-other-10",
      })}`,
    });
    const { store, assembler, compactor, service } = build({ keepRecentTokens: 0 });
    await service.addCard({ sessionId: session, cardId: foreign.cardId });
    await service.removeCard({ sessionId: session, cardId: foreign.cardId });
    store.recordUsage({
      conversationId: session,
      turnId: "turn_3",
      inputTokens: 700,
      outputTokens: 40,
      cacheReadTokens: 200,
      cacheWriteTokens: 0,
      requestTokens: 900,
      recordedAt: "2026-11-15T03:00:00.000Z",
    });
    const before = await assembler.view(session);
    expect(before.entries.find((entry) => entry.cardId === foreign.cardId)?.state).toBe(
      "pending-removal",
    );

    const outcome = await compactor.compact(session, { trigger: "manual" });

    expect(outcome.compacted).toBe(true);
    const after = await assembler.view(session);
    expect(after.entries.some((entry) => entry.cardId === foreign.cardId)).toBe(false);
    expect(after.usedTokens).toBeLessThan(before.usedTokens);
  });

  it("沒有血緣標記的摘要卡不阻擋壓縮，摘要從歷史最前面開始", async () => {
    const session = await createConversation(fixture.engine);
    for (let index = 1; index <= 3; index += 1) {
      await send(fixture.engine, session, long(index));
    }
    const history = await fixture.engine.readConversationHistory({
      conversationId: session as never,
      limit: 200,
    });
    const plain = fixture.cards.add({
      kind: "summary",
      title: "手寫的重點",
      body: "使用者自己整理的摘要。",
    });
    const { assembler, compactor, service } = build({ keepRecentTokens: 0 });
    await service.addCard({ sessionId: session, cardId: plain.cardId });

    const outcome = await compactor.compact(session, { trigger: "manual" });

    expect(outcome.compacted).toBe(true);
    const footer = parseSummaryFooter(
      (await fixture.cards.get(outcome.summaryCardId ?? ""))?.body ?? "",
    );
    expect(footer?.conversationId).toBe(session);
    expect(footer?.fromCursor).toBe(history.messages[0]?.cursor);
    const after = await assembler.view(session);
    // 手寫的摘要卡只是一般卡片，沒有被當成壓縮的起點，也沒有被拿走。
    expect(after.entries.some((entry) => entry.cardId === plain.cardId)).toBe(true);
    expect(after.usedTokens).toBe(
      after.entries.reduce((sum, entry) => sum + entry.tokenEstimate, 0),
    );
  });
});
