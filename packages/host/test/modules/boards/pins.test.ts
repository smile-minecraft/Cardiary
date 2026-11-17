import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { newCardId } from "@cardiary/domain";
import { afterEach, describe, expect, it } from "vitest";

import {
  addDaysIso,
  BoardFileStore,
  FolderLayout,
  FreshnessStore,
  Storage,
} from "@cardiary/storage";

import { BoardService } from "../../../src/modules/boards/service.js";

const T0 = "2026-01-01T00:00:00.000Z";
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

interface Setup {
  readonly storage: Storage;
  readonly freshness: FreshnessStore;
  readonly service: BoardService;
  readonly store: BoardFileStore;
  readonly cards: {
    get: (cardId: string) => Promise<{ cardId: string }>;
    create: (input: { title: string }) => Promise<{ cardId: string }>;
  };
  readonly events: Array<{ boardId: string; change: string }>;
  readonly clock: { now: Date };
  readonly cleanup: () => void;
}

function setup(label = "board-pins"): Setup {
  const root = mkdtempSync(join(tmpdir(), `cardiary-${label}-`));
  const layout = new FolderLayout(root);
  const clock = { now: new Date(T0) };
  const events: Array<{ boardId: string; change: string }> = [];
  const storage = Storage.open({ path: root, initialize: true });
  const freshness = new FreshnessStore({
    db: storage.state,
    now: () => clock.now,
    halfLifeDays: 30,
  });
  const store = new BoardFileStore({ layout, now: () => clock.now });
  const cards = {
    get: async (cardId: string) => ({ cardId }),
    create: async (input: { title: string }) => ({
      cardId: `01CARD${input.title}0000000000`.slice(0, 26).padEnd(26, "0"),
    }),
  };
  const service = new BoardService(
    store,
    () => clock.now,
    (event) => events.push({ boardId: event.boardId, change: event.change }),
    cards,
    freshness,
  );
  const cleanup = (): void => {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  };
  cleanups.push(cleanup);
  return { storage, freshness, service, store, cards, events, clock, cleanup };
}

async function pinInBoard(
  fixture: Setup,
  boardId: string,
  itemId: string,
  pinned: boolean,
): Promise<void> {
  const board = fixture.service.get(boardId);
  const items = board.items.map((item) => (item.id === itemId ? { ...item, pinned } : item));
  await fixture.service.save({ ...board, items }, board.updatedAt);
}

