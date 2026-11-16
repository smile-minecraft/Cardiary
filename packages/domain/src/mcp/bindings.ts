/**
 * MCP 伺服器核准綁定的内容雜湊。
 *
 * 設定正本 `state/mcp-servers.json` 可能被核准流程以外的路徑寫入，光看
 * `enabled` 無法證明這筆設定通過核准。這裡把「核准過的設定」壓成一組
 * 正規化欄位的 SHA-256，交給受保護的狀態庫保存；啟動時比對兩邊，只有
 * 內容完全一致才讓伺服器啟動。
 *
 * 正規化欄位不含時間戳（當初產生的時間不影響行為），其餘會影響啟動行為
 * 或工具命名空間的欄位都進雜湊，包含 `enabled`：手改 enabled 也必須重新
 * 送出核准，不能偷偷啟動或停止伺服器。
 */
import { createHash } from "node:crypto";

import type { McpServerRecord } from "./servers.js";

export const MCP_SERVER_CONFIG_DIGEST_VERSION = 1;

/**
 * 固定順序、固定鍵名的正規化快照；字串陣列用 JSON.stringify，
 * allowedHosts 先排序，避免欄位順序或 host 順序造成雜湊漂移。
 */
export function mcpServerConfigSnapshot(record: McpServerRecord): string {
  const fields = {
    v: MCP_SERVER_CONFIG_DIGEST_VERSION,
    serverId: record.serverId,
    name: record.name,
    transport: record.transport,
    command: record.command ?? null,
    args: record.args === undefined ? null : [...record.args],
    url: record.url ?? null,
    allowedHosts: [...record.allowedHosts].sort(),
    enabled: record.enabled,
  };
  return JSON.stringify(fields);
}

/** 核准綁定用的設定雜湊（16 進位 SHA-256）。 */
export function mcpServerConfigDigest(record: McpServerRecord): string {
  return createHash("sha256").update(mcpServerConfigSnapshot(record), "utf8").digest("hex");
}
