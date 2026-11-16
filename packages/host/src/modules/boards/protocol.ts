import { BoardDomainError, assertValidBoard, type BoardDocument } from "@cardiary/domain";
import type { JsonValue } from "@cardiary/engine-adapter";
import type { ProtocolEventEmitter, ProtocolRequestContext } from "@cardiary/module-api";
import type {
  BoardCreateCardFromSelectionResponsePayload,
  BoardCreateResponsePayload,
  BoardDeleteResponsePayload,
  BoardDocument as WireBoardDocument,
  BoardItem as WireBoardItem,
  BoardListResponsePayload,
  BoardProjectCardResponsePayload,
  BoardSaveResponsePayload,
  BoardSummary as WireBoardSummary,
  BoardUnprojectCardResponsePayload,
  JSONObject,
} from "@cardiary/protocol";
import { StorageError } from "@cardiary/storage";

import { ProtocolHandlerError } from "../contract.js";
import type { BoardService, CreatedCardProjection } from "./service.js";

/** `board.save` 的冪等記憶；行程內有效，重送回傳同一次儲存的結果。 */
const SAVE_DEDUPE_LIMIT = 256;

export interface BoardsProtocolOptions {
  readonly service: BoardService;
  readonly protocol: ProtocolEventEmitter;
}

/**
 * `board.*` 協定處理器。
 *
 * 人類客戶端走這裡：投影落在畫布、`projectedBy` 是 `user`。代理走工具，
 * 不經過這個命名空間，兩條路的權限判定因此不會混在一起。
 */
export function registerBoardsProtocol(options: BoardsProtocolOptions): void {
  const { service, protocol } = options;
  const saves = new Map<string, { readonly boardId: string; readonly updatedAt: string }>();

  const rememberSave = (key: string, value: { boardId: string; updatedAt: string }): void => {
    saves.set(key, value);
    if (saves.size > SAVE_DEDUPE_LIMIT) {
      const oldest = saves.keys().next();
      if (!oldest.done) saves.delete(oldest.value);
    }
  };

  protocol.registerNamespace(
    "board",
    async (request: ProtocolRequestContext): Promise<JsonValue> => {
      try {
        switch (request.type) {
          case "board.list":
            return asJson(listBoards(service));
          case "board.get": {
            const input = objectOf(request.payload);
            return asJson({ board: wireBoard(service.get(requiredString(input, "boardId"))) });
          }
          case "board.create": {
            const input = objectOf(request.payload);
            const board = await service.create(
              requiredString(input, "boardId"),
              requiredString(input, "title"),
            );
            return asJson({ board: wireBoard(board) } satisfies BoardCreateResponsePayload);
          }
          case "board.save":
            return asJson(await saveBoard(service, request.payload, saves, rememberSave));
          case "board.delete": {
            const input = objectOf(request.payload);
            const deleted = await service.delete(requiredString(input, "boardId"));
            return asJson({ deleted } satisfies BoardDeleteResponsePayload);
          }
          case "board.project_card":
            return asJson(await projectCard(service, request.payload));
          case "board.unproject_card": {
            const input = objectOf(request.payload);
            const board = await service.unproject(
              requiredString(input, "boardId"),
              requiredString(input, "itemId"),
            );
            return asJson({ board: wireBoard(board) } satisfies BoardUnprojectCardResponsePayload);
          }
          case "board.create_card_from_selection":
            return asJson(await createCardFromSelection(service, request.payload));
          default:
            throw new ProtocolHandlerError("not_found", `沒有這個白板訊息：${request.type}`);
        }
      } catch (error) {
        throw asProtocolError(error);
      }
    },
  );
}

