/**
 * MCP 伺服器與工具名稱的規則。
 *
 * 命名空間固定是 `mcp.<server>.`，伺服器名稱不能冒充內建工具；允許的
 * 網域只接受精確 hostname（小寫、不含 scheme、路徑、萬用字元或 IP 字面值）。
 * 這些規則由領域層定義一次，host 模組、儲存與介面都共用，避免各層自行
 * 放寬。
 */

/** 工具名稱的固定前綴。 */
export const MCP_TOOL_PREFIX = "mcp.";

/** 伺服器識別碼：小寫英數字與連字號，長度 1 到 48。 */
export const MCP_SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** 內建工具名稱；MCP 伺服器不能佔用這些名字。 */
export const BUILTIN_TOOL_NAMES: readonly string[] = [
  "read_file",
  "write_file",
  "list_dir",
  "run_command",
  "card_search",
  "card_read",
  "card_create",
  "propose_card_patch",
  "card_patch",
  "card_delete",
  "card_refresh",
  "card_flip",
  "schedule_propose",
];

/** 名稱或設定不合法時丟出的錯誤。 */
export class McpNameError extends Error {
  readonly code = "invalid_mcp_name";

  constructor(message: string) {
    super(message);
    this.name = "McpNameError";
  }
}

/** 把給人看的伺服器名稱轉成識別碼；結果一定符合 `MCP_SERVER_ID_PATTERN`。 */
export function deriveServerId(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug.length === 0 ? "server" : slug;
}

export function isMcpServerId(value: string): boolean {
  return MCP_SERVER_ID_PATTERN.test(value);
}

export function assertMcpServerId(value: string): string {
  if (!isMcpServerId(value)) {
    throw new McpNameError(`伺服器識別碼不合法：${value}`);
  }
  return value;
}

/** 對外顯示的完整工具名稱；`tool` 只留在後兩段之後，不能含點以外格式限制。 */
export function exposedToolName(serverId: string, tool: string): string {
  assertMcpServerId(serverId);
  const inner = assertMcpToolName(tool);
  return `${MCP_TOOL_PREFIX}${serverId}.${inner}`;
}

/** MCP 伺服器回報的工具名稱；規則依 MCP 規格，只允許英數、底線、連字號與點。 */
export function assertMcpToolName(tool: string): string {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(tool)) {
    throw new McpNameError(`MCP 工具名稱不合法：${tool}`);
  }
  return tool;
}

/**
 * 註冊前的名稱檢查。
 *
 * 只接受 `mcp.` 前綴，且不能與任何內建工具同名。內層工具名稱（伺服器
 * 回報的名稱）也一併檢查：伺服器可以用 `read_file` 命名它自己的工具，
 * 但 Cardiary 不會把它當成可直接覆蓋內建工具的名稱。
 */
export function assertRegisterableToolName(
  name: string,
  reserved: readonly string[] = BUILTIN_TOOL_NAMES,
): string {
  if (!name.startsWith(MCP_TOOL_PREFIX)) {
    throw new McpNameError(`MCP 工具名稱必須以 ${MCP_TOOL_PREFIX} 開頭：${name}`);
  }
  if (reserved.includes(name)) {
    throw new McpNameError(`MCP 工具不能與內建工具同名：${name}`);
  }
  const parts = name.split(".");
  if (parts.length < 3 || parts[1] === undefined) {
    throw new McpNameError(`MCP 工具名稱缺少伺服器段：${name}`);
  }
  assertMcpServerId(parts[1]);
  const inner = parts.slice(2).join(".");
  if (inner.length === 0) {
    throw new McpNameError(`MCP 工具名稱缺少工具段：${name}`);
  }
  return name;
}

/**
 * 正規化允許的網域。
 *
 * 只接受精確 hostname：小寫、不含 scheme、路徑、連接埠、使用者資訊、
 * 萬用字元或 IP 字面值。拒絕 IP 是避免把連線限制偽裝成網域限制。
 */
export function normalizeAllowedHost(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value.length === 0) {
    throw new McpNameError("允許的網域不能是空字串");
  }
  if (value.includes("://")) {
    throw new McpNameError(`允許的網域不能含 scheme：${raw}`);
  }
  if (/[/\\?#@:\s*]/.test(value)) {
    throw new McpNameError(`允許的網域只能是精確 hostname：${raw}`);
  }
  if (value.endsWith(".") || value.startsWith(".") || value.includes("..")) {
    throw new McpNameError(`允許的網域格式不合法：${raw}`);
  }
  if (isIpLiteral(value)) {
    throw new McpNameError(`允許的網域不能是 IP 字面值：${raw}`);
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(value)) {
    throw new McpNameError(`允許的網域格式不合法：${raw}`);
  }
  return value;
}

/** 一組網域；重複值會合併、排序。 */
export function normalizeAllowedHosts(raw: readonly string[]): string[] {
  return [...new Set(raw.map((host) => normalizeAllowedHost(host)))].sort();
}

/** 連線的目的地是否在允許清單內；比對完整 hostname，不做後綴比對。 */
export function isAllowedHost(hostname: string, allowedHosts: readonly string[]): boolean {
  const host = hostname.trim().toLowerCase();
  return allowedHosts.some((allowed) => allowed.toLowerCase() === host);
}

function isIpLiteral(value: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return true;
  }
  // IPv6 含冒號；冒號已在上面被拒絕，這裡保留給未來改成先剝埠號的實作。
  return value.startsWith("[") || value.includes(":");
}
