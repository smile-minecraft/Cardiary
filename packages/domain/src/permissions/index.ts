/**
 * 權限判斷的領域型別。
 *
 * 判斷是純函式；實作由本機檔案與終端機工作補上。精確定義見
 * `docs/design/permissions.md`。
 */

/** 一個動作的形狀；工具執行前必須轉成其中一種。 */
export type PermissionAction =
  | { readonly kind: "fs.read"; readonly path: string }
  | { readonly kind: "fs.list"; readonly path: string }
  | {
      readonly kind: "fs.write";
      readonly path: string;
      readonly mode: "create" | "replace" | "append";
    }
  | { readonly kind: "fs.delete"; readonly path: string; readonly recursive: boolean }
  | { readonly kind: "shell.exec"; readonly command: string; readonly cwd: string }
  | { readonly kind: "cards.read"; readonly cardId?: string; readonly query?: string }
  | { readonly kind: "cards.create"; readonly cardKind: "note" | "image" | "audio" }
  | { readonly kind: "cards.patch" | "cards.delete"; readonly cardId: string }
  | { readonly kind: "cards.refresh" | "cards.flip"; readonly cardId: string }
  | {
      readonly kind: "network.outbound";
      readonly host: string;
      readonly port: number;
      readonly scheme: "http" | "https" | "tcp";
    }
  | { readonly kind: "mcp.call"; readonly serverId: string; readonly toolName: string }
  | { readonly kind: "external-agent.dispatch"; readonly agent: string; readonly command: string }
  | {
      readonly kind: "settings.change";
      readonly key: string;
      readonly level: "free" | "approval" | "human-only";
    };

/** 判斷的輸入。 */
export interface PermissionRequest {
  readonly action: PermissionAction;
  /** 已 realpath 的工作目錄。 */
  readonly workingDir: string;
  /** 已 realpath 的 Cardiary 資料夾。 */
  readonly folderRoot: string;
  readonly call: {
    readonly sessionId: string;
    readonly turnId: string;
    readonly scope: "main" | "subagent";
    readonly subagentDepth: number;
  };
}

/** 判斷的結果。 */
export type PermissionVerdict =
  | { readonly kind: "allow"; readonly rule: string }
  | { readonly kind: "deny"; readonly rule: string; readonly reason: string }
  | {
      readonly kind: "ask-human";
      readonly rule: string;
      readonly risk: "low" | "medium" | "high";
    };

/** 純函式：先看禁止、再看放行、其餘詢問。 */
export type PermissionEvaluator = (request: PermissionRequest) => PermissionVerdict;

/** 路徑分類；由 `normalizePath` 的結果決定。 */
export type PathClass = "workspace" | "folder" | "system" | "external";
