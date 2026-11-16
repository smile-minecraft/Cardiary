/**
 * `state/mcp-servers.json` 的內容與嚴格解析。
 *
 * 這個檔案是 MCP 伺服器設定的正本；容量小、由人管理，用 JSON 而不是資料庫，
 * 讓使用者可以直接檢視與備份。解析採嚴格模式：欄位不合、版本不認識或
 * 伺服器識別碼重複都拒絕，不讓壞掉的設定悄悄降級成「沒有伺服器」。
 */
import {
  assertMcpServerId,
  isAllowedHost,
  isMcpServerId,
  McpNameError,
  normalizeAllowedHosts,
} from "./names.js";

/** 伺服器設定檔的版本；以後改格式時遞增。 */
export const MCP_SERVERS_FILE_VERSION = 1;

export type McpServerTransport = "stdio" | "http";

/** 一個 MCP 伺服器的正本設定；不含執行狀態。 */
export interface McpServerRecord {
  readonly serverId: string;
  readonly name: string;
  readonly transport: McpServerTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly allowedHosts: readonly string[];
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 新增伺服器的輸入；識別碼、時間與啟用狀態由呼叫端補上。 */
export interface McpServerInput {
  readonly name: string;
  readonly transport: McpServerTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly allowedHosts: readonly string[];
}

/** 解析或驗證失敗時丟出的錯誤。 */
export class McpConfigError extends Error {
  readonly code = "invalid_mcp_config";

  constructor(message: string) {
    super(message);
    this.name = "McpConfigError";
  }
}

const RECORD_KEYS = new Set([
  "serverId",
  "name",
  "transport",
  "command",
  "args",
  "url",
  "allowedHosts",
  "enabled",
  "createdAt",
  "updatedAt",
]);

const INPUT_KEYS = new Set(["name", "transport", "command", "args", "url", "allowedHosts"]);

/** 驗證新增伺服器的輸入；回傳正規化後的設定，錯誤時丟 `McpConfigError`。 */
export function validateMcpServerInput(input: McpServerInput): McpServerInput {
  assertKnownKeys(input as unknown as Record<string, unknown>, INPUT_KEYS, "伺服器設定");
  if (typeof input.name !== "string") {
    throw new McpConfigError("伺服器名稱必須是字串");
  }
  const name = input.name.trim();
  if (name.length === 0 || name.length > 80) {
    throw new McpConfigError("伺服器名稱長度必須介於 1 到 80");
  }
  if (input.transport !== "stdio" && input.transport !== "http") {
    throw new McpConfigError(`不支援的傳輸方式：${String(input.transport)}`);
  }
  if (input.transport === "stdio") {
    const command = optionalString(input.command, "command");
    if (command === undefined || command.length === 0) {
      throw new McpConfigError("stdio 伺服器需要 command");
    }
    if (input.url !== undefined) {
      throw new McpConfigError("stdio 伺服器不能同時設定 url");
    }
    const args = optionalStringArray(input.args, "args");
    const allowedHosts = normalizeHostsOrThrow(input.allowedHosts);
    if (allowedHosts.length > 0) {
      // Seatbelt 只能全域允許或全域拒絕網路，沒有逐網域的過濾器；在能證明
      // 實際目的地受限之前，拒絕啟動比假裝限制有效安全。
      throw new McpConfigError(
        "stdio 伺服器的沙盒只能全部拒絕網路，不支援個別網域白名單；請留空 allowedHosts",
      );
    }
    return {
      name,
      transport: "stdio",
      command,
      args,
      allowedHosts: [],
    };
  }
  if (input.command !== undefined || input.args !== undefined) {
    throw new McpConfigError("http 伺服器不能設定 command 或 args");
  }
  const url = validateHttpUrl(input.url);
  const allowedHosts = normalizeHostsOrThrow(input.allowedHosts);
  if (!isAllowedHost(new URL(url).hostname, allowedHosts)) {
    throw new McpConfigError("http 伺服器的 URL host 必須在 allowedHosts 內");
  }
  return { name, transport: "http", url, allowedHosts };
}

/** 建立完整的正本記錄；`serverId` 必須先檢查過唯一性。 */
export function createMcpServerRecord(
  input: McpServerInput,
  options: { readonly serverId: string; readonly now: string; readonly enabled: boolean },
): McpServerRecord {
  const normalized = validateMcpServerInput(input);
  assertMcpServerId(options.serverId);
  return {
    serverId: options.serverId,
    name: normalized.name,
    transport: normalized.transport,
    ...(normalized.command === undefined ? {} : { command: normalized.command }),
    ...(normalized.args === undefined ? {} : { args: normalized.args }),
    ...(normalized.url === undefined ? {} : { url: normalized.url }),
    allowedHosts: normalized.allowedHosts,
    enabled: options.enabled,
    createdAt: options.now,
    updatedAt: options.now,
  };
}

/** 解析 `state/mcp-servers.json` 的完整內容。 */
export function parseMcpServersFile(text: string): McpServerRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new McpConfigError("mcp-servers.json 不是合法的 JSON");
  }
  if (!isObject(parsed)) {
    throw new McpConfigError("mcp-servers.json 的最外層必須是物件");
  }
  assertKnownKeys(parsed, new Set(["version", "servers"]), "mcp-servers.json");
  if (parsed.version !== MCP_SERVERS_FILE_VERSION) {
    throw new McpConfigError(`不認識的 mcp-servers.json 版本：${String(parsed.version)}`);
  }
  if (!Array.isArray(parsed.servers)) {
    throw new McpConfigError("mcp-servers.json 的 servers 必須是陣列");
  }
  const seen = new Set<string>();
  const servers = parsed.servers.map((entry) => parseRecord(entry, seen));
  return servers;
}

