/**
 * MCP 工具清單的快取。
 *
 * 位置是 `cache/mcp/<serverId>/tools.json`：可重建，刪掉只會讓模型少看到
 * 上次載入的工具，下次 `list_tools` 或連線時重新抓。檔案屬於快取區，
 * 由模組自己維護；寫入前先登記到檔案登記簿，每日維護的掃描才不會把它
 * 當成未登記的檔案刪掉，儲存清理也能把它算進可回收的快取。
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { assertMcpServerId } from "@cardiary/domain";
import {
  FolderLayout,
  mcpCacheDirectory,
  readFileNoFollow,
  writeFileAtomic,
  type FileRegistry,
} from "@cardiary/storage";

import type { McpToolDescriptor } from "./client.js";

/** 快取檔名；一個伺服器一個目錄。 */
export const MCP_TOOLS_CACHE_FILE = "tools.json";

const CACHE_VERSION = 1;

/** 工具清單的快取介面；工具組只依賴這兩個動作，不知道檔案在哪裡。 */
export interface McpToolCachePort {
  load(): McpToolDescriptor[] | null;
  save(tools: readonly McpToolDescriptor[]): void;
}

interface CacheFile {
  readonly version: number;
  readonly serverId: string;
  readonly savedAt: string;
  readonly tools: readonly McpToolDescriptor[];
}

/** 快取檔在資料夾內的相對路徑；測試與登記簿共用同一個算法。 */
export function toolCacheRelativePath(serverId: string): string {
  assertMcpServerId(serverId);
  return `cache/mcp/${serverId}/${MCP_TOOLS_CACHE_FILE}`;
}

/** `cache/mcp/<serverId>/tools.json` 的讀寫；壞掉或版本不合的檔案一律當成沒有快取。 */
export class McpToolCache {
  readonly #layout: FolderLayout;
  readonly #registry: FileRegistry;
  readonly #now: () => Date;

  constructor(layout: FolderLayout, registry: FileRegistry, options: { now?: () => Date } = {}) {
    this.#layout = layout;
    this.#registry = registry;
    this.#now = options.now ?? (() => new Date());
  }

  /** 綁定一個伺服器的讀寫介面；工具組拿到的是這個。 */
  portFor(serverId: string): McpToolCachePort {
    return {
      load: () => this.load(serverId),
      save: (tools) => this.save(serverId, tools),
    };
  }

  load(serverId: string): McpToolDescriptor[] | null {
    const relativePath = toolCacheRelativePath(serverId);
    let text: string;
    try {
      text = readFileNoFollow(this.#layout, this.#layout.absolute(relativePath)).toString("utf8");
    } catch {
      return null;
    }
    const parsed = parseCacheFile(text, serverId);
    if (parsed === null) {
      return null;
    }
    this.#registry.touch(relativePath);
    return parsed;
  }

  save(serverId: string, tools: readonly McpToolDescriptor[]): void {
    const relativePath = toolCacheRelativePath(serverId);
    const content = `${JSON.stringify(
      {
        version: CACHE_VERSION,
        serverId,
        savedAt: this.#now().toISOString(),
        tools,
      } satisfies CacheFile,
      null,
      2,
    )}\n`;
    mkdirSync(mcpCacheDirectory(this.#layout.root, serverId), { recursive: true });
    // 先登記再寫入：掃描若在兩者之間跑，看到的是「已登記但檔案還沒出現」，
    // 掃描會刪掉只剩登記列的項目，不會留下未登記的檔案。
    this.#registry.register({
      relPath: relativePath,
      ownerKind: "module",
      ownerId: `mcp:${serverId}`,
      sizeBytes: Buffer.byteLength(content),
    });
    writeFileAtomic(this.#layout, this.#layout.absolute(relativePath), content);
  }

  /** 移除伺服器時一起清掉快取；同名伺服器重建後才不會讀到舊工具。 */
  remove(serverId: string): void {
    assertMcpServerId(serverId);
    this.#registry.purgeOwner("module", [`mcp:${serverId}`]);
  }
}

function parseCacheFile(text: string, serverId: string): McpToolDescriptor[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(value)) {
    return null;
  }
  if (value.version !== CACHE_VERSION || value.serverId !== serverId) {
    return null;
  }
  if (!Array.isArray(value.tools)) {
    return null;
  }
  const tools: McpToolDescriptor[] = [];
  for (const entry of value.tools) {
    const tool = parseTool(entry);
    if (tool === null) {
      return null;
    }
    tools.push(tool);
  }
  return tools;
}

function parseTool(value: unknown): McpToolDescriptor | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const name = value.name;
  if (typeof name !== "string" || name.length === 0) {
    return null;
  }
  const description = value.description;
  if (description !== undefined && typeof description !== "string") {
    return null;
  }
  const inputSchema = value.inputSchema;
  if (inputSchema !== undefined && !isPlainObject(inputSchema)) {
    return null;
  }
  const meta = value.meta;
  return {
    name,
    ...(description === undefined ? {} : { description }),
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...(isPlainObject(meta) ? { meta } : {}),
  };
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 快取檔的絕對路徑；測試用來確認檔案位置。 */
export function toolCacheFilePath(layout: FolderLayout, serverId: string): string {
  return path.join(mcpCacheDirectory(layout.root, serverId), MCP_TOOLS_CACHE_FILE);
}
