import { accessSync, constants, existsSync, realpathSync } from "node:fs";
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
 * `tmp/`，最後把保護路徑與系統目錄蓋回去。讀取維持 `allow default`，只拒絕
 * 憑證路徑。
 */
export function buildSandboxProfile(options: SandboxProfileOptions): string {
  const workingDir = canonical(options.workingDir);
  const folderRoot = canonical(options.folderRoot);
  const homeDir = canonical(options.homeDir ?? homedir());
  const appBundlePath = canonical(options.appBundlePath ?? DEFAULT_APP_BUNDLE_PATH);

  const allowedWrites = [workingDir, join(folderRoot, "tmp")];
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
