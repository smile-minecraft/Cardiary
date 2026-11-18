import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  readdirSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { DEFAULT_APP_BUNDLE_PATH } from "@cardiary/domain";

/** `sandbox-exec` 的固定位置；產品只支援 macOS。 */
export const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

/** `run_command` 啟動子行程時使用的作業系統沙盒。 */
export interface CommandSandbox {
  readonly executable: string;
  readonly profile: string;
}

export interface SandboxProfileOptions {
  /** 已 realpath 或即將正規化的工作目錄。 */
  readonly workingDir: string;
  /** Cardiary 資料夾；正本區由它推出。 */
  readonly folderRoot: string;
  /** 家目錄；預設 `os.homedir()`。 */
  readonly homeDir?: string;
  /** App bundle；預設 `/Applications/Cardiary.app`。 */
  readonly appBundlePath?: string;
  /**
   * 外部代理專屬：代理的家目錄（`cache/agents/<session>`）。這個目錄允許
   * 寫入，但正本區仍然拒絕。沙盒不可用時呼叫端必須拒絕啟動。
   */
  readonly agentHomeDir?: string;
  /** 外部代理專屬：額外允許寫入的目錄（例如代理自己的暫存目錄）。 */
  readonly extraWritableDirs?: readonly string[];
  /**
   * 額外允許寫入的目錄，規則是「後面的規則覆蓋前面的」：這裡的放行排在
   * 正本區的拒絕之後，所以只會蓋過被拒絕的 `modules/` 子路徑，不放寬其他
   * 正本區。呼叫端必須先確認路徑已經過 realpath 與符號連結檢查。
   */
  readonly persistentWritableDirs?: readonly string[];
}

/**
 * 憑證檔名樣式（POSIX ERE，比對整條路徑）。
 *
 * 與 `packages/domain/src/permissions/credentials.ts` 的清單一致，再加上
 * `auth.json` 與 `credentials*`。只拒絕讀內容，不拒絕 `stat`，讓 `git status`
 * 不會因為工作目錄裡有一個 `*.key` 就整條失敗。
 */
const CREDENTIAL_FILE_REGEX = [
  "^(.*/)?(",
  "(\\.env(\\..*)?)",
  "|([^/]+\\.env)",
  "|([^/]+\\.(pem|key|p12|pfx|jks|keystore))",
  "|(id_(rsa|ed25519|ecdsa|dsa).*)",
  "|(\\.netrc)",
  "|(\\.npmrc)",
  "|(\\.pypirc)",
  "|(Cookies)",
  "|(Login Data.*)",
  "|(Local State)",
  "|(keychain.*)",
  "|([^/]+\\.keychain-db)",
  "|(credentials.*)",
  "|(secrets\\.(json|ya?ml))",
  "|(auth\\.json)",
  ")$",
].join("");

/** 正本區的子目錄；`run_command` 即使被允許也不能寫。 */
const PROTECTED_FOLDERS = ["state", "cards", "assets", "boards", "skills", "modules"] as const;

/**
 * 系統目錄；寫入一律拒絕（全域的 deny 已涵蓋，這裡是 defense in depth）。
 *
 * `/var` 與 `/private/var` 不放進來：測試與暫存資料夾就在 `/private/var/folders`，
 * 而權限設計把 `/var/folders` 排除在系統目錄之外（`permissions.md` 第 2 節）。
 */
const SYSTEM_FOLDERS = ["/System", "/Library", "/usr", "/bin", "/sbin", "/etc", "/private/etc"];

/** 敏感讀取：整個目錄都不給讀（含 metadata）。 */
const SENSITIVE_FOLDERS = [".ssh", ".aws", ".gnupg"] as const;

/** 敏感讀取：單一檔案。 */
const SENSITIVE_FILES = [".netrc", ".npmrc", ".pypirc"] as const;

/**
 * 受保護 inode 的別名：存在於可寫入區、卻和 `state/**` 的某個一般檔案共用
 * inode。SBPL 只看路徑，這種別名能繞過寫入保護，所以要在啟動前擋下。
 */
export interface ProtectedAlias {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
}

/** 別名掃描本身失敗（例如目錄讀不出來）；呼叫端必須 fail-closed。 */
export class ProtectedAliasScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtectedAliasScanError";
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function describeStatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inodeKey(stat: Stats): string {
  return `${stat.dev}:${stat.ino}`;
}

/**
 * 只走一般檔案：遇到符號連結不跟隨，遇到讀不出來的目錄 fail-closed。
 *
 * `missingOk` 讓不存在的根目錄或競態消失的項目跳過；兩者都不是別名。
 */
function walkRegularFiles(
  root: string,
  onFile: (path: string, stat: Stats) => void,
  missingOk: boolean,
): void {
  let stat: Stats;
  try {
    stat = lstatSync(root);
  } catch (error) {
    if (missingOk && isMissing(error)) return;
    throw new ProtectedAliasScanError(`無法檢查路徑 ${root}：${describeStatError(error)}`);
  }
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    onFile(root, stat);
    return;
  }
  if (!stat.isDirectory()) return;

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (error) {
    if (missingOk && isMissing(error)) return;
    throw new ProtectedAliasScanError(`無法讀取目錄 ${root}：${describeStatError(error)}`);
  }
  for (const entry of entries) {
    walkRegularFiles(join(root, entry), onFile, true);
  }
}

