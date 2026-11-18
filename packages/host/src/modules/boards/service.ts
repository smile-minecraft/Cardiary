import {
  addEdge,
  addGroup,
  assertValidBoard,
  assignGroup,
  createBoard,
  listBoardsContainingCard,
  listPinnedCardIds,
  moveItem,
  newCardId,
  pinItem,
  projectCard,
  removeEdge,
  removeGroup,
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
  /** 目前狀態庫標記為釘選的卡片識別碼；啟動校正要用。 */
  listPinned(): readonly string[] | Promise<readonly string[]>;
}

/**
 * 代理變更的來源。
 *
 * 有這個欄位的寫入會進入該白板的復原紀錄；使用者自己的操作不帶它，因此
 * 不會被 `undo` 復原。`tool` 只記在復原紀錄裡，供除錯與復原後查看；服務
 * 層不以它過濾變更，這一筆變更的 changeId 由 `agentChangeIdFor` 直接依
 * 寫入結果查出。
 */
export interface AgentChangeContext {
  readonly tool: string;
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
  readonly agent?: AgentChangeContext;
}

export interface ProjectCardOnBoardInput {
  readonly boardId: string;
  readonly itemId: string;
  readonly cardId: string;
  readonly position: BoardPoint;
  readonly origin: "canvas" | "inbox";
  readonly projectedBy: "user" | "agent";
  readonly agent?: AgentChangeContext;
}

export interface MoveBoardItemInput {
  readonly boardId: string;
  readonly itemId: string;
  readonly position: BoardPoint;
  readonly agent: AgentChangeContext;
}

export interface ConnectBoardItemsInput {
  readonly boardId: string;
  readonly edgeId: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly agent: AgentChangeContext;
}

export interface DisconnectBoardItemsInput {
  readonly boardId: string;
  readonly edgeId: string;
  readonly agent: AgentChangeContext;
}

export interface CreateBoardGroupInput {
  readonly boardId: string;
  readonly groupId: string;
  readonly label: string;
  readonly parentId?: string;
  readonly agent: AgentChangeContext;
}

export interface AssignBoardItemGroupInput {
  readonly boardId: string;
  readonly itemId: string;
  /** 省略表示移回畫布。 */
  readonly groupId?: string;
  readonly agent: AgentChangeContext;
}

export interface RemoveBoardGroupInput {
  readonly boardId: string;
  readonly groupId: string;
  readonly agent: AgentChangeContext;
}

export interface PinBoardItemInput {
  readonly boardId: string;
  readonly itemId: string;
  readonly pinned: boolean;
  readonly agent: AgentChangeContext;
}

export interface RemoveBoardItemInput {
  readonly boardId: string;
  readonly itemId: string;
  readonly agent: AgentChangeContext;
}

export interface UndoBoardChangeInput {
  readonly boardId: string;
  readonly changeId: string;
}

export interface UndoBoardChangeResult {
  readonly board: BoardDocument;
  /** 這筆變更在這之前已經復原過；重送會回 false，不視為錯誤。 */
  readonly undone: boolean;
  /** 這塊白板還剩幾筆可以復原的代理變更。 */
  readonly remaining: number;
}

export interface CreatedCardProjection {
  readonly board: BoardDocument;
  readonly cardId: string;
  readonly item: BoardItem;
}

/** 每塊白板保留的代理變更筆數；夠代理在一次對話裡修正，不會無限成長。 */
const AGENT_CHANGE_HISTORY_LIMIT = 20;
/** 已復原的 changeId 記憶；只為了讓重送的 undo 認得出「這筆已經復原過」。 */
const UNDONE_CHANGE_MEMORY_LIMIT = 200;

interface AgentChange {
  readonly changeId: string;
  readonly tool: string;
  /** 變更前的完整白板與變更後的完整白板；復原只需要前者，後者用來認版本。 */
  readonly before: BoardDocument;
  readonly after: BoardDocument;
}

/**
 * 白板正本由 `BoardFileStore` 保存，版本由主機配發。
 *
 * 所有寫入都排在同一條佇列上：讀檔、驗證版本、寫檔之間不能插入另一筆
 * 寫入，否則兩個視窗同時投影會把對方覆蓋掉。讀取不排隊，最多看到前一筆
 * 寫入完成的狀態。
 *
 * 代理變更的復原紀錄只放在記憶體：主機重啟後清空，客戶端就顯示沒有可
 * 復原的變更。把快照寫進檔案會讓它和正本、釘選狀態跨越重啟後互相矛盾，
 * 保守的做法是不假裝還原得回來。
 */
