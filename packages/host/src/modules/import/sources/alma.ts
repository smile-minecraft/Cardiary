import { basename } from "node:path";

import {
  contentHash,
  conversationContentHash,
  looksBinary,
  skillContentHash,
  skillFrontmatter,
  skillSlug,
  titleFrom,
} from "../interchange.js";
import type { ReadonlyDatabaseOpener, ReadonlyQuery, SourceFileSystem } from "../fs.js";
import type {
  ImportConversationCandidate,
  ImportItemDraft,
  ImportScanOptions,
  ImportScanResult,
  ImportSkipped,
  ImportSourceAdapter,
  ImportSourceNote,
} from "../types.js";
import {
  conclusionsOf,
  countMeanings,
  countMessages,
  memoryMetadata,
  readBriefs,
  readMemories,
  readPrompts,
  readThreads,
  type AlmaMemoryRow,
  type AlmaThreadRow,
} from "./alma-db.js";

/**
 * Alma 來源。
 *
 * 事實依 `docs/spikes/migration-sources.md`：對話、記憶與知識都在
 * `~/Library/Application Support/alma/chat_threads.db`，可以唯讀開啟（WAL）；
 * 人格沒有來源；`crystals` 系列先跳過；摘要卡只取 `thread_briefs.conclusions`；
 * `memories` 全部匯入並保留 `importance`。匯出檔（`threads.json`）為備援，
 * 結構未驗證，只做寬鬆解析。
 */
export function createAlmaAdapter(deps: {
  readonly fs: SourceFileSystem;
  readonly openDatabase: ReadonlyDatabaseOpener;
  readonly homeDir: string;
}): ImportSourceAdapter {
  return {
    kind: "alma",
    async scan(options: ImportScanOptions): Promise<ImportScanResult> {
      const path = options.path.trim() === "" ? defaultDatabasePath(deps.homeDir) : options.path;
      const items: ImportItemDraft[] = [];
      const conversations: ImportConversationCandidate[] = [];
      const skipped: ImportSkipped[] = [];
      const notes: ImportSourceNote[] = [];
      const warnings: string[] = [];

      const stat = await deps.fs.stat(path);
      if (stat.kind === "missing") {
        warnings.push("找不到 Alma 的資料庫或匯出檔。");
        return { tool: "alma", items, skills: [], conversations, skipped, notes, warnings };
      }

      let databasePath = path;
      if (stat.kind === "directory") {
        databasePath = `${path.replace(/\/$/u, "")}/chat_threads.db`;
        const inner = await deps.fs.stat(databasePath);
        if (inner.kind !== "file") {
          warnings.push("這個資料夾裡沒有 chat_threads.db。");
          return { tool: "alma", items, skills: [], conversations, skipped, notes, warnings };
        }
      }

      if (databasePath.endsWith(".json")) {
        conversations.push(
          ...(await readExportFile(deps.fs, databasePath, options, skipped, notes)),
        );
      } else if (/\.(db|sqlite|sqlite3)$/iu.test(databasePath)) {
        scanDatabase(deps.openDatabase, {
          path: databasePath,
          options,
          items,
          conversations,
          skipped,
          notes,
        });
      } else {
        skipped.push({ path: basename(databasePath), reason: "unsupported-format" });
        warnings.push("不認得的 Alma 來源格式：只支援 chat_threads.db 或 threads.json。");
      }

      notes.push({
        path: databasePath,
        detail: "Alma 沒有人格來源；人格卡由使用者自行撰寫或貼上。",
      });
      if (options.providedPersona !== undefined) {
        const persona = options.providedPersona;
        items.push({
          key: "provided:persona",
          category: "persona",
          title: titleFrom({ explicit: persona.title, body: persona.body, fallback: "人格" }),
          body: persona.body,
          tags: ["alma"],
          contentHash: contentHash({
            category: "persona",
            title: persona.title,
            body: persona.body,
          }),
          source: { tool: "alma", path: `${basename(databasePath)}#provided` },
        });
      }

      return { tool: "alma", items, skills: [], conversations, skipped, notes, warnings };
    },
  };
}

