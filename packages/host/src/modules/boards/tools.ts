import { createHash } from "node:crypto";

import {
  isAgentBoardOperationAllowed,
  type BoardAgentMode as DomainBoardMode,
  type BoardDocument,
} from "@cardiary/domain";
import type {
  JsonValue,
  ToolBundleDraft,
  ToolDefinition,
  ToolExecutionContext,
  ToolOutcome,
} from "@cardiary/engine-adapter";

import type { AuditEntry } from "../../permissions/audit.js";
import { ProtocolHandlerError } from "../contract.js";
import {
  BOARDS_BUNDLE_ID,
  BOARDS_FULL_BUNDLE_ID,
  BOARDS_PROJECT_BUNDLE_ID,
  type BoardsAgentMode,
} from "./policy.js";
import type { BoardService } from "./service.js";

export interface BoardsToolsOptions {
  readonly service: BoardService;
  /** 呼叫當下的模式；設定切換對既有對話立即生效。 */
  readonly agentMode: () => BoardsAgentMode;
  readonly audit: { appendAudit(entry: AuditEntry): void };
  readonly now: () => Date;
}

/**
 * 代理白板工具。
 *
 * `boards.agentMode` 決定新對話看得到哪些工具組；既有對話可能還留著投影
 * 或完全操作的工具，所以每次呼叫都重新讀目前模式，受限時回 `policy-denied`
 * 並寫稽核。曝光控制與執行期防禦是兩層；少了任何一層都可能讓代理改到
 * 使用者內容。
 */
export function createBoardsToolBundles(options: BoardsToolsOptions): {
  readonly create: ToolBundleDraft;
  readonly project: ToolBundleDraft;
  readonly full: ToolBundleDraft;
} {
  return {
    create: {
      bundleId: BOARDS_BUNDLE_ID,
      label: "白板",
      tools: [createCardOnBoardTool(options)],
    },
    project: {
      bundleId: BOARDS_PROJECT_BUNDLE_ID,
      label: "白板投影",
      tools: [projectCardToBoardTool(options)],
    },
    full: {
      bundleId: BOARDS_FULL_BUNDLE_ID,
      label: "白板完全操作",
      tools: [
        moveBoardItemTool(options),
        connectBoardItemsTool(options),
        disconnectBoardItemsTool(options),
        createBoardGroupTool(options),
        assignBoardItemToGroupTool(options),
        removeBoardGroupTool(options),
        pinBoardItemTool(options),
        removeBoardItemTool(options),
        undoBoardChangeTool(options),
      ],
    },
  };
}

function createCardOnBoardTool(options: BoardsToolsOptions): ToolDefinition {
  return {
    name: "create_card_on_board",
    description:
      "用一段文字建立新卡片並投影到白板收件區。這是受限模式唯一允許改白板的方式；" +
      "投影的卡片一定落在收件區，等使用者決定要不要放上畫布。要整理圈選的卡片時把" +
      "它們的 id 放進 sources。",
    parameters: {
      type: "object",
      properties: {
        boardId: { type: "string", description: "白板 id。" },
        title: { type: "string", description: "新卡標題。" },
        body: { type: "string", description: "新卡內文。" },
        itemId: {
          type: "string",
          description: "投影 id（ULID）；重送同一個值視為同一次操作。省略時由主機產生。",
        },
        x: { type: "integer", description: "收件區的 x 座標，預設 0。" },
        y: { type: "integer", description: "收件區的 y 座標，預設 0。" },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "血緣：這張卡是從哪些卡片整理出來的。",
        },
      },
      required: ["boardId", "title", "body"],
      additionalProperties: false,
    },
    replay: "safe",
    async execute(input, context): Promise<ToolOutcome> {
      return run(async () => {
        if (
          !isAgentBoardOperationAllowed(
            domainMode(options.agentMode()),
            "create_card_from_selection",
            {
              isNewCard: true,
              target: "inbox",
            },
          )
        ) {
          return deny(options, "create_card_on_board", input, context, "respect-user-content");
        }
        const record = objectOf(input);
        const sources = stringsOf(record, "sources");
        const itemId =
          stringOf(record, "itemId") ?? callScopedId(context, options.now(), "board-item");
        const created = await options.service.createCard({
          boardId: requiredStringOf(record, "boardId"),
          itemId,
          title: requiredStringOf(record, "title"),
          body: requiredStringOf(record, "body"),
          position: { x: integerOf(record, "x") ?? 0, y: integerOf(record, "y") ?? 0 },
          origin: "inbox",
          projectedBy: "agent",
          agent: { tool: "create_card_on_board" },
          ...(sources === undefined ? {} : { derivedFrom: sources }),
        });
        return jsonOutcome({
          boardId: created.board.id,
          cardId: created.cardId,
          itemId: created.item.id,
          inboxSize: created.board.inbox.length,
          changeId: changeIdOf(options, created.board, "create_card_on_board"),
        });
      });
    },
  };
}

