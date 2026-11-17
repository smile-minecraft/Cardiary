import {
  assertValidBoard,
  createBoard,
  listPinnedCardIds,
  newCardId,
  projectCard,
  unprojectCard,
  type BoardChange,
  type BoardDocument,
  type BoardItem,
  type BoardPoint,
} from "@cardiary/domain";
import type { BoardFileStore } from "@cardiary/storage";

import { ProtocolHandlerError } from "../contract.js";

/** 白板變更事件；閘道轉成 `board.changed` 協定事件。 */
export interface BoardChangedEvent {
  readonly boardId: string;
  readonly change: BoardChange;
  readonly board?: BoardDocument;
  readonly cardIds?: readonly string[];
}

/** 建卡與投影時，服務只需要卡片服務的這兩個方法。 */
export interface BoardCardGateway {
  get(cardId: string): Promise<unknown | null>;
  create(input: {
    readonly kind: "note";
    readonly title: string;
    readonly body: string;
    readonly sources?: readonly string[];
  }): Promise<{ readonly cardId: string }>;
}

/** 釘選同步：白板是正本，卡片狀態只是鏡射。 */
export interface BoardPinStore {
  setPinned(cardId: string, pinned: boolean): void | Promise<void>;
}

export interface CreateCardOnBoardInput {
  readonly boardId: string;
  /** 投影的 ULID；重送同一個 itemId 視為同一次操作。 */
  readonly itemId: string;
  readonly title: string;
  readonly body: string;
  readonly position: BoardPoint;
  readonly origin: "canvas" | "inbox";
  readonly projectedBy: "user" | "agent";
  /** 由圈選建立的卡片帶血緣。 */
  readonly derivedFrom?: readonly string[];
}

export interface ProjectCardOnBoardInput {
  readonly boardId: string;
  readonly itemId: string;
  readonly cardId: string;
  readonly position: BoardPoint;
  readonly origin: "canvas" | "inbox";
  readonly projectedBy: "user" | "agent";
}

export interface CreatedCardProjection {
  readonly board: BoardDocument;
  readonly cardId: string;
  readonly item: BoardItem;
}

/**
 * 白板正本由 `BoardFileStore` 保存，版本由主機配發。
 *
 * 所有寫入都排在同一條佇列上：讀檔、驗證版本、寫檔之間不能插入另一筆
 * 寫入，否則兩個視窗同時投影會把對方覆蓋掉。讀取不排隊，最多看到前一筆
 * 寫入完成的狀態。
 */
