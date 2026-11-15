import { isUlid, sha256Hex } from "./ids.js";
import { stableStringify } from "./stable-json.js";
import type { CardFrontmatter, CardKind } from "./index.js";

/** 卡片種類；封閉集合。 */
export const CARD_KINDS: readonly CardKind[] = [
  "note",
  "image",
  "audio",
  "memory",
  "summary",
  "persona",
  "bedrock",
];
const CARD_KIND_SET = new Set<string>(CARD_KINDS);

/** 代理的工具只能建立這三種；系統與匯入可以建立全部。 */
export const AGENT_CREATABLE_KINDS: readonly CardKind[] = ["note", "image", "audio"];

export type CardFileLineEnding = "\n" | "\r\n";

/**
 * frontmatter 的版面：序列化時依這個順序重建，註解留在原來的位置。
 *
 * 整行的註解是 `comment`；每個欄位是 `field`，同一行尾端的註解放在
 * `inlineComment`（含開頭的 `#`）。
 */
export type FrontmatterLayoutItem =
  | { readonly kind: "comment"; readonly text: string }
  | { readonly kind: "field"; readonly key: string; readonly inlineComment?: string };

/** frontmatter 解析成功的一張卡片；`body` 與未知欄位保留原樣。 */
export interface ParsedCardFile {
  readonly ok: true;
  readonly frontmatter: CardFrontmatter;
  /** 原檔裡實際出現的鍵，依原檔順序；服務改寫時用來決定寫哪些欄位。 */
  readonly presentKeys: readonly string[];
  /** 原檔的 frontmatter 版面（含註解）；`serializeCardFile` 用它重建。 */
  readonly layout: readonly FrontmatterLayoutItem[];
  /** frontmatter 結尾標記之後的內文，位元組不變。 */
  readonly body: string;
  /** 原檔主要使用的換行字元。 */
  readonly lineEnding: CardFileLineEnding;
}

/** 格式不符的檔案；服務不改寫、不刪除，只標記與回報。 */
export interface BrokenCardFile {
  readonly ok: false;
  /** 給人看的原因。 */
  readonly reason: string;
}

export type CardFileResult = ParsedCardFile | BrokenCardFile;

export interface ParseCardOptions {
  /** 有值時檢查 frontmatter 的 id 必須等於這個值（檔名主幹）。 */
  readonly expectedCardId?: string;
}

/** 長度上限；超過時截斷（建立與索引使用，檔案內容不改）。 */
export const TITLE_MAX_LENGTH = 300;
export const SUMMARY_MAX_LENGTH = 2_000;
export const TAGS_MAX_COUNT = 100;

const frontMatterStart = /^---[ \t]*\r?\n/;
const frontMatterClose = /^---[ \t]*(\r?\n|$)/gm;
const topLevelKey = /^([A-Za-z0-9_.-]+):(.*)$/;
const blockSequenceEntry = /^\s*-\s?(.*)$/;
const nestedMappingEntry = /^([ \t]+)([A-Za-z0-9_.-]+):(.*)$/;