function projectCardToBoardTool(options: BoardsToolsOptions): ToolDefinition {
  return {
    name: "project_card_to_board",
    description:
      "把已經存在的卡片投影到白板收件區，不改卡片內容。只有代理模式為 full 時才" +
      "可用；受限模式請改用 create_card_on_board 建立新卡。",
    parameters: {
      type: "object",
      properties: {
        boardId: { type: "string", description: "白板 id。" },
        cardId: { type: "string", description: "要投影的卡片 id。" },
        itemId: {
          type: "string",
          description: "投影 id（ULID）；重送同一個值視為同一次操作。省略時由主機產生。",
        },
        x: { type: "integer", description: "收件區的 x 座標，預設 0。" },
        y: { type: "integer", description: "收件區的 y 座標，預設 0。" },
      },
      required: ["boardId", "cardId"],
      additionalProperties: false,
    },
    replay: "safe",
    async execute(input, context): Promise<ToolOutcome> {
      return run(async () => {
        const record = objectOf(input);
        const boardId = requiredStringOf(record, "boardId");
        if (
          !isAgentBoardOperationAllowed(domainMode(options.agentMode()), "project_card", {
            isNewCard: false,
            target: "inbox",
          })
        ) {
          const reason =
            options.service.find(boardId) === undefined
              ? "board-not-found"
              : "respect-user-content";
          return deny(options, "project_card_to_board", input, context, reason);
        }
        const cardId = requiredStringOf(record, "cardId");
        const projected = await options.service.project({
          boardId,
          itemId: stringOf(record, "itemId") ?? callScopedId(context, options.now(), "board-item"),
          cardId,
          position: { x: integerOf(record, "x") ?? 0, y: integerOf(record, "y") ?? 0 },
          origin: "inbox",
          projectedBy: "agent",
          agent: { tool: "project_card_to_board" },
        });
        const item = projected.inbox.find((entry) => entry.cardId === cardId);
        return jsonOutcome({
          boardId: projected.id,
          itemId: item?.id ?? null,
          inboxSize: projected.inbox.length,
          changeId: changeIdOf(options, projected, "project_card_to_board"),
        });
      });
    },
  };
}

function moveBoardItemTool(options: BoardsToolsOptions): ToolDefinition {
  return fullTool(options, {
    name: "move_board_item",
    description:
      "把畫布上的項目移到新座標。只有完全操作模式可用；每次成功的變更會回傳 " +
      "changeId，可用 undo_board_change 復原。",
    parameters: {
      type: "object",
      properties: {
        boardId: { type: "string", description: "白板 id。" },
        itemId: { type: "string", description: "畫布項目的 id（不是卡片 id）。" },
        x: { type: "integer", description: "新的 x 座標（非負整數）。" },
        y: { type: "integer", description: "新的 y 座標（非負整數）。" },
      },
      required: ["boardId", "itemId", "x", "y"],
      additionalProperties: false,
    },
    async apply(record, _context, tool) {
      const itemId = requiredStringOf(record, "itemId");
      const board = await options.service.move({
        boardId: requiredStringOf(record, "boardId"),
        itemId,
        position: {
          x: requiredIntegerOf(record, "x"),
          y: requiredIntegerOf(record, "y"),
        },
        agent: { tool: "move_board_item" },
      });
      return boardOutcome(options, board, { itemId }, tool);
    },
  });
}

function connectBoardItemsTool(options: BoardsToolsOptions): ToolDefinition {
  return fullTool(options, {
    name: "connect_board_items",
    description:
      "在畫布上的兩個項目之間加一條連線。兩端都必須是已放上畫布的項目，收件區的" +
      "投影不能當端點。只有完全操作模式可用。",
    parameters: {
      type: "object",
      properties: {
        boardId: { type: "string", description: "白板 id。" },
        from: { type: "string", description: "起點項目 id。" },
        to: { type: "string", description: "終點項目 id。" },
        edgeId: {
          type: "string",
          description: "連線 id（ULID）；重送同一個值視為同一次操作。省略時由主機產生。",
        },
        label: { type: "string", description: "連線上的標籤，可省略。" },
      },
      required: ["boardId", "from", "to"],
      additionalProperties: false,
    },
    async apply(record, context, tool) {
      const edgeId =
        stringOf(record, "edgeId") ?? callScopedId(context, options.now(), "board-edge");
      const label = stringOf(record, "label");
      const board = await options.service.connect({
        boardId: requiredStringOf(record, "boardId"),
        edgeId,
        from: requiredStringOf(record, "from"),
        to: requiredStringOf(record, "to"),
        ...(label === undefined ? {} : { label }),
        agent: { tool: "connect_board_items" },
      });
      return boardOutcome(options, board, { edgeId }, tool);
    },
  });
}

