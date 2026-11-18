import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { newCardId } from "@cardiary/domain";
import {
  BoardFileStore,
  CardFileStore,
  CardIndexStore,
  FolderLayout,
  FreshnessStore,
  LocalAssetStore,
  Storage,
} from "@cardiary/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageError } from "@cardiary/storage";

import { BoardService } from "../../../src/modules/boards/service.js";
import { ProtocolHandlerError } from "../../../src/modules/contract.js";
import { CardLibrary } from "../../../src/modules/cards/library.js";
import { CardStateStore } from "../../../src/modules/cards/state.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

interface Fixture {
  readonly library: CardLibrary;
  readonly files: CardFileStore;
  readonly boards: BoardService;
  readonly boardStore: BoardFileStore;
  readonly freshness: FreshnessStore;
  readonly events: Array<{ kind: string; [key: string]: unknown }>;
}

function setup(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "cardiary-card-board-delete-"));
  const clock = { now: new Date("2026-01-01T00:00:00.000Z") };
  const storage = Storage.open({ path: root, initialize: true });
  const layout = new FolderLayout(root);
  const now = (): Date => clock.now;
  const files = new CardFileStore({ layout, now });
  const index = new CardIndexStore({ db: storage.cache, now });
  const events: Array<{ kind: string; [key: string]: unknown }> = [];
  const freshness = new FreshnessStore({
    db: storage.state,
    now,
    halfLifeDays: 30,
  });
  const boardStore = new BoardFileStore({ layout, now });
  const boards = new BoardService(
    boardStore,
    now,
    (event) => events.push({ kind: "board-changed", ...event }),
    {
      get: async (cardId: string) => (files.read(cardId) === undefined ? null : { cardId }),
      create: async (input) => {
        const card = await library.create({
          kind: "note",
          title: input.title,
          body: input.body,
        });
        return { cardId: card.cardId };
      },
    },
    freshness,
  );
  const library = new CardLibrary({
    files,
    index: () => index,
    assets: () => new LocalAssetStore({ layout, index, now }),
    state: new CardStateStore({ db: () => storage.state, now }),
    now,
    emit: (intent) => events.push(intent as unknown as { kind: string }),
    beforeDelete: (cardId) => boards.removeCardProjections(cardId),
  });
  const cleanup = (): void => {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  };
  cleanups.push(cleanup);
  return { library, files, boards, boardStore, freshness, events };
}

async function projectOnBoard(
  fixture: Fixture,
  input: {
    readonly boardId: string;
    readonly cardId: string;
    readonly origin: "canvas" | "inbox";
    readonly x: number;
    readonly y: number;
    readonly pinned?: boolean;
  },
): Promise<string> {
  const itemId = newCardId();
  await fixture.boards.project({
    boardId: input.boardId,
    itemId,
    cardId: input.cardId,
    position: { x: input.x, y: input.y },
    origin: input.origin,
    projectedBy: "user",
  });
  if (input.pinned === true) {
    await fixture.boards.setPinned({
      boardId: input.boardId,
      itemId,
      pinned: true,
      agent: { tool: "test" },
    });
  }
  return itemId;
}

