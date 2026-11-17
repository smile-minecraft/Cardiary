/**
 * MCP 工具對模型的介面。
 *
 * 對話開場只會看到每個伺服器兩個小工具：`list_tools` 與 `call`，不含
 * 伺服器回報的任何 schema。模型第一次呼叫 `list_tools` 之後，才把實際
 * 工具註冊進同一個工具組版本；下一個回合起，模型就能直接呼叫
 * `mcp.<server>.<tool>`。這讓「工具延遲載入」在引擎的靜態工具定義下
 * 仍然成立，也讓同名檢查發生在真正註冊之前。
 */
import type {
  JsonSchema,
  JsonValue,
  ToolBundleDraft,
  ToolContent,
  ToolDefinition,
  ToolDiagnostic,
  ToolOutcome,
} from "@cardiary/engine-adapter";
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
import type { McpToolCachePort } from "./tool-cache.js";

/** 一個已核准伺服器的執行狀態。 */
export interface McpServerRuntime {
  readonly record: McpServerRecord;
  readonly client: McpClient;
  /** 重新註冊這個伺服器的工具組；首次載入工具後由模組換上完整定義。 */
  readonly refresh: () => void;
  /** 工具清單的快取；沒有檔案登記簿時為 null，照樣直接向伺服器要。 */
  readonly cache: McpToolCachePort | null;
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

/** MCP App 介面資源的 MIME；uri 必須是 ui://，HTML 最大 1 MiB。 */
const MCP_APP_MIME = "text/html;profile=mcp-app";
const UI_URI_PREFIX = "ui://";
const MAX_HTML_BYTES = 1024 * 1024;
const CSP_KEYS = ["connectDomains", "resourceDomains", "frameDomains", "baseUriDomains"] as const;

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
                      .map(
                        (tool) =>
                          `- ${tool.name}${tool.description ? `：${tool.description}` : ""}`,
                      )
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
    const descriptor = runtime.tools?.find((tool) => tool.name === toolName);
    return await toOutcome(runtime, descriptor, result);
  } catch (error) {
    return failure(`MCP 工具 ${toolName} 執行失敗：${errorMessage(error)}`);
  }
}

async function loadTools(runtime: McpServerRuntime): Promise<McpToolDescriptor[]> {
  if (runtime.tools !== null) {
    return runtime.tools;
  }
  // 重啟後先看快取：伺服器開機時已經驗證過連線，工具清單不必再問一次。
  const cached = runtime.cache?.load() ?? null;
  if (cached !== null) {
    runtime.tools = cached;
    return cached;
  }
  const tools = await runtime.client.listTools();
  runtime.tools = tools;
  runtime.cache?.save(tools);
  return tools;
}

async function toOutcome(
  runtime: McpServerRuntime,
  descriptor: McpToolDescriptor | undefined,
  result: McpCallResult,
): Promise<ToolOutcome> {
  if (result.isError) {
    return { ok: false, message: result.text.length > 0 ? result.text : "MCP 工具回報失敗" };
  }
  const content: ToolContent[] = [{ type: "text", text: result.text }];

  // 工具結果自帶的 resource 優先；沒有才看工具描述的 _meta 要不要讀 ui:// 資源。
  let resource = inlineUiResource(result.content);
  let fallbackUri: string | undefined;
  if (resource === null) {
    const uri = resourceUriFromMeta(descriptor?.meta);
    if (uri !== undefined) {
      fallbackUri = uri;
      try {
        resource = firstResourceContent(await runtime.client.readResource(uri));
      } catch {
        return withDiagnostic(content, unavailable("讀取失敗"));
      }
    }
  }

  // 完全沒有 UI 意圖：照原樣回文字，不加診斷。
  if (resource === null) {
    // 描述指向 UI 但讀回來沒有內容，也算資源無法讀取。
    if (fallbackUri !== undefined) {
      return withDiagnostic(content, unavailable("沒有 resource 內容"));
    }
    return { ok: true, content };
  }

  const uri = typeof resource.uri === "string" ? resource.uri : fallbackUri;
  if (uri === undefined || !uri.startsWith(UI_URI_PREFIX)) {
    return withDiagnostic(content, unavailable("uri 不是 ui://"));
  }
  const mimeType = resource.mimeType;
  if (typeof mimeType !== "string" || !mimeType.includes(MCP_APP_MIME)) {
    return withDiagnostic(content, unavailable("MIME 不符"));
  }
  const html = decodeResourceHtml(resource);
  if (html === null) {
    return withDiagnostic(content, unavailable("沒有 HTML 內容"));
  }
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return withDiagnostic(content, {
      code: "output-truncated",
      message: "MCP App HTML 超過大小上限",
    });
  }
  return {
    ok: true,
    content,
    metadata: {
      renderer: "mcp.app",
      data: { html, allowedHosts: allowedHostsFrom(resource._meta) },
    },
  };
}