/** 序列化成正本檔內容；伺服器依識別碼排序，方便人閱讀與版本比較。 */
export function serializeMcpServersFile(servers: readonly McpServerRecord[]): string {
  const sorted = [...servers].sort((left, right) => left.serverId.localeCompare(right.serverId));
  return `${JSON.stringify({ version: MCP_SERVERS_FILE_VERSION, servers: sorted }, null, 2)}\n`;
}

function parseRecord(value: unknown, seen: Set<string>): McpServerRecord {
  if (!isObject(value)) {
    throw new McpConfigError("servers 的每一項都必須是物件");
  }
  assertKnownKeys(value, RECORD_KEYS, "伺服器記錄");
  const serverId = typeof value.serverId === "string" ? value.serverId : "";
  if (!isMcpServerId(serverId)) {
    throw new McpConfigError(`伺服器識別碼不合法：${String(value.serverId)}`);
  }
  if (seen.has(serverId)) {
    throw new McpConfigError(`伺服器識別碼重複：${serverId}`);
  }
  seen.add(serverId);
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (name.length === 0 || name.length > 80) {
    throw new McpConfigError(`伺服器 ${serverId} 的名稱不合法`);
  }
  if (value.transport !== "stdio" && value.transport !== "http") {
    throw new McpConfigError(`伺服器 ${serverId} 的傳輸方式不合法`);
  }
  if (typeof value.enabled !== "boolean") {
    throw new McpConfigError(`伺服器 ${serverId} 的 enabled 必須是布林值`);
  }
  const createdAt = requireIsoInstant(value.createdAt, serverId);
  const updatedAt = requireIsoInstant(value.updatedAt, serverId);
  let base: McpServerInput;
  if (value.transport === "stdio") {
    base = {
      name,
      transport: "stdio",
      command: optionalString(value.command, "command"),
      args: optionalStringArray(value.args, "args"),
      allowedHosts: requireStringArray(value.allowedHosts, "allowedHosts"),
    };
  } else {
    base = {
      name,
      transport: "http",
      url: optionalString(value.url, "url"),
      allowedHosts: requireStringArray(value.allowedHosts, "allowedHosts"),
    };
  }
  const normalized = validateMcpServerInput(base);
  return {
    serverId,
    name: normalized.name,
    transport: normalized.transport,
    ...(normalized.command === undefined ? {} : { command: normalized.command }),
    ...(normalized.args === undefined ? {} : { args: normalized.args }),
    ...(normalized.url === undefined ? {} : { url: normalized.url }),
    allowedHosts: normalized.allowedHosts,
    enabled: value.enabled,
    createdAt,
    updatedAt,
  };
}

function validateHttpUrl(raw: string | undefined): string {
  if (raw === undefined || raw.length === 0) {
    throw new McpConfigError("http 伺服器需要 url");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new McpConfigError(`url 不合法：${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new McpConfigError("url 只接受 http 或 https");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new McpConfigError("url 不能含使用者資訊；密鑰由 Keychain 管理");
  }
  if (url.hash.length > 0) {
    throw new McpConfigError("url 不能含片段（#）");
  }
  return url.toString();
}

function normalizeHostsOrThrow(raw: readonly string[]): string[] {
  try {
    return normalizeAllowedHosts(raw);
  } catch (error) {
    if (error instanceof McpNameError) {
      throw new McpConfigError(error.message);
    }
    throw error;
  }
}

function assertKnownKeys(value: Record<string, unknown>, allowed: Set<string>, where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new McpConfigError(`${where} 有不認識的欄位：${key}`);
    }
  }
}

function requireIsoInstant(value: unknown, serverId: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new McpConfigError(`伺服器 ${serverId} 的時間欄位必須是 ISO 字串`);
  }
  return new Date(value).toISOString();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new McpConfigError(`${field} 必須是字串`);
  }
  return value;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  return requireStringArray(value, field);
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new McpConfigError(`${field} 必須是字串陣列`);
  }
  return [...value];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