/** 解析卡片檔。任何一步失敗都回 `broken`，不猜測、不修復。 */
export function parseCardText(text: string, options: ParseCardOptions = {}): CardFileResult {
  const start = frontMatterStart.exec(text);
  if (!start) {
    return broken("沒有 frontmatter（檔案必須以 --- 開頭）");
  }
  const rest = text.slice(start[0].length);
  frontMatterClose.lastIndex = 0;
  const closing = frontMatterClose.exec(rest);
  if (!closing || closing.index === undefined) {
    return broken("frontmatter 沒有結尾的 ---");
  }
  const rawFrontmatter = rest.slice(0, closing.index);
  const body = rest.slice(closing.index + closing[0].length);
  const lineEnding: CardFileLineEnding = text.includes("\r\n") ? "\r\n" : "\n";

  const split = splitTopLevelEntries(rawFrontmatter);
  if (typeof split === "string") {
    return broken(split);
  }
  const { entries, items: layout } = split;

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      return broken(`frontmatter 有重複的欄位：${entry.key}`);
    }
    seen.add(entry.key);
  }

  const known = new Map<string, TopLevelEntry>();
  const extra: Record<string, string> = {};
  const presentKeys: string[] = [];
  for (const entry of entries) {
    presentKeys.push(entry.key);
    if (isKnownKey(entry.key)) {
      known.set(entry.key, entry);
      continue;
    }
    extra[entry.key] = rawOf(entry);
  }

  const idResult = parseScalarField(known.get("id"), "id");
  if (!idResult.ok) return broken(idResult.reason);
  const id = idResult.value;
  if (!isUlid(id)) {
    return broken("id 不是 ULID");
  }
  if (
    options.expectedCardId !== undefined &&
    id.toUpperCase() !== options.expectedCardId.toUpperCase()
  ) {
    return broken("id 與檔名不符");
  }

  const kindResult = parseScalarField(known.get("kind"), "kind");
  if (!kindResult.ok) return broken(kindResult.reason);
  const kind = kindResult.value;
  if (!CARD_KIND_SET.has(kind)) {
    return broken(`kind 不是已知的種類：${kind}`);
  }

  const titleResult = parseScalarField(known.get("title"), "title");
  if (!titleResult.ok) return broken(titleResult.reason);
  if (titleResult.value.trim().length === 0) {
    return broken("title 是空的");
  }

  const createdResult = parseDateField(known.get("created"), "created", true);
  if (!createdResult.ok) return broken(createdResult.reason);
  const created = createdResult.value as string;

  const updatedResult = parseDateField(known.get("updated"), "updated", false);
  if (!updatedResult.ok) return broken(updatedResult.reason);
  const updated = updatedResult.value;

  const summaryResult = parseScalarField(known.get("summary"), "summary");
  if (!summaryResult.ok) return broken(summaryResult.reason);
  const summary = summaryResult.value.length === 0 ? undefined : summaryResult.value;

  const personaResult = parseScalarField(known.get("persona"), "persona");
  if (!personaResult.ok) return broken(personaResult.reason);
  const personaRaw = personaResult.value.trim();
  const persona = personaRaw.length === 0 ? "default" : personaRaw;

  const assetResult = parseScalarField(known.get("asset"), "asset");
  if (!assetResult.ok) return broken(assetResult.reason);
  const assetRaw = assetResult.value.trim();
  if (assetRaw.length > 0 && !assetRaw.startsWith("assets/")) {
    return broken("asset 必須是 assets/ 底下的相對路徑");
  }
  const asset = assetRaw.length === 0 ? undefined : assetRaw;

  const supersedesResult = parseScalarField(known.get("supersedes"), "supersedes");
  if (!supersedesResult.ok) return broken(supersedesResult.reason);
  const supersedesRaw = supersedesResult.value.trim();
  const supersedes = supersedesRaw.length === 0 ? undefined : supersedesRaw;

  const sourcesResult = parseStringArrayField(known.get("sources"), "sources");
  if (!sourcesResult.ok) return broken(sourcesResult.reason);
  const supersedesOf = sourcesResult.value;

  const tagsResult = parseStringArrayField(known.get("tags"), "tags");
  if (!tagsResult.ok) return broken(tagsResult.reason);
  const tags = tagsResult.value.slice(0, TAGS_MAX_COUNT);

  const importedFromResult = parseImportedFrom(known.get("importedFrom"));
  if (importedFromResult.kind === "invalid") {
    return broken("importedFrom 的格式不符");
  }
  let importedFrom: CardFrontmatter["importedFrom"];
  if (importedFromResult.kind === "parsed") {
    importedFrom = importedFromResult.value;
  } else if (importedFromResult.kind === "raw") {
    extra["importedFrom"] = importedFromResult.raw;
    const index = presentKeys.indexOf("importedFrom");
    if (index >= 0) presentKeys.splice(index, 1);
  }

  const frontmatter: CardFrontmatter = {
    id,
    kind: kind as CardKind,
    title: titleResult.value,
    ...(summary !== undefined ? { summary } : {}),
    created,
    ...(updated !== undefined ? { updated } : {}),
    sources: supersedesOf,
    ...(supersedes !== undefined ? { supersedes } : {}),
    tags,
    ...(asset !== undefined ? { asset } : {}),
    persona,
    ...(importedFrom !== undefined ? { importedFrom } : {}),
    extra,
  };

  return { ok: true, frontmatter, presentKeys, layout, body, lineEnding };
}

