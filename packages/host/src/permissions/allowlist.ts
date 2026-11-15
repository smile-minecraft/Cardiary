import { isWithin } from "@cardiary/domain";
import { newUlid } from "@cardiary/storage";

/**
 * `approval_allowlist` 的最小資料庫介面；`@cardiary/storage` 的 `Database`
 * 直接滿足它。這裡刻意不 import 儲存層的類別，讓權限模組只依賴 SQL 形狀。
 */
export interface AllowlistDatabase {
  all<T>(sql: string, ...params: readonly unknown[]): T[];
  get<T>(sql: string, ...params: readonly unknown[]): T | undefined;
  run(sql: string, ...params: readonly unknown[]): { readonly changes: number };
}

/** 一筆白名單。鍵是 `UNIQUE (tool_name, scope_key)`。 */
export interface AllowlistEntry {
  readonly id: string;
  readonly toolName: string;
  readonly scopeKey: string;
  readonly actionKind: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

/** 使用者按下「一律允許」時要寫入的內容。 */
export interface AllowlistGrant {
  readonly toolName: string;
  readonly scopeKey: string;
  readonly actionKind: string;
  readonly createdBy: string;
  readonly now?: Date;
}

/** 白名單的查詢條件；`path` 只用於 `fs.*` 的路徑邊界比對。 */
export interface AllowlistQuery {
  readonly toolName: string;
  readonly actionKind: string;
  /** `fs.*` 與 `shell.*` 使用的工作目錄；`cards.*` 用 `*`。 */
  readonly scopeKey: string;
  /** 正規化後的目標路徑；指令沒有單一路徑時省略。 */
  readonly path?: string;
}

interface AllowlistRow {
  readonly id: string;
  readonly tool_name: string;
  readonly scope_key: string;
  readonly action_kind: string;
  readonly created_at: string;
  readonly created_by: string;
}

/**
 * 「此工具在此目錄一律允許」的白名單。
 *
 * 它是設定，不是審批紀錄：不過期、不隨對話刪除、不受 30 天保留影響。
 * 只有 `PermissionDecisionService` 在使用者按下「一律允許」時寫入；權限
 * 閘道只讀。代理沒有任何寫入路徑——工具介面沒有這個參數，這裡也不提供
 * 給模組的服務。
 */
export class ApprovalAllowlistStore {
  readonly #db: AllowlistDatabase;

  constructor(db: AllowlistDatabase) {
    this.#db = db;
  }

  list(): AllowlistEntry[] {
    return this.#db
      .all<AllowlistRow>("SELECT * FROM approval_allowlist ORDER BY created_at, id")
      .map(rowToEntry);
  }

  /** 同一個工具的所有目錄。 */
  listForTool(toolName: string): AllowlistEntry[] {
    return this.#db
      .all<AllowlistRow>("SELECT * FROM approval_allowlist WHERE tool_name = ?", toolName)
      .map(rowToEntry);
  }

  /**
   * 寫入或更新一筆；同一個 `(tool_name, scope_key)` 只會有一列。
   *
   * 重複按下「一律允許」是安全的：更新動作種類與建立時間，不新增第二列。
   */
  grant(grant: AllowlistGrant): AllowlistEntry {
    const now = grant.now ?? new Date();
    const id = newUlid(now.getTime());
    this.#db.run(
      `INSERT INTO approval_allowlist (id, tool_name, scope_key, action_kind, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (tool_name, scope_key) DO UPDATE SET
         action_kind = excluded.action_kind,
         created_at = excluded.created_at,
         created_by = excluded.created_by`,
      id,
      grant.toolName,
      grant.scopeKey,
      grant.actionKind,
      now.toISOString(),
      grant.createdBy,
    );
    const entry = this.find(grant.toolName, grant.scopeKey);
    if (entry === null) {
      throw new Error(`approval_allowlist 寫入後找不到 (${grant.toolName}, ${grant.scopeKey})`);
    }
    return entry;
  }

  find(toolName: string, scopeKey: string): AllowlistEntry | null {
    const row = this.#db.get<AllowlistRow>(
      "SELECT * FROM approval_allowlist WHERE tool_name = ? AND scope_key = ?",
      toolName,
      scopeKey,
    );
    return row === undefined ? null : rowToEntry(row);
  }

  /** 使用者撤銷一筆；回傳是否真的刪掉。 */
  revoke(toolName: string, scopeKey: string): boolean {
    return (
      this.#db.run(
        "DELETE FROM approval_allowlist WHERE tool_name = ? AND scope_key = ?",
        toolName,
        scopeKey,
      ).changes > 0
    );
  }

  /**
   * 命中條件：工具名稱與動作種類相同，而且 `scope_key = '*'` 或目標在
   * `scope_key` 之內。前綴必須是路徑邊界（`/a/b` 不涵蓋 `/a/b-other`）。
   */
  match(query: AllowlistQuery): AllowlistEntry | null {
    for (const entry of this.listForTool(query.toolName)) {
      if (entry.actionKind !== query.actionKind) {
        continue;
      }
      if (entry.scopeKey === "*") {
        return entry;
      }
      if (query.path !== undefined && isWithin(entry.scopeKey, query.path)) {
        return entry;
      }
      if (query.path === undefined && query.scopeKey === entry.scopeKey) {
        return entry;
      }
    }
    return null;
  }
}

function rowToEntry(row: AllowlistRow): AllowlistEntry {
  return {
    id: row.id,
    toolName: row.tool_name,
    scopeKey: row.scope_key,
    actionKind: row.action_kind,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}
