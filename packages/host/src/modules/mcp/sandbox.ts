/**
 * stdio MCP 伺服器的 Seatbelt。
 *
 * `sandbox-exec` 只能表達「全部允許網路／全部拒絕網路」，沒有逐網域的
 * 過濾器，所以 stdio 伺服器一律 `(deny network*)`。需要外連的場景改用
 * HTTP 傳輸，由主机連線並限制 host，重新導向重新檢查。沙盒或網路限制
 * 無法生效時，該伺服器不啟動（fail closed）。
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  findProtectedAliases,
  buildSandboxProfile,
  createCommandSandbox,
  SANDBOX_EXEC_PATH,
  type CommandSandbox,
  type SandboxProfileOptions,
} from "../../permissions/sandbox.js";

export interface McpStdioSandboxOptions extends Omit<SandboxProfileOptions, "workingDir"> {
  readonly folderRoot: string;
  readonly serverId: string;
}

/**
 * 可寫入區出現指向 state 正本的硬連結別名。
 *
 * SBPL 只看路徑，擋不到 inode 別名；與其讓沙盒帶著這個缺口啟動，不如丟出
 * 可辨識的錯誤，讓 MCP 模組把伺服器標成 failed 並顯示原因。
 */
export class ProtectedAliasError extends Error {
  readonly paths: readonly string[];

  constructor(paths: readonly string[]) {
    const listing = paths.map((entry) => path.basename(entry)).join("、");
    super(`可寫入區出現指向 state 正本的硬連結（${listing}），伺服器不啟動`);
    this.name = "ProtectedAliasError";
    this.paths = paths;
  }
}

/**
 * 建立只寫自己暫存目錄、完全不能碰網路的沙盒；不支援時回 `null`。
 *
 * 建立 profile 前先檢查硬連結別名與掃描是否成功；兩者都屬於 fail-closed，
 * 擋下時丟 `ProtectedAliasError`，不會退回沒有沙盒的執行。
 *
 * 別名掃描是啟動前的快照，而 SBPL 只比對路徑：掃描後到 `sandbox-exec` 啟動
 * 之間就算冒出新的別名，正本被改寫仍會讓啟動前與核准紀錄的內容比對失敗，
 * 伺服器不會啟動，殘留的競爭危害因此由核准綁定吸收。
 */
export function createMcpStdioSandbox(options: McpStdioSandboxOptions): CommandSandbox | null {
  const workingDir = path.join(options.folderRoot, "tmp", "mcp", options.serverId);
  const aliases = findProtectedAliases({ workingDir, folderRoot: options.folderRoot });
  if (aliases.length > 0) {
    throw new ProtectedAliasError(aliases.map((entry) => entry.path));
  }
  if (process.platform !== "darwin" || !existsSync(SANDBOX_EXEC_PATH)) {
    return null;
  }
  mkdirSync(workingDir, { recursive: true });
  const base = createCommandSandbox({
    folderRoot: options.folderRoot,
    workingDir,
    ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
    ...(options.appBundlePath === undefined ? {} : { appBundlePath: options.appBundlePath }),
  });
  if (base === null) {
    return null;
  }
  return {
    executable: base.executable,
    profile: `${base.profile}\n; MCP stdio 一律不給網路\n(deny network*)\n`,
  };
}

/** 測試與文件用的 profile 產生器；與實際啟動使用的規則同源。 */
export function buildMcpStdioProfile(options: McpStdioSandboxOptions): string {
  const base = buildSandboxProfile({
    folderRoot: options.folderRoot,
    workingDir: path.join(options.folderRoot, "tmp", "mcp", options.serverId),
    ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
    ...(options.appBundlePath === undefined ? {} : { appBundlePath: options.appBundlePath }),
  });
  return `${base}\n; MCP stdio 一律不給網路\n(deny network*)\n`;
}
