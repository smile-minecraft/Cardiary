import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  rmdirSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { StorageError } from "./errors.js";
import { byteLength } from "./util.js";

/** 根資料夾的九個子資料夾；順序就是建立順序。 */
export const SUBFOLDERS = [
  "cards",
  "assets",
  "boards",
  "skills",
  "state",
  "modules",
  "cache",
  "tmp",
  "logs",
] as const;

export type Subfolder = (typeof SUBFOLDERS)[number];

/** 正本區的子資料夾；只在初始化時建立，之後不見了就是 mismatch。 */
export const ORIGINAL_SUBFOLDERS = [
  "cards",
  "assets",
  "boards",
  "skills",
  "state",
  "modules",
] as const;

/** 可以自動重建的資料夾。 */
export const RECREATABLE_SUBFOLDERS = ["cache", "tmp", "logs"] as const;

export type Zone = "origin" | "cache" | "tmp" | "logs";

const ZONE_BY_SUBFOLDER: Readonly<Record<Subfolder, Zone>> = {
  cards: "origin",
  assets: "origin",
  boards: "origin",
  skills: "origin",
  state: "origin",
  modules: "origin",
  cache: "cache",
  tmp: "tmp",
  logs: "logs",
};

/** 路徑長度上限（bytes）；避免回收時 `ENAMETOOLONG`。 */
export const MAX_RELATIVE_PATH_BYTES = 1024;

/** APFS 的 `statfs.type` 值。 */
export const APFS_FILESYSTEM_TYPE = 0x1a;

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;

/**
 * 驗證並正規化內部相對路徑。
 *
 * 一律使用 POSIX `/`；回傳 NFC 正規化後的字串。違反規則時丟 `invalid-path`。
 */
export function validateRelativePath(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new StorageError("invalid-path", "路徑不能是空字串", { input });
  }
  if (input.includes("\0")) {
    throw new StorageError("invalid-path", "路徑不能含 NUL", { input });
  }
  const normalized = input.normalize("NFC");
  if (byteLength(normalized) > MAX_RELATIVE_PATH_BYTES) {
    throw new StorageError("invalid-path", "路徑超過 1024 bytes", {
      bytes: byteLength(normalized),
    });
  }
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    normalized.startsWith("\\") ||
    WINDOWS_DRIVE.test(normalized)
  ) {
    throw new StorageError("invalid-path", "路徑必須是相對於根資料夾的 POSIX 路徑", {
      input: normalized,
    });
  }
  if (normalized.includes("\\")) {
    throw new StorageError("invalid-path", "路徑不能含反斜線", { input: normalized });
  }
  const segments = normalized.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new StorageError("invalid-path", "路徑不能有空段、`.` 或 `..`", { input: normalized });
    }
  }
  return normalized;
}

/** 回傳相對路徑所屬的區域；第一段不是九個子資料夾時回 null。 */
export function zoneForRelativePath(relativePath: string): Zone | null {
  const [first] = relativePath.split("/");
  if (first === undefined || !(first in ZONE_BY_SUBFOLDER)) {
    return null;
  }
  return ZONE_BY_SUBFOLDER[first as Subfolder];
}

export interface RemoveFileResult {
  readonly removed: boolean;
  readonly reason?: "symlink" | "hard-link" | "directory" | "missing" | "special";
}

export interface RemoveTreeReport {
  readonly removedFiles: number;
  readonly removedLinks: number;
  readonly skippedHardLinks: number;
  readonly keptDirectories: number;
}

export interface TreeEntry {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly size: number;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly linkCount: number;
  readonly modifiedAtMs: number;
}

export interface FolderLayoutOptions {
  readonly statfs?: (path: string) => { type: number };
}

/**
 * 資料夾配置與路徑解析。
 *
 * 所有刪除都必須經過 `assertDeletable`：只允許快取、暫存與日誌區，
 * 且解析後的絕對路徑必須在根資料夾內。
 */
export class FolderLayout {
  readonly root: string;
  readonly displayName: string;
  readonly #statfs: (path: string) => { type: number };

  constructor(root: string, options: FolderLayoutOptions = {}) {
    if (typeof root !== "string" || root.trim() === "") {
      throw new StorageError("invalid-folder-root", "資料夾路徑不能是空字串");
    }
    if (!path.isAbsolute(root)) {
      throw new StorageError("invalid-folder-root", "資料夾路徑必須是絕對路徑", { root });
    }
    const resolved = path.resolve(root);
    if (resolved === path.parse(resolved).root) {
      throw new StorageError("invalid-folder-root", "資料夾路徑不能是檔案系統根目錄", { root });
    }
    this.root = resolved;
    this.displayName = path.basename(resolved);
    this.#statfs = options.statfs ?? ((target) => statfsSync(target));
  }