function disconnectBoardItemsTool(options: BoardsToolsOptions): ToolDefinition {
  return fullTool(options, {
    name: "disconnect_board_items",
    description:
      "移除畫布上的一條連線。連線已經不存在時視為同一次操作已完成。只有完全操作" + "模式可用。",
    parameters: {
      type: "object",
      properties: {
        boardId: { type: "string", description: "白板 id。" },
        edgeId: { type: "string", description: "要移除的連線 id。" },
      },
      required: ["boardId", "edgeId"],
      additionalProperties: false,
    },
    async apply(record, _context, tool) {
      const edgeId = requiredStringOf(record, "edgeId");
      const board = await options.service.disconnect({
        boardId: requiredStringOf(record, "boardId"),
        edgeId,
        agent: { tool: "disconnect_board_items" },
      });
      return boardOutcome(options, board, { edgeId, removed: !hasEdge(board, edgeId) }, tool);
    },
  });
}

function createBoardGroupTool(options: BoardsToolsOptions): ToolDefinition {
  return fullTool(options, {
    name: "create_board_group",
    description:
      "在白板建立一個分組，可指定上層分組。只有完全操作模式可用；分組是畫布上的" +
      "整理方式，不會改變卡片內容。",
    parameters: {
      type: "object",
      properties: {
        boardId: { type: "string", description: "白板 id。" },
        label: { type: "string", description: "分組名稱。" },
        groupId: {
          type: "string",
          description: "分組 id（ULID）；重送同一個值視為同一次操作。省略時由主機產生。",
        },
        parentId: { type: "string", description: "上層分組 id，可省略。" },
      },
      required: ["boardId", "label"],
      additionalProperties: false,
    },
    async apply(record, context, tool) {
      const groupId =
        stringOf(record, "groupId") ?? callScopedId(context, options.now(), "board-group");
      const parentId = stringOf(record, "parentId");
      const board = await options.service.createGroup({
        boardId: requiredStringOf(record, "boardId"),
        groupId,
        label: requiredStringOf(record, "label"),
        ...(parentId === undefined ? {} : { parentId }),
        agent: { tool: "create_board_group" },
      });
      return boardOutcome(options, board, { groupId }, tool);
    },
  });
}

function assignBoardItemToGroupTool(options: BoardsToolsOptions): ToolDefinition {
  return fullTool(options, {
    name: "assign_board_item_to_group",
    description: "把畫布上的項目放進分組。省略 groupId 表示移回畫布。只有完全操作模式可用。",
    parameters: {
      type: "object",
      properties: {
        boardId: { type: "string", description: "白板 id。" },
        itemId: { type: "string", description: "畫布項目的 id。" },
        groupId: { type: "string", description: "目標分組 id；省略表示移回畫布。" },
      },
      required: ["boardId", "itemId"],
      additionalProperties: false,
    },
    async apply(record, _context, tool) {
      const itemId = requiredStringOf(record, "itemId");
      const groupId = stringOf(record, "groupId");
      const board = await options.service.assignToGroup({
        boardId: requiredStringOf(record, "boardId"),
        itemId,
        ...(groupId === undefined ? {} : { groupId }),
        agent: { tool: "assign_board_item_to_group" },
      });
      return boardOutcome(options, board, { itemId, groupId: groupId ?? null }, tool);
    },
  });
}

function removeBoardGroupTool(options: BoardsToolsOptions): ToolDefinition {
  return fullTool(options, {
    name: "remove_board_group",
    description: "移除一個分組；分組內的項目回到畫布，子分組往上接。只有完全操作模式可用。",
    parameters: {
      type: "object",
      properties: {
        boardId: { type: "string", description: "白板 id。" },
        groupId: { type: "string", description: "要移除的分組 id。" },
      },
      required: ["boardId", "groupId"],
      additionalProperties: false,
    },
    async apply(record, _context, tool) {
      const groupId = requiredStringOf(record, "groupId");
      const board = await options.service.deleteGroup({
        boardId: requiredStringOf(record, "boardId"),
        groupId,
        agent: { tool: "remove_board_group" },
      });
      return boardOutcome(options, board, { groupId }, tool);
    },
  });
}

