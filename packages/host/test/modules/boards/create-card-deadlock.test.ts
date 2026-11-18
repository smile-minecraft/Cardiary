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
import { afterEach, describe, expect, it } from "vitest";

import {
  BoardService,
  type BoardCardGateway,
  type CreateCardOnBoardInput,
} from "../../../src/modules/boards/service.js";
import { CardLibrary } from "../../../src/modules/cards/library.js";
import { CardStateStore } from "../../../src/modules/cards/state.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** 有上限的等待；超過時讓測試失敗，而不是跟著卡住。 */
function withDeadline<T>(promise: Promise<T>, label: string): Promise<T> {
  const timeoutMs = 2_000;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}在 ${timeoutMs}ms 內沒有完成`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface Gate {
  /** 建卡已進入卡片服務、還在等寫入完成。 */
  readonly entered: Deferred<void>;
  /** 放行卡片寫入。 */
  readonly release: Deferred<void>;
}

interface Fixture {
  readonly files: CardFileStore;
  readonly library: CardLibrary;
  readonly boards: BoardService;
  readonly gate: Gate;
}

/**
 * 真的卡片庫與白板檔，建卡路徑在 `createCard` 呼叫 `create` 時停住。
 *
 * 這個停頓點模擬卡片寫入很慢的情況：如果建卡在白板鎖內等它，另一邊的
 * 刪卡（先拿卡片寫入鎖、再移除白板投影）就永遠等不到白板鎖。
 */
function setup(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "cardiary-board-create-deadlock-"));
  const clock = { now: new Date("2026-01-01T00:00:00.000Z") };
  const storage = Storage.open({ path: root, initialize: true });
  const layout = new FolderLayout(root);
  const now = (): Date => clock.now;
  const files = new CardFileStore({ layout, now });
  const index = new CardIndexStore({ db: storage.cache, now });
  const freshness = new FreshnessStore({ db: storage.state, now, halfLifeDays: 30 });
  const boardStore = new BoardFileStore({ layout, now });
  const gate = { entered: deferred<void>(), release: deferred<void>() };
  const gateway: BoardCardGateway = {
    get: async (cardId) => (files.read(cardId) === undefined ? null : { cardId }),
    create: async (input) => {
      gate.entered.resolve(undefined);
      await gate.release.promise;
      const card = await library.create({
        cardId: input.cardId,
        kind: "note",
        title: input.title,
        body: input.body,
        ...(input.sources === undefined ? {} : { sources: input.sources }),
      });
      return { cardId: card.cardId };
    },
  };
  const boards = new BoardService(boardStore, now, () => {}, gateway, freshness);
  const library = new CardLibrary({
    files,
    index: () => index,
    assets: () => new LocalAssetStore({ layout, index, now }),
    state: new CardStateStore({ db: () => storage.state, now }),
    now,
    beforeDelete: (cardId) => boards.removeCardProjections(cardId),
  });
  cleanups.push(() => {
    storage.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { files, library, boards, gate };
}

function cardOnBoard(boardId: string, itemId: string, derivedFrom: readonly string[]) {
  return {
    boardId,
    itemId,
    title: "圈選後的新卡",
    body: "整理成一份摘要。",
    position: { x: 10, y: 20 },
    origin: "canvas",
    projectedBy: "agent",
    derivedFrom,
    agent: { tool: "create_card_on_board" },
  } satisfies CreateCardOnBoardInput;
}

describe("建卡與刪卡同時進行的鎖順序", () => {
  it("建卡還在等卡片寫入時，刪卡可以完成；之後建卡照常投影", async () => {
    const fixture = setup();
    const board = await fixture.boards.create(newCardId(), "白板");
    const victim = await fixture.library.create({
      kind: "note",
      title: "要刪的卡",
      body: "內容\n",
    });
    const input = cardOnBoard(board.id, newCardId(), [victim.cardId]);

    const creation = fixture.boards.createCard(input);
    await withDeadline(fixture.gate.entered.promise, "建卡進入卡片服務");

    const deletion = fixture.library.delete(victim.cardId);
    // 關鍵斷言：建卡只是停在卡片寫入，還沒有拿白板鎖。刪卡若在這裡卡住，
    // 就是兩邊互等（建卡：白板鎖 → 卡片鎖；刪卡：卡片鎖 → 白板鎖）。
    await withDeadline(deletion, "刪卡");
    expect(fixture.files.read(victim.cardId)).toBeUndefined();

    fixture.gate.release.resolve(undefined);
    const created = await withDeadline(creation, "建卡");

    expect(created.cardId).toBeDefined();
    const projected = fixture.boards.get(board.id);
    expect(projected.items).toHaveLength(1);
    expect(projected.items[0]).toMatchObject({ id: input.itemId, cardId: created.cardId });
    const card = await fixture.library.get(created.cardId);
    expect(card?.frontmatter.sources).toEqual([victim.cardId]);
  });
});
