/**
 * 白板內容的純函式操作。
 *
 * 每一個函式回傳一份新的 BoardDocument，不改輸入；呼叫端負責把回傳值
 * 交給 BoardFileStore 原子寫入。id 與時間由呼叫端注入，測試才能重現。
 */

import { isUlid } from "../cards/ids.js";
import { BoardDomainError } from "./errors.js";
import { assertValidBoard } from "./validate.js";
import type {
  BoardDocument,
  BoardEdge,
  BoardGroup,
  BoardItem,
  BoardPoint,
  BoardSize,
  CreateBoardInput,
} from "./types.js";

/** 投影框的預設大小。 */
export const DEFAULT_ITEM_SIZE: BoardSize = { width: 240, height: 160 };

export interface ProjectCardInput {
  readonly board: BoardDocument;
  /** 新投影的 ULID，由呼叫端產生。 */
  readonly itemId: string;
  readonly cardId: string;
  readonly position: BoardPoint;
  readonly size?: BoardSize | undefined;
  readonly groupId?: string | undefined;
  readonly pinned?: boolean | undefined;
  readonly origin?: "canvas" | "inbox" | undefined;
  readonly projectedBy?: "user" | "agent" | undefined;
  readonly now: string;
}

export function createBoard(input: CreateBoardInput): BoardDocument {
  if (!isUlid(input.id)) {
    throw new BoardDomainError("invalid_id", `白板 id 不是 ULID：${input.id}`);
  }
  return {
    schema: 1,
    id: input.id,
    title: input.title,
    createdAt: input.now,
    updatedAt: input.now,
    items: [],
    inbox: [],
    edges: [],
    groups: [],
  };
}

/** 把一張卡投影進白板；同一張卡在同一份白板只能投影一次。 */
export function projectCard(input: ProjectCardInput): BoardDocument {
  const { board, itemId, cardId, position, now } = input;
  if (!isUlid(itemId)) {
    throw new BoardDomainError("invalid_id", `投影 id 不是 ULID：${itemId}`);
  }
  if (!isUlid(cardId)) {
    throw new BoardDomainError("invalid_id", `卡片 id 不是 ULID：${cardId}`);
  }
  if ([...board.items, ...board.inbox].some((item) => item.cardId === cardId)) {
    throw new BoardDomainError(
      "duplicate_projection",
      `同一張卡在同一份白板只能投影一次：${cardId}`,
    );
  }
  const item: BoardItem = {
    id: itemId,
    cardId,
    position,
    size: input.size ?? DEFAULT_ITEM_SIZE,
    pinned: input.pinned ?? false,
    origin: input.origin ?? "canvas",
    ...(input.projectedBy !== undefined ? { projectedBy: input.projectedBy } : {}),
    ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
  };
  return item.origin === "inbox"
    ? finish(board, { inbox: [...board.inbox, item] }, now)
    : finish(board, { items: [...board.items, item] }, now);
}

/**
 * 移除投影，並連帶移除參照它的連線。卡片本體不受影響。
 *
 * 畫布與收件區的投影都算；連線只會指向畫布上的投影，所以收件區的投影
 * 不會留下連線，但取消時仍走同一條路徑，呼叫端不必先分辨投影在哪一區。
 */
export function unprojectCard(input: {
  readonly board: BoardDocument;
  readonly itemId: string;
  readonly now: string;
}): BoardDocument {
  requireProjection(input.board, input.itemId);
  return finish(
    input.board,
    {
      items: input.board.items.filter((item) => item.id !== input.itemId),
      inbox: input.board.inbox.filter((item) => item.id !== input.itemId),
      edges: input.board.edges.filter(
        (edge) => edge.from !== input.itemId && edge.to !== input.itemId,
      ),
    },
    input.now,
  );
}

export function moveItem(input: {
  readonly board: BoardDocument;
  readonly itemId: string;
  readonly position: BoardPoint;
  readonly now: string;
}): BoardDocument {
  requireItem(input.board, input.itemId);
  return finish(
    input.board,
    {
      items: input.board.items.map((item) =>
        item.id === input.itemId ? { ...item, position: input.position } : item,
      ),
    },
    input.now,
  );
}

export function resizeItem(input: {
  readonly board: BoardDocument;
  readonly itemId: string;
  readonly size: BoardSize;
  readonly now: string;
}): BoardDocument {
  requireItem(input.board, input.itemId);
  return finish(
    input.board,
    {
      items: input.board.items.map((item) =>
        item.id === input.itemId ? { ...item, size: input.size } : item,
      ),
    },
    input.now,
  );
}

/** 新增連線；兩端都必須是白板上的投影。 */
export function addEdge(input: {
  readonly board: BoardDocument;
  readonly edge: BoardEdge;
  readonly now: string;
}): BoardDocument {
  if (!isUlid(input.edge.id)) {
    throw new BoardDomainError("invalid_id", `連線 id 不是 ULID：${input.edge.id}`);
  }
  requireItem(input.board, input.edge.from);
  requireItem(input.board, input.edge.to);
  if (input.board.edges.some((edge) => edge.id === input.edge.id)) {
    throw new BoardDomainError("invalid_id", `連線 id 重複：${input.edge.id}`);
  }
  return finish(input.board, { edges: [...input.board.edges, input.edge] }, input.now);
}

