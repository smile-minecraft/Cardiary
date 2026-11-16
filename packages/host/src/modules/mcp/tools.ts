/**
 * MCP 工具對模型的介面。
 *
 * 對話開場只會看到每個伺服器兩個小工具：`list_tools` 與 `call`，不含
 * 伺服器回報的任何 schema。模型第一次呼叫 `list_tools` 之後，才把實際
 * 工具註冊進同一個工具組版本；下一個回合起，模型就能直接呼叫
 * `mcp.<server>.<tool>`。這讓「工具延遲載入」在引擎的靜態工具定義下
 * 仍然成立，也讓同名檢查發生在真正註冊之前。
 */
import type { JsonSchema, JsonValue, ToolBundleDraft, ToolDefinition, ToolOutcome } from "@cardiary/engine-adapter";
import type { McpServerRecord } from "@cardiary/domain";
import {
  assertRegisterableToolName,
  BUILTIN_TOOL_NAMES,
  evaluateMcpToolPolicy,
  exposedToolName,
  McpNameError,
} from "@cardiary/domain";
import type { McpServerState } from "@cardiary/protocol";

import type { McpCallResult, McpClient, McpToolDescriptor } from "./client.js";

/** 一個已核准伺服器的執行狀態。 */
export interface McpServerRuntime {
  readonly record: McpServerRecord;
  readonly client: McpClient;
  /** 重新註冊這個伺服器的工具組；首次載入工具後由模組換上完整定義。 */
  readonly refresh: () => void;
  state: McpServerState;
  failure?: string;
  tools: McpToolDescriptor[] | null;
}

/** 工具組的識別碼；一個伺服器一組，版本由模組主機配發。 */
export function bundleIdFor(serverId: string): string {
  return `mcp:${serverId}`;
}

const LIST_TOOL_NAME = "list_tools";
const CALL_TOOL_NAME = "call";

/** 建立包含兩個入口工具的工具組；伺服器工具之後才加入。 */
export function buildBundleDraft(runtime: McpServerRuntime): ToolBundleDraft {
  const { serverId, name } = runtime.record;
  const tools: ToolDefinition[] = [
    {
      name: exposedToolName(serverId, LIST_TOOL_NAME),
      description: `列出 MCP 伺服器「${name}」提供的工具。第一次呼叫會載入這個伺服器的工具定義。`,
      parameters: emptyObjectSchema(),
      replay: "safe",
      execute: async () => {
        const loaded = await loadTools(runtime);
        // 同版本重新註冊：引擎會換掉這組 extension，下個回合起模型才看得到
        // 真正的工具定義。此呼叫的回傳仍只列名稱，這些工具不是這次才呼叫。
        runtime.refresh();
        const visible = loaded.filter((tool) => !isReserved(tool.name));
        return {
          ok: true,
          content: [
            {
              type: "text",
              text:
                visible.length === 0
                  ? `伺服器「${name}」沒有可用的工具。`
                  : visible
                      .map((tool) => `- ${tool.name}${tool.description ? `：${tool.description}` : ""}`)
                      .join("\n"),
            },
          ],
        };
      },
    },
    {
      name: exposedToolName(serverId, CALL_TOOL_NAME),
      description: `呼叫 MCP 伺服器「${name}」的工具。輸入要帶工具名稱與參數物件；每次呼叫都需要人工審批。`,
      parameters: {
        type: "object",
        properties: {
          tool: { type: "string", description: "伺服器回報的工具名稱" },
          arguments: { type: "object", description: "工具參數", additionalProperties: true },
        },
        required: ["tool"],
        additionalProperties: false,
      },
      replay: "unsafe",
      execute: async (input) => {
        const parsed = parseCallInput(input);
        if (parsed === null) {
          return failure("call 需要 { tool: string, arguments?: object }");
        }
        return runTool(runtime, parsed.tool, parsed.arguments);
      },
    },
  ];

  // 已載入的工具換成各自的定義；版本相同，重註冊會換掉引擎裡的 extension。
  if (runtime.tools !== null) {
    for (const tool of runtime.tools) {
      const definition = perToolDefinition(runtime, tool);
      if (definition !== null) {
        tools.push(definition);
      }
    }
  }

  const draft: ToolBundleDraft = {
    bundleId: bundleIdFor(serverId),
    label: `MCP：${name}`,
    tools,
  };
  return draft;
}

