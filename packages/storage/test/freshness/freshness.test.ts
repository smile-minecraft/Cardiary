import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConversationStore, FreshnessStore, Storage, addDaysIso } from "../../src/index.js";
import { createTempRoot, openTestStorage, type TempRoot } from "../helpers/temp.js";

/**
 * 新鮮度寫入狀態庫的整合測試：真的 SQLite、注入的時鐘與真的卡片檔。
 *
 * 規則本身在 domain 的純函式測試；這裡驗資料從哪裡來、寫回哪裡，以及
 * 卡片檔在保鮮與載入前後位元組不變。
 */

const T0 = "2026-01-01T00:00:00.000Z";
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

interface Fixture {
  readonly temp: TempRoot;
  readonly storage: Storage;
  readonly conversations: ConversationStore;
  readonly freshness: FreshnessStore;
  readonly clock: { now: Date };
}

function makeFixture(halfLifeDays = 30): Fixture {
  const temp = createTempRoot("freshness");
  cleanups.push(temp.cleanup);
  const storage = openTestStorage(temp);
  cleanups.push(() => storage.close());
  const clock = { now: new Date(T0) };
  const conversations = new ConversationStore({
    db: storage.state,
    now: () => clock.now,
  });
  const freshness = new FreshnessStore({
    db: storage.state,
    now: () => clock.now,
    halfLifeDays,
  });
  return { temp, storage, conversations, freshness, clock };
}

