import { createHash } from "node:crypto";

import {
  isAgentBoardOperationAllowed,
  type BoardAgentMode as DomainBoardMode,
} from "@cardiary/domain";
import type {
  JsonValue,
  ToolBundleDraft,
  ToolDefinition,
  ToolOutcome,
} from "@cardiary/engine-adapter";

import type { AuditEntry } from "../../permissions/audit.js";
import { ProtocolHandlerError } from "../contract.js";
import { BOARDS_BUNDLE_ID, BOARDS_PROJECT_BUNDLE_ID, type BoardsAgentMode } from "./policy.js";
import { newItemId, type BoardService } from "./service.js";

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
 * 工具，所以每次呼叫都重新讀目前模式，受限時回 `policy-denied` 並寫稽核。
 * 曝光控制與執行期防禦是兩層；少了任何一層都可能讓代理改到使用者內容。
 */
export function createBoardsToolBundles(options: BoardsToolsOptions): {
  readonly create: ToolBundleDraft;
  readonly project: ToolBundleDraft;
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
        const created = await options.service.createCard({
          boardId: requiredStringOf(record, "boardId"),
          itemId: stringOf(record, "itemId") ?? newItemId(options.now()),
          title: requiredStringOf(record, "title"),
          body: requiredStringOf(record, "body"),
          position: { x: integerOf(record, "x") ?? 0, y: integerOf(record, "y") ?? 0 },
          origin: "inbox",
          projectedBy: "agent",
          ...(sources === undefined ? {} : { derivedFrom: sources }),
        });
        return {
          ok: true,
          content: [
            {
              type: "json",
              value: {
                boardId: created.board.id,
                cardId: created.cardId,
                itemId: created.item.id,
                inboxSize: created.board.inbox.length,
              },
            },
          ],
        };
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
        const projected = await options.service.project({
          boardId,
          itemId: stringOf(record, "itemId") ?? newItemId(options.now()),
          cardId: requiredStringOf(record, "cardId"),
          position: { x: integerOf(record, "x") ?? 0, y: integerOf(record, "y") ?? 0 },
          origin: "inbox",
          projectedBy: "agent",
        });
        const item = projected.inbox.find(
          (entry) => entry.cardId === requiredStringOf(record, "cardId"),
        );
        return {
          ok: true,
          content: [
            {
              type: "json",
              value: {
                boardId: projected.id,
                itemId: item?.id ?? null,
                inboxSize: projected.inbox.length,
              },
            },
          ],
        };
      });
    },
  };
}

/** 受限模式下的拒絕：先寫稽核，再回錯誤；稽核寫不進去就不假裝已記錄。 */
function deny(
  options: BoardsToolsOptions,
  tool: string,
  input: JsonValue,
  context: { readonly conversationId?: string } | undefined,
  reason: "respect-user-content" | "board-not-found",
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
        : "policy-denied: 代理模式 respect-user-content 只允許建立新卡到收件區。",
  };
}

function domainMode(mode: BoardsAgentMode): DomainBoardMode {
  return mode === "full" ? "full" : "read_only";
}

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
