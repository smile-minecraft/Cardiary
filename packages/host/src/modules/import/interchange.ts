import { newCardId, normalizeRfc3339, sha256Hex, TITLE_MAX_LENGTH } from "@cardiary/domain";

import { SECRET_FILE_NAMES, type ImportCategory } from "./types.js";

/**
 * 中介格式的共用小工具：內容雜湊、標題、記憶切條。
 *
 * 去重只認內容雜湊（規格書第 16 章）：同一個來源重跑時，`title` 與 `body`
 * 正規化後要得到同一個值。時間與來源路徑刻意不進雜湊，所以換了資料夾或
 * 重跑一次，不會被當成新內容。
 */

/** 去重用的內容雜湊；類別不同就是不同內容。 */
export function contentHash(input: {
  readonly category: ImportCategory;
  readonly title: string;
  readonly body: string;
}): string {
  return sha256Hex(
    [input.category, normalizeLineEndings(input.title).trim(), normalizeBody(input.body)].join(
      "\u0000",
    ),
  );
}

/** 技能的去重鍵：`SKILL.md` 的內容本身。 */
export function skillContentHash(markdown: string): string {
  return sha256Hex(normalizeBody(markdown));
}

/** 對話的去重鍵：來源的執行緒與它的最後更新時間。 */
export function conversationContentHash(input: {
  readonly tool: string;
  readonly anchor: string;
  readonly updatedAt: string;
}): string {
  return sha256Hex(["conversation", input.tool, input.anchor, input.updatedAt].join("\u0000"));
}

/** CRLF 與行尾空白不影響是不是同一段內容。 */
export function normalizeBody(text: string): string {
  return normalizeLineEndings(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .trim();
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}

/**
 * 中介格式項目的識別鍵。
 *
 * `file:<編碼後的相對路徑>` 或 `file:<編碼後的相對路徑>#<分段序號>`；技能是
 * `skill:<編碼後的相對路徑>`。路徑只做 percent-encoding，所以 `#` 不會出現
 * 在路徑段裡；還原時，最後一個 `#` 後面若是純數字就是分段序號，否則整段是
 * 路徑。這樣 `note#1.md` 這種檔名不會被誤認成「`note` 的第 1 段」。
 */
export function fileItemKey(relativePath: string, partIndex?: number): string {
  const base = `file:${encodePath(relativePath)}`;
  return partIndex === undefined ? base : `${base}#${partIndex}`;
}

export function skillItemKey(relativePath: string): string {
  return `skill:${encodePath(relativePath)}`;
}

/** 從 `file:` 後面的部分還原相對路徑；認不出來就回 `undefined`。 */
export function fileItemPath(rest: string): string | undefined {
  return decodePath(pathBeforeIndex(rest));
}

/** 從 `skill:` 後面的部分還原相對路徑；認不出來就回 `undefined`。 */
export function skillItemPath(rest: string): string | undefined {
  return decodePath(rest);
}

function pathBeforeIndex(rest: string): string {
  const hash = rest.lastIndexOf("#");
  if (hash >= 0 && /^\d+$/u.test(rest.slice(hash + 1))) return rest.slice(0, hash);
  return rest;
}

/** 機密檔名的比對（檔名本身，不分大小寫）；通用來源不開這些檔案。 */
export function isSecretFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return SECRET_FILE_NAMES.some((secret) => lower === secret.toLowerCase());
}

/**
 * 路徑逐段編碼：`/` 保持不變讓鍵看得懂，每一段裡的 `#`／`%` 變成 percent-encoding。
 * 還原時逐段解回去；任何一段壞掉就整個不認得。
 */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function decodePath(encoded: string): string | undefined {
  if (encoded === "") return undefined;
  try {
    return encoded.split("/").map(decodeURIComponent).join("/");
  } catch {
    return undefined;
  }
}

/** 標題：指定的標題、第一個標題行、第一個非空行，最後才是檔案名稱。 */
export function titleFrom(input: {
  readonly explicit?: string;
  readonly body: string;
  readonly fallback: string;
}): string {
  const candidates = [
    input.explicit,
    headingOf(input.body),
    firstLineOf(input.body),
    input.fallback,
  ];
  for (const candidate of candidates) {
    const text = candidate?.replace(/^#{1,6}\s*/u, "").trim();
    if (text !== undefined && text.length > 0) {
      return [...text].slice(0, TITLE_MAX_LENGTH).join("");
    }
  }
  return "未命名";
}

/**
 * 把一份記憶檔拆成一條一條。
 *
 * Hermes 的 `MEMORY.md`、`USER.md` 與通用來源的記憶檔都沒有固定的條目格式
 * （Hermes 的實際檔案在這台機器不存在），所以用寬鬆規則：項目符號或編號
 * 開頭是新的一條，空行也切開，`#` 標題本身不是內容。
 */
export function splitEntries(text: string): string[] {
  const entries: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    const joined = current.join("\n").trim();
    if (joined.length > 0) entries.push(joined);
    current = [];
  };
  for (const line of normalizeLineEndings(text).split("\n")) {
    if (/^#{1,6}\s/u.test(line)) {
      flush();
      continue;
    }
    const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/u.exec(line);
    if (bullet !== null) {
      flush();
      current.push(bullet[1] ?? "");
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return entries;
}

/** 檔案名稱轉成技能目錄名稱；只留小寫英數與連字號。 */
export function skillSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug.length > 0 ? slug.slice(0, 80) : `skill-${newCardId().slice(-8).toLowerCase()}`;
}

/** 來源時間轉成卡片要的 RFC 3339；不合法時回 undefined，由寫入端補上現在時間。 */
export function sourceTimestamp(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return normalizeRfc3339(value) ?? undefined;
}

/** 來源裡的一行 frontmatter；只用來取標題，不解析整份 YAML。 */
export function frontmatterTitle(text: string): string | undefined {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/u.exec(text);
  if (match === null) return undefined;
  const title = /^title:\s*(.+)$/mu.exec(match[1] ?? "");
  if (title === null) return undefined;
  return (title[1] ?? "").trim().replace(/^["']|["']$/gu, "");
}

/** `SKILL.md` 的 frontmatter：`name` 與 `description` 是必要欄位，`license` 可有可無。 */
export function skillFrontmatter(text: string): { name?: string; description?: string } {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---/u.exec(text);
  if (match === null) return {};
  const block = match[1] ?? "";
  const read = (key: string): string | undefined => {
    const line = new RegExp(`^${key}:\\s*(.+)$`, "mu").exec(block);
    return line === null ? undefined : (line[1] ?? "").trim().replace(/^["']|["']$/gu, "");
  };
  const name = read("name");
  const description = read("description");
  return {
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
  };
}

/** 文字是不是二進位；以 NUL 判斷，足夠擋掉誤標成 Markdown 的檔案。 */
export function looksBinary(text: string): boolean {
  return text.includes("\u0000");
}

function headingOf(body: string): string | undefined {
  const heading = /^\s*#{1,6}\s+(.+)$/mu.exec(body);
  return heading?.[1];
}

function firstLineOf(body: string): string | undefined {
  return normalizeLineEndings(body)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}
