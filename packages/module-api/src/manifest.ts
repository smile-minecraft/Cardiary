import type { SettingDeclaration } from "./settings.js";

/** 模組識別碼；穩定不變，例如 `card.library`。 */
export type ModuleId = string;

/** 模組之間的相依性。 */
export interface ModuleDependency {
  readonly moduleId: ModuleId;
  /** semver 範圍；由模組主機檢查。 */
  readonly versionRange: string;
  readonly optional?: boolean;
}

/**
 * 模組需要的權限。
 *
 * 第一方模組與主機服務在同一個行程內執行，這些宣告用於使用者審批、
 * 設定頁顯示與工具權限掛點，不是沙盒邊界。第三方外掛開放時才收緊。
 */
export type ModulePermission =
  | "cards:read"
  | "cards:write"
  | "boards:read"
  | "boards:write"
  | "files:read"
  | "files:write"
  | "terminal:execute"
  | "network:outbound"
  | "model:invoke"
  | "schedules:create"
  | "notifications:emit"
  | "mcp:connect"
  | "external-agent:dispatch"
  | "storage:maintain";

/**
 * 模組描述檔。
 *
 * 只放宣告；工具、上下文區段、掛鉤與排程在啟用時由主機端邏輯註冊。
 */
export interface ModuleManifest {
  readonly id: ModuleId;
  readonly name: string;
  /** 模組版本；semver。 */
  readonly version: string;
  readonly description?: string;
  /** 相容的主機介面版本；不相容時拒絕載入。 */
  readonly hostApiVersion: string;
  readonly dependencies: readonly ModuleDependency[];
  readonly permissions: readonly ModulePermission[];
  readonly settings: readonly SettingDeclaration[];
}