/**
 * 找出 `workingDir` 與 `<folderRoot>/tmp` 底下指向 `<folderRoot>/state/**`
 * 一般檔案的硬連結別名。
 *
 * 先對 state 做一次 inode 集合，再線性掃描可寫入區；只用 `lstat`，不跟隨符號
 * 連結。state 不存在代表沒有保護檔案；任何讀取失敗都丟
 * `ProtectedAliasScanError`，讓呼叫端 fail-closed，不要假裝掃描通過。
 *
 * 這是啟動前的快照：SBPL 只比對路徑，硬連結從可寫入的別名寫入可以繞過寫入
 * 保護，所以先掃掉已存在的別名。掃描完成到 `sandbox-exec` 啟動子行程之間仍有
 * 競爭危害，這段空窗攔不住新建立的別名；後果由核准綁定吸收：正本一旦被別名
 * 改寫，啟動前與核准紀錄的內容比對就會失敗，伺服器照樣不啟動。
 */
export function findProtectedAliases(options: {
  readonly workingDir: string;
  readonly folderRoot: string;
  /** 其他可寫入的根目錄（例如經核准的持久資料目錄）。 */
  readonly extraScanRoots?: readonly string[];
}): ProtectedAlias[] {
  const stateInodes = new Set<string>();
  walkRegularFiles(
    join(options.folderRoot, "state"),
    (_path, stat) => stateInodes.add(inodeKey(stat)),
    true,
  );
  if (stateInodes.size === 0) return [];

  const aliases: ProtectedAlias[] = [];
  const seen = new Set<string>();
  const collect = (path: string, stat: Stats): void => {
    if (stat.nlink <= 1 || !stateInodes.has(inodeKey(stat)) || seen.has(path)) return;
    seen.add(path);
    aliases.push({ path, dev: stat.dev, ino: stat.ino });
  };
  // workingDir 通常在 tmp 底下，兩處都掃並用路徑去重，兼具通用性。
  walkRegularFiles(options.workingDir, collect, true);
  walkRegularFiles(join(options.folderRoot, "tmp"), collect, true);
  for (const root of options.extraScanRoots ?? []) {
    walkRegularFiles(root, collect, true);
  }
  return aliases;
}

/**
 * 建立 `run_command` 的 sandbox；平台不支援或 `sandbox-exec` 不可用時回
 * `null`。呼叫端必須把 `null` 當成「不能執行指令」，不能退回無沙盒的執行。
 */
export function createCommandSandbox(options: SandboxProfileOptions): CommandSandbox | null {
  if (process.platform !== "darwin" || !existsSync(SANDBOX_EXEC_PATH)) {
    return null;
  }
  try {
    accessSync(SANDBOX_EXEC_PATH, constants.X_OK);
  } catch {
    return null;
  }
  return { executable: SANDBOX_EXEC_PATH, profile: buildSandboxProfile(options) };
}

/**
 * 產生 Seatbelt profile。
 *
 * 規則是後面的規則覆蓋前面的：先預設拒絕寫入，再放行工作目錄與資料夾的
 * `tmp/`，再把保護路徑與系統目錄蓋回去，最後放行呼叫端指定的持久資料目錄
 * （只蓋過 `modules/` 子路徑）。讀取維持 `allow default`，只拒絕憑證路徑。
 */
export function buildSandboxProfile(options: SandboxProfileOptions): string {
  const workingDir = canonical(options.workingDir);
  const folderRoot = canonical(options.folderRoot);
  const homeDir = canonical(options.homeDir ?? homedir());
  const appBundlePath = canonical(options.appBundlePath ?? DEFAULT_APP_BUNDLE_PATH);

  const agentHome = options.agentHomeDir ? canonical(options.agentHomeDir) : null;
  const allowedWrites = [
    workingDir,
    join(folderRoot, "tmp"),
    ...(agentHome ? [agentHome] : []),
    ...(options.extraWritableDirs ?? []).map(canonical),
  ];
  const persistentWrites = (options.persistentWritableDirs ?? []).map(canonical);
  const protectedWrites = [
    ...PROTECTED_FOLDERS.map((name) => join(folderRoot, name)),
    ...SYSTEM_FOLDERS,
    appBundlePath,
    join(homeDir, "Library", "Application Support", "com.cardiary"),
  ];
  const protectedFiles = [join(folderRoot, "folder.json")];
  const sensitiveReads = [
    ...SENSITIVE_FOLDERS.map((name) => join(homeDir, name)),
    join(homeDir, "Library", "Keychains"),
    "/Library/Keychains",
    ...SENSITIVE_FILES.map((name) => join(homeDir, name)),
    join(homeDir, ".config", "gh", "hosts.yml"),
  ];

  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* ${allowedWrites.map((path) => subpath(path)).join(" ")})`,
    '(allow file-write-data (literal "/dev/null"))',
    `(deny file-write* ${[...protectedWrites.map((path) => subpath(path)), ...protectedFiles.map((path) => literal(path))].join(" ")})`,
    ...(persistentWrites.length === 0
      ? []
      : [`(allow file-write* ${persistentWrites.map((path) => subpath(path)).join(" ")})`]),
    `(deny file-read* ${sensitiveReads.map((path) => subpath(path)).join(" ")})`,
    `(deny file-read-data file-read-xattr (regex ${quote(CREDENTIAL_FILE_REGEX)}))`,
    "",
  ].join("\n");
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function subpath(path: string): string {
  return `(subpath ${quote(path)})`;
}

function literal(path: string): string {
  return `(literal ${quote(path)})`;
}

/** SBPL 字串：跳脫反斜線與雙引號，其他字元原樣保留。 */
function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
