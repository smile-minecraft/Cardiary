import type {
  ApprovalAction,
  ApprovalDetail,
  JsonValue,
  ToolPermissionGate,
  ToolPermissionRequest,
  ToolPermissionVerdict,
} from "@cardiary/engine-adapter";
import {
  evaluatePermission,
  resolvePath,
  type PermissionAction,
  type PermissionVerdict,
  type PathRoots,
} from "@cardiary/domain";

import { actionKindFor, localToolAction } from "./actions.js";
import type { AllowlistEntry, ApprovalAllowlistStore } from "./allowlist.js";

/** 審批的預設逾時：5 分鐘。 */
export const DEFAULT_APPROVAL_TIMEOUT_MS = 300_000;

/**
 * 審批請求的 `details` 裡，給「一律允許」沿用分類的三個欄位。
 *
 * 標籤是主機與審批之間的穩定介面：`PermissionDecisionService` 從審批的
 * `request_json` 讀回 `action_kind` 與 `scope_key`，寫入白名單。改標籤等於
 * 改行為，測試會擋。
 */
export const ALLOWLIST_DETAIL_LABELS = {
  actionKind: "動作類型",
  scopeKey: "允許範圍",
  toolName: "工具",
} as const;

export interface ToolPermissionGateOptions {
  /** 已 realpath 的工作目錄；`scope_key` 也用它。 */
  readonly workingDir: string;
  /** 已 realpath 的 Cardiary 資料夾。 */
  readonly folderRoot: string;
  readonly allowlist: Pick<ApprovalAllowlistStore, "match">;
  readonly homeDir?: string;
  readonly appBundlePath?: string;
  /** 工具呼叫轉成動作的方式；省略時只認本機檔案與終端機的四個工具。 */
  readonly resolveAction?: (toolName: string, input: JsonValue) => PermissionAction | null;
  readonly timeoutMs?: number;
}

/**
 * 硬規則的權限閘道。
 *
 * 順序固定是 `deny` → `allow`（硬規則或白名單）→ `ask-human`；
 * `deny` 之後不再查白名單，所以「一律允許」不能推翻禁止項。
 */
export function createToolPermissionGate(options: ToolPermissionGateOptions): ToolPermissionGate {
  const roots: PathRoots = {
    workingDir: options.workingDir,
    folderRoot: options.folderRoot,
  };
  const resolveAction = options.resolveAction ?? localToolAction;
  const timeoutMs = options.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;

  return {
    evaluate(request: ToolPermissionRequest): Promise<ToolPermissionVerdict> {
      const action = resolveAction(request.toolName, request.input);
      if (action === null) {
        // 不認得的工具：沒有動作可以分類，一律詢問，而且不提供「一律允許」。
        return Promise.resolve({
          kind: "ask-human",
          action: {
            kind: "tool-execution",
            summary: `執行工具 ${request.toolName}`,
            toolName: request.toolName,
            toolInput: request.input,
          },
          risk: "high",
          timeoutMs,
        });
      }

      const verdict = evaluatePermission(
        {
          action,
          workingDir: options.workingDir,
          folderRoot: options.folderRoot,
          call: {
            sessionId: request.conversationId,
            turnId: request.turnId,
            scope: "main",
            subagentDepth: 0,
          },
        },
        {
          ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
          ...(options.appBundlePath === undefined ? {} : { appBundlePath: options.appBundlePath }),
        },
      );

      if (verdict.kind === "deny") {
        return Promise.resolve({ kind: "deny", reason: `${verdict.rule}：${verdict.reason}` });
      }
      if (verdict.kind === "allow") {
        return Promise.resolve({ kind: "allow" });
      }

      const allowlistEntry = matchAllowlist(action, request.toolName, options, roots);
      if (allowlistEntry !== null) {
        return Promise.resolve({ kind: "allow" });
      }

      return Promise.resolve({
        kind: "ask-human",
        action: approvalAction(action, request, verdict, roots),
        risk: verdict.risk,
        timeoutMs,
      });
    },
  };
}