export class BoardService {
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: BoardFileStore,
    private readonly now: () => Date,
    private readonly emit: (event: BoardChangedEvent) => void,
    private readonly cards: BoardCardGateway | undefined = undefined,
    private readonly pins: BoardPinStore | undefined = undefined,
  ) {}

  list(): BoardDocument[] {
    return this.store.list().map((entry) => entry.board);
  }

  /** 讀取；找不到時回 undefined，給需要自行處理缺檔的呼叫端。 */
  find(id: string): BoardDocument | undefined {
    return this.store.read(id)?.board;
  }

  get(id: string): BoardDocument {
    const board = this.store.read(id)?.board;
    if (board === undefined)
      throw new ProtocolHandlerError("not_found", "找不到白板。", { boardId: id });
    return board;
  }

  /** 建立白板；同一個 id 重送時回傳既有白板，不視為錯誤。 */
  create(id: string, title: string): Promise<BoardDocument> {
    return this.#exclusive(() => {
      const existing = this.store.read(id)?.board;
      if (existing !== undefined) return existing;
      const board = createBoard({ id, title, now: this.now().toISOString() });
      assertValidBoard({ board });
      this.store.write(board);
      this.emit({ boardId: id, change: "created", board });
      return board;
    });
  }

  /** 以 `expectedUpdatedAt` 做單寫者比對；版本過期回 conflict，不覆寫。 */
  save(input: BoardDocument, expectedUpdatedAt: string): Promise<BoardDocument> {
    return this.#exclusive(async () => {
      const pinnedBefore = this.#pinnedCardIds();
      const existing = this.get(input.id);
      if (existing.updatedAt !== expectedUpdatedAt) {
        throw new ProtocolHandlerError("conflict", "白板已被其他視窗修改。", { boardId: input.id });
      }
      const nextMs = Math.max(this.now().getTime(), Date.parse(existing.updatedAt) + 1);
      const board = {
        ...input,
        createdAt: existing.createdAt,
        updatedAt: new Date(nextMs).toISOString(),
      };
      assertValidBoard({ board });
      this.store.write(board, { expectedUpdatedAt });
      await this.#syncPinned(pinnedBefore);
      this.emit({ boardId: board.id, change: "updated", board });
      return board;
    });
  }

  delete(id: string): Promise<boolean> {
    return this.#exclusive(async () => {
      const pinnedBefore = this.#pinnedCardIds();
      const deleted = this.store.remove(id);
      if (!deleted) return false;
      await this.#syncPinned(pinnedBefore);
      this.emit({ boardId: id, change: "deleted" });
      return true;
    });
  }

  /** 投影既有卡片；同一個 itemId 重送回傳目前的結果。 */
  project(input: ProjectCardOnBoardInput): Promise<BoardDocument> {
    return this.#exclusive(async () => {
      const pinnedBefore = this.#pinnedCardIds();
      const board = this.get(input.boardId);
      if (findItem(board, input.itemId) !== undefined) return board;
      const cards = this.#requireCards();
      if ((await cards.get(input.cardId)) === null) {
        throw new ProtocolHandlerError("not_found", "找不到要投影的卡片。", {
          cardId: input.cardId,
        });
      }
      const current = this.get(input.boardId);
      const projected = this.#projectOnto(current, input);
      this.store.write(projected, { expectedUpdatedAt: current.updatedAt });
      await this.#syncPinned(pinnedBefore);
      this.emit({
        boardId: projected.id,
        change: "updated",
        board: projected,
        cardIds: [input.cardId],
      });
      return projected;
    });
  }

  /** 取消投影；畫布與收件區的項目都能移除，連帶移除參照它的連線。 */
  unproject(boardId: string, itemId: string): Promise<BoardDocument> {
    return this.#exclusive(async () => {
      const pinnedBefore = this.#pinnedCardIds();
      const board = this.get(boardId);
      const item = findItem(board, itemId);
      if (item === undefined) {
        throw new ProtocolHandlerError("not_found", "找不到白板上的這個項目。", {
          boardId,
          itemId,
        });
      }
      const next = unprojectCard({ board, itemId, now: this.#nextTimestamp(board) });
      this.store.write(next, { expectedUpdatedAt: board.updatedAt });
      await this.#syncPinned(pinnedBefore);
      this.emit({ boardId, change: "updated", board: next, cardIds: [item.cardId] });
      return next;
    });
  }

  /**
   * 用圈選的卡片建立新卡並投影到白板。
   *
   * 建卡成功、投影失敗時卡片會留在卡片庫：這是保守的方向，寧可多一張卡，
   * 也不要出現投影指向不存在的卡。
   */
  createCard(input: CreateCardOnBoardInput): Promise<CreatedCardProjection> {
    return this.#exclusive(async () => {
      const pinnedBefore = this.#pinnedCardIds();
      const board = this.get(input.boardId);
      const existing = findItem(board, input.itemId);
      if (existing !== undefined) {
        return { board, cardId: existing.cardId, item: existing };
      }
      const cards = this.#requireCards();
      const card = await cards.create({
        kind: "note",
        title: input.title,
        body: input.body,
        ...(input.derivedFrom === undefined ? {} : { sources: input.derivedFrom }),
      });
      // 建卡是慢操作，回來後重新讀一次，避免把等待期間的寫入蓋掉。
      const current = this.get(input.boardId);
      const projected = this.#projectOnto(current, {
        boardId: input.boardId,
        itemId: input.itemId,
        cardId: card.cardId,
        position: input.position,
        origin: input.origin,
        projectedBy: input.projectedBy,
      });
      this.store.write(projected, { expectedUpdatedAt: current.updatedAt });
      await this.#syncPinned(pinnedBefore);
      this.emit({
        boardId: projected.id,
        change: "updated",
        board: projected,
        cardIds: [card.cardId],
      });
      const item = findItem(projected, input.itemId);
      if (item === undefined) {
        throw new ProtocolHandlerError("internal", "投影寫入後找不到項目。", {
          boardId: input.boardId,
        });
      }
      return { board: projected, cardId: card.cardId, item };
    });
  }

  /**
   * 白板是目前唯一決定「卡片是否釘選」的地方；每次寫入前後比對集合，
   * 只同步真的改變的卡片。
   */
  #pinnedCardIds(): Set<string> {
    const boards = this.store.list().map((entry) => entry.board);
    return new Set(listPinnedCardIds(boards));
  }

  async #syncPinned(before: ReadonlySet<string>): Promise<void> {
    if (this.pins === undefined) return;
    const after = this.#pinnedCardIds();
    for (const cardId of before) {
      if (!after.has(cardId)) await this.pins.setPinned(cardId, false);
    }
    for (const cardId of after) {
      if (!before.has(cardId)) await this.pins.setPinned(cardId, true);
    }
  }

  #projectOnto(board: BoardDocument, input: ProjectCardOnBoardInput): BoardDocument {
    return projectCard({
      board,
      itemId: input.itemId,
      cardId: input.cardId,
      position: input.position,
      origin: input.origin,
      projectedBy: input.projectedBy,
      now: this.#nextTimestamp(board),
    });
  }

  /** 版本一定要前進：同一毫秒內連續寫入也要產生不同版本。 */
  #nextTimestamp(board: BoardDocument): string {
    const previous = Date.parse(board.updatedAt);
    return new Date(Math.max(this.now().getTime(), previous + 1)).toISOString();
  }

  #requireCards(): BoardCardGateway {
    if (this.cards === undefined) {
      throw new ProtocolHandlerError("unavailable", "白板模組沒有接到卡片服務。");
    }
    return this.cards;
  }

  #exclusive<T>(work: () => T | Promise<T>): Promise<T> {
    const run = this.#queue.then(work, work);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function findItem(board: BoardDocument, itemId: string): BoardItem | undefined {
  return [...board.items, ...board.inbox].find((item) => item.id === itemId);
}

/** 供工具產生新的投影 id。 */
export function newItemId(now: Date): string {
  return newCardId(now.getTime());
}
