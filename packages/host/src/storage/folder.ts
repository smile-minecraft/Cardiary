import { constants } from "node:fs";
import { access, lstat, readFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";

import type { FolderIdentity } from "./interfaces.js";

export type FolderProblem =
  | "path_not_absolute"
  | "missing"
  | "not_directory"
  | "symlink"
  | "not_writable"
  | "no_identity"
  | "invalid_identity"
  | "mismatch";

export class FolderError extends Error {
  readonly reason: FolderProblem;

  constructor(reason: FolderProblem, message: string) {
    super(message);
    this.name = "FolderError";
    this.reason = reason;
  }
}

interface FolderFile {
  readonly format: number;
  readonly folderId: string;
}

async function readIdentity(path: string): Promise<FolderFile> {
  let raw: string;
  try {
    raw = await readFile(join(path, "state", "folder.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FolderError("no_identity", "資料夾沒有 state/folder.json");
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FolderError("invalid_identity", "state/folder.json 不是合法 JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new FolderError("invalid_identity", "state/folder.json 不是物件");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.folderId !== "string" || record.folderId.length === 0) {
    throw new FolderError("invalid_identity", "state/folder.json 缺少 folderId");
  }
  if (typeof record.format !== "number") {
    throw new FolderError("invalid_identity", "state/folder.json 缺少 format");
  }
  return { format: record.format, folderId: record.folderId };
}

/**
 * 只讀地驗證資料夾身分：不建立目錄、不寫任何檔案。
 *
 * 建立與修復資料夾是儲存套件的工作；主機服務在資料夾不可用時直接以退出碼 2
 * 結束，不簽發任何序號。
 */
export async function readFolderIdentity(
  path: string,
  options?: { readonly expectedFolderId?: string },
): Promise<FolderIdentity> {
  if (!isAbsolute(path)) {
    throw new FolderError("path_not_absolute", "資料夾路徑必須是絕對路徑");
  }
  let stats;
  try {
    stats = await lstat(path);
  } catch {
    throw new FolderError("missing", "資料夾不存在");
  }
  if (stats.isSymbolicLink()) {
    throw new FolderError("symlink", "資料夾路徑是符號連結");
  }
  if (!stats.isDirectory()) {
    throw new FolderError("not_directory", "路徑不是資料夾");
  }
  try {
    await access(path, constants.W_OK);
  } catch {
    throw new FolderError("not_writable", "資料夾不可寫");
  }
  const identity = await readIdentity(path);
  if (options?.expectedFolderId !== undefined && options.expectedFolderId !== identity.folderId) {
    throw new FolderError("mismatch", "資料夾的 folderId 與預期不同");
  }
  return {
    path,
    folderId: identity.folderId,
    displayName: basename(path),
    writable: true,
  };
}
