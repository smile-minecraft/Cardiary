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
  StorageError,
} from "@cardiary/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BoardService, type CreateCardOnBoardInput } from "../../../src/modules/boards/service.js";
import { CardLibrary } from "../../../src/modules/cards/library.js";
import { CardStateStore } from "../../../src/modules/cards/state.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (cleanups.length > 0) cleanups.pop()?.();
});

interface Fixture {
  readonly files: CardFileStore;
  readonly boardStore: BoardFileStore;
  readonly library: CardLibrary;
  readonly boards: BoardService;
  readonly makeLibrary: () => CardLibrary;
  readonly makeBoards: (library: CardLibrary) => BoardService;
}

/**
 * 用真的卡片庫與白板檔，重現「卡片已寫入、白板寫入失敗」的中斷。
 *
 * 白板寫入由 spy 控制：只讓指定白板的下一次寫入失敗，之後恢復正常，
 * 模擬使用者按重試時磁碟或程式已經恢復的情況。
 */
function setup(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "cardiary-board-create-retry-"));
  const clock = { now: new Date("2026-01-01T00:00:00.000Z") };
  const storage = Storage.open({ path: root, initialize: true });
  const layout = new FolderLayout(root);
  const now = (): Date => clock.now;
  const files = new CardFileStore({ layout, now });
  const index = new CardIndexStore({ db: storage.cache, now });
  const freshness = new FreshnessStore({ db: storage.state, now, halfLifeDays: 30 });
  const boardStore = new BoardFileStore({ layout, now });
  const events: unknown[] = [];
  const makeLibrary = (): CardLibrary =>
    new CardLibrary({
      files,
      index: () => index,
      assets: () => new LocalAssetStore({ layout, index, now }),
      state: new CardStateStore({ db: () => storage.state, now }),
      now,
      emit: (intent) => events.push(intent),
    });
  const makeBoards = (library: CardLibrary): BoardService =>
    new BoardService(
      boardStore,
      now,
      (event) => events.push(event),
      {
        get: async (cardId: string) => (files.read(cardId) === undefined ? null : { cardId }),
        create: async (input) => {
          const card = await library.create({
            cardId: input.cardId,
            kind: "note",
            title: input.title,
            body: input.body,
            ...(input.sources === undefined ? {} : { sources: input.sources }),
          });
          return { cardId: card.cardId };
        },
      },
      freshness,
    );
  const library = makeLibrary();
  cleanups.push(() => {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    files,
    boardStore,
    library,
    boards: makeBoards(library),
    makeLibrary,
    makeBoards,
  };
}

/** 讓指定白板的下一次寫入失敗一次，之後恢復。 */
function failNextBoardWrite(store: BoardFileStore, boardId: string): void {
  const original = store.write.bind(store);
  const arm = { pending: true };
  vi.spyOn(store, "write").mockImplementation((board, options) => {
    if (arm.pending && board.id === boardId) {
      arm.pending = false;
      throw new StorageError("storage-failed", "模擬白板寫入失敗");
    }
    return original(board, options);
  });
}

function cardOnBoard(
  boardId: string,
  itemId: string,
  sources: readonly string[] = [],
): CreateCardOnBoardInput {
  return {
    boardId,
    itemId,
    title: "整理三個月內的專案筆記",
    body: "把相關段落收斂成一份摘要。",
    position: { x: 120, y: 80 },
    origin: "canvas",
    projectedBy: "user",
    derivedFrom: sources,
  };
}

describe("白板建卡的中斷重試", () => {
  it("白板寫入失敗後，同一個 itemId 重試沿用地一張卡", async () => {
    const fixture = setup();
    const board = await fixture.boards.create(newCardId(), "研究");
    const source = await fixture.library.create({ kind: "note", title: "來源", body: "原文" });
    const input = cardOnBoard(board.id, newCardId(), [source.cardId]);
    failNextBoardWrite(fixture.boardStore, board.id);

    await expect(fixture.boards.createCard(input)).rejects.toThrow("模擬白板寫入失敗");

    const afterFailure = await fixture.library.list({});
    expect(afterFailure.items).toHaveLength(2);
    const written = afterFailure.items.find((item) => item.cardId !== source.cardId);
    expect(written).toBeDefined();
    expect(fixture.boards.get(board.id).items).toHaveLength(0);

    const retry = await fixture.boards.createCard(input);

    expect(retry.cardId).toBe(written?.cardId);
    expect((await fixture.library.list({})).items).toHaveLength(2);
    expect(fixture.files.list()).toHaveLength(2);
    const persisted = fixture.boards.get(board.id);
    expect(persisted.items).toHaveLength(1);
    expect(persisted.items[0]).toMatchObject({ id: input.itemId, cardId: written?.cardId });
    const adopted = await fixture.library.get(String(written?.cardId));
    expect(adopted?.frontmatter.sources).toEqual([source.cardId]);
  });

  it("主機重建服務後重試同一個 itemId，仍沿用地一張卡", async () => {
    const fixture = setup();
    const board = await fixture.boards.create(newCardId(), "研究");
    const input = cardOnBoard(board.id, newCardId());
    failNextBoardWrite(fixture.boardStore, board.id);

    await expect(fixture.boards.createCard(input)).rejects.toThrow("模擬白板寫入失敗");
    const written = (await fixture.library.list({})).items[0];
    expect(written).toBeDefined();

    const restartedBoards = fixture.makeBoards(fixture.makeLibrary());
    const retry = await restartedBoards.createCard(input);

    expect(retry.cardId).toBe(written?.cardId);
    expect((await fixture.library.list({})).items).toHaveLength(1);
    expect(fixture.files.list()).toHaveLength(1);
    expect(restartedBoards.get(board.id).items).toHaveLength(1);
  });

  it("不同的 itemId 仍然各自建立新卡", async () => {
    const fixture = setup();
    const board = await fixture.boards.create(newCardId(), "研究");

    const first = await fixture.boards.createCard(cardOnBoard(board.id, newCardId()));
    const second = await fixture.boards.createCard(cardOnBoard(board.id, newCardId()));

    expect(second.cardId).not.toBe(first.cardId);
    expect((await fixture.library.list({})).items).toHaveLength(2);
    expect(fixture.boards.get(board.id).items).toHaveLength(2);
  });
});
