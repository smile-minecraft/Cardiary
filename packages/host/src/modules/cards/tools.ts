import type {
  JsonValue,
  ToolBundleDraft,
  ToolDefinition,
  ToolOutcome,
} from "@cardiary/engine-adapter";
import { AGENT_CREATABLE_KINDS, type CardKind } from "@cardiary/domain";

import { ProtocolHandlerError } from "../contract.js";
import type { CardLibrary } from "./library.js";

/**
 * 卡片代理工具。
 *
 * 工具名稱就是權限規則的鍵：`card_patch` 與 `card_delete` 一律詢問，
 * 其餘自動放行（規格書第 18 章）。權限閘道（本機工具工作）用
 * `CARD_TOOL_POLICY` 決定，工具本身不重複判斷；它只限制「補丁只能是
 * unified」，因為補丁文字直接來自模型。
 */

export const CARDS_TOOL_BUNDLE_ID = "module.cards";

export type CardToolApproval = "auto" | "ask";

/** 工具名稱 → 審批分類與審批主體；權限閘道用這張表，不解析工具輸入。 */
export const CARD_TOOL_POLICY = {
  card_search: { approval: "auto" },
  card_read: { approval: "auto", subjectField: "cardId" },
  card_create: { approval: "auto", subjectField: "title" },
  card_patch: { approval: "ask", subjectField: "cardId" },
  card_delete: { approval: "ask", subjectField: "cardId" },
  card_refresh: { approval: "auto", subjectField: "cardId" },
} as const satisfies Record<string, { approval: CardToolApproval; subjectField?: string }>;

export type CardToolName = keyof typeof CARD_TOOL_POLICY;

export interface CardToolsOptions {
  readonly library: CardLibrary;
  readonly search?: CardLibrary["search"];
}

