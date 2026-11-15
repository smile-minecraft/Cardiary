import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encodeSummaryFooter, parseSummaryFooter } from "@cardiary/domain";

import { ContextAssembler } from "../../src/context/assembler.js";
import { ContextCompactor } from "../../src/context/compactor.js";
import { ContextServiceImpl } from "../../src/context/service.js";
import { ContextStore } from "../../src/context/store.js";
import { entryIdOf } from "../../src/context/assembler.js";
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

const long = (index: number): string => `訊息 ${index}：${"內容".repeat(100)}`;

function build(options: {
  readonly keepRecentTokens?: number;
  readonly models?: StubModels;
  readonly now?: () => Date;
}): {
  store: ContextStore;
  assembler: ContextAssembler;
  compactor: ContextCompactor;
  models: StubModels;
} {
  const store = new ContextStore(fixture.db);
  const now = options.now ?? (() => new Date("2026-11-15T04:00:00.000Z"));
  const assembler = new ContextAssembler({
    store,
    cards: fixture.cards,
    budget: () => ({
      contextWindow: 100_000,
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
  });
  return { store, assembler, compactor, models };
}

async function summaryFooters(): Promise<
  { readonly fromCursor: string; readonly toCursor: string }[]
> {
  const page = await fixture.cards.list({ kinds: ["summary"] });
  const footers: { readonly fromCursor: string; readonly toCursor: string }[] = [];
  for (const summary of page.items) {
    const card = await fixture.cards.get(summary.cardId);
    const footer = card === null ? null : parseSummaryFooter(card.body);
    if (footer !== null) footers.push(footer);
  }
  return footers;
}

function sumEntries(view: {
  readonly entries: readonly { readonly tokenEstimate: number }[];
}): number {
  return view.entries.reduce((sum, entry) => sum + entry.tokenEstimate, 0);
}

describe("中斷的壓縮在重啟後", () => {
  it("第二次壓縮在 commit 前失敗：recovery 後仍是兩張不重疊的卡", async () => {
    const session = await createConversation(fixture.engine);
    for (let index = 1; index <= 3; index += 1) {
      await send(fixture.engine, session, long(index));
    }
    let tick = 0;
    const clock = (): Date => new Date(Date.UTC(2026, 10, 15, 4, 0, tick++));
    const { store, assembler, compactor, models } = build({ keepRecentTokens: 0, now: clock });
    store.ensure(session, {
      contextWindow: 100_000,
      budgetTokens: 100_000,
      compactionThreshold: 0.75,
      reserveTokens: 0,
    });
    models.text = "甲摘要";
    const first = await compactor.compact(session, { trigger: "manual" });
    expect(first.compacted).toBe(true);
    const firstFooter = parseSummaryFooter(
      (await fixture.cards.get(first.summaryCardId ?? ""))?.body ?? "",
    );
    expect(firstFooter).not.toBeNull();

    for (let index = 4; index <= 6; index += 1) {
      await send(fixture.engine, session, long(index));
    }
    models.text = "乙摘要";

    // 引擎 commit 失敗：摘要卡與第 5 層項目照常寫入，旗標留著。
    const original = fixture.engine.compactConversation?.bind(fixture.engine);
    (fixture.engine as { compactConversation?: unknown }).compactConversation = async () => {
      throw new Error("引擎 commit 失敗");
    };
    const second = await compactor.compact(session, { trigger: "manual" });
    expect(second).toEqual({ compacted: false, reason: "engine-failed" });
    expect(store.interrupted()).toContain(session);

    (fixture.engine as { compactConversation?: unknown }).compactConversation = original;
    const requestsBefore = models.requests.length;
    await compactor.recoverInterrupted();

    const footers = await summaryFooters();
    expect(footers).toHaveLength(2);
    const history = await fixture.engine.readConversationHistory({
      conversationId: session as never,
      limit: 200,
    });
    const firstEnd = history.messages.findIndex(
      (message) => message.cursor === firstFooter?.toCursor,
    );
    expect(firstEnd).toBeGreaterThanOrEqual(0);
    const firstEndCursor = history.messages[firstEnd]?.cursor;
    const secondFooter = footers.find((footer) => footer.toCursor !== firstFooter?.toCursor);
    expect(secondFooter?.fromCursor).toBe(history.messages[firstEnd + 1]?.cursor);
    expect(secondFooter?.fromCursor).not.toBe(undefined);
    expect(secondFooter?.toCursor).not.toBe(firstEndCursor);

    // 補做沒有重新摘要；用量和項目加總一致；旗標清掉。
    expect(models.requests).toHaveLength(requestsBefore);
    const after = await assembler.view(session);
    expect(after.usedTokens).toBe(sumEntries(after));
    expect(store.interrupted()).toEqual([]);
  });

  it("commit 完成但旗標未清：recovery 不重建卡、不重摘、不重設保留範圍", async () => {
    const session = await createConversation(fixture.engine);
    for (let index = 1; index <= 3; index += 1) {
      await send(fixture.engine, session, long(index));
    }
    let tick = 0;
    const clock = (): Date => new Date(Date.UTC(2026, 10, 15, 4, 0, tick++));
    const { store, assembler, compactor, models } = build({ keepRecentTokens: 0, now: clock });
    store.ensure(session, {
      contextWindow: 100_000,
      budgetTokens: 100_000,
      compactionThreshold: 0.75,
      reserveTokens: 0,
    });
    models.text = "甲摘要";
    const first = await compactor.compact(session, { trigger: "manual" });
    expect(first.compacted).toBe(true);
    for (let index = 4; index <= 6; index += 1) {
      await send(fixture.engine, session, long(index));
    }
    models.text = "乙摘要";
    const second = await compactor.compact(session, { trigger: "manual" });
    expect(second.compacted).toBe(true);

    // 模擬「commit 之後、清旗標之前」被強制結束。
    store.setCompactionInProgress(session, true);
    const cardsBefore = (await fixture.cards.list({ kinds: ["summary"] })).items.length;
    const contextStartBefore = fixture.engine.readContextStart(session);
    const requestsBefore = models.requests.length;
    const usedBefore = (await assembler.view(session)).usedTokens;

    await compactor.recoverInterrupted();

    expect((await fixture.cards.list({ kinds: ["summary"] })).items).toHaveLength(cardsBefore);
    expect(models.requests).toHaveLength(requestsBefore);
    expect(fixture.engine.readContextStart(session)).toBe(contextStartBefore);
    expect((await assembler.view(session)).usedTokens).toBe(usedBefore);
    expect(store.interrupted()).toEqual([]);
  });

  it("中斷在建立卡片之前：recovery 依已完成的摘要接續，補做完整", async () => {
    const session = await createConversation(fixture.engine);
    for (let index = 1; index <= 3; index += 1) {
      await send(fixture.engine, session, long(index));
    }
    let tick = 0;
    const clock = (): Date => new Date(Date.UTC(2026, 10, 15, 4, 0, tick++));
    const { store, assembler, compactor, models } = build({ keepRecentTokens: 0, now: clock });
    store.ensure(session, {
      contextWindow: 100_000,
      budgetTokens: 100_000,
      compactionThreshold: 0.75,
      reserveTokens: 0,
    });
    models.text = "甲摘要";
    const first = await compactor.compact(session, { trigger: "manual" });
    expect(first.compacted).toBe(true);
    const firstFooter = parseSummaryFooter(
      (await fixture.cards.get(first.summaryCardId ?? ""))?.body ?? "",
    );

    for (let index = 4; index <= 6; index += 1) {
      await send(fixture.engine, session, long(index));
    }
    // 模擬第二次壓縮在摘要模型回傳後、建立卡片前被強制結束：旗標還在，但沒有新卡。
    store.setCompactionInProgress(session, true);
    const requestsBefore = models.requests.length;

    await compactor.recoverInterrupted();

    const footers = await summaryFooters();
    expect(footers).toHaveLength(2);
    const history = await fixture.engine.readConversationHistory({
      conversationId: session as never,
      limit: 200,
    });
    const firstEnd = history.messages.findIndex(
      (message) => message.cursor === firstFooter?.toCursor,
    );
    const secondFooter = footers.find((footer) => footer.toCursor !== firstFooter?.toCursor);
    // 補做的摘要從第一張結束之後接續，不重疊。
    expect(secondFooter?.fromCursor).toBe(history.messages[firstEnd + 1]?.cursor);
    expect(models.requests).toHaveLength(requestsBefore + 1);
    const after = await assembler.view(session);
    expect(after.usedTokens).toBe(sumEntries(after));
    expect(store.interrupted()).toEqual([]);
  });

  it("真的走 attach() 模擬重啟：下一次 prompt 的固定前綴只有一份摘要", async () => {
    const session = await createConversation(fixture.engine);
    const longMessage = long;
    const make = (): {
      store: ContextStore;
      assembler: ContextAssembler;
      compactor: ContextCompactor;
      models: StubModels;
      service: ContextServiceImpl;
    } => {
      const store = new ContextStore(fixture.db);
      const now = (): Date => new Date("2026-11-15T04:00:00.000Z");
      const models = new StubModels();
      const assembler = new ContextAssembler({
        store,
        cards: fixture.cards,
        budget: () => ({
          contextWindow: 100_000,
          reserveTokens: 0,
          compactionThreshold: 0.75,
        }),
        now,
        timeZone: "Asia/Taipei",
      });
      const compactor = new ContextCompactor({
        store,
        assembler,
        engine: fixture.engine,
        cards: fixture.cards,
        models,
        now,
        keepRecentTokens: () => 0,
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
        contextWindow: () => 100_000,
      });
      return { store, assembler, compactor, models, service };
    };

    for (let index = 1; index <= 3; index += 1) {
      await send(fixture.engine, session, longMessage(index));
    }
    const first = make();
    first.store.ensure(session, {
      contextWindow: 100_000,
      budgetTokens: 100_000,
      compactionThreshold: 0.75,
      reserveTokens: 0,
    });
    first.models.text = "甲摘要";
    const firstOutcome = await first.compactor.compact(session, { trigger: "manual" });
    expect(firstOutcome.compacted).toBe(true);

    for (let index = 4; index <= 6; index += 1) {
      await send(fixture.engine, session, longMessage(index));
    }
    first.models.text = "乙摘要";
    const secondOutcome = await first.compactor.compact(session, { trigger: "manual" });
    expect(secondOutcome.compacted).toBe(true);

    // commit 完成、旗標未清就「被強制結束」；重啟後 attach。
    first.store.setCompactionInProgress(session, true);
    const restored = make();
    const requestsBefore = restored.models.requests.length;
    await restored.service.attach(session);
    await send(fixture.engine, session, "重啟後第一則");

    const snapshot = fixture.engine.readPromptLog(session).at(-1);
    const systemContext = snapshot?.systemContext ?? "";
    const occurrence = (text: string): number => systemContext.split(text).length - 1;
    expect(occurrence("甲摘要")).toBe(1);
    expect(occurrence("乙摘要")).toBe(1);
    expect(restored.models.requests).toHaveLength(requestsBefore);
    expect((await fixture.cards.list({ kinds: ["summary"] })).items).toHaveLength(2);
    const view = await restored.service.view(session);
    expect(view.usedTokens).toBe(sumEntries(view));
    expect(restored.store.interrupted()).toEqual([]);
  });

  it("殘留的摘要卡是舊格式（沒有保留範圍）時：清旗標、不重摘、不建新卡", async () => {
    const session = await createConversation(fixture.engine);
    for (let index = 1; index <= 3; index += 1) {
      await send(fixture.engine, session, long(index));
    }
    const { store, compactor, models } = build({});
    store.ensure(session, {
      contextWindow: 100_000,
      budgetTokens: 100_000,
      compactionThreshold: 0.75,
      reserveTokens: 0,
    });
    models.text = "甲摘要";
    const first = await compactor.compact(session, { trigger: "manual" });
    expect(first.compacted).toBe(true);

    // 手工放一張沒有保留範圍的舊格式摘要卡，模擬修正前寫出的卡。
    const history = await fixture.engine.readConversationHistory({
      conversationId: session as never,
      limit: 200,
    });
    const anchor = history.messages.at(-1)?.cursor ?? "";
    const legacy = fixture.cards.add({
      kind: "summary",
      title: "舊格式摘要",
      body: `舊摘要\n\n${encodeSummaryFooter({
        conversationId: session,
        fromCursor: "",
        toCursor: anchor,
      })}`,
    });
    const position = Math.max(0, ...store.entries(session).map((entry) => entry.position)) + 1;
    store.addEntry(session, {
      entryId: entryIdOf(session, `card:${legacy.cardId}`),
      layer: "short-term-memory",
      cardId: legacy.cardId,
      title: legacy.frontmatter.title,
      tokenEstimate: 10,
      state: "active",
      position,
    });
    store.setCompactionInProgress(session, true);

    const requestsBefore = models.requests.length;
    await compactor.recoverInterrupted();

    expect(store.interrupted()).toEqual([]);
    expect(models.requests).toHaveLength(requestsBefore);
    expect((await fixture.cards.list({ kinds: ["summary"] })).items).toHaveLength(2);
  });

  it("本場摘要卡的保留範圍被改掉：放棄重做、清旗標、資料完整", async () => {
    const session = await createConversation(fixture.engine);
    for (let index = 1; index <= 3; index += 1) {
      await send(fixture.engine, session, long(index));
    }
    const { store, assembler, compactor, models } = build({ keepRecentTokens: 0 });
    store.ensure(session, {
      contextWindow: 100_000,
      budgetTokens: 100_000,
      compactionThreshold: 0.75,
      reserveTokens: 0,
    });
    models.text = "甲摘要";
    const first = await compactor.compact(session, { trigger: "manual" });
    expect(first.compacted).toBe(true);
    const footer = parseSummaryFooter(
      (await fixture.cards.get(first.summaryCardId ?? ""))?.body ?? "",
    );
    expect(footer?.keepFromCursor).toBeDefined();

    // 使用者把保留範圍從標記裡刪掉：摘要範圍還讀得到，但接不回保留範圍。
    fixture.cards.rewrite(
      first.summaryCardId ?? "",
      `改過的摘要\n\n${encodeSummaryFooter({
        conversationId: session,
        fromCursor: footer?.fromCursor ?? "",
        toCursor: footer?.toCursor ?? "",
      })}`,
    );
    store.setCompactionInProgress(session, true);
    const cardsBefore = fixture.cards.count;
    const contextStartBefore = fixture.engine.readContextStart(session);
    const requestsBefore = models.requests.length;
    const usedBefore = (await assembler.view(session)).usedTokens;

    await compactor.recoverInterrupted();

    expect(store.interrupted()).toEqual([]);
    expect(fixture.cards.count).toBe(cardsBefore);
    expect(models.requests).toHaveLength(requestsBefore);
    expect(fixture.engine.readContextStart(session)).toBe(contextStartBefore);
    expect((await assembler.view(session)).usedTokens).toBe(usedBefore);
  });
});