function listBoards(service: BoardService): BoardListResponsePayload {
  const boards = service
    .list()
    .map((board): WireBoardSummary => ({
      id: board.id,
      title: board.title,
      updatedAt: board.updatedAt,
      itemCount: board.items.length + board.inbox.length,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return { boards };
}

async function saveBoard(
  service: BoardService,
  payload: JsonValue,
  saves: Map<string, { boardId: string; updatedAt: string }>,
  remember: (key: string, value: { boardId: string; updatedAt: string }) => void,
): Promise<BoardSaveResponsePayload> {
  const input = objectOf(payload);
  const board = domainBoardOf(input["board"]);
  const baseUpdatedAt = requiredString(input, "baseUpdatedAt");
  const clientRequestId = optionalString(input, "clientRequestId");
  if (clientRequestId !== undefined) {
    const previous = saves.get(clientRequestId);
    const current = previous === undefined ? undefined : service.find(previous.boardId);
    if (
      previous !== undefined &&
      current !== undefined &&
      current.updatedAt === previous.updatedAt
    ) {
      return { board: wireBoard(current) };
    }
  }
  const saved = await service.save(board, baseUpdatedAt);
  if (clientRequestId !== undefined) {
    remember(clientRequestId, { boardId: saved.id, updatedAt: saved.updatedAt });
  }
  return { board: wireBoard(saved) };
}

async function projectCard(
  service: BoardService,
  payload: JsonValue,
): Promise<BoardProjectCardResponsePayload> {
  const input = objectOf(payload);
  const board = await service.project({
    boardId: requiredString(input, "boardId"),
    itemId: requiredString(input, "itemId"),
    cardId: requiredString(input, "cardId"),
    position: pointOf(requiredObject(input, "position")),
    origin: "canvas",
    projectedBy: "user",
  });
  return { board: wireBoard(board) };
}

async function createCardFromSelection(
  service: BoardService,
  payload: JsonValue,
): Promise<BoardCreateCardFromSelectionResponsePayload> {
  const input = objectOf(payload);
  const cardIds = stringArrayOf(input, "cardIds");
  if (cardIds.length === 0) {
    throw new ProtocolHandlerError("invalid_message", "圈選至少要有一張卡。", { field: "cardIds" });
  }
  const created: CreatedCardProjection = await service.createCard({
    boardId: requiredString(input, "boardId"),
    itemId: requiredString(input, "itemId"),
    title: requiredString(input, "title"),
    body: requiredString(input, "body"),
    position: pointOf(requiredObject(input, "position")),
    origin: "canvas",
    projectedBy: "user",
    derivedFrom: cardIds,
  });
  return { board: wireBoard(created.board), cardId: created.cardId };
}

function wireBoard(board: BoardDocument): WireBoardDocument {
  return {
    schema: 1,
    id: board.id,
    title: board.title,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    items: board.items.map(wireItem),
    inbox: board.inbox.map(wireItem),
    edges: board.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      ...(edge.label === undefined ? {} : { label: edge.label }),
    })),
    groups: board.groups.map((group) => ({
      id: group.id,
      label: group.label,
      ...(group.parentId === undefined ? {} : { parentId: group.parentId }),
    })),
  };
}

function wireItem(item: BoardDocument["items"][number]): WireBoardItem {
  return {
    id: item.id,
    cardId: item.cardId,
    position: { x: item.position.x, y: item.position.y },
    size: { width: item.size.width, height: item.size.height },
    pinned: item.pinned,
    origin: item.origin,
    ...(item.projectedBy === undefined ? {} : { projectedBy: item.projectedBy }),
    ...(item.groupId === undefined ? {} : { groupId: item.groupId }),
  };
}

/** 儲存請求帶整份文件；形狀由領域驗證，這裡只確認它是一個物件。 */
function domainBoardOf(value: JsonValue | undefined): BoardDocument {
  const board = value as unknown as BoardDocument;
  if (typeof board !== "object" || board === null || Array.isArray(board)) {
    throw new ProtocolHandlerError("invalid_message", "board 必須是物件。", { field: "board" });
  }
  assertValidBoard({ board });
  return board;
}

function pointOf(input: JSONObject): { x: number; y: number } {
  const x = input["x"];
  const y = input["y"];
  if (typeof x !== "number" || typeof y !== "number") {
    throw new ProtocolHandlerError("invalid_message", "座標必須是數字。", { field: "position" });
  }
  return { x, y };
}

function objectOf(value: JsonValue | undefined): JSONObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolHandlerError("invalid_message", "請求內容必須是物件。");
  }
  return value as JSONObject;
}

function requiredObject(input: JSONObject, key: string): JSONObject {
  const value = input[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolHandlerError("invalid_message", `缺少或型別不符的欄位：${key}`, {
      field: key,
    });
  }
  return value as JSONObject;
}

function requiredString(input: JSONObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new ProtocolHandlerError("invalid_message", `缺少或型別不符的欄位：${key}`, {
      field: key,
    });
  }
  return value;
}

function optionalString(input: JSONObject, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ProtocolHandlerError("invalid_message", `欄位 ${key} 必須是字串。`, { field: key });
  }
  return value;
}

function stringArrayOf(input: JSONObject, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ProtocolHandlerError("invalid_message", `欄位 ${key} 必須是字串陣列。`, {
      field: key,
    });
  }
  return value as string[];
}

function asProtocolError(error: unknown): unknown {
  if (error instanceof ProtocolHandlerError) return error;
  if (error instanceof BoardDomainError) {
    const code =
      error.reason === "permission_denied"
        ? "permission_denied"
        : error.reason === "conflict"
          ? "conflict"
          : "invalid_message";
    return new ProtocolHandlerError(code, error.message, { reason: error.reason });
  }
  if (error instanceof StorageError) {
    if (error.code === "invalid-state-transition") {
      return new ProtocolHandlerError("conflict", error.message);
    }
    if (error.code === "invalid-input" || error.code === "invalid-path") {
      return new ProtocolHandlerError("invalid_message", error.message);
    }
  }
  return error;
}

function asJson(payload: object): JsonValue {
  return payload as unknown as JsonValue;
}
