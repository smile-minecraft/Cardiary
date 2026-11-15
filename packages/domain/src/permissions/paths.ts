import { existsSync, lstatSync, realpathSync, statSync, type Stats } from "node:fs";
import path from "node:path";

import { PERMISSION_RULES } from "./rules.js";
import type { PathClass, PathResolution } from "./types.js";

/** 路徑正規化要比較的兩個根；兩者都是已 realpath 的絕對路徑。 */
export interface PathRoots {
  readonly workingDir: string;
  readonly folderRoot: string;
}

/** 路徑長度上限（bytes）；與設計文件的 4,096 一致。 */
export const MAX_PATH_BYTES = 4096;

/**
 * 系統路徑。`/var` 與 `/private/var` 都要列，因為 macOS 的 `/var` 是符號
 * 連結，realpath 之後變成 `/private/var`；`/var/folders` 是唯一的例外，
 * 它是使用者與系統的暫存區。
 */
const SYSTEM_ROOTS = [
  "/System",
  "/usr",
  "/bin",
  "/sbin",
  "/etc",
  "/private/etc",
  "/Library",
  "/Applications",
  "/var",
  "/private/var",
  "/dev",
] as const;

const SYSTEM_EXCEPTIONS = ["/var/folders", "/private/var/folders"] as const;

/** 檔案系統的大小寫敏感度；`unknown` 時保護目標一律折疊比對（寧可誤擋，不可漏過）。 */
export type CaseSensitivity = "case-sensitive" | "case-insensitive" | "unknown";

/** `dev` → 已偵測的敏感度；同一個卷只探測一次。 */
const sensitivityByDev = new Map<number, CaseSensitivity>();

/**
 * 探測 `target` 所在卷的大小寫敏感度。
 *
 * 由根往下走、以 `dev` 為界找出掛載點，再把掛載點之後的第一個含 ASCII 字母的
 * 元件大小寫反過來再 `stat` 一次：成功且 `dev`＋`ino` 都相同代表卷不分大小寫；
 * `ENOENT` 代表分大小寫。只翻掛載點之後的元件，因為翻更前面的元件（例如
 * `/Volumes/External-Data` 的 `/Volumes`）測到的是開機卷，不是目標卷。整條路徑
 * 都在根卷上時，翻第一個字母就是測根卷。`target` 不存在時會往上找存在的祖先，
 * 整條都不存在或翻不出可用的元件就回 `unknown`。已知的結果以 `dev` 編號快取；
 * `unknown` 不快取，換一條同卷路徑再探測還有機會得到答案。
 */
export function detectCaseSensitivity(target: string): CaseSensitivity {
  let current = target;
  for (;;) {
    try {
      const stats = statSync(current);
      const cached = sensitivityByDev.get(stats.dev);
      if (cached !== undefined) {
        return cached;
      }
      const flipped = flipAsciiCaseOnTargetVolume(current);
      let result: CaseSensitivity = "unknown";
      if (flipped !== null) {
        try {
          const other = statSync(flipped);
          result =
            other.dev === stats.dev && other.ino === stats.ino
              ? "case-insensitive"
              : "case-sensitive";
        } catch (error) {
          result =
            (error as NodeJS.ErrnoException).code === "ENOENT" ? "case-sensitive" : "unknown";
        }
      }
      if (result !== "unknown") {
        // `unknown` 不快取：同一個卷的另一條路徑可能翻得出可用的元件（目標剛好
        // 是掛載點時翻不到）。若把 unknown 以 dev 記住，一次掛載點探測就會讓
        // 整個卷的路徑都變成 unknown，`tmp/` 的放行邊界也跟著失效。
        sensitivityByDev.set(stats.dev, result);
      }
      return result;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return "unknown";
      }
      current = parent;
    }
  }
}

/** 大小寫折疊的 `isWithin`；只給保護目標在大小寫不敏感或未知的卷上使用。 */
export function isWithinFolded(root: string, candidate: string): boolean {
  return isWithin(root.toLowerCase(), candidate.toLowerCase());
}