function perToolDefinition(
  runtime: McpServerRuntime,
  tool: McpToolDescriptor,
): ToolDefinition | null {
  if (isReserved(tool.name)) {
    return null;
  }
  let name: string;
  try {
    name = assertRegisterableToolName(exposedToolName(runtime.record.serverId, tool.name));
  } catch (error) {
    if (error instanceof McpNameError) {
      return null;
    }
    throw error;
  }
  return {
    name,
    description:
      tool.description === undefined || tool.description.length === 0
        ? `MCP 伺服器「${runtime.record.name}」的工具 ${tool.name}`
        : tool.description,
    parameters:
      tool.inputSchema === undefined ? emptyObjectSchema() : withObjectType(tool.inputSchema),
    replay: "unsafe",
    execute: async (input) => {
      const args = isPlainObject(input) ? (input as Readonly<Record<string, unknown>>) : {};
      return runTool(runtime, tool.name, args);
    },
  };
}

async function runTool(
  runtime: McpServerRuntime,
  toolName: string,
  args: Readonly<Record<string, unknown>>,
): Promise<ToolOutcome> {
  if (isReserved(toolName)) {
    return failure(
      `工具名稱 ${toolName} 與 Cardiary 內建工具相同，MCP 伺服器不能冒用；請改用其他名稱。`,
    );
  }
  const policy = evaluateMcpToolPolicy(toolName);
  if (policy.outcome === "deny") {
    return {
      ok: false,
      message: policy.reason,
      diagnostics: [{ code: "permission-denied", message: policy.reason }],
    };
  }
  try {
    const result = await runtime.client.callTool(toolName, args);
    return toOutcome(result);
  } catch (error) {
    return failure(`MCP 工具 ${toolName} 執行失敗：${errorMessage(error)}`);
  }
}

async function loadTools(runtime: McpServerRuntime): Promise<McpToolDescriptor[]> {
  if (runtime.tools !== null) {
    return runtime.tools;
  }
  const tools = await runtime.client.listTools();
  runtime.tools = tools;
  return tools;
}

function toOutcome(result: McpCallResult): ToolOutcome {
  if (result.isError) {
    return { ok: false, message: result.text.length > 0 ? result.text : "MCP 工具回報失敗" };
  }
  return { ok: true, content: [{ type: "text", text: result.text }] };
}

function parseCallInput(
  input: JsonValue,
): { readonly tool: string; readonly arguments: Readonly<Record<string, unknown>> } | null {
  if (!isPlainObject(input)) {
    return null;
  }
  const tool = input.tool;
  if (typeof tool !== "string" || tool.length === 0) {
    return null;
  }
  const args = input.arguments;
  if (args === undefined) {
    return { tool, arguments: {} };
  }
  if (!isPlainObject(args)) {
    return null;
  }
  return { tool, arguments: args };
}

function isReserved(toolName: string): boolean {
  return BUILTIN_TOOL_NAMES.includes(toolName);
}

function emptyObjectSchema(): JsonSchema {
  return { type: "object", properties: {}, additionalProperties: false };
}

function withObjectType(schema: Readonly<Record<string, unknown>>): JsonSchema {
  // 伺服器回報的 schema 是任意 JSON;MCP 只要求是物件 schema,其餘關鍵字
  // 由引擎當成未知欄位忽略,所以只保證 type 存在就好。
  if (schema.type === "object") {
    return schema as unknown as JsonSchema;
  }
  return { ...schema, type: "object" } as unknown as JsonSchema;
}

function failure(message: string): ToolOutcome {
  return { ok: false, message };
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 給測試用的工具清單快照。 */
export function toolNamesOf(draft: ToolBundleDraft): string[] {
  return draft.tools.map((tool) => tool.name);
}