  /** 根資料夾目前是否存在且是目錄。 */
  get exists(): boolean {
    if (!existsSync(this.root)) {
      return false;
    }
    try {
      return lstatSync(this.root).isDirectory();
    } catch {
      return false;
    }
  }

  /** 九個子資料夾的絕對路徑。 */
  subfolderPath(name: Subfolder): string {
    return path.join(this.root, name);
  }

  /** 解析內部相對路徑；前後各驗一次，避免路徑穿越。 */
  absolute(relativePath: string): string {
    const normalized = validateRelativePath(relativePath);
    if (zoneForRelativePath(normalized) === null) {
      throw new StorageError("invalid-path", "路徑必須位於九個子資料夾之一", {
        relativePath: normalized,
      });
    }
    const absolutePath = path.join(this.root, ...normalized.split("/"));
    this.assertInside(absolutePath);
    return absolutePath;
  }

  /** 刪除前使用；只允許快取、暫存與日誌區。 */
  assertDeletable(
    absolutePath: string,
    allowedZones: readonly Zone[] = ["cache", "tmp", "logs"],
  ): string {
    const relativePath = this.relative(absolutePath);
    if (relativePath === "") {
      throw new StorageError("protected-path", "不能刪除根資料夾", { absolutePath });
    }
    const zone = zoneForRelativePath(relativePath);
    if (zone === null || !allowedZones.includes(zone)) {
      throw new StorageError("protected-path", "路徑不在允許刪除的區域", {
        relativePath,
        zone,
        allowedZones,
      });
    }
    return relativePath;
  }

  /** 登記簿只接受快取與暫存區的路徑。 */
  assertRegistryPath(relativePath: string): string {
    const normalized = validateRelativePath(relativePath);
    const zone = zoneForRelativePath(normalized);
    if (zone !== "cache" && zone !== "tmp") {
      throw new StorageError("invalid-path", "只有快取與暫存區的檔案需要登記", {
        relativePath: normalized,
      });
    }
    return normalized;
  }

  /** 確認絕對路徑在根資料夾內（含根本身）。 */
  assertInside(absolutePath: string): void {
    const resolved = path.resolve(absolutePath);
    if (resolved !== this.root && !resolved.startsWith(`${this.root}${path.sep}`)) {
      throw new StorageError("path-outside-root", "路徑在根資料夾之外", {
        absolutePath: resolved,
        root: this.root,
      });
    }
  }

  /** 把絕對路徑轉成內部相對路徑；根本身回空字串。 */
  relative(absolutePath: string): string {
    const resolved = path.resolve(absolutePath);
    this.assertInside(resolved);
    if (resolved === this.root) {
      return "";
    }
    return path.relative(this.root, resolved).split(path.sep).join("/");
  }

  /** 根資料夾所在的檔案系統是不是 APFS。 */
  isApfs(): boolean {
    return this.#statfs(this.root).type === APFS_FILESYSTEM_TYPE;
  }

  /** 遞迴列出區域內的檔案與連結；不跟隨符號連結。 */
  listTree(absoluteDirectory: string): TreeEntry[] {
    const base = this.relative(absoluteDirectory);
    const entries: TreeEntry[] = [];
    const walk = (currentRelative: string): void => {
      const absolute = currentRelative === "" ? absoluteDirectory : this.absolute(currentRelative);
      const dirents = readdirSync(absolute, { withFileTypes: true });
      for (const dirent of dirents) {
        const childRelative =
          currentRelative === "" ? dirent.name : `${currentRelative}/${dirent.name}`;
        const childAbsolute = this.absolute(childRelative);
        const stats = lstatSync(childAbsolute);
        entries.push({
          relativePath: childRelative,
          absolutePath: childAbsolute,
          size: stats.size,
          isDirectory: stats.isDirectory() && !stats.isSymbolicLink(),
          isSymbolicLink: stats.isSymbolicLink(),
          linkCount: stats.nlink,
          modifiedAtMs: stats.mtimeMs,
        });
        if (stats.isDirectory() && !stats.isSymbolicLink()) {
          walk(childRelative);
        }
      }
    };
    if (base !== "") {
      this.assertInside(absoluteDirectory);
    }
    walk(base);
    return entries;
  }
}

/** 刪除單一檔案；符號連結只刪連結本身，硬連結不刪。 */
export function removeFileSafely(
  layout: FolderLayout,
  absolutePath: string,
  allowedZones: readonly Zone[] = ["cache", "tmp", "logs"],
): RemoveFileResult {
  layout.assertDeletable(absolutePath, allowedZones);
  let stats;
  try {
    stats = lstatSync(absolutePath);
  } catch {
    return { removed: false, reason: "missing" };
  }
  if (stats.isSymbolicLink()) {
    unlinkSync(absolutePath);
    return { removed: true, reason: "symlink" };
  }
  if (stats.isDirectory()) {
    return { removed: false, reason: "directory" };
  }
  if (!stats.isFile()) {
    return { removed: false, reason: "special" };
  }
  if (stats.nlink > 1) {
    return { removed: false, reason: "hard-link" };
  }
  unlinkSync(absolutePath);
  return { removed: true };
}

