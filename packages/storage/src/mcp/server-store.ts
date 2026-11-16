/**
 * MCP 伺服器設定的正本存取。
 *
 * 檔案是 `state/mcp-servers.json`，由 `FolderLayout` 定位並以原子寫入
 * （同目錄暫存檔 + rename）落盤。所有變更都串在同一條佇列上，避免兩個
 * 協定請求同時讀改寫而互相覆蓋。
 */
import { existsSync } from "node:fs";
import path from "node:path";

import {
  createMcpServerRecord,
  deriveServerId,
  isAllowedHost,
  isMcpServerId,
  McpConfigError,
  normalizeAllowedHosts,
  parseMcpServersFile,
  serializeMcpServersFile,
  validateMcpServerInput,
  type McpServerInput,
  type McpServerRecord,
} from "@cardiary/domain";

import {
  assertNotSymbolicLink,
  FolderLayout,
  readFileNoFollow,
  writeFileAtomic,
} from "../paths.js";
import { nowIso } from "../util.js";

/** 設定檔在資料夾內的相對路徑。 */
export const MCP_SERVERS_RELATIVE_PATH = "state/mcp-servers.json";

export interface McpServerStoreOptions {
  readonly now?: () => Date;
}

/** `state/mcp-servers.json` 的存取；方法會序列化，呼叫端不必自己排隊。 */
export class McpServerStore {
  readonly #layout: FolderLayout;
  readonly #now: () => Date;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(layout: FolderLayout, options: McpServerStoreOptions = {}) {
    this.#layout = layout;
    this.#now = options.now ?? (() => new Date());
  }

  /** 設定檔的絕對路徑。 */
  get filePath(): string {
    return this.#layout.absolute(MCP_SERVERS_RELATIVE_PATH);
  }

  list(): Promise<McpServerRecord[]> {
    return this.#enqueue(() => this.#readAll());
  }

  get(serverId: string): Promise<McpServerRecord | null> {
    return this.#enqueue(() => {
      const servers = this.#readAll();
      return servers.find((server) => server.serverId === serverId) ?? null;
    });
  }

  /** 新增伺服器；識別碼由名稱推導，衝突時加上序號。 */
  add(input: McpServerInput): Promise<McpServerRecord> {
    return this.#enqueue(() => {
      const normalized = validateMcpServerInput(input);
      const servers = this.#readAll();
      const serverId = uniqueServerId(deriveServerId(normalized.name), servers);
      const now = nowIso(this.#now);
      const record = createMcpServerRecord(normalized, { serverId, now, enabled: true });
      this.#writeAll([...servers, record]);
      return record;
    });
  }

  remove(serverId: string): Promise<boolean> {
    return this.#enqueue(() => {
      const servers = this.#readAll();
      const next = servers.filter((server) => server.serverId !== serverId);
      if (next.length === servers.length) {
        return false;
      }
      this.#writeAll(next);
      return true;
    });
  }

  setEnabled(serverId: string, enabled: boolean): Promise<McpServerRecord> {
    return this.#enqueue(() => this.#update(serverId, (server) => ({ ...server, enabled })));
  }

  /** 由人調整允許網域；stdio 伺服器只能留空。 */
  setAllowedHosts(serverId: string, allowedHosts: readonly string[]): Promise<McpServerRecord> {
    return this.#enqueue(() => {
      const servers = this.#readAll();
      const current = findOrThrow(servers, serverId);
      const input = toInput(current);
      const normalized = validateMcpServerInput({
        ...input,
        allowedHosts: normalizeAllowedHosts(allowedHosts),
      });
      if (normalized.transport === "http" && normalized.url !== undefined) {
        if (!isAllowedHost(new URL(normalized.url).hostname, normalized.allowedHosts)) {
          throw new McpConfigError("http 伺服器的 URL host 必須留在 allowedHosts 內");
        }
      }
      const now = nowIso(this.#now);
      const updated: McpServerRecord = {
        ...current,
        allowedHosts: normalized.allowedHosts,
        updatedAt: now,
      };
      this.#writeAll(servers.map((server) => (server.serverId === serverId ? updated : server)));
      return updated;
    });
  }

  #update(
    serverId: string,
    change: (server: McpServerRecord) => McpServerRecord,
  ): McpServerRecord {
    const servers = this.#readAll();
    const current = findOrThrow(servers, serverId);
    const updated: McpServerRecord = { ...change(current), updatedAt: nowIso(this.#now) };
    this.#writeAll(servers.map((server) => (server.serverId === serverId ? updated : server)));
    return updated;
  }

  #readAll(): McpServerRecord[] {
    const filePath = this.filePath;
    if (!existsSync(filePath)) {
      return [];
    }
    assertNotSymbolicLink(filePath);
    return parseMcpServersFile(readFileNoFollow(this.#layout, filePath).toString("utf8"));
  }

  #writeAll(servers: readonly McpServerRecord[]): void {
    const filePath = this.filePath;
    assertNotSymbolicLink(filePath);
    writeFileAtomic(this.#layout, filePath, serializeMcpServersFile(servers));
  }

  #enqueue<T>(operation: () => T): Promise<T> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function toInput(record: McpServerRecord): McpServerInput {
  return {
    name: record.name,
    transport: record.transport,
    ...(record.command === undefined ? {} : { command: record.command }),
    ...(record.args === undefined ? {} : { args: record.args }),
    ...(record.url === undefined ? {} : { url: record.url }),
    allowedHosts: record.allowedHosts,
  };
}

function findOrThrow(servers: readonly McpServerRecord[], serverId: string): McpServerRecord {
  if (!isMcpServerId(serverId)) {
    throw new McpConfigError(`伺服器識別碼不合法：${serverId}`);
  }
  const found = servers.find((server) => server.serverId === serverId);
  if (found === undefined) {
    throw new McpConfigError(`找不到 MCP 伺服器：${serverId}`);
  }
  return found;
}

function uniqueServerId(base: string, servers: readonly McpServerRecord[]): string {
  const taken = new Set(servers.map((server) => server.serverId));
  if (!taken.has(base)) {
    return base;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base.slice(0, 45)}-${index}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new McpConfigError("伺服器識別碼找不到可用的名稱");
}

/** 目錄路徑的附屬工具；測試與模組共用。 */
export function mcpCacheDirectory(root: string, serverId: string): string {
  return path.join(root, "cache", "mcp", serverId);
}
