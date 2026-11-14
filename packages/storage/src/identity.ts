import { readTextIfExists, writeFileAtomic, type FolderLayout } from "./paths.js";
import { StorageError } from "./errors.js";

/** 資料夾結構版本；和資料庫 schema 版本分開。 */
export const FOLDER_FORMAT_VERSION = 1;

/** `state/folder.json` 的內容。 */
export interface FolderIdentity {
  readonly format: number;
  readonly folderId: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export type FolderIdentityRead =
  | { readonly kind: "ok"; readonly identity: FolderIdentity }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly reason: string };

/** `state/folder.json` 的絕對路徑。 */
export function folderIdentityPath(layout: FolderLayout): string {
  return layout.absolute("state/folder.json");
}

/** 讀取資料夾身分；內容不合法時回 invalid，不拋錯。 */
export function readFolderIdentity(layout: FolderLayout): FolderIdentityRead {
  const raw = readTextIfExists(folderIdentityPath(layout));
  if (raw === null) {
    return { kind: "missing" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { kind: "invalid", reason: "not-json" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "invalid", reason: "not-object" };
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.format !== "number" ||
    typeof record.folderId !== "string" ||
    record.folderId.length === 0 ||
    typeof record.createdAt !== "string" ||
    typeof record.createdBy !== "string"
  ) {
    return { kind: "invalid", reason: "missing-fields" };
  }
  return {
    kind: "ok",
    identity: {
      format: record.format,
      folderId: record.folderId,
      createdAt: record.createdAt,
      createdBy: record.createdBy,
    },
  };
}

/** 原子寫入資料夾身分；`folder.json` 一定是最後一個建立的檔案。 */
export function writeFolderIdentity(layout: FolderLayout, identity: FolderIdentity): void {
  if (identity.format > FOLDER_FORMAT_VERSION) {
    throw new StorageError("folder-mismatch", "資料夾格式版本比程式新", {
      format: identity.format,
    });
  }
  writeFileAtomic(folderIdentityPath(layout), `${JSON.stringify(identity, null, 2)}\n`);
}