function writeCard(fixture: Fixture, cardId: string, body: string): string {
  const directory = path.join(fixture.temp.folder, "cards");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${cardId}.md`);
  const text = [
    "---",
    `id: ${cardId}`,
    "kind: note",
    "title: 測試卡",
    `created: ${T0}`,
    "---",
    body,
  ].join("\n");
  writeFileSync(file, text);
  return file;
}

function addConversation(fixture: Fixture, id: string, archived = false): void {
  fixture.conversations.ensure({ conversationId: id, title: `對話 ${id}`, createdAt: T0 });
  if (archived) {
    fixture.conversations.archive({
      conversationId: id,
      archivedAt: T0,
      purgeAt: addDaysIso(T0, 7),
    });
  }
}

function reference(fixture: Fixture, conversationId: string, cardId: string): void {
  fixture.storage.state.run(
    `INSERT INTO conversation_cards
       (conversation_id, card_id, first_loaded_at, last_loaded_at, load_count)
     VALUES (?, ?, ?, ?, 1)`,
    conversationId,
    cardId,
    T0,
    T0,
  );
}

describe("新鮮度狀態", () => {
  it("平時衰減寫回狀態庫，卡片檔位元組不變", () => {
    const fixture = makeFixture();
    const cardId = "01FRESHNESS000000000000001";
    const file = writeCard(fixture, cardId, "原始內容\n");
    const before = readFileSync(file);
    addConversation(fixture, "conv-1");
    reference(fixture, "conv-1", cardId);
    fixture.freshness.ensure(cardId);
    fixture.storage.state.run(
      "UPDATE card_state SET freshness = 100, freshness_at = ? WHERE card_id = ?",
      T0,
      cardId,
    );

    fixture.clock.now = new Date(addDaysIso(T0, 30));
    const value = fixture.freshness.recompute(cardId);
    expect(value).toBeCloseTo(50, 6);
    expect(fixture.freshness.get(cardId).freshness).toBeCloseTo(50, 6);
    expect(readFileSync(file)).toEqual(before);
  });

  it("實際載入回滿 100；搜尋預覽只記紀錄、不回滿", () => {
    const fixture = makeFixture();
    const cardId = "01FRESHNESS000000000000002";
    writeCard(fixture, cardId, "內容\n");
    addConversation(fixture, "conv-1");
    fixture.freshness.ensure(cardId);
    fixture.storage.state.run(
      "UPDATE card_state SET freshness = 40, freshness_at = ? WHERE card_id = ?",
      T0,
      cardId,
    );

    fixture.clock.now = new Date(addDaysIso(T0, 10));
    expect(
      fixture.freshness.recordLoad({
        conversationId: "conv-1",
        cardId,
        kind: "search",
        countsAsLoad: false,
      }),
    ).toBeLessThan(40);
    expect(fixture.freshness.get(cardId).freshness).toBe(40);

    expect(
      fixture.freshness.recordLoad({
        conversationId: "conv-1",
        cardId,
        kind: "deal",
        countsAsLoad: true,
      }),
    ).toBe(100);
    expect(fixture.freshness.get(cardId).freshness).toBe(100);
  });

  it("手動保鮮回滿，且不改卡片檔", () => {
    const fixture = makeFixture();
    const cardId = "01FRESHNESS000000000000003";
    const file = writeCard(fixture, cardId, "保鮮前\n");
    const before = readFileSync(file);
    fixture.freshness.ensure(cardId);
    fixture.storage.state.run(
      "UPDATE card_state SET freshness = 3, freshness_at = ? WHERE card_id = ?",
      T0,
      cardId,
    );

    expect(fixture.freshness.refresh(cardId)).toBe(100);
    expect(fixture.freshness.get(cardId).freshness).toBe(100);
    expect(readFileSync(file)).toEqual(before);
  });

  it("所屬對話封存後線性下降，取消封存回到平時規則", () => {
    const fixture = makeFixture();
    const cardId = "01FRESHNESS000000000000004";
    writeCard(fixture, cardId, "封存\n");
    fixture.conversations.ensure({ conversationId: "conv-1", createdAt: T0 });
    reference(fixture, "conv-1", cardId);
    fixture.freshness.ensure(cardId);
    fixture.freshness.anchorAfterArchive([cardId], T0);
    fixture.conversations.archive({
      conversationId: "conv-1",
      archivedAt: T0,
      purgeAt: addDaysIso(T0, 7),
    });

    fixture.clock.now = new Date(addDaysIso(T0, 3.5));
    expect(fixture.freshness.compute(cardId)).toBeCloseTo(50, 6);
    fixture.clock.now = new Date(addDaysIso(T0, 7));
    expect(fixture.freshness.compute(cardId)).toBe(0);

    // 取消封存：從倒數當下的值回到一般衰減，不會瞬間回春到 100。
    fixture.clock.now = new Date(addDaysIso(T0, 3.5));
    const current = fixture.freshness.compute(cardId, addDaysIso(T0, 3.5));
    expect(current).toBeCloseTo(50, 6);
    fixture.conversations.unarchive("conv-1");
    fixture.freshness.resumeAfterUnarchive([{ cardId, value: current }], addDaysIso(T0, 3.5));
    expect(fixture.freshness.get(cardId).freshness).toBeCloseTo(50, 6);
    fixture.clock.now = new Date(addDaysIso(T0, 33.5));
    expect(fixture.freshness.compute(cardId)).toBeCloseTo(25, 6);
  });

  it("兩個對話先後封存：錨點是封存當下的有效值，不會回春", () => {
    const fixture = makeFixture();
    const cardId = "01FRESHNESS000000000000010";
    writeCard(fixture, cardId, "兩對話\n");
    addConversation(fixture, "conv-1");
    reference(fixture, "conv-1", cardId);
    fixture.freshness.ensure(cardId);
    fixture.storage.state.run(
      "UPDATE card_state SET freshness = 100, freshness_at = ? WHERE card_id = ?",
      T0,
      cardId,
    );

    // A 封存：先以封存前的有效值留錨點，再標記封存。
    const anchorA = addDaysIso(T0, 1);
    const anchorValue = 100 * 0.5 ** (1 / 30);
    expect(fixture.freshness.anchorAfterArchive([cardId], anchorA)).toBe(1);
    fixture.conversations.archive({
      conversationId: "conv-1",
      archivedAt: anchorA,
      purgeAt: addDaysIso(anchorA, 7),
    });
    expect(fixture.freshness.get(cardId).freshness).toBeCloseTo(anchorValue, 6);

    // 3 天後：線性下降，7 天倒數走了 3 天。
    const t2 = addDaysIso(anchorA, 3);
    fixture.clock.now = new Date(t2);
    const duringLinear = fixture.freshness.compute(cardId, t2);
    expect(duringLinear).toBeCloseTo(anchorValue * (4 / 7), 6);

    // B 開始引用：先留下當下的值，才不會從舊錨點重算回春。
    addConversation(fixture, "conv-2");
    fixture.freshness.anchorBeforeLiveReference(cardId, t2);
    reference(fixture, "conv-2", cardId);
    expect(fixture.freshness.compute(cardId, t2)).toBeCloseTo(duringLinear, 6);

    // B 封存：錨點是封存當下的有效值，不是從舊錨點重算還回 A 的下降。
    fixture.freshness.anchorAfterArchive([cardId], t2);
    fixture.conversations.archive({
      conversationId: "conv-2",
      archivedAt: t2,
      purgeAt: addDaysIso(t2, 7),
    });
    expect(fixture.freshness.compute(cardId, t2)).toBeCloseTo(duringLinear, 6);

    // 再過一天：往最早結束的倒數（A 的）下降，且不再回春。
    const t3 = addDaysIso(t2, 1);
    fixture.clock.now = new Date(t3);
    expect(fixture.freshness.compute(cardId, t3)).toBeCloseTo(duringLinear * (3 / 4), 6);
  });

  it("多個對話引用時，只要一個未封存就按平時計算", () => {
    const fixture = makeFixture();
    const cardId = "01FRESHNESS000000000000005";
    writeCard(fixture, cardId, "共享\n");
    const conversations = fixture.conversations;
    conversations.ensure({ conversationId: "conv-1", createdAt: T0 });
    conversations.ensure({ conversationId: "conv-2", createdAt: T0 });
    reference(fixture, "conv-1", cardId);
    reference(fixture, "conv-2", cardId);
    fixture.freshness.ensure(cardId);
    conversations.archive({
      conversationId: "conv-1",
      archivedAt: T0,
      purgeAt: addDaysIso(T0, 7),
    });

    fixture.clock.now = new Date(addDaysIso(T0, 30));
    expect(fixture.freshness.compute(cardId)).toBeCloseTo(50, 6);
  });

  it("失去所有引用的卡歸零；從沒被對話引用過的卡照平時衰減", () => {
    const fixture = makeFixture();
    const orphan = "01FRESHNESS000000000000006";
    const fresh = "01FRESHNESS000000000000007";
    writeCard(fixture, orphan, "孤兒\n");
    writeCard(fixture, fresh, "新卡\n");
    addConversation(fixture, "conv-1");
    reference(fixture, "conv-1", orphan);
    fixture.freshness.ensure(orphan);
    fixture.freshness.ensure(fresh);
    // 有對話載入紀錄才算「曾經被引用」。
    fixture.freshness.recordLoad({
      conversationId: "conv-1",
      cardId: orphan,
      kind: "deal",
      countsAsLoad: true,
    });
    fixture.storage.state.run("DELETE FROM conversation_cards WHERE card_id = ?", orphan);

    fixture.clock.now = new Date(addDaysIso(T0, 10));
    expect(fixture.freshness.compute(orphan)).toBe(0);
    expect(fixture.freshness.compute(fresh)).toBeGreaterThan(0);
  });

  it("釘在白板的卡固定 100", () => {
    const fixture = makeFixture();
    const cardId = "01FRESHNESS000000000000008";
    writeCard(fixture, cardId, "釘選\n");
    fixture.freshness.ensure(cardId);
    fixture.storage.state.run(
      "UPDATE card_state SET freshness = 4, freshness_at = ?, pinned = 1 WHERE card_id = ?",
      T0,
      cardId,
    );

    fixture.clock.now = new Date(addDaysIso(T0, 365));
    expect(fixture.freshness.compute(cardId)).toBe(100);
  });

  it("封存倒數結束、引用移除後，專屬卡片歸零但檔案還在", () => {
    const fixture = makeFixture();
    const cardId = "01FRESHNESS000000000000009";
    const file = writeCard(fixture, cardId, "倒數結束\n");
    const before = readFileSync(file);
    addConversation(fixture, "conv-1");
    reference(fixture, "conv-1", cardId);
    fixture.freshness.ensure(cardId);

    fixture.storage.state.run("DELETE FROM conversation_cards WHERE conversation_id = 'conv-1'");
    fixture.clock.now = new Date(addDaysIso(T0, 7));
    expect(fixture.freshness.zeroUnreferenced([cardId], addDaysIso(T0, 7))).toBe(1);
    expect(fixture.freshness.get(cardId).freshness).toBe(0);
    expect(readFileSync(file)).toEqual(before);
  });
  it("釘選與取消釘選同步 card_state，取消後從 100 恢復衰減", () => {
    const fixture = makeFixture();
    const cardId = "01FRESHNESS000000000000020";

    fixture.freshness.ensure(cardId);
    // 先讓卡片進入衰減狀態，確認釘選會把分數拉回 100。
    fixture.storage.state.run(
      "UPDATE card_state SET freshness = 30, freshness_at = ? WHERE card_id = ?",
      T0,
      cardId,
    );

    fixture.freshness.setPinned(cardId, true);
    const pinned = fixture.freshness.get(cardId);
    expect(pinned.pinned).toBe(true);
    expect(pinned.freshness).toBe(100);
    expect(pinned.freshnessAt).toBe(T0);
    const pinnedRow = fixture.storage.state.get<{ pinned: number; pinned_at: string | null }>(
      "SELECT pinned, pinned_at FROM card_state WHERE card_id = ?",
      cardId,
    );
    expect(pinnedRow?.pinned).toBe(1);
    expect(pinnedRow?.pinned_at).toBe(T0);

    fixture.clock.now = new Date(addDaysIso(T0, 90));
    expect(fixture.freshness.recompute(cardId)).toBe(100);

    fixture.freshness.setPinned(cardId, false);
    const unpinned = fixture.freshness.get(cardId);
    expect(unpinned.pinned).toBe(false);
    expect(unpinned.freshness).toBe(100);
    expect(unpinned.freshnessAt).toBe(addDaysIso(T0, 90));
    const unpinnedRow = fixture.storage.state.get<{ pinned_at: string | null }>(
      "SELECT pinned_at FROM card_state WHERE card_id = ?",
      cardId,
    );
    expect(unpinnedRow?.pinned_at).toBeNull();

    fixture.clock.now = new Date(addDaysIso(T0, 120));
    expect(fixture.freshness.recompute(cardId)).toBeCloseTo(50, 6);
  });

  it("重複寫入相同的釘選狀態不重置 freshness_at", () => {
    const fixture = makeFixture();
    const cardId = "01FRESHNESS000000000000021";
    fixture.freshness.ensure(cardId);
    fixture.clock.now = new Date(addDaysIso(T0, 10));

    fixture.freshness.setPinned(cardId, false);
    fixture.freshness.setPinned(cardId, true);
    fixture.freshness.setPinned(cardId, true);

    const first = fixture.freshness.get(cardId);
    expect(first.pinned).toBe(true);
    expect(first.freshnessAt).toBe(addDaysIso(T0, 10));
  });
});
