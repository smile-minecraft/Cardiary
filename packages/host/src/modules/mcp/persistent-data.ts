/**
 * MCP 伺服器經核准後的持久資料目錄：`modules/mcp/<serverId>/`。
 *
 * 這個目錄是正本區的一部分，預設拒絕寫入；只有在人核准該伺服器的持久資料
 * 授權之後，stdio 沙盒才會額外放行這一個目錄（連同子目錄）。本模組集中處理
 * 路徑正規化、符號連結檢查、用量統計與移除，讓 MCP 模組和沙盒共用同一份
 * 防線。所有失敗都丟 `McpPersistentDirError`，呼叫端必須採 fail-closed
 * 的處理方式。
 */
import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { isMcpServerId } from "@cardiary/domain";
import { FolderLayout, removeTreeSafely } from "@cardiary/storage";

export interface McpPersistentDataUsage {
  /** 目錄內全部檔案的容量總和（bytes）。符號連結本身也計入。 */
  readonly bytes: number;
  /** 目錄內的檔案與符號連結數量；子目錄不計入。 */
  readonly files: number;
}

/** 持久資料目錄無法安全使用時丟出；呼叫端必須當成不能啟動或不授權。 */
export class McpPersistentDirError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpPersistentDirError";
  }
}

/** `modules/mcp/<serverId>` 的路徑；不建立目錄，只做字元與解析檢查。 */
export function mcpPersistentDirPath(folderRoot: string, serverId: string): string {
  if (!isMcpServerId(serverId)) {
    throw new McpPersistentDirError(`MCP 伺服器識別碼不安全：${serverId}`);
  }
  const root = realFolderRoot(folderRoot);
  return path.join(root, "modules", "mcp", serverId);
}

/**
 * 建立並驗證持久資料目錄；回傳驗證後的實際路徑。
 *
 * 檢查順序：先逐段 lstat `modules`、`modules/mcp`，任何一段是符號連結或
 * 不是目錄就拒絕（fail closed）；再建立目錄、再驗證一次整條鏈，最後確認
 * realpath 與預期的路徑一致。沙盒放行的路徑只會是這個結果。
 */
export function ensureMcpPersistentDir(folderRoot: string, serverId: string): string {
  const expected = mcpPersistentDirPath(folderRoot, serverId);
  assertDirectoryChain(path.dirname(expected));
  mkdirSync(expected, { recursive: true });
  assertDirectoryChain(expected);
  const real = realpathSync(expected);
  if (real !== expected) {
    throw new McpPersistentDirError(`持久資料目錄的路徑解析不一致：${real} ≠ ${expected}`);
  }
  return expected;
}

/** 目錄內的容量與檔案數；目錄不存在就回傳 0/0，不跟隨符號連結。 */
export function mcpPersistentDataUsage(
  folderRoot: string,
  serverId: string,
): McpPersistentDataUsage {
  if (!isMcpServerId(serverId)) {
    throw new McpPersistentDirError(`MCP 伺服器識別碼不安全：${serverId}`);
  }
  const layout = new FolderLayout(realFolderRoot(folderRoot));
  const absolute = layout.absolute(`modules/mcp/${serverId}`);
  if (!existsSync(absolute)) {
    return { bytes: 0, files: 0 };
  }
  let entries: ReturnType<FolderLayout["listTree"]>;
  try {
    entries = layout.listTree(absolute);
  } catch {
    return { bytes: 0, files: 0 };
  }
  let bytes = 0;
  let files = 0;
  for (const entry of entries) {
    if (entry.isDirectory) {
      continue;
    }
    bytes += entry.size;
    files += 1;
  }
  return { bytes, files };
}

/**
 * 刪除整個持久資料目錄；符號連結不跟隨、硬連結不刪。
 *
 * 目錄原本不存在時回傳 false，不算錯誤。任何殘留都丟 `McpPersistentDirError`：
 * 硬連結（`skippedHardLinks`）不能強刪，只能回報；FIFO／socket 這類特殊檔案
 * `removeTreeSafely` 也不會動，留著時 `rmdir` 失敗記成 `keptDirectories`；
 * 任何一項非零、或刪除後用 `lstat` 看目標仍存在，呼叫端都要發「MCP 持久資料目錄未刪除」通知。
 * 上層路徑出現符號連結時 `removeTreeSafely` 會丟出 `protected-path`，
 * 呼叫端要捕捉並只回報，不影響其他清理步驟。
 */
export function removeMcpPersistentDir(folderRoot: string, serverId: string): boolean {
  if (!isMcpServerId(serverId)) {
    throw new McpPersistentDirError(`MCP 伺服器識別碼不安全：${serverId}`);
  }
  const layout = new FolderLayout(realFolderRoot(folderRoot));
  const absolute = layout.absolute(`modules/mcp/${serverId}`);
  // 上層出現符號連結時 fail closed：丟出去讓呼叫端回報，不能靜靜回傳
  // 「不存在」讓人以為目錄沒留下。上層缺段（modules 還沒建）時照常
  // 回傳 false，不算錯誤。
  assertDirectoryChain(path.dirname(absolute));
  if (!existsSync(absolute) && !isSymbolicLink(absolute)) {
    return false;
  }
  const report = removeTreeSafely(layout, absolute, ["origin"]);
  // removeTreeSafely 不會動 nlink > 1 的硬連結，也會略過 FIFO／socket；
  // 兩種都留著時連 rmdir 都會失敗。這裡再用 lstat 確認目標真的消失，
  // 任何殘留都回報，不能回傳 true 讓人以為目錄刪乾淨了。
  let targetRemains = true;
  try {
    lstatSync(absolute);
  } catch {
    targetRemains = false;
  }
  if (report.skippedHardLinks > 0 || report.keptDirectories > 0 || targetRemains) {
    throw new McpPersistentDirError(
      `MCP 持久資料目錄未完全刪除：${absolute}` +
        `（硬連結保留 ${report.skippedHardLinks} 個、目錄保留 ${report.keptDirectories} 個` +
        `${targetRemains ? "，目標仍存在" : ""}）`,
    );
  }
  return true;
}

function realFolderRoot(folderRoot: string): string {
  try {
    return realpathSync(folderRoot);
  } catch (error) {
    throw new McpPersistentDirError(
      `MCP 資料夾 ${folderRoot} 無法解析：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertDirectoryChain(expected: string): void {
  const root = path.parse(expected).root;
  let current = root;
  for (const segment of path.relative(root, expected).split(path.sep)) {
    if (segment.length === 0) continue;
    current = path.join(current, segment);
    let stats;
    try {
      stats = lstatSync(current);
    } catch {
      // 尚未建立的部分交給 mkdir；最後會再驗一次整條鏈。
      break;
    }
    if (stats.isSymbolicLink()) {
      throw new McpPersistentDirError(`持久資料目錄的上層是符號連結，拒絕跟隨：${current}`);
    }
    if (!stats.isDirectory()) {
      throw new McpPersistentDirError(`持久資料目錄的上層不是目錄：${current}`);
    }
  }
}

function isSymbolicLink(target: string): boolean {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}
