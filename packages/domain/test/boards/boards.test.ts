import { describe, expect, it } from "vitest";

import { newCardId } from "../../src/cards/ids.js";
import { FRESHNESS_MAX, computeFreshness } from "../../src/freshness/index.js";
import {
  BoardDomainError,
  addEdge,
  addGroup,
  assertValidBoard,
  assignGroup,
  createBoard,
  createCardDraftFromSelection,
  isAgentBoardOperationAllowed,
  listBoardsContainingCard,
  listPinnedCardIds,
  moveItem,
  pinItem,
  projectCard,
  renameBoard,
  removeEdge,
  removeGroup,
  unprojectCard,
  type BoardDocument,
} from "../../src/boards/index.js";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-02T00:00:00.000Z";
const T90 = "2026-04-01T00:00:00.000Z";

function emptyBoard(): BoardDocument {
  return createBoard({ id: newCardId(), title: "測試白板", now: T0 });
}

function rejectWith(reason: string, run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BoardDomainError);
    expect((error as BoardDomainError).reason).toBe(reason);
    return;
  }
  throw new Error(`預期丟出 ${reason}`);
}

describe("投影不是複本", () => {
  it("同一張卡投影到兩個白板，卡片本體只有一份", () => {
    const cardId = newCardId();
    const boardA = projectCard({
      board: emptyBoard(),
      itemId: newCardId(),
      cardId,
      position: { x: 10, y: 20 },
      now: T1,
    });
    const boardB = projectCard({
      board: emptyBoard(),
      itemId: newCardId(),
      cardId,
      position: { x: 300, y: 400 },
      now: T1,
    });

    expect(boardA.items).toHaveLength(1);
    expect(boardB.items).toHaveLength(1);
    expect(boardA.items[0]?.cardId).toBe(cardId);
    expect(boardB.items[0]?.cardId).toBe(cardId);
    expect(boardA.items[0]?.id).not.toBe(boardB.items[0]?.id);
    expect(boardA.items[0]?.position).toEqual({ x: 10, y: 20 });
    expect(boardB.items[0]?.position).toEqual({ x: 300, y: 400 });
    expect(listBoardsContainingCard([boardA, boardB], cardId)).toEqual([boardA.id, boardB.id]);
  });

  it("收件區的投影也算這張卡的投影", () => {
    const cardId = newCardId();
    const inboxBoard = projectCard({
      board: emptyBoard(),
      itemId: newCardId(),
      cardId,
      origin: "inbox",
      position: { x: 0, y: 0 },
      now: T1,
    });

    expect(inboxBoard.inbox).toHaveLength(1);
    expect(listBoardsContainingCard([inboxBoard], cardId)).toEqual([inboxBoard.id]);
  });

  it("同一份白板重複投影同一張卡會被拒絕", () => {
    const board = emptyBoard();
    const cardId = newCardId();
    const once = projectCard({
      board,
      itemId: newCardId(),
      cardId,
      position: { x: 0, y: 0 },
      now: T1,
    });
    rejectWith("duplicate_projection", () =>
      projectCard({
        board: once,
        itemId: newCardId(),
        cardId,
        position: { x: 5, y: 5 },
        now: T1,
      }),
    );
  });

  it("取消投影會一併移除相關連線，但不動別的投影", () => {
    const cardA = newCardId();
    const cardB = newCardId();
    const itemA = newCardId();
    const itemB = newCardId();
    const edgeId = newCardId();
    let board = projectCard({
      board: emptyBoard(),
      itemId: itemA,
      cardId: cardA,
      position: { x: 0, y: 0 },
      now: T1,
    });
    board = projectCard({
      board,
      itemId: itemB,
      cardId: cardB,
      position: { x: 10, y: 0 },
      now: T1,
    });
    board = addEdge({
      board,
      edge: { id: edgeId, from: itemA, to: itemB },
      now: T1,
    });
    board = unprojectCard({ board, itemId: itemA, now: T1 });

    expect(board.items.map((item) => item.cardId)).toEqual([cardB]);
    expect(board.edges).toHaveLength(0);
    expect(board.updatedAt).toBe(T1);
  });
});