interface TopLevelEntry {
  readonly key: string;
  readonly firstLineRest: string;
  /** 同一行尾端的註解（含 `#`）；寫回時留在原本的欄位後面。 */
  readonly inlineComment?: string;
  readonly bodyLines: readonly string[];
}

function rawOf(entry: TopLevelEntry): string {
  return [entry.firstLineRest, ...entry.bodyLines].join("\n").replace(/\s+$/u, "");
}

function broken(reason: string): BrokenCardFile {
  return { ok: false, reason };
}

function isKnownKey(key: string): boolean {
  switch (key) {
    case "id":
    case "kind":
    case "title":
    case "summary":
    case "created":
    case "updated":
    case "sources":
    case "supersedes":
    case "tags":
    case "asset":
    case "persona":
    case "importedFrom":
      return true;
    default:
      return false;
  }
}

interface SplitFrontmatter {
  readonly entries: TopLevelEntry[];
  /** 完整版面：欄位與整行註解依原檔順序。 */
  readonly items: FrontmatterLayoutItem[];
}

/**
 * 切出頂層欄位，同時記下版面。
 *
 * 整行的 `#` 註解不算欄位，也不會讓檔案變成 broken：縮排的註解留在所屬欄位
 * 的原文裡，頂層的註解變成一個 `comment` 版面項目。欄位同一行尾端的註解
 * 從值裡切掉，記在 `inlineComment`，寫回時接回同一行。
 */
function splitTopLevelEntries(rawFrontmatter: string): SplitFrontmatter | string {
  const lines = rawFrontmatter.split(/\r?\n/);
  const entries: TopLevelEntry[] = [];
  const items: FrontmatterLayoutItem[] = [];
  let current: {
    key: string;
    firstLineRest: string;
    inlineComment?: string;
    bodyLines: string[];
  } | null = null;
  const flush = (): void => {
    if (current === null) return;
    const { inlineComment, ...rest } = current;
    entries.push(inlineComment === undefined ? rest : { ...rest, inlineComment });
    current = null;
  };
  for (const line of lines) {
    if (line.trim().length === 0) {
      if (current === null) continue;
      current.bodyLines.push("");
      continue;
    }
    if (line.trimStart().startsWith("#") && (current === null || !/^[ \t]/.test(line))) {
      flush();
      items.push({ kind: "comment", text: line });
      continue;
    }
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      const match = topLevelKey.exec(line);
      if (!match) {
        return `frontmatter 有無法辨識的行：${line}`;
      }
      flush();
      const { value, comment } = splitInlineComment(match[2] ?? "");
      current = {
        key: match[1] as string,
        firstLineRest: value,
        ...(comment === undefined ? {} : { inlineComment: comment }),
        bodyLines: [],
      };
      items.push({
        kind: "field",
        key: match[1] as string,
        ...(comment === undefined ? {} : { inlineComment: comment }),
      });
      continue;
    }
    if (current === null) {
      return `frontmatter 在第一個欄位之前出現內容：${line}`;
    }
    current.bodyLines.push(line);
  }
  flush();
  return { entries, items };
}

/**
 * 切開「值」與「同行尾端的註解」。
 *
 * `#` 只有在行首或前面是空白時才是註解，引號裡的 `#` 不算；所以 `C#`、
 * `/path#fragment` 這種值不會被誤切。
 */
function splitInlineComment(rest: string): { value: string; comment?: string } {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < rest.length; index += 1) {
    const char = rest[index] as string;
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "#" && (index === 0 || /\s/u.test(rest[index - 1] as string))) {
      return {
        value: rest.slice(0, index).replace(/\s+$/u, ""),
        comment: rest.slice(index).replace(/\s+$/u, ""),
      };
    }
  }
  return { value: rest.replace(/\s+$/u, "") };
}

type ScalarResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string };