export function removeEdge(input: {
  readonly board: BoardDocument;
  readonly edgeId: string;
  readonly now: string;
}): BoardDocument {
  if (!input.board.edges.some((edge) => edge.id === input.edgeId)) {
    throw new BoardDomainError("unknown_item", `找不到連線：${input.edgeId}`);
  }
  return finish(
    input.board,
    { edges: input.board.edges.filter((edge) => edge.id !== input.edgeId) },
    input.now,
  );
}

export function addGroup(input: {
  readonly board: BoardDocument;
  readonly group: BoardGroup;
  readonly now: string;
}): BoardDocument {
  if (!isUlid(input.group.id)) {
    throw new BoardDomainError("invalid_id", `分組 id 不是 ULID：${input.group.id}`);
  }
  if (input.board.groups.some((group) => group.id === input.group.id)) {
    throw new BoardDomainError("invalid_id", `分組 id 重複：${input.group.id}`);
  }
  return finish(input.board, { groups: [...input.board.groups, input.group] }, input.now);
}

/** 移除分組；所屬投影回到畫布，子分組的 parentId 也一併清掉。 */
export function removeGroup(input: {
  readonly board: BoardDocument;
  readonly groupId: string;
  readonly now: string;
}): BoardDocument {
  if (!input.board.groups.some((group) => group.id === input.groupId)) {
    throw new BoardDomainError("unknown_group", `找不到分組：${input.groupId}`);
  }
  return finish(
    input.board,
    {
      items: input.board.items.map((item) =>
        item.groupId === input.groupId ? { ...item, groupId: undefined } : item,
      ),
      groups: input.board.groups
        .filter((group) => group.id !== input.groupId)
        .map((group) =>
          group.parentId === input.groupId ? { ...group, parentId: undefined } : group,
        ),
    },
    input.now,
  );
}

/** 把投影放進分組；groupId 省略表示移回畫布。 */
export function assignGroup(input: {
  readonly board: BoardDocument;
  readonly itemId: string;
  readonly groupId?: string | undefined;
  readonly now: string;
}): BoardDocument {
  requireItem(input.board, input.itemId);
  if (input.groupId !== undefined) {
    requireGroup(input.board, input.groupId);
  }
  return finish(
    input.board,
    {
      items: input.board.items.map((item) =>
        item.id === input.itemId ? { ...item, groupId: input.groupId } : item,
      ),
    },
    input.now,
  );
}

/** 釘選或取消釘選；卡片新鮮度由 host 依 listPinnedCardIds 同步。 */
export function pinItem(input: {
  readonly board: BoardDocument;
  readonly itemId: string;
  readonly pinned: boolean;
  readonly now: string;
}): BoardDocument {
  requireItem(input.board, input.itemId);
  return finish(
    input.board,
    {
      items: input.board.items.map((item) =>
        item.id === input.itemId ? { ...item, pinned: input.pinned } : item,
      ),
    },
    input.now,
  );
}

export function renameBoard(input: {
  readonly board: BoardDocument;
  readonly title: string;
  readonly now: string;
}): BoardDocument {
  return finish(input.board, { title: input.title }, input.now);
}

/** 至少在一個白板被釘選的卡片識別碼；順序照輸入首次出現的順序。 */
export function listPinnedCardIds(boards: readonly BoardDocument[]): readonly string[] {
  const pinned: string[] = [];
  const seen = new Set<string>();
  for (const board of boards) {
    for (const item of board.items) {
      if (item.pinned && !seen.has(item.cardId)) {
        seen.add(item.cardId);
        pinned.push(item.cardId);
      }
    }
  }
  return pinned;
}

/**
 * 含有某張卡投影的白板 id；用來在刪卡時逐一取消投影。
 *
 * 收件區的投影也指向同一張卡，所以要一起算；只掃畫布會留下指向已刪卡
 * 的收件區項目。
 */
export function listBoardsContainingCard(
  boards: readonly BoardDocument[],
  cardId: string,
): readonly string[] {
  return boards
    .filter(
      (board) =>
        board.items.some((item) => item.cardId === cardId) ||
        board.inbox.some((item) => item.cardId === cardId),
    )
    .map((board) => board.id);
}

function finish(board: BoardDocument, change: Partial<BoardDocument>, now: string): BoardDocument {
  const next: BoardDocument = { ...board, ...change, updatedAt: now };
  assertValidBoard({ board: next });
  return next;
}

function requireItem(board: BoardDocument, itemId: string): void {
  if (!board.items.some((item) => item.id === itemId)) {
    throw new BoardDomainError("unknown_item", `找不到投影：${itemId}`);
  }
}

/** 取消投影時兩區都算；其他操作只認畫布上的投影。 */
function requireProjection(board: BoardDocument, itemId: string): void {
  if (![...board.items, ...board.inbox].some((item) => item.id === itemId)) {
    throw new BoardDomainError("unknown_item", `找不到投影：${itemId}`);
  }
}

function requireGroup(board: BoardDocument, groupId: string): void {
  if (!board.groups.some((group) => group.id === groupId)) {
    throw new BoardDomainError("unknown_group", `找不到分組：${groupId}`);
  }
}