describe("收件區", () => {
  it("代理投影留在收件區，同一張卡不能在畫布重複投影", () => {
    const cardId = newCardId();
    const board = projectCard({
      board: emptyBoard(),
      itemId: newCardId(),
      cardId,
      position: { x: 0, y: 0 },
      origin: "inbox",
      projectedBy: "agent",
      now: T1,
    });
    expect(board.items).toEqual([]);
    expect(board.inbox[0]).toMatchObject({ cardId, origin: "inbox", projectedBy: "agent" });
    rejectWith("duplicate_projection", () =>
      projectCard({
        board,
        itemId: newCardId(),
        cardId,
        position: { x: 1, y: 1 },
        now: T1,
      }),
    );
  });

  it("收件區的投影也能取消，版本同時前進", () => {
    const itemId = newCardId();
    const board = projectCard({
      board: emptyBoard(),
      itemId,
      cardId: newCardId(),
      position: { x: 0, y: 0 },
      origin: "inbox",
      projectedBy: "agent",
      now: T1,
    });
    const next = unprojectCard({ board, itemId, now: T90 });
    expect(next.inbox).toEqual([]);
    expect(next.items).toEqual([]);
    expect(next.updatedAt).toBe(T90);
  });

  it("取消不存在的投影會拒絕", () => {
    rejectWith("unknown_item", () =>
      unprojectCard({ board: emptyBoard(), itemId: newCardId(), now: T1 }),
    );
  });

  it("不能用收件區投影作為畫布連線的端點", () => {
    const itemId = newCardId();
    const board = projectCard({
      board: emptyBoard(),
      itemId,
      cardId: newCardId(),
      position: { x: 0, y: 0 },
      origin: "inbox",
      now: T1,
    });
    rejectWith("unknown_item", () =>
      assertValidBoard({
        board: { ...board, edges: [{ id: newCardId(), from: itemId, to: itemId }] },
      }),
    );
  });
});

describe("驗證", () => {
  it("拒絕小數座標和小數尺寸", () => {
    for (const [position, size] of [
      [
        { x: 0.5, y: 0 },
        { width: 10, height: 10 },
      ],
      [
        { x: 0, y: 0 },
        { width: 10, height: 10.5 },
      ],
    ] as const) {
      rejectWith("invalid_point", () =>
        projectCard({
          board: emptyBoard(),
          itemId: newCardId(),
          cardId: newCardId(),
          position,
          size,
          now: T1,
        }),
      );
    }
  });
  it("連到不存在的投影會被拒絕", () => {
    const board = projectCard({
      board: emptyBoard(),
      itemId: newCardId(),
      cardId: newCardId(),
      position: { x: 0, y: 0 },
      now: T1,
    });
    rejectWith("unknown_item", () =>
      addEdge({
        board,
        edge: { id: newCardId(), from: board.items[0]!.id, to: newCardId() },
        now: T1,
      }),
    );
  });

  it("分組形成循環會被拒絕", () => {
    const groupA = newCardId();
    const groupB = newCardId();
    let board = addGroup({
      board: emptyBoard(),
      group: { id: groupA, label: "甲" },
      now: T1,
    });
    board = addGroup({
      board,
      group: { id: groupB, label: "乙", parentId: groupA },
      now: T1,
    });
    const cyclic: BoardDocument = {
      ...board,
      groups: board.groups.map((group) =>
        group.id === groupA ? { ...group, parentId: groupB } : group,
      ),
    };
    rejectWith("group_cycle", () => assertValidBoard({ board: cyclic }));
  });

  it("投影到不存在的卡片只在提供 knownCardIds 時檢查", () => {
    const missingCard = newCardId();
    const board = projectCard({
      board: emptyBoard(),
      itemId: newCardId(),
      cardId: missingCard,
      position: { x: 0, y: 0 },
      now: T1,
    });
    expect(() => assertValidBoard({ board })).not.toThrow();
    rejectWith("unknown_card", () =>
      assertValidBoard({ board, knownCardIds: new Set([newCardId()]) }),
    );
  });
});