function parseScalarField(entry: TopLevelEntry | undefined, field: string): ScalarResult {
  if (entry === undefined) {
    return { ok: true, value: "" };
  }
  const rest = entry.firstLineRest.trim();
  if (rest.length > 0) {
    // Block scalar 的指示符在鍵的同一行：summary: |、summary: >+ 等。
    if (/^[|>][+-]?$/.test(rest)) {
      const lines = entry.bodyLines;
      const indent = indentOf(lines);
      const dedented = lines.map((line) => line.slice(Math.min(indent, line.length)));
      const text = dedented.join("\n").replace(/\n+$/u, "\n");
      return { ok: true, value: rest.startsWith(">") ? text.replace(/\n/g, " ") : text };
    }
    const parsed = parseFlowScalar(rest);
    if (parsed === undefined || typeof parsed === "object") {
      return { ok: false, reason: `${field} 不是單一值` };
    }
    return { ok: true, value: String(parsed) };
  }
  return { ok: true, value: "" };
}

function parseDateField(
  entry: TopLevelEntry | undefined,
  field: string,
  required: boolean,
):
  | { readonly ok: true; readonly value: string | undefined }
  | { readonly ok: false; readonly reason: string } {
  const scalar = parseScalarField(entry, field);
  if (!scalar.ok) return scalar;
  const value = scalar.value.trim();
  if (value.length === 0) {
    if (required) {
      return { ok: false, reason: `${field} 是必填欄位` };
    }
    return { ok: true, value: undefined };
  }
  const normalized = normalizeRfc3339(value);
  if (normalized === null) {
    return { ok: false, reason: `${field} 不是 RFC 3339 時間：${value}` };
  }
  return { ok: true, value: normalized };
}

export function normalizeRfc3339(value: string): string | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const utc = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(utc.getTime()) ? null : utc.toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    return null;
  }
  const parsed = new Date(value.includes(" ") ? value.replace(" ", "T") : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

type ArrayResult =
  { readonly ok: true; readonly value: string[] } | { readonly ok: false; readonly reason: string };

function parseStringArrayField(entry: TopLevelEntry | undefined, field: string): ArrayResult {
  if (entry === undefined) {
    return { ok: true, value: [] };
  }
  const rest = entry.firstLineRest.trim();
  if (rest.startsWith("[")) {
    const values = parseFlowArray(rest, field);
    if (typeof values === "string") {
      return { ok: false, reason: values };
    }
    return { ok: true, value: dedupeStrings(values) };
  }
  if (rest.length > 0) {
    // YAML：單一純量不會被視為陣列；這裡寬容地收成單元素陣列。
    const parsed = parseFlowScalar(rest);
    if (parsed === undefined || typeof parsed === "object") {
      return { ok: false, reason: `${field} 不是字串陣列` };
    }
    return { ok: true, value: [String(parsed)] };
  }
  const values: string[] = [];
  for (const line of entry.bodyLines) {
    if (line.trim().length === 0) continue;
    if (line.trimStart().startsWith("#")) continue;
    const match = blockSequenceEntry.exec(line);
    if (!match) {
      return { ok: false, reason: `${field} 的區塊陣列有無法辨識的行：${line}` };
    }
    const item = (match[1] ?? "").trim();
    if (item.length === 0) {
      return { ok: false, reason: `${field} 有空的項目` };
    }
    const parsed = parseFlowScalar(item);
    if (parsed === undefined || typeof parsed === "object") {
      return { ok: false, reason: `${field} 的項目不是單一值` };
    }
    values.push(String(parsed));
  }
  return { ok: true, value: dedupeStrings(values) };
}

type ImportedFromResult =
  | { readonly kind: "parsed"; readonly value: { tool: string; path: string; hash: string } }
  | { readonly kind: "raw"; readonly raw: string }
  | { readonly kind: "absent" }
  | { readonly kind: "invalid" };

function parseImportedFrom(entry: TopLevelEntry | undefined): ImportedFromResult {
  if (entry === undefined) {
    return { kind: "absent" };
  }
  const rest = entry.firstLineRest.trim();
  const raw = rawOf(entry);
  if (rest.startsWith("{")) {
    const parsed = parseFlowMapping(rest);
    if (parsed === undefined) {
      return { kind: "raw", raw };
    }
    return toImportedFrom(parsed, raw);
  }
  if (rest.length > 0) {
    return { kind: "raw", raw };
  }
  const parsed: Record<string, string> = {};
  for (const line of entry.bodyLines) {
    if (line.trim().length === 0) continue;
    if (line.trimStart().startsWith("#")) {
      // 區塊裡有註解就整段保留原文，不在改寫時把它吃掉。
      return { kind: "raw", raw };
    }
    const match = nestedMappingEntry.exec(line);
    if (!match) {
      return { kind: "raw", raw };
    }
    const value = parseFlowScalar((match[3] ?? "").trim());
    if (value === undefined || typeof value === "object") {
      return { kind: "raw", raw };
    }
    parsed[match[2] as string] = String(value);
  }
  return toImportedFrom(parsed, raw);
}

function toImportedFrom(parsed: Record<string, string>, raw: string): ImportedFromResult {
  const { tool, path, hash, ...rest } = parsed;
  if (Object.keys(rest).length > 0 || !tool || !path || !hash) {
    // 多了看不懂的欄位就整段保留原文，不解析也不丟棄。
    return { kind: "raw", raw };
  }
  return { kind: "parsed", value: { tool, path, hash } };
}

function indentOf(lines: readonly string[]): number {
  let indent = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const match = /^ */.exec(line);
    indent = Math.min(indent, match ? match[0].length : 0);
  }
  return Number.isFinite(indent) ? indent : 0;
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/** 解析 flow 純量；無法辨識時回 undefined。物件與陣列回物件。 */
function parseFlowScalar(raw: string): string | number | boolean | null | object | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("'")) {
    return parseSingleQuoted(trimmed);
  }
  if (trimmed.startsWith('"')) {
    return parseDoubleQuoted(trimmed);
  }
  if (trimmed.startsWith("[")) {
    const array = parseFlowArray(trimmed, "value");
    return typeof array === "string" ? undefined : array;
  }
  if (trimmed.startsWith("{")) {
    return parseFlowMapping(trimmed);
  }
  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === "true";
  }
  if (/^(null|~)$/i.test(trimmed)) {
    return null;
  }
  if (/^-?\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    if (Number.isSafeInteger(value)) return value;
    return trimmed;
  }
  if (/^-?\d+\.\d+$/.test(trimmed) || /^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : undefined;
  }
  return trimmed;
}