/** 遞迴刪除整個目錄；符號連結不跟隨、硬連結不刪。 */
export function removeTreeSafely(
  layout: FolderLayout,
  absoluteDirectory: string,
  allowedZones: readonly Zone[] = ["cache", "tmp", "logs"],
): RemoveTreeReport {
  layout.assertDeletable(absoluteDirectory, allowedZones);
  const report = { removedFiles: 0, removedLinks: 0, skippedHardLinks: 0, keptDirectories: 0 };
  const walk = (absolute: string): void => {
    const dirents = readdirSync(absolute, { withFileTypes: true });
    for (const dirent of dirents) {
      const child = path.join(absolute, dirent.name);
      const stats = lstatSync(child);
      if (stats.isSymbolicLink()) {
        unlinkSync(child);
        report.removedLinks += 1;
        continue;
      }
      if (stats.isDirectory()) {
        walk(child);
        try {
          rmdirSync(child);
        } catch {
          report.keptDirectories += 1;
        }
        continue;
      }
      if (stats.isFile() && stats.nlink === 1) {
        unlinkSync(child);
        report.removedFiles += 1;
        continue;
      }
      if (stats.isFile()) {
        report.skippedHardLinks += 1;
      }
    }
  };
  walk(absoluteDirectory);
  try {
    rmdirSync(absoluteDirectory);
  } catch {
    report.keptDirectories += 1;
  }
  return report;
}

/** 清空一個區域目錄的內容，但保留目錄本身。 */
export function clearDirectorySafely(
  layout: FolderLayout,
  absoluteDirectory: string,
  allowedZones: readonly Zone[] = ["cache", "tmp", "logs"],
): RemoveTreeReport {
  layout.assertDeletable(absoluteDirectory, allowedZones);
  const report = { removedFiles: 0, removedLinks: 0, skippedHardLinks: 0, keptDirectories: 0 };
  for (const dirent of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const child = path.join(absoluteDirectory, dirent.name);
    const stats = lstatSync(child);
    if (stats.isSymbolicLink()) {
      unlinkSync(child);
      report.removedLinks += 1;
      continue;
    }
    if (stats.isDirectory()) {
      const sub = removeTreeSafely(layout, child, allowedZones);
      report.removedFiles += sub.removedFiles;
      report.removedLinks += sub.removedLinks;
      report.skippedHardLinks += sub.skippedHardLinks;
      continue;
    }
    if (stats.isFile() && stats.nlink === 1) {
      unlinkSync(child);
      report.removedFiles += 1;
      continue;
    }
    if (stats.isFile()) {
      report.skippedHardLinks += 1;
    }
  }
  return report;
}

/** 以 `O_NOFOLLOW` 開檔讀取；符號連結會直接失敗。 */
export function readFileNoFollow(absolutePath: string): Buffer {
  const fd = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) {
      throw new StorageError("invalid-path", "不是一般檔案", { absolutePath });
    }
    const buffer = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < buffer.length) {
      const bytes = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (bytes === 0) {
        break;
      }
      offset += bytes;
    }
    return buffer.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

/** 建立缺少的子資料夾；已存在但型別不對時丟錯。 */
export function ensureSubfolders(layout: FolderLayout, names: readonly Subfolder[]): void {
  for (const name of names) {
    const target = layout.subfolderPath(name);
    if (existsSync(target)) {
      if (!lstatSync(target).isDirectory()) {
        throw new StorageError("folder-mismatch", `子資料夾不是目錄：${name}`, { name });
      }
      continue;
    }
    mkdirSync(target);
  }
}

/** 根資料夾是否只有空目錄（或完全沒有東西）。 */
export function isEffectivelyEmpty(root: string): boolean {
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      return false;
    }
    if (readdirSync(path.join(root, dirent.name)).length > 0) {
      return false;
    }
  }
  return true;
}

/** 原子寫入資料夾身分檔；先寫暫存檔再 rename。 */
export function writeFileAtomic(absolutePath: string, content: string): void {
  const temporary = `${absolutePath}.tmp-${process.pid}`;
  writeFileSync(temporary, content, { encoding: "utf8", flag: "w" });
  renameSync(temporary, absolutePath);
}

/** 讀取文字檔；不存在時回 null。 */
export function readTextIfExists(absolutePath: string): string | null {
  if (!existsSync(absolutePath)) {
    return null;
  }
  return readFileSync(absolutePath, "utf8");
}