export function createCardToolBundle(options: CardToolsOptions): ToolBundleDraft {
  const { library } = options;
  const tools: ToolDefinition[] = [
    {
      name: "card_search",
      description:
        "搜尋卡片庫的標題、內文與標籤。只回摘要與片段，不回整份內文；要讀全文用 card_read。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "查詢字串；中文用子字串比對。" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "同時包含這些標籤。",
          },
          kinds: {
            type: "array",
            items: {
              type: "string",
              enum: ["note", "image", "audio", "memory", "summary", "persona", "bedrock"],
            },
            description: "只搜這幾種。",
          },
          limit: { type: "integer", description: "最多幾筆，預設 20。", default: 20 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      replay: "safe",
      async execute(input): Promise<ToolOutcome> {
        return run(async () => {
          const record = objectOf(input);
          const query = stringOf(record, "query");
          const tags = stringsOf(record, "tags");
          const kinds = stringsOf(record, "kinds");
          const search = options.search ?? library.search.bind(library);
          const page = await search({
            query,
            ...(tags === undefined ? {} : { tags }),
            ...(kinds === undefined ? {} : { kinds: kinds as CardKind[] }),
            limit: integerOf(record, "limit") ?? 20,
          });
          return {
            ok: true,
            content: [
              {
                type: "json",
                value: {
                  hits: page.items.map((hit) => ({
                    cardId: hit.card.cardId,
                    kind: hit.card.kind,
                    title: hit.card.title,
                    tags: [...hit.card.tags],
                    snippet: hit.snippet,
                    score: hit.score,
                  })),
                },
              },
            ],
          };
        });
      },
    },
    {
      name: "card_read",
      description: "讀一張卡片的 frontmatter、內文、連結與目前 revision。",
      parameters: {
        type: "object",
        properties: {
          cardId: { type: "string", description: "卡片識別碼（ULID）。" },
        },
        required: ["cardId"],
        additionalProperties: false,
      },
      replay: "safe",
      async execute(input): Promise<ToolOutcome> {
        return run(async () => {
          const record = objectOf(input);
          const cardId = stringOf(record, "cardId");
          const card = await library.get(cardId);
          if (card === null) {
            throw new ProtocolHandlerError("not_found", `找不到卡片 ${cardId}。`, { cardId });
          }
          return {
            ok: true,
            content: [
              {
                type: "json",
                value: {
                  cardId: card.cardId,
                  kind: card.frontmatter.kind,
                  title: card.frontmatter.title,
                  summary: card.frontmatter.summary ?? null,
                  tags: [...card.frontmatter.tags],
                  persona: card.frontmatter.persona,
                  createdAt: card.frontmatter.created,
                  updatedAt: card.frontmatter.updated ?? null,
                  sources: [...card.frontmatter.sources],
                  supersedes: card.frontmatter.supersedes ?? null,
                  asset: card.frontmatter.asset ?? null,
                  body: card.body,
                  revision: card.revision,
                  links: {
                    outgoing: library.outgoingTargets(card.cardId),
                    backlinks: library.backlinks(card.cardId),
                  },
                  freshness: library.freshnessOf(card.cardId),
                },
              },
            ],
          };
        });
      },
    },
    {
      name: "card_create",
      description:
        "建立一張 note、image 或 audio 卡片；其他種類由系統或匯入建立。內文是 Markdown，原樣保存。",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...AGENT_CREATABLE_KINDS] },
          title: { type: "string" },
          body: { type: "string", description: "Markdown 內文。" },
          summary: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          sources: {
            type: "array",
            items: { type: "string" },
            description: "血緣：由哪些卡片生成。",
          },
          supersedes: { type: "string", description: "被這張卡取代的舊卡。" },
          assetBlobId: {
            type: "string",
            description: "image／audio 必填：已上傳原檔的內容雜湊（S3 的 blobId）。",
          },
        },
        required: ["kind", "title", "body"],
        additionalProperties: false,
      },
      replay: "unsafe",
      async execute(input): Promise<ToolOutcome> {
        return run(async () => {
          const record = objectOf(input);
          const summary = optionalString(record, "summary");
          const tags = stringsOf(record, "tags");
          const sources = stringsOf(record, "sources");
          const supersedes = optionalString(record, "supersedes");
          const assetBlobId = optionalString(record, "assetBlobId");
          const card = await library.create({
            kind: stringOf(record, "kind") as CardKind,
            title: stringOf(record, "title"),
            body: stringOf(record, "body"),
            ...(summary === undefined ? {} : { summary }),
            ...(tags === undefined ? {} : { tags }),
            ...(sources === undefined ? {} : { sources }),
            ...(supersedes === undefined ? {} : { supersedes }),
            ...(assetBlobId === undefined ? {} : { assetBlobId }),
          });
          return {
            ok: true,
            content: [
              {
                type: "json",
                value: {
                  cardId: card.cardId,
                  title: card.frontmatter.title,
                  kind: card.frontmatter.kind,
                  revision: card.revision,
                },
              },
            ],
          };
        });
      },
    },
    {
      name: "card_patch",
      description:
        "用統一 diff（unified）編修卡片內文。送出前要帶讀到的 revision；不符會回衝突，不會覆寫。",
      parameters: {
        type: "object",
        properties: {
          cardId: { type: "string" },
          baseRevision: { type: "string", description: "card_read 回傳的 revision。" },
          patch: { type: "string", description: "統一 diff 文字（---/+++ 與 @@ 區塊）。" },
        },
        required: ["cardId", "baseRevision", "patch"],
        additionalProperties: false,
      },
      replay: "unsafe",
      async execute(input): Promise<ToolOutcome> {
        return run(async () => {
          const record = objectOf(input);
          const card = await library.patch({
            cardId: stringOf(record, "cardId"),
            baseRevision: stringOf(record, "baseRevision"),
            patch: { format: "unified", text: stringOf(record, "patch") },
          });
          return {
            ok: true,
            content: [
              {
                type: "json",
                value: {
                  cardId: card.cardId,
                  revision: card.revision,
                  updatedAt: card.frontmatter.updated ?? null,
                  title: card.frontmatter.title,
                },
              },
            ],
          };
        });
      },
    },
    {
      name: "card_delete",
      description: "刪除一張卡片；回報連帶刪除的原檔數。這個動作會先詢問使用者。",
      parameters: {
        type: "object",
        properties: { cardId: { type: "string" } },
        required: ["cardId"],
        additionalProperties: false,
      },
      replay: "unsafe",
      async execute(input): Promise<ToolOutcome> {
        return run(async () => {
          const record = objectOf(input);
          const cardId = stringOf(record, "cardId");
          const result = await library.delete(cardId);
          return {
            ok: true,
            content: [
              {
                type: "json",
                value: { cardId, deletedAssets: result.deletedAssets },
              },
            ],
          };
        });
      },
    },
    {
      name: "card_refresh",
      description: "保鮮：把卡片的新鮮度回滿 100。",
      parameters: {
        type: "object",
        properties: { cardId: { type: "string" } },
        required: ["cardId"],
        additionalProperties: false,
      },
      replay: "safe",
      async execute(input): Promise<ToolOutcome> {
        return run(async () => {
          const record = objectOf(input);
          const cardId = stringOf(record, "cardId");
          const freshness = await library.refresh(cardId);
          return {
            ok: true,
            content: [{ type: "json", value: { cardId, freshness } }],
          };
        });
      },
    },
  ];

  return {
    bundleId: CARDS_TOOL_BUNDLE_ID,
    label: "卡片",
    tools,
  };
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

function stringOf(input: { readonly [key: string]: JsonValue }, key: string): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new ProtocolHandlerError("invalid_message", `缺少或型別不符的欄位：${key}`, {
      field: key,
    });
  }
  return value;
}

function optionalString(
  input: { readonly [key: string]: JsonValue },
  key: string,
): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ProtocolHandlerError("invalid_message", `欄位 ${key} 必須是字串。`, { field: key });
  }
  return value;
}

function stringsOf(
  input: { readonly [key: string]: JsonValue },
  key: string,
): string[] | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ProtocolHandlerError("invalid_message", `欄位 ${key} 必須是字串陣列。`, {
      field: key,
    });
  }
  return value as string[];
}

function integerOf(input: { readonly [key: string]: JsonValue }, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ProtocolHandlerError("invalid_message", `欄位 ${key} 必須是整數。`, { field: key });
  }
  return value;
}
