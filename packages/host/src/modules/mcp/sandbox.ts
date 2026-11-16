/**
 * stdio MCP 伺服器的 Seatbelt。
 *
 * `sandbox-exec` 只能表達「全部允許網路／全部拒絕網路」，沒有逐網域的
 * 過濾器，所以 stdio 伺服器一律 `(deny network*)`。需要外連的場景改用
 * HTTP 傳輸，由主机逐次比對重新導向後的 host；兩者都不能生效時不啟動。
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  buildSandboxProfile,
  createCommandSandbox,
  SANDBOX_EXEC_PATH,
  type CommandSandbox,
  type SandboxProfileOptions,
} from "../../permissions/sandbox.js";

export interface McpStdioSandboxOptions extends SandboxProfileOptions {
  readonly folderRoot: string;
  readonly serverId: string;
}

/** 建立只寫自己暫存目錄、完全不能碰網路的沙盒；不支援時回 `null`。 */
export function createMcpStdioSandbox(options: McpStdioSandboxOptions): CommandSandbox | null {
  if (process.platform !== "darwin" || !existsSync(SANDBOX_EXEC_PATH)) {
    return null;
  }
  const workingDir = path.join(options.folderRoot, "tmp", "mcp", options.serverId);
  mkdirSync(workingDir, { recursive: true });
  const base = createCommandSandbox({
    ...options,
    workingDir,
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
    ...options,
    workingDir: path.join(options.folderRoot, "tmp", "mcp", options.serverId),
  });
  return `${base}\n; MCP stdio 一律不給網路\n(deny network*)\n`;
}
