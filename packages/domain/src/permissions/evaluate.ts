import { homedir } from "node:os";

import { evaluateShellCommand, isCommandWorkingDirAllowed } from "./commands.js";
import type { ShellContext } from "./commands.js";
import { evaluateReadPath, evaluateWritePath } from "./fs-rules.js";
import { resolvePath } from "./paths.js";
import { PERMISSION_RULES } from "./rules.js";
import type { PermissionRequest, PermissionVerdict } from "./types.js";
import { allow, askHuman, deny } from "./verdict.js";

/** 判斷時可調整的外部事實；正式程式用預設值，測試注入固定的家目錄與 bundle 路徑。 */
export interface EvaluateContext {
  readonly homeDir?: string;
  readonly appBundlePath?: string;
  /** 權限模式；M1 只接受 `hard-rules`，其他模式屬於 M5。 */
  readonly mode?: "hard-rules";
}

/** Cardiary App bundle 的預設位置；`deny.self-modify` 用。 */
export const DEFAULT_APP_BUNDLE_PATH = "/Applications/Cardiary.app";

/**
 * 判定一個動作：先看禁止、再看放行，其餘詢問。
 *
 * 這是唯一的上層入口；工具在執行前把輸入轉成一個 `PermissionAction`，
 * 呼叫這個函式。`deny` 的結果不會被白名單或任何模式推翻。
 */
export function evaluatePermission(
  request: PermissionRequest,
  context: EvaluateContext = {},
): PermissionVerdict {
  const fsContext: ShellContext = {
    workingDir: request.workingDir,
    folderRoot: request.folderRoot,
    homeDir: context.homeDir ?? homedir(),
    appBundlePath: context.appBundlePath ?? DEFAULT_APP_BUNDLE_PATH,
  };
  const action = request.action;

  switch (action.kind) {
    case "fs.read":
    case "fs.list": {
      const resolved = resolvePath(action.path, fsContext);
      if (!resolved.ok) {
        return deny(resolved.rule, resolved.reason);
      }
      return evaluateReadPath(resolved.path, {
        ...fsContext,
        list: action.kind === "fs.list",
      });
    }
    case "fs.write": {
      const resolved = resolvePath(action.path, fsContext);
      if (!resolved.ok) {
        return deny(resolved.rule, resolved.reason);
      }
      return evaluateWritePath(resolved.path, fsContext, "write");
    }
    case "fs.delete": {
      const resolved = resolvePath(action.path, fsContext);
      if (!resolved.ok) {
        return deny(resolved.rule, resolved.reason);
      }
      return evaluateWritePath(resolved.path, fsContext, "delete", action.recursive);
    }
    case "shell.exec": {
      const cwd = resolvePath(action.cwd, fsContext);
      if (!cwd.ok) {
        return deny(cwd.rule, cwd.reason);
      }
      // 指令裡的相對路徑以指令的 cwd 為基準，不是整個工作階段的工作目錄。
      const shellContext: ShellContext = { ...fsContext, workingDir: cwd.path.resolved };
      const verdict = evaluateShellCommand(action.command, shellContext);
      if (verdict.kind === "allow" && !isCommandWorkingDirAllowed(cwd.path.resolved, fsContext)) {
        // 唯讀查詢也要在工作目錄或資料夾之內；否則只是普通的 shell 指令。
        return askHuman(PERMISSION_RULES.askShell, "high");
      }
      return verdict;
    }
    case "cards.read":
      return allow(PERMISSION_RULES.cardsRead);
    case "cards.create":
      return allow(PERMISSION_RULES.cardsCreate);
    case "cards.refresh":
      return allow(PERMISSION_RULES.cardsRefresh);
    case "cards.flip":
      return allow(PERMISSION_RULES.cardsFlip);
    case "cards.patch":
    case "cards.delete":
      return askHuman(PERMISSION_RULES.askCardsWrite, "medium");
    case "network.outbound":
      return askHuman(PERMISSION_RULES.askNetwork, "high");
    case "mcp.call":
      return askHuman(PERMISSION_RULES.askMcp, "high");
    case "external-agent.dispatch":
      return askHuman(PERMISSION_RULES.askExternalAgent, "high");
    case "settings.change":
      if (action.level === "human-only") {
        return deny(PERMISSION_RULES.humanSettings, "這個設定僅限人類修改");
      }
      if (action.level === "approval") {
        return askHuman(PERMISSION_RULES.askSettings, "medium");
      }
      return allow(PERMISSION_RULES.settingsFree);
    default:
      return askHuman(PERMISSION_RULES.askUnclassified, "high");
  }
}
