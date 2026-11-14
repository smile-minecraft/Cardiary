import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** 檔案樹的快照；路徑是相對於根資料夾的 POSIX 路徑。 */
export type TreeSnapshot = ReadonlyMap<string, { readonly size: number; readonly mtimeMs: number }>;

export interface SnapshotDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

/** 遞迴列出檔案（不跟隨符號連結）；目錄本身不列入。 */
export function collectFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  const walk = (absolute: string, relative: string): void => {
    for (const dirent of readdirSync(absolute, { withFileTypes: true })) {
      const childAbsolute = path.join(absolute, dirent.name);
      const childRelative = relative === "" ? dirent.name : `${relative}/${dirent.name}`;
      const stats = lstatSync(childAbsolute);
      if (stats.isSymbolicLink()) {
        files.push(childRelative);
        continue;
      }
      if (stats.isDirectory()) {
        walk(childAbsolute, childRelative);
        continue;
      }
      files.push(childRelative);
    }
  };
  walk(root, "");
  return files.sort();
}

/** 對整個資料夾做快照；整合驗收用它比對「資料夾以外新增的檔案數」。 */
export function snapshotTree(root: string): TreeSnapshot {
  const snapshot = new Map<string, { size: number; mtimeMs: number }>();
  for (const relative of collectFiles(root)) {
    const absolute = path.join(root, relative);
    const stats = lstatSync(absolute);
    snapshot.set(relative, { size: stats.size, mtimeMs: stats.mtimeMs });
  }
  return snapshot;
}

/** 比較兩份快照；`changed` 代表大小或 mtime 不同。 */
export function diffSnapshots(before: TreeSnapshot, after: TreeSnapshot): SnapshotDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [relative, next] of after) {
    const previous = before.get(relative);
    if (previous === undefined) {
      added.push(relative);
      continue;
    }
    if (previous.size !== next.size || previous.mtimeMs !== next.mtimeMs) {
      changed.push(relative);
    }
  }
  for (const relative of before.keys()) {
    if (!after.has(relative)) {
      removed.push(relative);
    }
  }
  return { added, removed, changed };
}

export interface ByteHit {
  readonly file: string;
  readonly needle: string;
  readonly count: number;
}

/**
 * 對資料夾做 byte search；任何命中都代表刪除殘留。
 *
 * 讀取的是原始位元組，不是資料表查詢；`-wal`、`-shm` 與二進位檔都包含在內。
 */
export function byteSearch(root: string, needles: readonly string[]): ByteHit[] {
  return byteSearchFiles(
    collectFiles(root).map((relative) => path.join(root, relative)),
    needles,
    root,
  );
}

/** 對指定的檔案清單做 byte search；`displayRoot` 只影響回報路徑。 */
export function byteSearchFiles(
  files: readonly string[],
  needles: readonly string[],
  displayRoot?: string,
): ByteHit[] {
  const hits: ByteHit[] = [];
  for (const file of files) {
    let content: Buffer;
    try {
      if (lstatSync(file).isSymbolicLink()) {
        continue;
      }
      content = readFileSync(file);
    } catch {
      continue;
    }
    for (const needle of needles) {
      if (needle.length === 0) {
        continue;
      }
      const count = countOccurrences(content, Buffer.from(needle, "utf8"));
      if (count > 0) {
        hits.push({
          file: displayRoot === undefined ? file : path.relative(displayRoot, file),
          needle,
          count,
        });
      }
    }
  }
  return hits;
}

function countOccurrences(haystack: Buffer, needle: Buffer): number {
  let count = 0;
  let index = 0;
  while (index <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) {
      break;
    }
    count += 1;
    index = found + needle.length;
  }
  return count;
}

/** 目錄的總位元組數（含 WAL 與 SHM）。 */
export function directorySize(root: string): number {
  let total = 0;
  for (const relative of collectFiles(root)) {
    try {
      total += statSync(path.join(root, relative)).size;
    } catch {
      // 掃描期間檔案消失時略過。
    }
  }
  return total;
}

/** 資料夾內某一組檔案的總大小；用於比較刪除前後。 */
export function filesSize(files: readonly string[]): number {
  let total = 0;
  for (const file of files) {
    try {
      total += statSync(file).size;
    } catch {
      // 不存在時不計。
    }
  }
  return total;
}

/** 測試用：等待非同步清理完成，最多 `timeoutMs`。 */
export async function waitFor(
  condition: () => boolean,
  options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return condition();
}
