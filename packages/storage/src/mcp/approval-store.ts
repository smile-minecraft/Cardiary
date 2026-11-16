/**
 * MCP 伺服器的核准綁定：通過核准的設定雜湊存在受保護的狀態庫。
 *
 * 設定正本 `state/mcp-servers.json` 可能被核准流程以外的路徑篡改，
 * 單憑檔案內容（`enabled` 為 true、schema 合法）不能證明它通過審批。
 * 本系列只保存核准當下針對正規化內容算出的 SHA-256；啟動時重新對目前的
 * 紀錄算雜湊，兩邊相符才准啟動。表中的 `config_json` 是核准當下的快照，
 * 供 UI 與稽核比對，不作為信任依據。
 *
 * 表由 v8 migration 建立（`mcp_server_approvals`），所以此類別即使建在還沒
 * 升級的資料庫上也不會寫入成功；呼叫端應由正規啟動流程保證 migration
 * 已完成。
 */
import {
  mcpServerConfigDigest,
  mcpServerConfigSnapshot,
  type McpServerRecord,
} from "@cardiary/domain";
import type { Database } from "../db.js";

export interface McpServerApproval {
  readonly serverId: string;
  readonly configDigest: string;
  readonly configJson: string;
  readonly approvedAt: string;
}

interface ApprovalRow {
  readonly server_id: string;
  readonly config_digest: string;
  readonly config_json: string;
  readonly approved_at: string;
}

function toApproval(row: ApprovalRow): McpServerApproval {
  return {
    serverId: row.server_id,
    configDigest: row.config_digest,
    configJson: row.config_json,
    approvedAt: row.approved_at,
  };
}

/** `mcp_server_approvals` 表的讀寫介面；所有查詢都用 server id 當鍵。 */
export class McpServerApprovalStore {
  readonly #db: Database;
  readonly #now: () => Date;

  constructor(db: Database, options: { readonly now?: () => Date } = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
  }

  /** 目前內容是否與核准紀錄完全一致；沒有紀錄一律視為未核准。 */
  isApproved(record: McpServerRecord): boolean {
    const approval = this.approvalOf(record.serverId);
    return approval !== undefined && approval.configDigest === mcpServerConfigDigest(record);
  }

  approvalOf(serverId: string): McpServerApproval | undefined {
    const row = this.#db.get<ApprovalRow>(
      "SELECT server_id, config_digest, config_json, approved_at FROM mcp_server_approvals WHERE server_id = ?",
      serverId,
    );
    return row === undefined ? undefined : toApproval(row);
  }

  /** 寫入或更新核准紀錄；只在協定核准通過後呼叫。 */
  approve(record: McpServerRecord): McpServerApproval {
    const digest = mcpServerConfigDigest(record);
    const configJson = mcpServerConfigSnapshot(record);
    const approvedAt = this.#now().toISOString();
    this.#db.run(
      `INSERT INTO mcp_server_approvals (server_id, config_digest, config_json, approved_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(server_id) DO UPDATE SET
         config_digest = excluded.config_digest,
         config_json = excluded.config_json,
         approved_at = excluded.approved_at`,
      record.serverId,
      digest,
      configJson,
      approvedAt,
    );
    return {
      serverId: record.serverId,
      configDigest: digest,
      configJson,
      approvedAt,
    };
  }

  revoke(serverId: string): void {
    this.#db.run("DELETE FROM mcp_server_approvals WHERE server_id = ?", serverId);
  }

  list(): readonly McpServerApproval[] {
    return this.#db
      .all<ApprovalRow>(
        "SELECT server_id, config_digest, config_json, approved_at FROM mcp_server_approvals ORDER BY server_id",
      )
      .map(toApproval);
  }
}
