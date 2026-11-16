/**
 * 白板格式的驗證。
 *
 * 這裡只檢查型別表達不出來的限制。時間一律由呼叫端注入，本模組不讀檔、
 * 不查資料庫；卡片是否真的存在由 `knownCardIds` 傳入，省略時只驗證格式。
 */

import { isUlid } from "../cards/ids.js";
import { BoardDomainError } from "./errors.js";
import type { BoardDocument } from "./types.js";

export interface ValidateBoardInput {
  readonly board: BoardDocument;
  /** 已知存在的卡片識別碼；提供時會檢查每個投影的 cardId。 */
  readonly knownCardIds?: ReadonlySet<string>;
}

/** 驗證整份白板；任何一項失敗就丟第一個錯誤，不部分修改。 */
export function assertValidBoard(input: ValidateBoardInput): void {
  const { board } = input;
  if (board.schema !== 1) {
    throw new BoardDomainError(
      "invalid_schema_version",
      `不支援的白板格式版本：${String(board.schema)}`,
    );
  }
  assertId(board.id, "白板 id");

  const itemIds = new Set<string>();
  const cardIds = new Set<string>();
  for (const item of board.items) {
    assertId(item.id, "投影 id");
    assertId(item.cardId, "卡片 id");
    if (itemIds.has(item.id)) {
      throw new BoardDomainError("invalid_id", `投影 id 重複：${item.id}`);
    }
    if (cardIds.has(item.cardId)) {
      throw new BoardDomainError(
        "duplicate_projection",
        `同一張卡在同一份白板只能投影一次：${item.cardId}`,
      );
    }
    itemIds.add(item.id);
    cardIds.add(item.cardId);
    assertPoint(item.position.x, item.position.y, "座標");
    assertPoint(item.size.width, item.size.height, "大小");
    if (input.knownCardIds !== undefined && !input.knownCardIds.has(item.cardId)) {
      throw new BoardDomainError("unknown_card", `投影到不存在的卡：${item.cardId}`);
    }
  }

  const groupIds = new Set<string>();
  for (const group of board.groups) {
    assertId(group.id, "分組 id");
    if (groupIds.has(group.id)) {
      throw new BoardDomainError("invalid_id", `分組 id 重複：${group.id}`);
    }
    groupIds.add(group.id);
  }
  for (const item of board.items) {
    if (item.groupId !== undefined && !groupIds.has(item.groupId)) {
      throw new BoardDomainError("unknown_group", `投影指向不存在的分組：${item.groupId}`);
    }
  }
  assertNoGroupCycle(board);

  const edgeIds = new Set<string>();
  for (const edge of board.edges) {
    assertId(edge.id, "連線 id");
    if (edgeIds.has(edge.id)) {
      throw new BoardDomainError("invalid_id", `連線 id 重複：${edge.id}`);
    }
    edgeIds.add(edge.id);
    if (!itemIds.has(edge.from)) {
      throw new BoardDomainError("unknown_item", `連線起點不是白板上的投影：${edge.from}`);
    }
    if (!itemIds.has(edge.to)) {
      throw new BoardDomainError("unknown_item", `連線終點不是白板上的投影：${edge.to}`);
    }
  }
}

function assertId(value: string, label: string): void {
  if (!isUlid(value)) {
    throw new BoardDomainError("invalid_id", `${label} 不是 ULID：${value}`);
  }
}

function assertPoint(x: number, y: number, label: string): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    throw new BoardDomainError("invalid_point", `${label}必須是有限非負數`);
  }
}

function assertNoGroupCycle(board: BoardDocument): void {
  const byId = new Map(board.groups.map((group) => [group.id, group]));
  for (const group of board.groups) {
    const seen = new Set<string>([group.id]);
    let cursor = group.parentId;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        throw new BoardDomainError("group_cycle", `分組形成循環：${cursor}`);
      }
      if (!byId.has(cursor)) {
        throw new BoardDomainError("unknown_group", `分組指向不存在的上層：${cursor}`);
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId;
    }
  }
}