function matchAllowlist(
  action: PermissionAction,
  toolName: string,
  options: ToolPermissionGateOptions,
  roots: PathRoots,
): AllowlistEntry | null {
  const actionKind = actionKindFor(action);
  const scopeKey = scopeKeyFor(action, options.workingDir);
  if (
    action.kind === "fs.read" ||
    action.kind === "fs.list" ||
    action.kind === "fs.write" ||
    action.kind === "fs.delete"
  ) {
    const resolved = resolvePath(action.path, roots);
    if (!resolved.ok) {
      return null;
    }
    return options.allowlist.match({
      toolName,
      actionKind,
      scopeKey,
      path: resolved.path.resolved,
    });
  }
  return options.allowlist.match({ toolName, actionKind, scopeKey });
}

/** 白名單的 `scope_key`：`fs.*` 與 `shell.*` 用工作目錄，其餘用 `*`。 */
export function scopeKeyFor(action: PermissionAction, workingDir: string): string {
  if (
    action.kind === "fs.read" ||
    action.kind === "fs.list" ||
    action.kind === "fs.write" ||
    action.kind === "fs.delete" ||
    action.kind === "shell.exec"
  ) {
    return workingDir;
  }
  return "*";
}

function approvalAction(
  action: PermissionAction,
  request: ToolPermissionRequest,
  verdict: Extract<PermissionVerdict, { kind: "ask-human" }>,
  roots: PathRoots,
): ApprovalAction {
  const details: ApprovalDetail[] = [
    { label: ALLOWLIST_DETAIL_LABELS.actionKind, value: actionKindFor(action) },
    { label: ALLOWLIST_DETAIL_LABELS.scopeKey, value: scopeKeyFor(action, roots.workingDir) },
    { label: ALLOWLIST_DETAIL_LABELS.toolName, value: request.toolName },
  ];
  let summary: string;
  switch (action.kind) {
    case "fs.read":
    case "fs.list": {
      const resolved = resolvePath(action.path, roots);
      summary = action.kind === "fs.read" ? `讀取檔案：${action.path}` : `列出目錄：${action.path}`;
      if (resolved.ok) {
        details.push({ label: "解析後的路徑", value: resolved.path.resolved });
        if (resolved.path.changed) {
          details.push({ label: "原始路徑", value: resolved.path.requested });
        }
      }
      break;
    }
    case "fs.write": {
      const resolved = resolvePath(action.path, roots);
      summary = `寫入檔案：${action.path}`;
      if (resolved.ok) {
        details.push({ label: "解析後的路徑", value: resolved.path.resolved });
        if (resolved.path.changed) {
          details.push({ label: "原始路徑", value: resolved.path.requested });
        }
      }
      break;
    }
    case "fs.delete": {
      const resolved = resolvePath(action.path, roots);
      summary = `刪除：${action.path}`;
      if (resolved.ok) {
        details.push({ label: "解析後的路徑", value: resolved.path.resolved });
        if (resolved.path.changed) {
          details.push({ label: "原始路徑", value: resolved.path.requested });
        }
      }
      details.push({ label: "遞迴", value: action.recursive ? "是" : "否" });
      break;
    }
    case "shell.exec": {
      summary = `執行指令：${action.command}`;
      details.push({ label: "工作目錄", value: action.cwd });
      break;
    }
    case "cards.patch":
      summary = `編修卡片 ${action.cardId}`;
      break;
    case "cards.delete":
      summary = `刪除卡片 ${action.cardId}`;
      break;
    case "settings.change":
      summary = `修改設定 ${action.key}`;
      break;
    default:
      summary = `${verdict.rule}：${request.toolName}`;
  }
  details.push({ label: "規則", value: verdict.rule });
  return {
    kind: "tool-execution",
    summary,
    details,
    toolName: request.toolName,
    toolInput: request.input,
  };
}