describe("移動、分組與釘選", () => {
  it("所有變更都回傳新文件，不修改輸入", () => {
    const itemId = newCardId();
    const groupId = newCardId();
    const original = projectCard({
      board: emptyBoard(),
      itemId,
      cardId: newCardId(),
      position: { x: 0, y: 0 },
      now: T0,
    });
    const grouped = addGroup({
      board: original,
      group: { id: groupId, label: "收件區" },
      now: T1,
    });
    const moved = moveItem({
      board: grouped,
      itemId,
      position: { x: 42, y: 24 },
      now: T1,
    });
    const assigned = assignGroup({ board: moved, itemId, groupId, now: T1 });
    const pinned = pinItem({ board: assigned, itemId, pinned: true, now: T1 });

    expect(original.items[0]?.position).toEqual({ x: 0, y: 0 });
    expect(original.items[0]?.pinned).toBe(false);
    expect(original.groups).toHaveLength(0);
    expect(original.updatedAt).toBe(T0);
    expect(moved.items[0]?.position).toEqual({ x: 42, y: 24 });
    expect(assigned.items[0]?.groupId).toBe(groupId);
    expect(pinned.items[0]?.pinned).toBe(true);
    expect(listPinnedCardIds([pinned])).toEqual([pinned.items[0]!.cardId]);

    const detached = removeGroup({ board: pinned, groupId, now: T1 });
    expect(detached.groups).toHaveLength(0);
    expect(detached.items[0]?.groupId).toBeUndefined();
  });

  it("釘選的卡片經過 90 天新鮮度仍是 100", () => {
    const itemId = newCardId();
    const board = pinItem({
      board: projectCard({
        board: emptyBoard(),
        itemId,
        cardId: newCardId(),
        position: { x: 0, y: 0 },
        now: T0,
      }),
      itemId,
      pinned: true,
      now: T0,
    });
    const cardId = board.items[0]!.cardId;
    expect(listPinnedCardIds([board])).toContain(cardId);

    const fresh = computeFreshness({
      state: { value: 55, at: T0, pinned: true, lifecycle: "live" },
      now: T90,
      halfLifeDays: 30,
      liveConversationCount: 1,
      orphaned: false,
    });
    expect(fresh).toBe(FRESHNESS_MAX);
  });
});

describe("圈選生成新卡草稿", () => {
  it("血緣保留來源順序並去掉重複", () => {
    const a = newCardId();
    const b = newCardId();
    const draft = createCardDraftFromSelection({ title: "整理後的新卡", cardIds: [a, b, a] });
    expect(draft).toEqual({ title: "整理後的新卡", derivedFrom: [a, b] });
  });

  it("沒有來源卡或空標題會被拒絕", () => {
    rejectWith("unknown_card", () =>
      createCardDraftFromSelection({ title: "空圈選", cardIds: [] }),
    );
    rejectWith("invalid_id", () =>
      createCardDraftFromSelection({ title: "  ", cardIds: [newCardId()] }),
    );
  });
});

describe("代理操作模式", () => {
  it("read_only 只允許讀取、投影與圈選建卡", () => {
    expect(isAgentBoardOperationAllowed("read_only", "read")).toBe(true);
    for (const operation of ["project_card", "create_card_from_selection"] as const) {
      expect(
        isAgentBoardOperationAllowed("read_only", operation, { isNewCard: true, target: "inbox" }),
      ).toBe(true);
      expect(
        isAgentBoardOperationAllowed("read_only", operation, { isNewCard: false, target: "inbox" }),
      ).toBe(false);
      expect(
        isAgentBoardOperationAllowed("read_only", operation, { isNewCard: true, target: "canvas" }),
      ).toBe(false);
      expect(isAgentBoardOperationAllowed("read_only", operation)).toBe(false);
    }
    for (const operation of [
      "unproject_card",
      "move_item",
      "add_edge",
      "remove_edge",
      "group",
      "pin",
      "save",
      "delete_board",
    ] as const) {
      expect(isAgentBoardOperationAllowed("read_only", operation)).toBe(false);
    }
  });

  it("full 允許所有操作", () => {
    for (const operation of [
      "read",
      "create_board",
      "project_card",
      "create_card_from_selection",
      "unproject_card",
      "move_item",
      "add_edge",
      "remove_edge",
      "group",
      "pin",
      "save",
      "delete_board",
    ] as const) {
      expect(isAgentBoardOperationAllowed("full", operation)).toBe(true);
    }
  });
});

describe("其他操作", () => {
  it("更名與移除連線會更新 updatedAt", () => {
    const board = renameBoard({ board: emptyBoard(), title: "新名字", now: T1 });
    expect(board.title).toBe("新名字");
    expect(board.updatedAt).toBe(T1);
    const edgeId = newCardId();
    const projected = projectCard({
      board,
      itemId: newCardId(),
      cardId: newCardId(),
      position: { x: 0, y: 0 },
      now: T1,
    });
    const withEdge = addEdge({
      board: projected,
      edge: { id: edgeId, from: projected.items[0]!.id, to: projected.items[0]!.id },
      now: T1,
    });
    const without = removeEdge({ board: withEdge, edgeId, now: T1 });
    expect(without.edges).toHaveLength(0);
  });
});