function pinBoardItemTool(options: BoardsToolsOptions): ToolDefinition {
  return fullTool(options, {
    name: "pin_board_item",
    description:
      "設定畫布項目的釘選狀態。釘選會把卡片的新鮮度固定在 100，白板仍是唯一正本。" +
      "只有完全操作模式可用。",
    parameters: {
      type: "object",
      properties: {
        boardId: { type: "string", description: "白板 id。" },
        itemId: { type: "string", description: "畫布項目的 id。" },
        pinned: { type: "boolean", description: "true 釘選，false 取消釘選。" },
      },
      required: ["boardId", "itemId", "pinned"],
      additionalProperties: false,
    },
    async apply(record, _context, tool) {
      const itemId = requiredStringOf(record, "itemId");
      const pinned = requiredBooleanOf(record, "pinned");
      const board = await options.service.setPinned({
        boardId: requiredStringOf(record, "boardId"),
        itemId,
        pinned,
        agent: { tool: "pin_board_item" },
      });
      return boardOutcome(options, board, { itemId, pinned }, tool);
    },
  });
}

function removeBoardItemTool(options: BoardsToolsOptions): ToolDefinition {
  return fullTool(options, {
    name: "remove_board_item",
    description:
      "把項目從白板移除（畫布或收件區都可以）。只移除投影，不會刪掉卡片本體。" +
      "只有完全操作模式可用。",
    parameters: {
      type: "object",
      properties: {
        boardId: { type: "string", description: "白板 id。" },
        itemId: { type: "string", description: "要移除的項目 id。" },
      },
      required: ["boardId", "itemId"],
      additionalProperties: false,
    },
    async apply(record, _context, tool) {
      const itemId = requiredStringOf(record, "itemId");
      const board = await options.service.removeItem({
        boardId: requiredStringOf(record, "boardId"),
        itemId,
        agent: { tool: "remove_board_item" },
      });
      return boardOutcome(options, board, { itemId }, tool);
    },
  });
}

function undoBoardChangeTool(options: BoardsToolsOptions): ToolDefinition {
  return fullTool(options, {
    name: "undo_board_change",
    description:
      "復原一筆代理自己造成的白板變更。要提供該變更回傳的 changeId；使用者改過" +
      "白板或後面還有更新的代理變更時會拒絕。只有完全操作模式可用。重送同一個 " +
      "changeId 不會再復原一次。",
    parameters: {
      type: "object",
      properties: {
        boardId: { type: "string", description: "白板 id。" },
        changeId: {
          type: "string",
          description: "要復原的代理變更 id；由先前的變更工具回傳。",
        },
      },
      required: ["boardId", "changeId"],
      additionalProperties: false,
    },
    async apply(record) {
      const changeId = requiredStringOf(record, "changeId");
      const result = await options.service.undo({
        boardId: requiredStringOf(record, "boardId"),
        changeId,
      });
      return jsonOutcome({
        boardId: result.board.id,
        changeId,
        undone: result.undone,
        remaining: result.remaining,
        boardUpdatedAt: result.board.updatedAt,
      });
    },
  });
}

/** 完全操作模式的工具；執行期一律重新檢查目前模式，不依賴工具清單。 */
function fullTool(
  options: BoardsToolsOptions,
  spec: {
    readonly name: string;
    readonly description: string;
    readonly parameters: ToolDefinition["parameters"];
    readonly apply: (
      input: { readonly [key: string]: JsonValue },
      context: ToolExecutionContext,
      tool: string,
    ) => Promise<ToolOutcome>;
  },
): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    replay: "safe",
    async execute(input, context): Promise<ToolOutcome> {
      return run(async () => {
        if (options.agentMode() !== "full") {
          return deny(options, spec.name, input, context, "full-mode-required");
        }
        return spec.apply(objectOf(input), context, spec.name);
      });
    },
  };
}

function boardOutcome(
  options: BoardsToolsOptions,
  board: BoardDocument,
  fields: { readonly [key: string]: JsonValue },
  tool: string,
): ToolOutcome {
  return jsonOutcome({
    boardId: board.id,
    ...fields,
    changeId: changeIdOf(options, board, tool),
  });
}

function changeIdOf(
  options: BoardsToolsOptions,
  board: BoardDocument,
  tool: string,
): string | null {
  return options.service.agentChangeId(board.id, board.updatedAt, tool) ?? null;
}

