import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";

import { StorageError } from "../errors.js";
import { readFileNoFollow, removeFileSafely, type FolderLayout } from "../paths.js";
import { isCardFileName } from "./files.js";

/** `assets/<sha256>.<副檔名>`；同內容不同副檔名算不同檔案。 */
const ASSET_FILE = /^([0-9a-f]{64})\.[a-z0-9]{1,12}$/i;
/** 卡片檔裡的雜湊；大小寫都算。 */
const HASH_TOKEN = /[0-9a-f]{64}/g;

export interface AssetFile {
  readonly assetId: string;
  readonly path: string;
}

export interface RemoveAssetFilesResult {
  /** 已刪除或本來就不存在的檔案數。 */
  readonly removed: number;
  /** 還在的檔案數；硬連結與目錄不刪。 */
  readonly kept: number;
}

/**
 * `assets/` 底下所有可刪的原檔；同內容不同副檔名會有多個。
 *
 * 只看一般檔案：符號連結不算原檔。資料夾不存在時回空陣列，其他讀取
 * 錯誤丟 `storage-failed`，呼叫端才知道回收沒有完成。
 */
export function listAssetFiles(layout: FolderLayout): AssetFile[] {
  const directory = layout.subfolderPath("assets");
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw new StorageError("storage-failed", "列出原檔資料夾失敗", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const inventory: AssetFile[] = [];
  for (const name of names) {
    const match = ASSET_FILE.exec(name);
    if (match === null) continue;
    const target = path.join(directory, name);
    try {
      const stats = lstatSync(target);
      if (!stats.isFile() || stats.isSymbolicLink()) continue;
    } catch {
      continue;
    }
    const assetId = match[1]?.toLowerCase();
    if (assetId === undefined) continue;
    inventory.push({ assetId, path: target });
  }
  return inventory;
}

/** 指定雜湊的所有原檔；同內容不同副檔名會有多個，依路徑排序。 */
export function assetFilesFor(layout: FolderLayout, assetId: string): string[] {
  const wanted = assetId.toLowerCase();
  return listAssetFiles(layout)
    .filter((entry) => entry.assetId === wanted)
    .map((entry) => entry.path)
    .sort();
}

/**
 * 卡片檔文字裡出現的所有 64 位雜湊（小寫）。
 *
 * 檔案內容任何地方出現這段雜湊就算引用：不解析 frontmatter，所以格式
 * 不符、仍然寫著 `asset:` 的檔案也算數，內文提到雜湊也算。比對不分
 * 大小寫：外部把 `asset:` 改成大寫，APFS 仍然讀得到同一個原檔。
 */
export function assetIdsInText(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.toLowerCase().matchAll(HASH_TOKEN)) {
    found.add(match[0]);
  }
  return [...found].sort();
}

/**
 * 掃描 `cards/` 的實際內容，回傳所有卡片檔裡出現的 64 位雜湊（小寫）。
 *
 * 回 `null` 代表無法確認（列不出資料夾、讀不到某個檔案），呼叫端要跳過
 * 回收，不能把「看不到」當成「沒有」。`cards/` 不存在時回空集合。
 *
 * `LocalAssetStore` 的回收與對話刪除的原檔收尾共用這一份：原檔的權威是
 * 卡片檔的實際內容，任何地方出現雜湊都算引用。
 */
export function cardFileAssetIds(layout: FolderLayout): Set<string> | null {
  const directory = layout.subfolderPath("cards");
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Set();
    }
    return null;
  }
  const hashes = new Set<string>();
  for (const name of names) {
    if (!isCardFileName(name)) continue;
    const target = path.join(directory, name);
    let text: string;
    try {
      const stats = lstatSync(target);
      if (!stats.isFile() || stats.isSymbolicLink()) continue;
      text = readFileNoFollow(layout, target).toString("utf8");
    } catch {
      return null;
    }
    for (const assetId of assetIdsInText(text)) {
      hashes.add(assetId);
    }
  }
  return hashes;
}

/**
 * 刪掉一組原檔；回傳刪掉與留下的檔案數。
 *
 * 走 `removeFileSafely`：路徑必須在 `assets/` 內、符號連結只刪連結本身、
 * 硬連結不刪。留下的檔案由呼叫端保留 `asset_meta`。
 */
export function removeAssetFiles(
  layout: FolderLayout,
  files: readonly string[],
): RemoveAssetFilesResult {
  let removed = 0;
  let kept = 0;
  for (const target of files) {
    const result = removeFileSafely(layout, target, ["origin"]);
    if (result.removed || result.reason === "missing") {
      removed += 1;
    } else {
      kept += 1;
    }
  }
  return { removed, kept };
}
