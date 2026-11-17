import { lstatSync, readdirSync } from "node:fs";
import { join, relative as relativePath, sep } from "node:path";

/** `cache/` 的用量分解；索引區包含 SQLite 主檔、WAL／SHM 與下載暫存。 */
export interface CacheUsage {
  readonly totalBytes: number;
  readonly modelBytes: number;
  readonly thumbBytes: number;
  readonly indexBytes: number;
}

const EMPTY: CacheUsage = { totalBytes: 0, modelBytes: 0, thumbBytes: 0, indexBytes: 0 };

function belongsTo(relative: string, segment: string): boolean {
  return relative === segment || relative.startsWith(`${segment}${sep}`);
}

/**
 * 量測整個 `cache/`，不只向量表。
 *
 * 模型權重不自動淘汰，但必須計入 2 GB 上限；縮圖與索引側車檔也一樣。
 * 只跟隨真實目錄，符號連結不計入，避免遞迴繞出 cache。
 */
export function measureCache(root: string): CacheUsage {
  let modelBytes = 0;
  let thumbBytes = 0;
  let indexBytes = 0;
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.isFile()) continue;
      let size: number;
      try {
        size = lstatSync(path).size;
      } catch {
        continue;
      }
      const relative = relativePath(root, path);
      if (belongsTo(relative, "models")) modelBytes += size;
      else if (belongsTo(relative, "thumbs")) thumbBytes += size;
      else indexBytes += size;
    }
  }
  if (modelBytes + thumbBytes + indexBytes === 0) return EMPTY;
  return {
    totalBytes: modelBytes + thumbBytes + indexBytes,
    modelBytes,
    thumbBytes,
    indexBytes,
  };
}