function parseSingleQuoted(raw: string): string | undefined {
  let result = "";
  let index = 1;
  while (index < raw.length) {
    const char = raw[index] as string;
    if (char === "'") {
      if (raw[index + 1] === "'") {
        result += "'";
        index += 2;
        continue;
      }
      return index + 1 === raw.length ? result : undefined;
    }
    result += char;
    index += 1;
  }
  return undefined;
}

function parseDoubleQuoted(raw: string): string | undefined {
  let result = "";
  let index = 1;
  while (index < raw.length) {
    const char = raw[index] as string;
    if (char === '"') {
      return index + 1 === raw.length ? result : undefined;
    }
    if (char === "\\") {
      const next = raw[index + 1];
      switch (next) {
        case '"':
          result += '"';
          index += 2;
          continue;
        case "\\":
          result += "\\";
          index += 2;
          continue;
        case "n":
          result += "\n";
          index += 2;
          continue;
        case "t":
          result += "\t";
          index += 2;
          continue;
        case "r":
          result += "\r";
          index += 2;
          continue;
        case "u": {
          const hex = raw.slice(index + 2, index + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return undefined;
          result += String.fromCharCode(Number.parseInt(hex, 16));
          index += 6;
          continue;
        }
        default:
          return undefined;
      }
    }
    result += char;
    index += 1;
  }
  return undefined;
}

/** 解析 flow 陣列（`[a, b]`）；支援巢狀與引號。回錯誤訊息字串或字串陣列。 */
function parseFlowArray(raw: string, field: string): string[] | string {
  const trimmed = raw.trim();
  if (!trimmed.endsWith("]")) {
    return `${field} 的陣列沒有結尾的 ]`;
  }
  const inner = trimmed.slice(1, -1);
  const values: string[] = [];
  for (const item of splitFlow(inner)) {
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    const parsed = parseFlowScalar(trimmed);
    if (parsed === undefined || typeof parsed === "object") {
      return `${field} 的項目不是單一值`;
    }
    values.push(parsed === null ? "" : String(parsed));
  }
  return values;
}

/** 解析 flow mapping（`{a: 1, b: x}`）。 */
function parseFlowMapping(raw: string): Record<string, string> | undefined {
  const trimmed = raw.trim();
  if (!trimmed.endsWith("}")) return undefined;
  const inner = trimmed.slice(1, -1);
  const result: Record<string, string> = {};
  for (const item of splitFlow(inner)) {
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    const colon = findMappingColon(trimmed);
    if (colon <= 0) return undefined;
    const key = trimmed.slice(0, colon).trim();
    const value = parseFlowScalar(trimmed.slice(colon + 1).trim());
    if (value === undefined || typeof value === "object") return undefined;
    result[key] = value === null ? "" : String(value);
  }
  return result;
}

/** 以頂層逗號切開 flow 內容；逗號在引號或括號內不算。 */
function splitFlow(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let current = "";
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index] as string;
    if (quote !== null) {
      current += char;
      if (char === quote) {
        if (char === "'" && inner[index + 1] === "'") {
          current += "'";
          index += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[" || char === "{") depth += 1;
    if (char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}

function findMappingColon(text: string): number {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === ":") {
      return index;
    }
  }
  return -1;
}

/** 序列化 frontmatter 的字串值；必要時加引號。 */
export function yamlScalar(value: string): string {
  if (value.length === 0) return '""';
  if (/[\n\r]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;
  }
  // 時間戳（RFC 3339）不加引號：使用者手寫的卡片與服務寫的卡片長得一樣，
  // 補丁也不該每改一次就換一種寫法。
  if (RFC3339_PLAIN.test(value)) return value;
  const plain = /^[A-Za-z0-9_][A-Za-z0-9 _\-./#()[\]]*$/.test(value);
  const looksLikeValue =
    /^(true|false|null|~|yes|no|on|off)$/i.test(value) ||
    /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value);
  if (plain && !looksLikeValue && !value.includes(": ") && !value.endsWith(":")) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const RFC3339_PLAIN =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))$/;

function yamlFlowArray(values: readonly string[]): string {
  return `[${values.map((value) => yamlScalar(value)).join(", ")}]`;
}

/**
 * 序列化整個卡片檔。
 *
 * 欄位的寫出順序依 `layout`（原檔版面），沒有版面時依 `presentKeys`；
 * 整行的註解留在原本的位置，同行尾端的註解留在同一個欄位後面。
 * 只有 `presentKeys` 裡的已知欄位會被寫出（服務不會無中生有；`updated`
 * 由呼叫端先放進 `presentKeys`），未知欄位一律照原文寫回。
 *
 * 已知欄位用標準形式重寫；未知欄位連缩排與內容都不動。內部的換行一律
 * 用檔案自己的換行字元，CRLF 的卡片不會混進 LF。
 */
export function serializeCardFile(input: {
  readonly frontmatter: CardFrontmatter;
  readonly presentKeys: readonly string[];
  readonly body: string;
  readonly lineEnding?: CardFileLineEnding;
  readonly layout?: readonly FrontmatterLayoutItem[];
}): string {
  const { frontmatter, body } = input;
  const extra = frontmatter.extra;
  const le = input.lineEnding ?? "\n";
  const writable = new Set<string>(input.presentKeys);
  for (const key of Object.keys(extra)) writable.add(key);
  const inlineComments = new Map<string, string>();
  for (const item of input.layout ?? []) {
    if (item.kind === "field" && item.inlineComment !== undefined) {
      inlineComments.set(item.key, item.inlineComment);
    }
  }
  const lines: string[] = ["---"];
  const emitted = new Set<string>();
  const push = (key: string): void => {
    if (emitted.has(key) || !writable.has(key)) return;
    emitted.add(key);
    const rendered = renderField(key, frontmatter);
    if (rendered === null || rendered.length === 0) return;
    const comment = inlineComments.get(key);
    if (comment !== undefined) rendered[0] = `${rendered[0] as string} ${comment}`;
    lines.push(...rendered);
  };
  for (const item of input.layout ?? []) {
    if (item.kind === "comment") {
      lines.push(item.text);
      continue;
    }
    push(item.key);
  }
  for (const key of input.presentKeys) push(key);
  for (const key of Object.keys(extra)) push(key);
  lines.push("---");
  return lines.join(le) + le + body;
}

/** 單一欄位的輸出；`null` 代表這個欄位沒有值、不寫。 */
function renderField(key: string, frontmatter: CardFrontmatter): string[] | null {
  const raw = frontmatter.extra[key];
  if (raw !== undefined) {
    // 未知欄位的原文：第一個元素是鍵後面那一行剩下的部分（可能是空字串），
    // 其餘是縮排的內容。逐行推出去，換行字元才由呼叫端統一。
    const [first = "", ...rest] = raw.split("\n");
    return [`${key}:${first}`, ...rest];
  }
  switch (key) {
    case "id":
      return [`id: ${yamlScalar(frontmatter.id)}`];
    case "kind":
      return [`kind: ${yamlScalar(frontmatter.kind)}`];
    case "title":
      return [`title: ${yamlScalar(frontmatter.title)}`];
    case "summary":
      return frontmatter.summary === undefined
        ? null
        : [`summary: ${yamlScalar(frontmatter.summary)}`];
    case "created":
      return [`created: ${yamlScalar(frontmatter.created)}`];
    case "updated":
      return frontmatter.updated === undefined
        ? null
        : [`updated: ${yamlScalar(frontmatter.updated)}`];
    case "sources":
      return [`sources: ${yamlFlowArray(frontmatter.sources)}`];
    case "supersedes":
      return frontmatter.supersedes === undefined
        ? null
        : [`supersedes: ${yamlScalar(frontmatter.supersedes)}`];
    case "tags":
      return [`tags: ${yamlFlowArray(frontmatter.tags)}`];
    case "asset":
      return frontmatter.asset === undefined ? null : [`asset: ${yamlScalar(frontmatter.asset)}`];
    case "persona":
      return [`persona: ${yamlScalar(frontmatter.persona)}`];
    case "importedFrom": {
      const imported = frontmatter.importedFrom;
      if (imported === undefined) return null;
      return [
        "importedFrom:",
        `  tool: ${yamlScalar(imported.tool)}`,
        `  path: ${yamlScalar(imported.path)}`,
        `  hash: ${yamlScalar(imported.hash)}`,
      ];
    }
    default:
      // 未知欄位沒有原文就沒有東西可寫（服務不自己造欄位）。
      return null;
  }
}

/** 計算 revision：正規化後的內容（frontmatter 依鍵排序、內文原樣）的 SHA-256。 */
export function computeRevision(frontmatter: CardFrontmatter, body: string): string {
  const view: Record<string, unknown> = {
    id: frontmatter.id,
    kind: frontmatter.kind,
    title: frontmatter.title,
    created: frontmatter.created,
    persona: frontmatter.persona,
  };
  if (frontmatter.summary !== undefined) view["summary"] = frontmatter.summary;
  if (frontmatter.updated !== undefined) view["updated"] = frontmatter.updated;
  view["sources"] = [...frontmatter.sources];
  if (frontmatter.supersedes !== undefined) view["supersedes"] = frontmatter.supersedes;
  view["tags"] = [...frontmatter.tags];
  if (frontmatter.asset !== undefined) view["asset"] = frontmatter.asset;
  if (frontmatter.importedFrom !== undefined) {
    view["importedFrom"] = {
      hash: frontmatter.importedFrom.hash,
      path: frontmatter.importedFrom.path,
      tool: frontmatter.importedFrom.tool,
    };
  }
  const extra: Record<string, string> = {};
  for (const key of Object.keys(frontmatter.extra).sort()) {
    extra[key] = normalizeRawBlock(frontmatter.extra[key] as string);
  }
  if (Object.keys(extra).length > 0) {
    view["extra"] = extra;
  }
  return sha256Hex(stableStringify({ frontmatter: view, body }));
}

function normalizeRawBlock(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const [first = "", ...restLines] = lines;
  const nonEmpty = restLines.filter((line) => line.trim().length > 0);
  let dedent = 0;
  if (nonEmpty.length > 0) {
    dedent = Number.POSITIVE_INFINITY;
    for (const line of nonEmpty) {
      dedent = Math.min(dedent, /^ */.exec(line)?.[0].length ?? 0);
    }
  }
  const trimmedRest = nonEmpty.length === 0 ? [] : restLines.map((line) => line.slice(dedent));
  return [first, ...trimmedRest]
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .replace(/\n*$/u, "");
}

/** 去重標籤並保留原順序；上限 TAGS_MAX_COUNT。 */
export function dedupeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
    if (result.length >= TAGS_MAX_COUNT) break;
  }
  return result;
}