export class BoardService {
  #queue: Promise<unknown> = Promise.resolve();
  readonly #agentChanges = new Map<string, AgentChange[]>();
  readonly #undoneChanges = new Map<string, string[]>();
  /** 這一輪寫入產生的白板文件 → 這一筆代理變更的 changeId；文件離開記憶體就不可再查。 */
  readonly #agentWrites = new WeakMap<BoardDocument, string>();

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
      this.#agentChanges.delete(id);
      this.#undoneChanges.delete(id);
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
      return this.#commit({
        before: current,
        next: projected,
        pinnedBefore,
        cardIds: [input.cardId],
        ...(input.agent === undefined ? {} : { agent: input.agent }),
      });
    });
  }

  /** 取消投影；畫布與收件區的項目都能移除，連帶移除參照它的連線。 */
  unproject(boardId: string, itemId: string, agent?: AgentChangeContext): Promise<BoardDocument> {
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
      return this.#commit({
        before: board,
        next,
        pinnedBefore,
        cardIds: [item.cardId],
        ...(agent === undefined ? {} : { agent }),
      });
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
      const written = await this.#commit({
        before: current,
        next: projected,
        pinnedBefore,
        cardIds: [card.cardId],
        ...(input.agent === undefined ? {} : { agent: input.agent }),
      });
      const item = findItem(written, input.itemId);
      if (item === undefined) {
        throw new ProtocolHandlerError("internal", "投影寫入後找不到項目。", {
          boardId: input.boardId,
        });
      }
      return { board: written, cardId: card.cardId, item };
    });
  }

  /** 移動畫布上的項目；同一個位置重送回目前的白板。 */
  move(input: MoveBoardItemInput): Promise<BoardDocument> {
    return this.#exclusive(async () => {
      const pinnedBefore = this.#pinnedCardIds();
      const board = this.get(input.boardId);
      const item = findItem(board, input.itemId);
      if (item === undefined) {
        throw new ProtocolHandlerError("not_found", "找不到白板上的這個項目。", {
          boardId: input.boardId,
          itemId: input.itemId,
        });
      }
      if (item.position.x === input.position.x && item.position.y === input.position.y) {
        return board;
      }
      const next = moveItem({
        board,
        itemId: input.itemId,
        position: input.position,
        now: this.#nextTimestamp(board),
      });
      return this.#commit({
        before: board,
        next,
        pinnedBefore,
        cardIds: [item.cardId],
        agent: input.agent,
      });
    });
  }

  /** 連接兩個畫布項目；同一個 edgeId 重送回目前的白板。 */
  connect(input: ConnectBoardItemsInput): Promise<BoardDocument> {
    return this.#exclusive(async () => {
      const pinnedBefore = this.#pinnedCardIds();
      const board = this.get(input.boardId);
      if (board.edges.some((edge) => edge.id === input.edgeId)) return board;
      const next = addEdge({
        board,
        edge: {
          id: input.edgeId,
          from: input.from,
          to: input.to,
          ...(input.label === undefined ? {} : { label: input.label }),
        },
        now: this.#nextTimestamp(board),
      });
      return this.#commit({
        before: board,
        next,
        pinnedBefore,
        agent: input.agent,
      });
    });
  }

  /** 移除連線；已經不存在的 edge 視為同一次操作已完成。 */
  disconnect(input: DisconnectBoardItemsInput): Promise<BoardDocument> {
    return this.#exclusive(async () => {
      const pinnedBefore = this.#pinnedCardIds();
      const board = this.get(input.boardId);
      if (!board.edges.some((edge) => edge.id === input.edgeId)) return board;
      const next = removeEdge({
        board,
        edgeId: input.edgeId,
        now: this.#nextTimestamp(board),
      });
      return this.#commit({
        before: board,
        next,
        pinnedBefore,
        agent: input.agent,
      });
    });
  }

  /** 建立分組；同一個 groupId 重送回目前的白板。 */
  createGroup(input: CreateBoardGroupInput): Promise<BoardDocument> {
    return this.#exclusive(async () => {
      const pinnedBefore = this.#pinnedCardIds();
      const board = this.get(input.boardId);
      if (board.groups.some((group) => group.id === input.groupId)) return board;
      const next = addGroup({
        board,
        group: {
          id: input.groupId,
          label: input.label,
          ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
        },
        now: this.#nextTimestamp(board),
      });
      return this.#commit({
        before: board,
        next,
        pinnedBefore,
        agent: input.agent,
      });
    });
  }

  /** 把項目放進分組；省略 groupId 表示移回畫布。 */
  assignToGroup(input: AssignBoardItemGroupInput): Promise<BoardDocument> {
    return this.#exclusive(async () => {
      const pinnedBefore = this.#pinnedCardIds();
      const board = this.get(input.boardId);
      const item = findItem(board, input.itemId);
      if (item === undefined) {
        throw new ProtocolHandlerError("not_found", "找不到白板上的這個項目。", {
          boardId: input.boardId,
          itemId: input.itemId,
        });
      }
      if (item.groupId === input.groupId) return board;
      const next = assignGroup({
        board,
        itemId: input.itemId,
        ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
        now: this.#nextTimestamp(board),
      });
      return this.#commit({
        before: board,
        next,
        pinnedBefore,
        cardIds: [item.cardId],
        agent: input.agent,
      });
    });
  }

  /** 移除分組；分組內的項目回到畫布，子分組往上接。 */
  deleteGroup(input: RemoveBoardGroupInput): Promise<BoardDocument> {
    return this.#exclusive(async () => {
      const pinnedBefore = this.#pinnedCardIds();
      const board = this.get(input.boardId);
      if (!board.groups.some((group) => group.id === input.groupId)) return board;
      const cardIds = board.items
        .filter((item) => item.groupId === input.groupId)
        .map((item) => item.cardId);
      const next = removeGroup({
        board,
        groupId: input.groupId,
        now: this.#nextTimestamp(board),
      });
      return this.#commit({
        before: board,
        next,
        pinnedBefore,
        cardIds,
        agent: input.agent,
      });
    });
  }

  /** 設定釘選；狀態已相同時不寫入，重送安全。 */
  setPinned(input: PinBoardItemInput): Promise<BoardDocument> {
    return this.#exclusive(async () => {
      const pinnedBefore = this.#pinnedCardIds();
      const board = this.get(input.boardId);
      const item = findItem(board, input.itemId);
      if (item === undefined) {
        throw new ProtocolHandlerError("not_found", "找不到白板上的這個項目。", {
          boardId: input.boardId,
          itemId: input.itemId,
        });
      }
      if (item.pinned === input.pinned) return board;
      const next = pinItem({
        board,
        itemId: input.itemId,
        pinned: input.pinned,
        now: this.#nextTimestamp(board),
      });
      return this.#commit({
        before: board,
        next,
        pinnedBefore,
        cardIds: [item.cardId],
        agent: input.agent,
      });
    });
  }

  /** 移除畫布或收件區的項目；卡片本體不動。 */
  removeItem(input: RemoveBoardItemInput): Promise<BoardDocument> {
    return this.#exclusive(async () => {
      const pinnedBefore = this.#pinnedCardIds();
      const board = this.get(input.boardId);
      const item = findItem(board, input.itemId);
      if (item === undefined) return board;
      const next = unprojectCard({
        board,
        itemId: input.itemId,
        now: this.#nextTimestamp(board),
      });
      return this.#commit({
        before: board,
        next,
        pinnedBefore,
        cardIds: [item.cardId],
        agent: input.agent,
      });
    });
  }

  /**
   * 復原一筆代理變更。
   *
   * 只能復原這塊白板最近、且之後沒有其他寫入的那一筆；使用者改過白板就
   * 回 conflict，不覆蓋使用者的內容。復原會把整份白板寫回變更前的內容，
   * 版本配新的值，釘選照一般寫入流程同步。
   */
  undo(input: UndoBoardChangeInput): Promise<UndoBoardChangeResult> {
    return this.#exclusive(async () => {
      const board = this.get(input.boardId);
      const changes = this.#agentChanges.get(board.id) ?? [];
      if (this.#undoneChanges.get(board.id)?.includes(input.changeId) === true) {
        return { board, undone: false, remaining: changes.length };
      }
      const entry = changes.find((change) => change.changeId === input.changeId);
      if (entry === undefined) {
        throw new ProtocolHandlerError(
          "not_found",
          "找不到這筆代理變更；可能已復原，或主機重啟後紀錄已清空。",
          { boardId: input.boardId, changeId: input.changeId },
        );
      }
      if (changes[changes.length - 1] !== entry) {
        throw new ProtocolHandlerError(
          "conflict",
          "這筆變更之後還有其他代理變更；請先復原較新的變更。",
          { boardId: input.boardId, changeId: input.changeId },
        );
      }
      if (board.updatedAt !== entry.after.updatedAt) {
        throw new ProtocolHandlerError("conflict", "白板在這筆變更之後被改過，不能直接復原。", {
          boardId: input.boardId,
          changeId: input.changeId,
          expectedUpdatedAt: entry.after.updatedAt,
          actualUpdatedAt: board.updatedAt,
        });
      }

      const pinnedBefore = this.#pinnedCardIds();
      const restored = await this.#dropDeadProjections({
        ...entry.before,
        updatedAt: this.#nextTimestamp(board),
      });
      assertValidBoard({ board: restored });
      this.store.write(restored, { expectedUpdatedAt: board.updatedAt });
      changes.pop();
      // 前一筆的 after 指向被復原這筆的 before；版本換了，跟著更新，
      // 連續復原才不會被自己的版本檢查擋下。
      const previous = changes[changes.length - 1];
      if (previous !== undefined && previous.after.updatedAt === entry.before.updatedAt) {
        changes[changes.length - 1] = {
          ...previous,
          after: { ...previous.after, updatedAt: restored.updatedAt },
        };
      }
      this.#rememberUndone(board.id, input.changeId);
      await this.#syncPinned(pinnedBefore);
      this.emit({
        boardId: board.id,
        change: "updated",
        board: restored,
        cardIds: cardIdsOf(entry.before, board),
      });
      return { board: restored, undone: true, remaining: changes.length };
    });
  }

  /**
   * 復原寫回前，先拿掉指向已刪除卡片的投影。
   *
   * 復原是把變更前的快照寫回去；該卡片可能在這期間已被刪除，快照裡的投影
   * 就會指向不存在的卡。與其把死投影寫回去，不如一併移除它（連帶它的
   * 連線），復原才會留下一份不含死投影的白板。卡片服務沒接上時無從查證，
   * 維持原快照。
   */
  async #dropDeadProjections(restored: BoardDocument): Promise<BoardDocument> {
    const cards = this.cards;
    if (cards === undefined) return restored;
    const cardIds = [
      ...new Set([...restored.items, ...restored.inbox].map((item) => item.cardId)),
    ];
    const dead = new Set<string>();
    for (const cardId of cardIds) {
      if ((await cards.get(cardId)) == null) {
        dead.add(cardId);
      }
    }
    if (dead.size === 0) return restored;
    let scrubbed = restored;
    for (const projection of [...scrubbed.items, ...scrubbed.inbox]) {
      if (!dead.has(projection.cardId)) continue;
      scrubbed = unprojectCard({ board: scrubbed, itemId: projection.id, now: scrubbed.updatedAt });
    }
    return scrubbed;
  }

  /**
   * 卡片刪除後移除它在所有白板的投影。
   *
   * 由卡片模組的刪除流程呼叫；只動白板的投影與連線，不碰卡片，也不會
   * 反過來刪卡。找不到投影的白板不寫入。每一份白板各自處理：一份失敗不
   * 影響其他白板，全部試完後把失敗的白板列在錯誤的 details 裡丟出；已處理
   * 的白板在重試時自然不會再被列出，所以重試是安全的。
   */
  removeCardProjections(cardId: string): Promise<readonly string[]> {
    return this.#exclusive(async () => {
      const pinnedBefore = this.#pinnedCardIds();
      const touched: string[] = [];
      const failures: { readonly boardId: string; readonly message: string }[] = [];
      for (const boardId of listBoardsContainingCard(this.list(), cardId)) {
        try {
          const board = this.get(boardId);
          const projections = [...board.items, ...board.inbox].filter(
            (item) => item.cardId === cardId,
          );
          if (projections.length === 0) continue;
          let next = board;
          for (const projection of projections) {
            next = unprojectCard({
              board: next,
              itemId: projection.id,
              now: this.#nextTimestamp(next),
            });
          }
          this.store.write(next, { expectedUpdatedAt: board.updatedAt });
          await this.#syncPinned(pinnedBefore);
          this.emit({ boardId, change: "updated", board: next, cardIds: [cardId] });
          touched.push(boardId);
        } catch (error) {
          failures.push({
            boardId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (failures.length > 0) {
        throw new ProtocolHandlerError(
          "storage-failed",
          `移除卡片 ${cardId} 的投影時有 ${failures.length} 份白板失敗；重試會略過已處理的白板。`,
          {
            cardId,
            succeeded: touched,
            failed: failures.map((failure) => failure.boardId),
            failures,
          },
        );
      }
      return touched;
    });
  }

  /**
   * 找出這一輪服務實際寫入的白板文件對應的代理變更 changeId。
   * 只看文件本身的身分，不依版本或工具查找；目標狀態已是現況、沒有寫入
   * 時回 undefined。
   */
  agentChangeIdFor(board: BoardDocument): string | undefined {
    return this.#agentWrites.get(board);
  }

  /**
   * 寫入白板並完成後續同步；所有變更都經過這裡，行為才一致。
   *
   * 先寫檔再記復原快照：寫檔失敗時不能留下「可以復原」的紀錄。事件在
   * 釘選同步之後才送，客戶端收到時狀態已經一致。
   */
  async #commit(input: {
    readonly before: BoardDocument;
    readonly next: BoardDocument;
    readonly pinnedBefore: ReadonlySet<string>;
    readonly cardIds?: readonly string[];
    readonly agent?: AgentChangeContext;
  }): Promise<BoardDocument> {
    assertValidBoard({ board: input.next });
    this.store.write(input.next, { expectedUpdatedAt: input.before.updatedAt });
    if (input.agent !== undefined) {
      const changeId = this.#rememberAgentChange(input.agent.tool, input.before, input.next);
      this.#agentWrites.set(input.next, changeId);
    }
    await this.#syncPinned(input.pinnedBefore);
    this.emit({
      boardId: input.next.id,
      change: "updated",
      board: input.next,
      ...(input.cardIds === undefined ? {} : { cardIds: input.cardIds }),
    });
    return input.next;
  }

  #rememberAgentChange(tool: string, before: BoardDocument, after: BoardDocument): string {
    const changeId = newCardId(this.now().getTime());
    const entries = this.#agentChanges.get(after.id) ?? [];
    entries.push({
      changeId,
      tool,
      before,
      after,
    });
    if (entries.length > AGENT_CHANGE_HISTORY_LIMIT) {
      entries.splice(0, entries.length - AGENT_CHANGE_HISTORY_LIMIT);
    }
    this.#agentChanges.set(after.id, entries);
    return changeId;
  }

  #rememberUndone(boardId: string, changeId: string): void {
    const undone = this.#undoneChanges.get(boardId) ?? [];
    undone.push(changeId);
    if (undone.length > UNDONE_CHANGE_MEMORY_LIMIT) {
      undone.splice(0, undone.length - UNDONE_CHANGE_MEMORY_LIMIT);
    }
    this.#undoneChanges.set(boardId, undone);
  }

  /** 白板是目前唯一決定「卡片是否釘選」的地方；從所有白板檔算出目前釘選的卡片。 */
  #pinnedCardIds(): Set<string> {
    const boards = this.store.list().map((entry) => entry.board);
    return new Set(listPinnedCardIds(boards));
  }

  /**
   * 啟動校正：白板是正本，把卡片狀態鏡射到與白板一致。
   *
   * 白板有釘選、狀態沒有的，標記為釘選；狀態釘選、白板沒有的，取消釘選。
   * 白板檔讀不出來時讓啟動失敗，不要猜測後把卡片解除釘選。
   */
  async reconcilePins(): Promise<void> {
    if (this.pins === undefined) return;
    const pinned = this.#pinnedCardIds();
    const statePinned = new Set(await this.pins.listPinned());
    const affected = new Set([...pinned, ...statePinned]);
    for (const cardId of affected) {
      await this.pins.setPinned(cardId, pinned.has(cardId));
    }
  }

  /**
   * 寫入後同步釘選。對受影響的卡片（寫入前釘選的或寫入後釘選的）無條件
   * 呼叫 `setPinned`：白板檔寫入成功但同步中斷時，重試會從新檔重算集合，
   * 差異會是空的，所以不能只同步差異。`setPinned` 對狀態已一致的卡片
   * 會早退，重送安全。
   */
  async #syncPinned(before: ReadonlySet<string>): Promise<void> {
    if (this.pins === undefined) return;
    const after = this.#pinnedCardIds();
    const affected = new Set([...before, ...after]);
    for (const cardId of affected) {
      await this.pins.setPinned(cardId, after.has(cardId));
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

/** 兩份白板擁有的卡片；事件用它提示釘選與新鮮度可能要更新。 */
function cardIdsOf(...boards: BoardDocument[]): string[] {
  const ids = new Set<string>();
  for (const board of boards) {
    for (const item of [...board.items, ...board.inbox]) ids.add(item.cardId);
  }
  return [...ids];
}

/** 供工具產生新的投影 id。 */
export function newItemId(now: Date): string {
  return newCardId(now.getTime());
}