describe("BoardService 釘選與卡片狀態同步", () => {
  it("釘選後新鮮度固定 100，取消釘選後恢復衰減", async () => {
    const fixture = setup();
    const board = await fixture.service.create(newCardId(), "白板 A");
    const projected = await fixture.service.project({
      boardId: board.id,
      itemId: "01000000000000000000000001",
      cardId: "01000000000000000000000011",
      position: { x: 10, y: 10 },
      origin: "canvas",
    });

    await pinInBoard(fixture, board.id, "01000000000000000000000001", true);
    expect(fixture.freshness.get("01000000000000000000000011").pinned).toBe(true);

    fixture.clock.now = new Date(addDaysIso(T0, 90));
    expect(fixture.freshness.recompute("01000000000000000000000011")).toBe(100);

    await pinInBoard(fixture, board.id, "01000000000000000000000001", false);
    expect(fixture.freshness.get("01000000000000000000000011").pinned).toBe(false);

    fixture.clock.now = new Date(addDaysIso(T0, 120));
    expect(fixture.freshness.recompute("01000000000000000000000011")).toBeCloseTo(50, 6);

    expect(projected.items[0]?.pinned).toBe(false);
  });

  it("同一張卡投影在兩個白板，任一個釘選就算釘選，最後一個解除才恢復衰減", async () => {
    const fixture = setup("board-pins-two");
    const cardId = "01000000000000000000000022";
    const itemA = "01000000000000000000000002";
    const itemB = "01000000000000000000000003";
    const boardA = await fixture.service.create(newCardId(), "白板 A");
    const boardB = await fixture.service.create(newCardId(), "白板 B");
    await fixture.service.project({
      boardId: boardA.id,
      itemId: itemA,
      cardId,
      position: { x: 0, y: 0 },
      origin: "canvas",
    });
    await fixture.service.project({
      boardId: boardB.id,
      itemId: itemB,
      cardId,
      position: { x: 0, y: 0 },
      origin: "canvas",
    });

    await pinInBoard(fixture, boardA.id, itemA, true);
    expect(fixture.freshness.get(cardId).pinned).toBe(true);
    await pinInBoard(fixture, boardB.id, itemB, true);
    expect(fixture.freshness.get(cardId).pinned).toBe(true);

    // A 解除釘選，B 仍是釘選，所以卡片狀態維持 pinned。
    await pinInBoard(fixture, boardA.id, itemA, false);
    expect(fixture.freshness.get(cardId).pinned).toBe(true);

    // B 也解除後才恢復衰減。
    await pinInBoard(fixture, boardB.id, itemB, false);
    expect(fixture.freshness.get(cardId).pinned).toBe(false);
  });

  it("刪除白板後卡片仍在，釘選依剩餘白板決定；收件區項目不會固定新鮮度", async () => {
    const fixture = setup("board-pins-delete");
    const cardId = "01000000000000000000000044";
    const itemA = "01000000000000000000000004";
    const itemB = "01000000000000000000000005";
    const boardA = await fixture.service.create(newCardId(), "白板 A");
    const boardB = await fixture.service.create(newCardId(), "白板 B");
    await fixture.service.project({
      boardId: boardA.id,
      itemId: itemA,
      cardId,
      position: { x: 0, y: 0 },
      origin: "canvas",
    });
    await fixture.service.project({
      boardId: boardB.id,
      itemId: itemB,
      cardId,
      position: { x: 0, y: 0 },
      origin: "canvas",
    });
    await pinInBoard(fixture, boardA.id, itemA, true);
    await pinInBoard(fixture, boardB.id, itemB, true);
    expect(fixture.freshness.get(cardId).pinned).toBe(true);

    expect(await fixture.service.delete(boardA.id)).toBe(true);
    // 卡片仍在（BoardService.delete 不碰卡片），B 仍釘選，所以還是 100。
    expect(fixture.freshness.get(cardId).pinned).toBe(true);
    expect(
      fixture.storage.state.get("SELECT card_id FROM card_state WHERE card_id = ?", cardId),
    ).toBeDefined();

    expect(await fixture.service.delete(boardB.id)).toBe(true);
    expect(fixture.freshness.get(cardId).pinned).toBe(false);

    // 收件區（agent 投影）pinned 不影響卡片新鮮度。
    const inboxBoard = await fixture.service.create(newCardId(), "收件白板");
    await fixture.service.save(
      {
        ...inboxBoard,
        inbox: [
          {
            id: "01000000000000000000000006",
            cardId: "01000000000000000000000066",
            position: { x: 0, y: 0 },
            size: { width: 1, height: 1 },
            pinned: true,
            origin: "inbox",
            projectedBy: "agent",
          },
        ],
      },
      inboxBoard.updatedAt,
    );
    expect(fixture.freshness.get("01000000000000000000000066").pinned).toBe(false);
  });

  it("unproject 會解除釘選", async () => {
    const fixture = setup("board-pins-unproject");
    const cardId = "01000000000000000000000077";
    const itemId = "01000000000000000000000007";
    const board = await fixture.service.create(newCardId(), "白板");
    await fixture.service.project({
      boardId: board.id,
      itemId,
      cardId,
      position: { x: 0, y: 0 },
      origin: "canvas",
    });
    await pinInBoard(fixture, board.id, itemId, true);
    expect(fixture.freshness.get(cardId).pinned).toBe(true);

    await fixture.service.unproject(board.id, itemId);
    expect(fixture.freshness.get(cardId).pinned).toBe(false);
  });

  it("釘選同步中斷後，重試同一個操作會把卡片狀態修復為釘選", async () => {
    const fixture = setup("board-pins-retry");
    let failOnce = true;
    const flakyPins = {
      setPinned: (cardId: string, pinned: boolean): void => {
        if (failOnce) {
          failOnce = false;
          throw new Error("模擬釘選同步中斷");
        }
        fixture.freshness.setPinned(cardId, pinned);
      },
      listPinned: () => fixture.freshness.listPinned(),
    };
    const service = new BoardService(
      fixture.store,
      () => fixture.clock.now,
      () => {},
      fixture.cards,
      flakyPins,
    );
    const board = await service.create(newCardId(), "白板");
    const cardId = "01000000000000000000000091";
    const itemId = "01000000000000000000000081";
    await service.project({
      boardId: board.id,
      itemId,
      cardId,
      position: { x: 0, y: 0 },
      origin: "canvas",
    });

    // 白板檔寫入成功後、setPinned 失敗：save 失敗，但白板檔已留下釘選。
    const before = service.get(board.id);
    const pinnedItems = before.items.map((item) =>
      item.id === itemId ? { ...item, pinned: true } : item,
    );
    await expect(service.save({ ...before, items: pinnedItems }, before.updatedAt)).rejects.toThrow(
      "模擬釘選同步中斷",
    );
    expect(service.get(board.id).items.find((item) => item.id === itemId)?.pinned).toBe(true);
    expect(fixture.freshness.get(cardId).pinned).toBe(false);

    // 重試同一個操作：集合差異是空的，仍會無條件重送，把狀態修成釘選。
    const retryBase = service.get(board.id);
    await service.save({ ...retryBase }, retryBase.updatedAt);
    expect(fixture.freshness.get(cardId).pinned).toBe(true);
  });

  it("啟動校正會把白板既有的釘選補進卡片狀態", async () => {
    const fixture = setup("board-pins-startup-pin");
    const board = await fixture.service.create(newCardId(), "白板");
    const cardId = "01000000000000000000000092";
    const itemId = "01000000000000000000000082";
    await fixture.service.project({
      boardId: board.id,
      itemId,
      cardId,
      position: { x: 0, y: 0 },
      origin: "canvas",
    });
    // 白板檔是正本：直接改檔留下釘選，不經過 BoardService（模擬上次同步沒做完）。
    const current = fixture.store.read(board.id);
    if (current === undefined) throw new Error("白板檔不存在");
    fixture.store.write({
      ...current.board,
      items: current.board.items.map((item) =>
        item.id === itemId ? { ...item, pinned: true } : item,
      ),
    });
    expect(fixture.freshness.get(cardId).pinned).toBe(false);

    // 重啟後的啟動校正會把白板的釘選鏡射到卡片狀態。
    const restarted = new BoardService(
      fixture.store,
      () => fixture.clock.now,
      () => {},
      undefined,
      fixture.freshness,
    );
    await restarted.reconcilePins();
    expect(fixture.freshness.get(cardId).pinned).toBe(true);
  });

  it("啟動校正會取消卡片狀態裡多餘的釘選", async () => {
    const fixture = setup("board-pins-startup-unpin");
    const board = await fixture.service.create(newCardId(), "白板");
    const cardId = "01000000000000000000000093";
    const itemId = "01000000000000000000000083";
    await fixture.service.project({
      boardId: board.id,
      itemId,
      cardId,
      position: { x: 0, y: 0 },
      origin: "canvas",
    });
    // 狀態庫說釘選，但沒有任何白板釘選這張卡。
    fixture.freshness.setPinned(cardId, true);
    expect(fixture.freshness.get(cardId).pinned).toBe(true);

    await fixture.service.reconcilePins();
    expect(fixture.freshness.get(cardId).pinned).toBe(false);
  });
});