describe("刪卡時移除白板投影", () => {
  it("畫布與收件區的投影都移除，釘選同步，其他卡片不受影響", async () => {
    const fixture = setup();
    const wrapper = await fixture.library.create({
      kind: "note",
      title: "要刪的卡",
      body: "內容\n",
    });
    const keeper = await fixture.library.create({
      kind: "note",
      title: "留著的卡",
      body: "內容\n",
    });
    const boardA = await fixture.boards.create(newCardId(), "白板 A");
    const boardB = await fixture.boards.create(newCardId(), "白板 B");
    const deletedItem = await projectOnBoard(fixture, {
      boardId: boardA.id,
      cardId: wrapper.cardId,
      origin: "canvas",
      x: 10,
      y: 10,
      pinned: true,
    });
    const inboxItem = await projectOnBoard(fixture, {
      boardId: boardB.id,
      cardId: wrapper.cardId,
      origin: "inbox",
      x: 0,
      y: 0,
    });
    const keeperItem = await projectOnBoard(fixture, {
      boardId: boardA.id,
      cardId: keeper.cardId,
      origin: "canvas",
      x: 200,
      y: 200,
      pinned: true,
    });
    expect(fixture.freshness.get(wrapper.cardId).pinned).toBe(true);
    expect(fixture.boards.get(boardB.id).inbox.map((item) => item.id)).toEqual([inboxItem]);

    await fixture.library.delete(wrapper.cardId);

    expect(fixture.files.read(wrapper.cardId)).toBeUndefined();
    const afterA = fixture.boards.get(boardA.id);
    expect(afterA.items.some((item) => item.id === deletedItem)).toBe(false);
    expect(afterA.items.map((item) => item.id)).toEqual([keeperItem]);
    expect(afterA.items[0]?.pinned).toBe(true);
    expect(fixture.boards.get(boardB.id).inbox).toHaveLength(0);
    expect(fixture.freshness.get(wrapper.cardId).pinned).toBe(false);
    expect(fixture.freshness.get(keeper.cardId).pinned).toBe(true);
    expect(fixture.boardStore.read(boardA.id)?.board).toEqual(afterA);
    expect(
      fixture.events.some((event) => event.kind === "card-changed" && event.change === "deleted"),
    ).toBe(true);
  });

  it("清投影失敗時不刪卡片，讓呼叫端可以重試", async () => {
    const root = mkdtempSync(join(tmpdir(), "cardiary-card-board-delete-fail-"));
    const storage = Storage.open({ path: root, initialize: true });
    const layout = new FolderLayout(root);
    const now = (): Date => new Date("2026-01-01T00:00:00.000Z");
    const files = new CardFileStore({ layout, now });
    const index = new CardIndexStore({ db: storage.cache, now });
    const library = new CardLibrary({
      files,
      index: () => index,
      assets: () => new LocalAssetStore({ layout, index, now }),
      state: new CardStateStore({ db: () => storage.state, now }),
      now,
      beforeDelete: () => {
        throw new Error("白板檔寫入失敗");
      },
    });
    cleanups.push(() => {
      storage.close();
      rmSync(root, { recursive: true, force: true });
    });
    const card = await library.create({ kind: "note", title: "留著", body: "內容\n" });

    await expect(library.delete(card.cardId)).rejects.toThrow("白板檔寫入失敗");
    expect(files.read(card.cardId)?.text).toContain("留著");
    expect(index.get(card.cardId)).toBeDefined();
  });

  it("移除投影不會刪卡，也不會改卡片內容", async () => {
    const fixture = setup();
    const card = await fixture.library.create({ kind: "note", title: "原卡", body: "原文\n" });
    const board = await fixture.boards.create(newCardId(), "白板");
    await projectOnBoard(fixture, {
      boardId: board.id,
      cardId: card.cardId,
      origin: "canvas",
      x: 1,
      y: 1,
    });
    const text = fixture.files.read(card.cardId)?.text;

    const touched = await fixture.boards.removeCardProjections(card.cardId);

    expect(touched).toEqual([board.id]);
    expect(fixture.boards.get(board.id).items).toHaveLength(0);
    expect(fixture.files.read(card.cardId)?.text).toBe(text);
    expect(fixture.library.rowOf(card.cardId)?.title).toBe("原卡");
  });

  it("沒有投影的卡片刪除時也不會碰到白板", async () => {
    const fixture = setup();
    const card = await fixture.library.create({ kind: "note", title: "孤島", body: "內容\n" });
    const board = await fixture.boards.create(newCardId(), "白板");
    const before = fixture.boards.get(board.id);
    const touched = await fixture.boards.removeCardProjections(card.cardId);
    expect(touched).toEqual([]);
    expect(fixture.boards.get(board.id)).toEqual(before);
  });

  it("一份白板失敗不影響其他白板，重試後全部移除", async () => {
    const fixture = setup();
    const card = await fixture.library.create({ kind: "note", title: "要刪的卡", body: "內容\n" });
    const boardA = await fixture.boards.create(newCardId(), "白板 A");
    const boardB = await fixture.boards.create(newCardId(), "白板 B");
    await projectOnBoard(fixture, {
      boardId: boardA.id,
      cardId: card.cardId,
      origin: "canvas",
      x: 10,
      y: 10,
    });
    await projectOnBoard(fixture, {
      boardId: boardB.id,
      cardId: card.cardId,
      origin: "inbox",
      x: 0,
      y: 0,
    });
    // 刪除流程依白板 id 排序處理；讓排在後面的那份失敗。
    const [, second] = [boardA, boardB].sort((left, right) => left.id.localeCompare(right.id));
    if (second === undefined) throw new Error("需要兩份白板");
    const failOnce = { armed: true };
    const originalWrite = fixture.boardStore.write.bind(fixture.boardStore);
    vi.spyOn(fixture.boardStore, "write").mockImplementation((board, options) => {
      if (failOnce.armed && board.id === second.id) {
        failOnce.armed = false;
        throw new StorageError("storage-failed", "模擬白板寫入失敗");
      }
      return originalWrite(board, options);
    });

    const failure = await fixture.library.delete(card.cardId).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ProtocolHandlerError);
    expect((failure as ProtocolHandlerError).code).toBe("unavailable");
    const details = (failure as ProtocolHandlerError).details as
      { failed?: string[]; succeeded?: string[]; reason?: string } | undefined;
    expect(details?.reason).toBe("storage-failed");
    const first = [boardA, boardB].find((board) => board.id !== second.id);
    if (first === undefined) throw new Error("需要兩份白板");
    expect(details?.failed).toEqual([second.id]);
    expect(details?.succeeded).toEqual([first.id]);
    expect(fixture.files.read(card.cardId)).toBeDefined();
    const processed = fixture.boards.get(first.id);
    expect(
      [...processed.items, ...processed.inbox].some((item) => item.cardId === card.cardId),
    ).toBe(false);
    const untouched = fixture.boards.get(second.id);
    expect(
      [...untouched.items, ...untouched.inbox].some((item) => item.cardId === card.cardId),
    ).toBe(true);

    await fixture.library.delete(card.cardId);

    expect(fixture.files.read(card.cardId)).toBeUndefined();
    for (const board of [boardA, boardB]) {
      const after = fixture.boards.get(board.id);
      expect([...after.items, ...after.inbox].some((item) => item.cardId === card.cardId)).toBe(
        false,
      );
    }
  });

  it("復原代理變更時不會復活已刪除卡片的投影", async () => {
    const fixture = setup();
    const card = await fixture.library.create({ kind: "note", title: "要刪的卡", body: "內容\n" });
    const board = await fixture.boards.create(newCardId(), "白板");
    const itemId = newCardId();
    await fixture.boards.project({
      boardId: board.id,
      itemId,
      cardId: card.cardId,
      position: { x: 10, y: 10 },
      origin: "canvas",
      projectedBy: "agent",
      agent: { tool: "project_card_to_board" },
    });
    const removal = await fixture.boards.removeItem({
      boardId: board.id,
      itemId,
      agent: { tool: "remove_board_item" },
    });
    const changeId = fixture.boards.agentChangeIdFor(removal);
    if (changeId === undefined) throw new Error("removeItem 應該留下代理變更紀錄");

    await fixture.library.delete(card.cardId);
    expect(fixture.files.read(card.cardId)).toBeUndefined();

    const undone = await fixture.boards.undo({ boardId: board.id, changeId });

    expect(undone.undone).toBe(true);
    const after = fixture.boards.get(board.id);
    expect(after.items.some((item) => item.cardId === card.cardId)).toBe(false);
    expect(after.inbox.some((item) => item.cardId === card.cardId)).toBe(false);
  });
});