/** 兩個路徑是否是同一個檔案（`dev`＋`ino`）；任一不存在時回傳 `null`。 */
export function sameFile(a: string, b: string): boolean | null {
  try {
    const first = statSync(a);
    const second = statSync(b);
    return first.dev === second.dev && first.ino === second.ino;
  } catch {
    return null;
  }
}

function flipAsciiCase(target: string): string | null {
  for (let index = 0; index < target.length; index += 1) {
    const character = target[index] ?? "";
    if (/[A-Za-z]/.test(character)) {
      const flipped =
        character === character.toLowerCase() ? character.toUpperCase() : character.toLowerCase();
      return `${target.slice(0, index)}${flipped}${target.slice(index + 1)}`;
    }
  }
  return null;
}

/** 翻單一元件裡第一個 ASCII 字母的大小寫。 */
function flipFirstAsciiLetter(component: string): string | null {
  return flipAsciiCase(component);
}

/**
 * 找出 `current`（已確認存在）所在卷裡可以翻轉的元件，回傳翻轉後的路徑。
 *
 * 由根往下逐段 `dev` 找出最深的掛載點：
 * - 沒有任何掛載點（整條在根卷）：翻第一個含 ASCII 字母的字母（原本的做法）。
 * - 有掛載點：只翻掛載點之後的元件；這些元件才在目標卷上。
 * - 目標剛好是掛載點本身（例如 `/Volumes/External-Data`）：沒有「之後」的元件可以
 *   翻，掛載點之前的元件屬於父卷，翻了不代表目標卷的敏感度，回傳 null。
 */
function flipAsciiCaseOnTargetVolume(current: string): string | null {
  const root = path.parse(current).root;
  const parts = current
    .slice(root.length)
    .split(path.sep)
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return null;
  }

  let walkDev: number;
  let mountEnd = -1;
  try {
    walkDev = statSync(root).dev;
  } catch {
    return null;
  }
  let prefix = root;
  for (let index = 0; index < parts.length; index += 1) {
    const next = path.join(prefix, parts[index] ?? "");
    let nextStats;
    try {
      nextStats = statSync(next);
    } catch {
      // current 已確認存在；理論上不會走到。
      return null;
    }
    if (nextStats.dev !== walkDev) {
      walkDev = nextStats.dev;
      mountEnd = index;
    }
    prefix = next;
  }

  const start = mountEnd + 1;
  for (let index = start; index < parts.length; index += 1) {
    const flippedComponent = flipFirstAsciiLetter(parts[index] ?? "");
    if (flippedComponent === null) {
      continue;
    }
    const flippedParts = parts.slice();
    flippedParts[index] = flippedComponent;
    return path.join(root, ...flippedParts);
  }
  return null;
}

/** 依敏感度決定用精確或折疊比對。 */
function isWithinSensitive(root: string, candidate: string, sensitivity: CaseSensitivity): boolean {
  return sensitivity === "case-sensitive"
    ? isWithin(root, candidate)
    : isWithinFolded(root, candidate);
}

/** `candidate` 在 `root` 之內（含等於 `root`）；用字串邊界比較，不做大小寫折疊。 */
export function isWithin(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return candidate.startsWith(prefix);
}

