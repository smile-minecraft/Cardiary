import path from "node:path";

import { matchCredentialPath } from "./credentials.js";
import {
  ORIGIN_ZONE_NAMES,
  detectCaseSensitivity,
  isWithin,
  isWithinFolded,
  originZoneOf,
  sameFile,
} from "./paths.js";
import type { CaseSensitivity } from "./paths.js";
import { PERMISSION_RULES } from "./rules.js";
import type { ResolvedPath } from "./types.js";
import { allow, askHuman, deny, maxRisk, type Risk } from "./verdict.js";
import type { PermissionVerdict } from "./types.js";

/** 檔案規則共用的根；`homeDir` 與 `appBundlePath` 用於 `deny.self-modify`。 */
export interface FsRuleContext {
  readonly folderRoot: string;
  readonly homeDir: string;
  readonly appBundlePath: string;
}

/** 代理自己的程式與服務資料；寫入一律拒絕。 */
export function isSelfModifyPath(
  resolved: string,
  context: FsRuleContext,
  sensitivity: CaseSensitivity = detectCaseSensitivity(resolved),
): boolean {
  const insensitive = sensitivity !== "case-sensitive";
  const within = (root: string): boolean =>
    insensitive ? isWithinFolded(root, resolved) : isWithin(root, resolved);
  const support = path.join(context.homeDir, "Library", "Application Support", "com.cardiary");
  if (
    within(context.appBundlePath) ||
    sameFile(resolved, context.appBundlePath) === true ||
    within(support) ||
    sameFile(resolved, support) === true
  ) {
    return true;
  }
  return false;
}

/**
 * 狀態資料庫、白名單、權限設定與 MCP 伺服器設定的儲存檔；代理不得直接改。
 *
 * `mcp-servers.json` 一定要在這裡：檔案裡的紀錄在下次啟動時會被主機直接
 * 執行（stdio 子行程或 HTTP 連線），寫得進去就等於繞過「新增 MCP 伺服器
 * 須人工審批」。它和其他受保護檔一樣，連「全部允許」與 System One 都
 * 不能放行。
 *
 * `external-agent-credentials.json` 存外部代理的登入權杖，代理一旦能讀寫
 * 就能取得憑證或竄改，因此同樣列名保護。
 */
const PROTECTED_STATE_FILES = [
  "cardiary.sqlite",
  "cardiary.sqlite-wal",
  "cardiary.sqlite-shm",
  "folder.json",
  "agent-permissions.json",
  "agent-audit.jsonl",
  "agent-audit.jsonl.1",
  "mcp-servers.json",
  "external-agent-credentials.json",
] as const;

/**
 * `resolved` 是否是狀態資料庫、白名單、權限設定、MCP 伺服器設定或
 * `folder.json`。
 *
 * 大小寫不敏感的卷上，路徑裡任何一段的大小寫不同都是同一個檔案；這裡一律
 * 折疊比對。大小寫敏感時改用精確比對加上 `dev`＋`ino` 比對，同一個 inode 的
 * 不同寫法仍然命中。`sensitivity` 可以注入，測試用它模擬兩種卷。
 */
export function isHumanSettingsPath(
  resolved: string,
  folderRoot: string,
  sensitivity: CaseSensitivity = detectCaseSensitivity(resolved),
): boolean {
  const insensitive = sensitivity !== "case-sensitive";
  const stateDir = path.join(folderRoot, "state");
  const within = insensitive ? isWithinFolded(stateDir, resolved) : isWithin(stateDir, resolved);
  if (within) {
    const name = path.basename(resolved);
    const candidate = insensitive ? name.toLowerCase() : name;
    if ((PROTECTED_STATE_FILES as readonly string[]).includes(candidate)) {
      return true;
    }
  }
  // 同一個 inode 的不同寫法（大小寫或 Unicode 正規化不同）也算保護目標。
  for (const name of PROTECTED_STATE_FILES) {
    if (sameFile(resolved, path.join(stateDir, name)) === true) {
      return true;
    }
  }
  return false;
}

/** `fs.read`／`fs.list` 的判定；`list` 用同一套分類，差別在 allow 的代號。 */
export function evaluateReadPath(
  resolved: ResolvedPath,
  context: FsRuleContext & { readonly list: boolean },
): PermissionVerdict {
  const credential = matchCredentialPath(resolved.resolved);
  if (credential !== null) {
    return deny(PERMISSION_RULES.credentials, `路徑命中憑證樣式（${credential}）`);
  }

  const sensitivity = detectCaseSensitivity(resolved.resolved);
  const insensitive = sensitivity !== "case-sensitive";
  const within = (root: string): boolean =>
    insensitive ? isWithinFolded(root, resolved.resolved) : isWithin(root, resolved.resolved);

  const stateDir = path.join(context.folderRoot, "state");
  const folderJson = path.join(stateDir, "folder.json");
  const sameFolderJson = insensitive
    ? resolved.resolved.toLowerCase() === folderJson.toLowerCase()
    : resolved.resolved === folderJson;
  if (sameFolderJson) {
    return context.list
      ? askHuman(PERMISSION_RULES.readState, "medium")
      : allow(PERMISSION_RULES.planRead);
  }
  if (within(stateDir)) {
    // `state/` 的資料庫與其他檔案不是給代理讀的介面（permissions.md 第 3.1 節）。
    return askHuman(PERMISSION_RULES.readState, "medium");
  }

  if (resolved.classification === "workspace" || resolved.classification === "folder") {
    return allow(PERMISSION_RULES.readWorkspace);
  }
  if (resolved.classification === "system") {
    return askHuman(PERMISSION_RULES.askFsRead, "medium");
  }
  return askHuman(PERMISSION_RULES.askFsRead, "low");
}

