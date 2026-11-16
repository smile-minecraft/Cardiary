/**
 * 委派判斷：哪些動作可以交給人事先授權的 System One 審核，以及機率門檻。
 *
 * 兩件事分開：
 *
 * 1. `delegationCandidate`：封閉清單的對應表。只回答「這個動作屬於哪個
 *    類別」，以及人的授權要涵蓋哪個路徑。回 `null` 代表這個動作永遠不
 *    委派——寫入、刪除、一般 shell、對外網路、MCP、外部代理、設定變更、
 *    卡片編修都不在清單內，新增類別要改這裡和設計文件。
 * 2. `reviewProbability`：把 System One 的機率對應到放行、退回人工或其他。
 *
 * 判得順序在呼叫端：硬規則先跑（`deny` 永遠贏），再看人的授權與類別，
 * 最後才問 System One。這裡的函式都不會放寬硬規則。
 */

import { matchCredentialPath } from "./credentials.js";
import { isReadonlyGitCommand, type ShellContext } from "./commands.js";
import { resolvePath } from "./paths.js";
import type { PathRoots } from "./paths.js";
import type { PermissionAction } from "./types.js";

export type DelegatedCategory =
  "read-only-files" | "git-readonly" | "create-card" | "own-notification";

export const DELEGABLE_CATEGORIES: readonly DelegatedCategory[] = [
  "read-only-files",
  "git-readonly",
  "create-card",
  "own-notification",
];

/** 一個可以委派的動作；`path` 是人的授權必須涵蓋的路徑。 */
export interface DelegationCandidate {
  readonly category: DelegatedCategory;
  readonly path?: string;
}

export interface DelegationInput {
  readonly action: PermissionAction;
  readonly roots: PathRoots;
  readonly homeDir?: string;
  readonly appBundlePath?: string;
}

/**
 * 把動作對應到可委派的類別。
 *
 * 回 `null` 代表這個動作永遠不委派。清單是封閉的：
 *
 * - `fs.read`／`fs.list` → `read-only-files`，路徑已進入憑證比對，仍要讓
 *   人授權的路徑涵蓋它。指向憑證的路徑不進委派。
 * - `shell.exec` → `git-readonly`，而且只認單一 `git` 段的唯讀文法；
 *   一般指令（`ls`、`cat`）走檔案類別，不算 git。
 * - `cards.create` → `create-card`；這一類目前在硬規則裡本來就是自動放行，
 *   委派只在未來有工具或規則改變時才會真的用到。
 * - `own-notification` 目前沒有對應的工具，只保留類別名稱。
 */
export function delegationCandidate(input: DelegationInput): DelegationCandidate | null {
  const { action, roots } = input;
  switch (action.kind) {
    case "fs.read":
    case "fs.list": {
      const resolved = resolvePath(action.path, roots);
      if (!resolved.ok) {
        return null;
      }
      if (matchCredentialPath(resolved.path.resolved) !== null) {
        // 指向憑證的路徑不委派；硬規則也會擋，這裡再擋一層。
        return null;
      }
      return { category: "read-only-files", path: resolved.path.resolved };
    }
    case "shell.exec": {
      const shellContext: ShellContext = {
        ...roots,
        homeDir: input.homeDir ?? "",
        appBundlePath: input.appBundlePath ?? "",
      };
      if (!isReadonlyGitCommand(action.command, shellContext)) {
        return null;
      }
      const cwd = resolvePath(action.cwd, roots);
      if (!cwd.ok) {
        return null;
      }
      return { category: "git-readonly", path: cwd.path.resolved };
    }
    case "cards.create":
      return { category: "create-card" };
    default:
      // 寫入、刪除、一般 shell、對外網路、MCP、外部代理、設定變更、
      // 卡片編修與刪除：永遠不委派，也不因為人開啟類別就放行。
      return null;
  }
}

export type ProbabilityVerdict =
  { readonly kind: "allow" } | { readonly kind: "ask-human"; readonly reason: string };

/** 只接受完整且位於 0 到 1 的機率；判斷失敗一律交給人。 */
export function reviewProbability(probability: number | undefined): ProbabilityVerdict {
  if (
    probability !== undefined &&
    Number.isFinite(probability) &&
    probability >= 0.9 &&
    probability <= 1
  ) {
    return { kind: "allow" };
  }
  if (probability !== undefined && probability >= 0.7 && probability < 0.9) {
    return { kind: "ask-human", reason: "System One 對這個動作的把握不足，請人工審核。" };
  }
  return { kind: "ask-human", reason: "System One 沒有提供足以放行的判斷。" };
}

/** 人類授權的類別；`paths` 已 realpath。 */
export interface CategoryGrant {
  readonly category: DelegatedCategory;
  readonly paths: readonly string[];
}