/** 工具結果 content 裡第一個 MIME 符合的 resource。 */
function inlineUiResource(content: readonly unknown[]): Record<string, unknown> | null {
  for (const entry of content) {
    if (!isPlainObject(entry) || entry.type !== "resource") continue;
    const resource = entry.resource;
    if (!isPlainObject(resource)) continue;
    const mime = resource.mimeType;
    if (typeof mime === "string" && mime.includes(MCP_APP_MIME)) {
      return resource;
    }
  }
  return null;
}

/** 從工具描述的原始 _meta 找出綁定的 ui:// 資源 uri。 */
function resourceUriFromMeta(
  meta: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  if (meta === undefined) return undefined;
  const ui = meta.ui;
  if (isPlainObject(ui)) {
    const current = ui.resourceUri;
    if (typeof current === "string" && current.startsWith(UI_URI_PREFIX)) return current;
  }
  // 舊的扁平寫法 _meta["ui/resourceUri"]。
  const legacy = meta["ui/resourceUri"];
  if (typeof legacy === "string" && legacy.startsWith(UI_URI_PREFIX)) return legacy;
  return undefined;
}

/** 從 resources/read 回應取出第一個內容項目。 */
function firstResourceContent(result: unknown): Record<string, unknown> | null {
  if (!isPlainObject(result) || !Array.isArray(result.contents)) return null;
  for (const entry of result.contents) {
    if (isPlainObject(entry)) return entry;
  }
  return null;
}

/** resource 的 text 或 base64 blob 轉成 UTF-8 字串。 */
function decodeResourceHtml(resource: Readonly<Record<string, unknown>>): string | null {
  if (typeof resource.text === "string") return resource.text;
  if (typeof resource.blob === "string") {
    return Buffer.from(resource.blob, "base64").toString("utf8");
  }
  return null;
}

/** 只從資源 _meta.ui.csp 的四個欄位取出 http/https hostname，去重。 */
function allowedHostsFrom(meta: unknown): string[] {
  const ui = isPlainObject(meta) ? meta.ui : undefined;
  const csp = isPlainObject(ui) ? ui.csp : undefined;
  if (!isPlainObject(csp)) return [];
  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const key of CSP_KEYS) {
    const domains = csp[key];
    if (!Array.isArray(domains)) continue;
    for (const entry of domains) {
      if (typeof entry !== "string") continue;
      const host = httpHostname(entry);
      if (host !== null && !seen.has(host)) {
        seen.add(host);
        hosts.push(host);
      }
    }
  }
  return hosts;
}

function httpHostname(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.hostname.length > 0 ? url.hostname : null;
}

function withDiagnostic(content: ToolContent[], diagnostic: ToolDiagnostic): ToolOutcome {
  return { ok: true, content, diagnostics: [diagnostic] };
}

function unavailable(reason: string): ToolDiagnostic {
  return { code: "tool-unavailable", message: `MCP App 介面資源無法讀取：${reason}` };
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