/**
 * `resolved` 是否落在 `<folder>/tmp/` 之內。
 *
 * 只有「已知大小寫敏感＋精確比對」與「已知不敏感＋折疊比對」才算放行邊界。
 * 敏感度未知時（例如目標本身是掛載點、翻不出可用的元件）不能假設 `TMP/` 與
 * `tmp/` 是同一個目錄，回 false 讓它走一般的詢問。
 */
export function isWithinTmpRoot(
  folderRoot: string,
  resolved: string,
  sensitivity: CaseSensitivity,
): boolean {
  if (sensitivity === "unknown") {
    return false;
  }
  const compare = sensitivity === "case-insensitive" ? isWithinFolded : isWithin;
  return compare(folderRoot, resolved) && compare(path.join(folderRoot, "tmp"), resolved);
}

/** `fs.write`／`fs.delete` 的判定；`delete` 另外套用正本區整批刪除的規則。 */
export function evaluateWritePath(
  resolved: ResolvedPath,
  context: FsRuleContext,
  operation: "write" | "delete",
  recursive = false,
): PermissionVerdict {
  const credential = matchCredentialPath(resolved.resolved);
  if (credential !== null) {
    return deny(PERMISSION_RULES.credentials, `路徑命中憑證樣式（${credential}）`);
  }

  if (isHumanSettingsPath(resolved.resolved, context.folderRoot)) {
    return deny(PERMISSION_RULES.humanSettings, "代理不得直接改狀態資料庫、白名單或 MCP 設定");
  }
  if (resolved.classification === "system") {
    return deny(PERMISSION_RULES.systemWrite, "路徑在系統目錄");
  }
  if (isSelfModifyPath(resolved.resolved, context)) {
    return deny(PERMISSION_RULES.selfModify, "路徑是 Cardiary 自己的程式或服務資料");
  }
  if (resolved.isSymlink) {
    // 寫入的目標本身是符號連結：一律拒絕。刪除只刪連結本身，但只有連結
    // 指向根之內時才放行；指向根之外的連結同樣是 deny.symlink-write。
    if (operation === "write" || resolved.classification === "external") {
      return deny(PERMISSION_RULES.symlinkWrite, "目標是符號連結，寫入與刪除不跟隨連結");
    }
  }
  if (resolved.changed && !resolved.insideWorkingDir && !resolved.insideFolderRoot) {
    // 經過符號連結之後離開兩個根：寫入與刪除一律拒絕（permissions.md 第 5 節）。
    return deny(PERMISSION_RULES.symlinkWrite, "解析後的路徑在允許的根之外");
  }

  const sensitivity = detectCaseSensitivity(resolved.resolved);
  const insensitive = sensitivity !== "case-sensitive";
  const samePath = (other: string): boolean =>
    insensitive
      ? resolved.resolved.toLowerCase() === other.toLowerCase()
      : resolved.resolved === other;

  if (operation === "delete") {
    const zone = originZoneOf(context.folderRoot, resolved.resolved);
    if (samePath(context.folderRoot)) {
      return deny(PERMISSION_RULES.zoneBulkDelete, "目標是 Cardiary 資料夾的根");
    }
    for (const name of ORIGIN_ZONE_NAMES) {
      if (samePath(path.join(context.folderRoot, name))) {
        return deny(PERMISSION_RULES.zoneBulkDelete, `目標是正本區的根（${name}）`);
      }
    }
    if (zone !== null && recursive) {
      return deny(PERMISSION_RULES.zoneBulkDelete, `遞迴刪除正本區（${zone}）的子路徑`);
    }
  }

  if (resolved.hardLinkCount > 1) {
    // 同一個 inode 可能也在根之外；不自動放行。
    return askHuman(PERMISSION_RULES.hardLinkWrite, "high");
  }

  if (isWithinTmpRoot(context.folderRoot, resolved.resolved, sensitivity)) {
    return allow(PERMISSION_RULES.tmpWrite);
  }

  const risk: Risk =
    resolved.classification === "workspace" || resolved.classification === "folder"
      ? "medium"
      : "high";
  return operation === "write"
    ? askHuman(PERMISSION_RULES.askFsWrite, risk)
    : askHuman(PERMISSION_RULES.askFsDelete, risk);
}

/** 指令重導向的目標：寫入語意，但 `/dev/null` 不算。 */
export function evaluateRedirectTarget(
  resolved: ResolvedPath,
  context: FsRuleContext,
  operator: "read" | "write",
): PermissionVerdict {
  if (resolved.resolved === "/dev/null") {
    return allow(PERMISSION_RULES.tmpWrite);
  }
  return operator === "write"
    ? evaluateWritePath(resolved, context, "write")
    : evaluateReadPath(resolved, { ...context, list: false });
}

export { maxRisk };
