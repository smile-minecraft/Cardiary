import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContextAssembler, resolveAddLayer } from "../../src/context/assembler.js";
import { ContextStore } from "../../src/context/store.js";
import { createContextFixture, type ContextFixture } from "./support.js";
import { openStateDatabase } from "@cardiary/storage";

let fixture: ContextFixture;

beforeEach(async () => {
  fixture = await createContextFixture();
});

afterEach(() => {
  fixture.close();
});

function assemblerOf(
  options: { readonly contextWindow?: number; readonly threshold?: number } = {},
): ContextAssembler {
  const store = new ContextStore(fixture.db);
  return new ContextAssembler({
    store,
    cards: fixture.cards,
    budget: () => ({
      contextWindow: options.contextWindow ?? 100_000,
      reserveTokens: 0,
      compactionThreshold: options.threshold ?? 0.75,
    }),
    now: () => new Date("2026-11-15T04:00:00.000Z"),
    timeZone: "Asia/Taipei",
  });
}

describe("八層的組裝", () => {
  it("固定前綴依層順序排列；卡片只往後追加，前一輪是下一輪的位元組前綴", async () => {
    fixture.cards.add({ kind: "bedrock", title: "基岩", body: "不變的規則。" });
    fixture.cards.add({ kind: "persona", title: "人格", body: "直接、簡短。" });
    const memory = fixture.cards.add({ kind: "memory", title: "記憶", body: "使用者喜歡茶。" });
    const note = fixture.cards.add({ kind: "note", title: "筆記", body: "今天討論排程。" });
    const assembler = assemblerOf();
    const session = "conv_context_layers";

    const first = await assembler.addCard(session, memory.cardId);
    const second = await assembler.addCard(session, note.cardId);
    const assembled = await assembler.assemble(session);

    expect(first.entries.map((entry) => entry.layer)).toEqual([
      "bedrock",
      "persona",
      "opening-memory",
      "working-context",
      "volatile-state",
    ]);
    expect(second.entries.some((entry) => entry.cardId === note.cardId)).toBe(true);
    expect(assembled.view.entries.map((entry) => entry.layer)).toEqual([
      "bedrock",
      "persona",
      "opening-memory",
      "other-cards",
      "working-context",
      "volatile-state",
    ]);
    const positions = ["基岩", "人格", "記憶", "筆記"].map((title) =>
      assembled.systemContext.indexOf(title),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
    expect(assembled.view.usedTokens).toBe(
      assembled.view.entries.reduce((sum, entry) => sum + entry.tokenEstimate, 0),
    );

    const third = await assembler.addCard(
      session,
      fixture.cards.add({ kind: "note", title: "第二張筆記", body: "補充。" }).cardId,
    );
    const after = await assembler.assemble(session);
    expect(after.systemContext.startsWith(assembled.systemContext)).toBe(true);
    expect(third.entries.at(-1)?.layer).toBe("volatile-state");
  });

  it("晚加入的記憶卡改放第 6 層尾端，不插入已送出的前綴", async () => {
    fixture.cards.add({ kind: "bedrock", title: "基岩", body: "規則。" });
    const note = fixture.cards.add({ kind: "note", title: "筆記", body: "內容。" });
    const assembler = assemblerOf();
    const session = "conv_append_only";
    await assembler.addCard(session, note.cardId);
    const before = await assembler.assemble(session);

    const lateMemory = fixture.cards.add({ kind: "memory", title: "後來的記憶", body: "新記憶。" });
    await assembler.addCard(session, lateMemory.cardId);
    const after = await assembler.assemble(session);
    expect(after.systemContext.startsWith(before.systemContext)).toBe(true);
    const entry = after.view.entries.find((item) => item.cardId === lateMemory.cardId);
    expect(entry?.layer).toBe("other-cards");
  });

  it("不同對話各自有版本與卡片，不能用另一場的卡片移除", async () => {
    const memory = fixture.cards.add({ kind: "memory", title: "工作節奏", body: "工作習慣。" });
    const assembler = assemblerOf();
    const first = await assembler.addCard("conv_first", memory.cardId);
    const second = await assembler.view("conv_second");
    const store = new ContextStore(fixture.db);

    expect(first.version).toBeGreaterThan(second.version);
    expect(store.entryOfCard("conv_first", memory.cardId)).not.toBeNull();
    expect(store.entryOfCard("conv_second", memory.cardId)).toBeNull();
    await expect(assembler.removeCard("conv_second", memory.cardId)).rejects.toThrow(
      `卡片 ${memory.cardId} 不在這場對話的上下文裡。`,
    );
  });

  it("重啟後既有上下文仍在：重新開啟狀態庫可讀到同一份視圖", async () => {
    const memory = fixture.cards.add({ kind: "memory", title: "重啟後還在", body: "內容。" });
    const session = "conv_restart";
    const before = await assemblerOf().addCard(session, memory.cardId);
    fixture.db.close();

    const reopened = openStateDatabase({
      filePath: `${fixture.root}/state/cardiary.sqlite`,
      appVersion: "0.1.0",
      backupDirectory: `${fixture.root}/tmp`,
    });
    try {
      const after = await new ContextAssembler({
        store: new ContextStore(reopened.db),
        cards: fixture.cards,
        budget: () => ({ contextWindow: 100_000, reserveTokens: 0, compactionThreshold: 0.75 }),
        now: () => new Date("2026-11-15T04:00:00.000Z"),
        timeZone: "Asia/Taipei",
      }).view(session);

      expect(after.sessionId).toBe(session);
      expect(after.version).toBe(before.version);
      expect(after.entries.map((entry) => entry.cardId)).toContain(memory.cardId);
    } finally {
      reopened.db.close();
    }
  });

  it("移除只標記，卡片仍在上下文；用量由最近一輪校正", async () => {
    fixture.cards.add({ kind: "bedrock", title: "基岩", body: "規則。" });
    const note = fixture.cards.add({ kind: "note", title: "筆記", body: "內容。" });
    const assembler = assemblerOf();
    const session = "conv_removal";
    await assembler.addCard(session, note.cardId);

    const store = new ContextStore(fixture.db);
    store.recordUsage({
      conversationId: session,
      turnId: "turn_1",
      inputTokens: 400,
      outputTokens: 20,
      cacheReadTokens: 600,
      cacheWriteTokens: 0,
      requestTokens: 1_000,
      recordedAt: new Date().toISOString(),
    });

    const removed = await assembler.removeCard(session, note.cardId);
    const entry = removed.entries.find((item) => item.cardId === note.cardId);
    expect(entry?.state).toBe("pending-removal");
    expect(removed.usedTokens).toBe(
      removed.entries.reduce((sum, item) => sum + item.tokenEstimate, 0),
    );
  });

  it("自然層已在最後一張卡之前時，改放第 6 層", () => {
    expect(
      resolveAddLayer("memory", [
        {
          entryId: "a",
          layer: "other-cards",
          cardId: "card_1",
          title: "",
          tokenEstimate: 0,
          state: "active",
          position: 0,
        },
      ]),
    ).toBe("other-cards");
    expect(
      resolveAddLayer("memory", [
        {
          entryId: "a",
          layer: "opening-memory",
          cardId: "card_1",
          title: "",
          tokenEstimate: 0,
          state: "active",
          position: 0,
        },
      ]),
    ).toBe("opening-memory");
  });
});