/** 依設計文件第 2 節的固定順序正規化一個路徑。 */
export function resolvePath(input: string, roots: PathRoots): PathResolution {
  const invalid = (reason: string): PathResolution => ({
    ok: false,
    rule: PERMISSION_RULES.invalidPath,
    reason,
  });
  // 1. 形狀檢查。
  if (input.length === 0) {
    return invalid("路徑是空字串");
  }
  if (input.includes("\0")) {
    return invalid("路徑含 NUL 位元組");
  }
  if (Buffer.byteLength(input, "utf8") > MAX_PATH_BYTES) {
    return invalid(`路徑超過 ${MAX_PATH_BYTES} bytes`);
  }
  if (/^[A-Za-z]:/.test(input)) {
    return invalid("不支援 Windows 磁碟代號");
  }

  // 2. 相對路徑以 workingDir 為基準；`~` 不展開。
  const absolute = path.isAbsolute(input)
    ? path.normalize(input)
    : path.resolve(roots.workingDir, input);
  if (Buffer.byteLength(absolute, "utf8") > MAX_PATH_BYTES) {
    return invalid(`正規化後的路徑超過 ${MAX_PATH_BYTES} bytes`);
  }

  // 3. 對存在的最深祖先做 realpath，再把剩下的部分接回去。
  let resolved: string;
  try {
    resolved = realpathDeepest(absolute);
  } catch (error) {
    return invalid(`realpath 失敗：${(error as NodeJS.ErrnoException).code ?? String(error)}`);
  }

  // 4. 最後一段不存在時，確認它不是符號連結。
  const isSymlink = lstatSafe(absolute)?.isSymbolicLink() === true;
  const stats = statSafe(resolved);
  const exists = stats !== null;

  const insideWorkingDir = isWithin(roots.workingDir, resolved);
  const insideFolderRoot = isWithin(roots.folderRoot, resolved);
  const classification = classifyResolved(resolved, insideWorkingDir, insideFolderRoot);

  return {
    ok: true,
    path: {
      requested: input,
      resolved,
      absolute,
      classification,
      insideWorkingDir,
      insideFolderRoot,
      changed: absolute !== resolved,
      exists,
      isSymlink,
      hardLinkCount: stats === null ? 0 : stats.nlink,
    },
  };
}

/** 分類；`resolved` 必須是 realpath 之後的絕對路徑。 */
export function classifyPath(resolved: string, roots: PathRoots): PathClass {
  return classifyResolved(
    resolved,
    isWithin(roots.workingDir, resolved),
    isWithin(roots.folderRoot, resolved),
  );
}

export function isSystemPath(
  resolved: string,
  sensitivity: CaseSensitivity = detectCaseSensitivity(resolved),
): boolean {
  for (const exception of SYSTEM_EXCEPTIONS) {
    if (isWithinSensitive(exception, resolved, sensitivity)) {
      return false;
    }
  }
  return SYSTEM_ROOTS.some((root) => isWithinSensitive(root, resolved, sensitivity));
}

/** 正本區的子資料夾；整批刪除這幾區或它們的根都算破壞。 */
export const ORIGIN_ZONE_NAMES = [
  "cards",
  "assets",
  "boards",
  "skills",
  "state",
  "modules",
] as const;

/** `resolved` 是正本區根或正本區之內；`recursive` 由呼叫端決定要不要算。 */
export function originZoneOf(folderRoot: string, resolved: string): string | null {
  const sensitivity = detectCaseSensitivity(folderRoot);
  for (const name of ORIGIN_ZONE_NAMES) {
    if (isWithinSensitive(path.join(folderRoot, name), resolved, sensitivity)) {
      return name;
    }
  }
  return null;
}

function classifyResolved(
  resolved: string,
  insideWorkingDir: boolean,
  insideFolderRoot: boolean,
): PathClass {
  if (insideWorkingDir) {
    return "workspace";
  }
  if (insideFolderRoot) {
    return "folder";
  }
  if (isSystemPath(resolved)) {
    return "system";
  }
  return "external";
}

/** 對存在的最深祖先 realpath；不存在的尾端原樣接回。 */
export function realpathDeepest(absolute: string): string {
  let current = absolute;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return rest.length === 0 ? real : path.join(real, ...rest.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return rest.length === 0 ? current : path.join(current, ...rest.reverse());
      }
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

function lstatSafe(target: string): Stats | null {
  try {
    return lstatSync(target);
  } catch {
    return null;
  }
}

function statSafe(target: string): Stats | null {
  try {
    return statSync(target);
  } catch {
    return null;
  }
}

/** 除錯與診斷用：路徑存在時回傳 true；不建立任何東西。 */
export function pathExists(target: string): boolean {
  return existsSync(target);
}

/** `target` 存在且是目錄時回傳 true（跟隨符號連結；不存在或解析失敗回 false）。 */
export function isExistingDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}