function jsonOutcome(value: JsonValue): ToolOutcome {
  return { ok: true, content: [{ type: "json", value }] };
}

function hasEdge(board: BoardDocument, edgeId: string): boolean {
  return board.edges.some((edge) => edge.id === edgeId);
}

/** 受限模式下的拒絕：先寫稽核，再回錯誤；稽核寫不進去就不假裝已記錄。 */
function deny(
  options: BoardsToolsOptions,
  tool: string,
  input: JsonValue,
  context: { readonly conversationId?: string } | undefined,
  reason: "respect-user-content" | "board-not-found" | "full-mode-required",
): ToolOutcome {
  options.audit.appendAudit({
    at: options.now().toISOString(),
    kind: "policy-denied",
    tool,
    argsHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    reason,
    ...(context?.conversationId === undefined ? {} : { conversationId: context.conversationId }),
  });
  return {
    ok: false,
    message:
      reason === "board-not-found"
        ? "policy-denied: 找不到白板，代理也不能在受限模式投影既有卡片。"
        : reason === "full-mode-required"
          ? "policy-denied: 代理模式 respect-user-content 不允許移動、連線、分組、釘選、移除或復原白板變更。"
          : "policy-denied: 代理模式 respect-user-content 只允許建立新卡到收件區。",
  };
}

function domainMode(mode: BoardsAgentMode): DomainBoardMode {
  return mode === "full" ? "full" : "read_only";
}

/**
 * 由這次工具呼叫產生穩定的 ULID。
 *
 * 重送同一個呼叫（同一個 conversationId 與 callId）會得到同一個 id，服務
 * 就把它當成同一次操作，不會重複建項目、連線或分組。
 */
function callScopedId(
  context: ToolExecutionContext | undefined,
  now: Date,
  namespace: string,
): string {
  const time = BigInt(now.getTime());
  let timePart = "";
  for (let index = 9; index >= 0; index -= 1) {
    timePart = `${CROCKFORD[Number((time >> BigInt(index * 5)) & 31n)]}${timePart}`;
  }
  const digest = createHash("sha256")
    .update(`${namespace}:${context?.conversationId ?? ""}:${context?.callId ?? ""}`)
    .digest();
  let randomPart = "";
  for (let index = 0; index < 16; index += 1) {
    randomPart = `${randomPart}${CROCKFORD[digest[index]! & 31]}`;
  }
  return `${timePart}${randomPart}`;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

async function run(work: () => Promise<ToolOutcome>): Promise<ToolOutcome> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ProtocolHandlerError) {
      return { ok: false, message: error.message, metadata: error.details ?? null };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function objectOf(input: JsonValue): { readonly [key: string]: JsonValue } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ProtocolHandlerError("invalid_message", "工具輸入必須是物件。");
  }
  return input as { readonly [key: string]: JsonValue };
}

function requiredStringOf(input: { readonly [key: string]: JsonValue }, key: string): string {
  const value = stringOf(input, key);
  if (value === undefined) {
    throw new ProtocolHandlerError("invalid_message", `缺少欄位：${key}`, { field: key });
  }
  return value;
}

function stringOf(input: { readonly [key: string]: JsonValue }, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ProtocolHandlerError("invalid_message", `欄位 ${key} 必須是字串。`, { field: key });
  }
  return value;
}

function integerOf(input: { readonly [key: string]: JsonValue }, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ProtocolHandlerError("invalid_message", `欄位 ${key} 必須是非負整數。`, {
      field: key,
    });
  }
  return value;
}

function requiredIntegerOf(input: { readonly [key: string]: JsonValue }, key: string): number {
  const value = integerOf(input, key);
  if (value === undefined) {
    throw new ProtocolHandlerError("invalid_message", `缺少欄位：${key}`, { field: key });
  }
  return value;
}

function requiredBooleanOf(input: { readonly [key: string]: JsonValue }, key: string): boolean {
  const value = input[key];
  if (value === undefined) {
    throw new ProtocolHandlerError("invalid_message", `缺少欄位：${key}`, { field: key });
  }
  if (typeof value !== "boolean") {
    throw new ProtocolHandlerError("invalid_message", `欄位 ${key} 必須是布林值。`, {
      field: key,
    });
  }
  return value;
}

function stringsOf(
  input: { readonly [key: string]: JsonValue },
  key: string,
): string[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ProtocolHandlerError("invalid_message", `欄位 ${key} 必須是字串陣列。`, {
      field: key,
    });
  }
  return value as string[];
}
