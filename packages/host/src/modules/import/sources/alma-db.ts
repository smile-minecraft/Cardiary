import type { ReadonlyQuery } from "../fs.js";

/**
 * Alma 的唯讀查詢（`chat_threads.db`）。
 *
 * 白名單：只查下面這幾張表，欄位一一列出，沒有 `SELECT *`。憑證表
 * （`providers`、`secrets`、`mcp_oauth_tokens`、`email_accounts`）不在這裡，
 * 也不會有任何查詢碰到；`crystals` 系列只數數量，不匯入（M1 的決定）。
 */

/** 這支轉接器會查的表；測試拿它比對實際送出的 SQL。 */
export const ALMA_READ_TABLES = [
  "memories",
  "memory_archive",
  "chat_threads",
  "chat_messages",
  "thread_briefs",
  "prompts",
  "crystals",
  "skills",
] as const;

/** 絕對不能出現的表名；憑證與登入資料。 */
export const ALMA_FORBIDDEN_TABLES = [
  "providers",
  "secrets",
  "mcp_oauth_tokens",
  "email_accounts",
] as const;

export interface AlmaMemoryRow {
  readonly id: string;
  readonly content: string;
  readonly metadata: string | null;
  readonly created_at: string;
}

export interface AlmaThreadRow {
  readonly id: string;
  readonly title: string | null;
  readonly created_at: string;
  readonly updated_at: string | null;
}

export interface AlmaBriefRow {
  readonly thread_id: string;
  readonly brief: string;
}

export interface AlmaPromptRow {
  readonly id: string;
  readonly name: string;
  readonly content: string;
}

export interface AlmaCountRow {
  readonly n: number | bigint;
}

export function readMemories(db: ReadonlyQuery): AlmaMemoryRow[] {
  return db.all<AlmaMemoryRow>(
    "SELECT id, content, metadata, created_at FROM memories ORDER BY created_at, id",
  );
}

export function countMeanings(
  db: ReadonlyQuery,
  table: "memory_archive" | "crystals" | "skills",
): number {
  const row = db.get<AlmaCountRow>(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(row?.n ?? 0);
}

export function readThreads(
  db: ReadonlyQuery,
  range: { start: string; end: string },
): AlmaThreadRow[] {
  return db.all<AlmaThreadRow>(
    `SELECT id, title, created_at, updated_at FROM chat_threads
     WHERE created_at >= ? AND created_at <= ?
     ORDER BY created_at, id`,
    range.start,
    range.end,
  );
}

export function readBriefs(db: ReadonlyQuery, threadIds: readonly string[]): AlmaBriefRow[] {
  if (threadIds.length === 0) return [];
  const rows: AlmaBriefRow[] = [];
  // SQLite 的參數數量有上限（999）；分批查，範圍大也不會整段失敗。
  const CHUNK = 500;
  for (let start = 0; start < threadIds.length; start += CHUNK) {
    const batch = threadIds.slice(start, start + CHUNK);
    const placeholders = batch.map(() => "?").join(", ");
    rows.push(
      ...db.all<AlmaBriefRow>(
        `SELECT thread_id, brief FROM thread_briefs WHERE thread_id IN (${placeholders})`,
        ...batch,
      ),
    );
  }
  return rows;
}

export function countMessages(db: ReadonlyQuery, threadId: string): number {
  const row = db.get<AlmaCountRow>(
    "SELECT COUNT(*) AS n FROM chat_messages WHERE thread_id = ?",
    threadId,
  );
  return Number(row?.n ?? 0);
}

export function readPrompts(db: ReadonlyQuery): AlmaPromptRow[] {
  return db.all<AlmaPromptRow>("SELECT id, name, content FROM prompts ORDER BY sort_order, id");
}

/** `thread_briefs.brief` 是 JSON；M1 只取 `conclusions`（設計決定）。 */
export function conclusionsOf(brief: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(brief);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const conclusions = (parsed as Record<string, unknown>)["conclusions"];
  if (typeof conclusions === "string") return conclusions.trim() || undefined;
  if (!Array.isArray(conclusions)) return undefined;
  const lines = conclusions
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  if (lines.length === 0) return undefined;
  return lines.map((line) => (line.startsWith("- ") ? line : `- ${line}`)).join("\n");
}

/** `memories.metadata` 的中繼資料；只取需要的鍵，缺欄位不補。 */
export interface AlmaMemoryMetadata {
  readonly importance?: number;
  readonly tags: readonly string[];
  readonly accessCount?: number;
}

export function memoryMetadata(raw: string | null): AlmaMemoryMetadata {
  if (raw === null) return { tags: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { tags: [] };
  }
  if (typeof parsed !== "object" || parsed === null) return { tags: [] };
  const record = parsed as Record<string, unknown>;
  const tags = Array.isArray(record["tags"])
    ? record["tags"].filter((tag): tag is string => typeof tag === "string")
    : [];
  const importance = typeof record["importance"] === "number" ? record["importance"] : undefined;
  const accessCount = typeof record["accessCount"] === "number" ? record["accessCount"] : undefined;
  return {
    tags,
    ...(importance === undefined ? {} : { importance }),
    ...(accessCount === undefined ? {} : { accessCount }),
  };
}