interface DatabaseScan {
  readonly path: string;
  readonly options: ImportScanOptions;
  readonly items: ImportItemDraft[];
  readonly conversations: ImportConversationCandidate[];
  readonly skipped: ImportSkipped[];
  readonly notes: ImportSourceNote[];
}

/** 單一表讀不了時不讓整個掃描失敗；記一筆跳過，其他項目照常匯入。 */
function tryRead<T>(scan: DatabaseScan, section: string, read: () => T): T | undefined {
  try {
    return read();
  } catch {
    scan.skipped.push({
      path: section,
      reason: "read-failed",
      detail: "這張表不存在或讀不了；其他項目照常匯入。",
    });
    return undefined;
  }
}

function scanDatabase(openDatabase: ReadonlyDatabaseOpener, scan: DatabaseScan): void {
  let database: ReadonlyQuery;
  try {
    database = openDatabase(scan.path);
  } catch {
    scan.skipped.push({ path: "chat_threads.db", reason: "not-readable" });
    return;
  }
  try {
    let memories: AlmaMemoryRow[];
    try {
      memories = readMemories(database);
    } catch {
      // 連 memories 都讀不了，這多半不是 Alma 的 chat_threads.db；
      // 其他表也不必再試，直接回報。
      scan.skipped.push({
        path: "chat_threads.db",
        reason: "not-readable",
        detail: "認不出 Alma 的 chat_threads.db（memories 表讀不了）。",
      });
      return;
    }
    for (const memory of memories) {
      const metadata = memoryMetadata(memory.metadata);
      const body = memory.content.trim();
      if (body === "") {
        scan.skipped.push({
          path: `memories/${memory.id}`,
          reason: "empty-content",
        });
        continue;
      }
      const legacyTitle = titleFrom({ body, fallback: "記憶" });
      const firstLine =
        body
          .split(/\r?\n/u)[0]
          ?.replace(/^#{1,6}\s*/u, "")
          .trim() || "記憶";
      const characters = [...firstLine];
      const title = characters.length > 60 ? `${characters.slice(0, 59).join("")}…` : firstLine;
      const tags = [
        "alma",
        ...metadata.tags,
        ...(metadata.importance === undefined ? [] : [`importance-${metadata.importance}`]),
      ];
      scan.items.push({
        key: `alma:memory:${memory.id}`,
        category: "memory",
        title,
        body,
        tags,
        createdAt: memory.created_at,
        // 保留舊標題的雜湊，避免格式變更讓既有記憶被重複匯入。
        contentHash: contentHash({ category: "memory", title: legacyTitle, body }),
        source: { tool: "alma", path: `${basename(scan.path)}#memories/${memory.id}` },
        ...(metadata.importance === undefined ? {} : { importance: metadata.importance }),
      });
    }

    const archived = tryRead(scan, "memory_archive", () =>
      countMeanings(database, "memory_archive"),
    );
    if (archived !== undefined && archived > 0) {
      scan.skipped.push({
        path: "memory_archive",
        reason: "archived-memory",
        count: archived,
        detail: "被封存或合併的舊記憶；M1 不匯入",
      });
    }

    const crystals = tryRead(scan, "crystals", () => countMeanings(database, "crystals"));
    if (crystals !== undefined && crystals > 0) {
      scan.skipped.push({
        path: "crystals",
        reason: "crystals-not-imported",
        count: crystals,
        detail: "六類中介格式沒有主題知識的位置；M1 跳過，保留擴充點",
      });
    }

    const skills = tryRead(scan, "skills", () => countMeanings(database, "skills"));
    if (skills === 0) {
      scan.skipped.push({ path: "skills", reason: "skills-table-empty", count: 0 });
    }

    const prompts = tryRead(scan, "prompts", () => readPrompts(database));
    for (const prompt of prompts ?? []) {
      const body = prompt.content.trim();
      if (body === "") continue;
      const title = titleFrom({ explicit: prompt.name, body, fallback: "操作規則" });
      scan.items.push({
        key: `alma:prompt:${prompt.id}`,
        category: "rule",
        title,
        body,
        tags: ["alma"],
        contentHash: contentHash({ category: "rule", title, body }),
        source: { tool: "alma", path: `${basename(scan.path)}#prompts/${prompt.id}` },
      });
    }

    if (scan.options.includeConversations !== true) {
      scan.skipped.push({
        path: "chat_threads",
        reason: "conversations-not-selected",
        detail: "對話預設不匯入；選擇匯入要先指定時間範圍",
      });
      return;
    }
    const range = scan.options.range;
    if (range === undefined) return;
    let threads: AlmaThreadRow[];
    let briefs: Map<string, string>;
    try {
      threads = readThreads(database, range);
      briefs = new Map(
        readBriefs(
          database,
          threads.map((thread) => thread.id),
        ).map((row) => [row.thread_id, row.brief]),
      );
    } catch {
      // 對話的表讀不了：記憶與規則照上面匯入，對話列入跳過清單。
      scan.skipped.push({
        path: "chat_threads",
        reason: "read-failed",
        detail: "對話讀不了（可能缺表或讀不了）；其他項目照常匯入。",
      });
      return;
    }
    let withoutBrief = 0;
    let messagesFailed = 0;
    for (const thread of threads) {
      const brief = briefs.get(thread.id);
      const conclusions = brief === undefined ? undefined : conclusionsOf(brief);
      const updatedAt = thread.updated_at ?? thread.created_at;
      if (conclusions === undefined) {
        withoutBrief += 1;
        continue;
      }
      let messageCount = 0;
      try {
        messageCount = countMessages(database, thread.id);
      } catch {
        // 訊息表讀不了就記一次；對話照匯入，最後統一回報。
        messagesFailed += 1;
      }
      scan.conversations.push({
        key: `alma:conversation:${thread.id}`,
        title: thread.title?.trim() || "未命名對話",
        createdAt: thread.created_at,
        updatedAt,
        messageCount,
        characterCount: conclusions.length,
        existingSummary: conclusions,
        contentHash: conversationContentHash({ tool: "alma", anchor: thread.id, updatedAt }),
        source: { tool: "alma", path: `${basename(scan.path)}#threads/${thread.id}` },
      });
    }
    if (messagesFailed > 0) {
      scan.skipped.push({
        path: "chat_messages",
        reason: "read-failed",
        count: messagesFailed,
        detail: "訊息數讀不了；對話仍匯入，預估用量不含訊息數。",
      });
    }
    if (withoutBrief > 0) {
      scan.skipped.push({
        path: "thread_briefs",
        reason: "no-brief",
        count: withoutBrief,
        detail: "沒有 thread_briefs.conclusions；M1 不自行摘要 Alma 的對話",
      });
    }
    scan.notes.push({
      path: "thread_briefs",
      detail: "摘要卡只取 conclusions；topic、goal、objects、followUp 不進卡片。",
      count: scan.conversations.length,
    });
  } finally {
    database.close();
  }
}

/**
 * 匯出檔（`threads.json`）的寬鬆解析。
 *
 * 這個格式在本機找不到範例，欄位未知；只接受看得出訊息角色與時間的形狀，
 * 其餘跳過並回報，不猜測。
 */
async function readExportFile(
  fs: SourceFileSystem,
  path: string,
  options: ImportScanOptions,
  skipped: ImportSkipped[],
  notes: ImportSourceNote[],
): Promise<ImportConversationCandidate[]> {
  if (options.includeConversations !== true) {
    skipped.push({ path: basename(path), reason: "conversations-not-selected" });
    return [];
  }
  const range = options.range;
  if (range === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse((await fs.readText(path, { maxBytes: 32 * 1024 * 1024 })).text);
  } catch {
    skipped.push({ path: basename(path), reason: "unsupported-format", detail: "不是合法的 JSON" });
    return [];
  }
  const threads = threadsOfExport(parsed);
  if (threads === undefined) {
    skipped.push({
      path: basename(path),
      reason: "unsupported-format",
      detail: "認不出 threads.json 的結構（未驗證的匯出格式）",
    });
    return [];
  }
  const candidates: ImportConversationCandidate[] = [];
  for (const thread of threads) {
    const createdAt = thread.createdAt;
    if (createdAt === undefined || createdAt < range.start || createdAt > range.end) continue;
    const anchor = thread.id ?? thread.title ?? createdAt;
    const updatedAt = thread.updatedAt ?? createdAt;
    const summary = conclusionsFromExport(thread.summary);
    const transcript = thread.messages
      .map((message) => `${message.role === "assistant" ? "助理" : "使用者"}：${message.content}`)
      .join("\n");
    if (summary === undefined && transcript.trim() === "") continue;
    candidates.push({
      key: `alma:conversation:${anchor}`,
      title: thread.title ?? "未命名對話",
      createdAt,
      updatedAt,
      messageCount: thread.messages.length,
      characterCount: summary?.length ?? transcript.length,
      ...(summary === undefined ? {} : { existingSummary: summary }),
      contentHash: conversationContentHash({ tool: "alma", anchor, updatedAt }),
      source: { tool: "alma", path: `${basename(path)}#threads/${anchor}` },
      unverified: true,
    });
  }
  notes.push({
    path: basename(path),
    detail: "Alma 匯出檔的欄位是寬鬆解析；官方 threads.json 的結構沒有驗證。",
    count: candidates.length,
  });
  return candidates;
}

interface ExportThread {
  readonly id?: string;
  readonly title?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly summary?: unknown;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
}

function threadsOfExport(value: unknown): ExportThread[] | undefined {
  const list = Array.isArray(value)
    ? value
    : typeof value === "object" &&
        value !== null &&
        Array.isArray((value as Record<string, unknown>)["threads"])
      ? ((value as Record<string, unknown>)["threads"] as unknown[])
      : undefined;
  if (list === undefined) return undefined;
  const threads: ExportThread[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = stringOf(record["id"] ?? record["threadId"]);
    const title = stringOf(record["title"]);
    const createdAt = stringOf(record["createdAt"] ?? record["created_at"]);
    const updatedAt = stringOf(record["updatedAt"] ?? record["updated_at"]);
    const messages = Array.isArray(record["messages"])
      ? (record["messages"] as unknown[])
          .map((message) => {
            if (typeof message !== "object" || message === null) return undefined;
            const row = message as Record<string, unknown>;
            const role = stringOf(row["role"]) ?? "user";
            const content = stringOf(row["content"] ?? row["text"]);
            return content === undefined ? undefined : { role, content };
          })
          .filter((message): message is { role: string; content: string } => message !== undefined)
      : [];
    threads.push({
      ...(id === undefined ? {} : { id }),
      ...(title === undefined ? {} : { title }),
      ...(createdAt === undefined ? {} : { createdAt }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
      ...(record["summary"] === undefined ? {} : { summary: record["summary"] }),
      messages,
    });
  }
  return threads;
}

function conclusionsFromExport(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const lines = value.filter(
      (line): line is string => typeof line === "string" && line.trim() !== "",
    );
    return lines.length === 0 ? undefined : lines.map((line) => `- ${line}`).join("\n");
  }
  if (typeof value === "object" && value !== null) {
    const conclusions = (value as Record<string, unknown>)["conclusions"];
    return conclusionsFromExport(conclusions);
  }
  return undefined;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Alma 的預設資料位置；沒有 App Sandbox，所以不在 `~/Library/Containers`。 */
export function defaultDatabasePath(homeDir: string): string {
  return `${homeDir}/Library/Application Support/alma/chat_threads.db`;
}

export { skillContentHash, skillFrontmatter, skillSlug, looksBinary };
