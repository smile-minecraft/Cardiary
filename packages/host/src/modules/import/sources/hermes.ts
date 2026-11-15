import { basename } from "node:path";

import {
  contentHash,
  conversationContentHash,
  looksBinary,
  skillContentHash,
  skillFrontmatter,
  skillSlug,
  splitEntries,
  titleFrom,
} from "../interchange.js";
import type { ReadonlyDatabaseOpener, ReadonlyQuery, SourceFileSystem } from "../fs.js";
import type {
  ImportConversationCandidate,
  ImportItemDraft,
  ImportScanOptions,
  ImportScanResult,
  ImportSkipped,
  ImportSkillDraft,
  ImportSourceNote,
  ImportSourceAdapter,
} from "../types.js";
import { staysInside } from "./generic.js";

/**
 * Hermes 來源。
 *
 * 這台機器沒有安裝 Hermes agent，`SOUL.md`、`memories/`、`state.db` 都不存在
 * （`docs/spikes/migration-sources.md`），所以 M1 只在真實安裝上驗證過
 * `skills/` 與 `config.yaml` 的形狀。轉接器仍然照規格書第 16 章的路徑實作，
 * 但對欄位差異寬鬆處理：讀不到就跳過並回報，`state.db` 的對話標成未驗證。
 *
 * 機密檔一律不開：`.env`、`auth.json`、`credentials*` 不在白名單裡；
 * `config.yaml` 只取鍵名，值（含 `headers.Authorization`）留在來源。
 */
export function createHermesAdapter(deps: {
  readonly fs: SourceFileSystem;
  readonly openDatabase: ReadonlyDatabaseOpener;
  readonly homeDir: string;
}): ImportSourceAdapter {
  return {
    kind: "hermes",
    async scan(options: ImportScanOptions): Promise<ImportScanResult> {
      const root = options.path.trim() === "" ? `${deps.homeDir}/.hermes` : options.path;
      const items: ImportItemDraft[] = [];
      const skills: ImportSkillDraft[] = [];
      const conversations: ImportConversationCandidate[] = [];
      const skipped: ImportSkipped[] = [];
      const warnings: string[] = [];
      const notes: ImportSourceNote[] = [];

      const rootStat = await deps.fs.stat(root);
      if (rootStat.kind !== "directory") {
        warnings.push("找不到 Hermes 資料夾（這台機器沒有安裝 agent）。");
        notes.push({
          path: root,
          detail: "Hermes agent 沒有安裝：SOUL.md、memories/ 與 state.db 都不存在。",
        });
        return {
          tool: "hermes",
          items,
          skills,
          conversations,
          skipped,
          notes,
          warnings,
        };
      }

      await readPersona(deps.fs, root, items, notes);
      await readMemories(deps.fs, root, "memories/USER.md", "user", items, notes);
      await readMemories(deps.fs, root, "memories/MEMORY.md", "memory", items, notes);
      await readSkills(deps.fs, root, skills, skipped);
      await readConfigShape(deps.fs, root, notes, skipped);

      if (options.includeConversations === true) {
        conversations.push(
          ...(await readStateDatabase(deps.openDatabase, deps.fs, root, options, skipped, notes)),
        );
      } else if ((await deps.fs.stat(`${root}/state.db`)).kind === "file") {
        skipped.push({
          path: "state.db",
          reason: "conversations-not-selected",
          detail: "對話預設不匯入；選擇匯入要先指定時間範圍",
        });
      }

      if (options.providedPersona !== undefined) {
        const persona = options.providedPersona;
        items.push({
          key: "provided:persona",
          category: "persona",
          title: titleFrom({ explicit: persona.title, body: persona.body, fallback: "人格" }),
          body: persona.body,
          tags: [],
          contentHash: contentHash({
            category: "persona",
            title: persona.title,
            body: persona.body,
          }),
          source: { tool: "hermes", path: `${root}#provided` },
        });
      }

      notes.push({
        path: root,
        detail: "M1 只在真實安裝上驗證 skills/ 與 config.yaml；state.db 的對話標為未驗證。",
      });
      return { tool: "hermes", items, skills, conversations, skipped, notes, warnings };
    },
  };
}

async function readPersona(
  fs: SourceFileSystem,
  root: string,
  items: ImportItemDraft[],
  notes: ImportSourceNote[],
): Promise<void> {
  const path = `${root}/SOUL.md`;
  const stat = await fs.stat(path);
  if (stat.kind !== "file") {
    notes.push({ path: "SOUL.md", detail: "找不到人格檔；Hermes agent 可能沒有安裝。" });
    return;
  }
  const file = await fs.readText(path);
  if (file.text.trim() === "" || looksBinary(file.text)) return;
  const title = titleFrom({ body: file.text, fallback: "人格" });
  items.push({
    key: "hermes:persona",
    category: "persona",
    title,
    body: file.text,
    tags: ["hermes"],
    contentHash: contentHash({ category: "persona", title, body: file.text }),
    source: { tool: "hermes", path },
  });
}

async function readMemories(
  fs: SourceFileSystem,
  root: string,
  relative: "memories/USER.md" | "memories/MEMORY.md",
  category: "user" | "memory",
  items: ImportItemDraft[],
  notes: ImportSourceNote[],
): Promise<void> {
  const path = `${root}/${relative}`;
  const stat = await fs.stat(path);
  if (stat.kind !== "file") {
    notes.push({ path: relative, detail: "找不到記憶檔。" });
    return;
  }
  const file = await fs.readText(path);
  if (looksBinary(file.text)) return;
  const entries = splitEntries(file.text);
  for (const [index, entry] of entries.entries()) {
    const title = titleFrom({ body: entry, fallback: `${basename(relative)} ${index + 1}` });
    items.push({
      key: `hermes:${category}:${index + 1}`,
      category,
      title,
      body: entry,
      ...optionalSummary(firstLine(entry)),
      tags: ["hermes"],
      contentHash: contentHash({ category, title, body: entry }),
      source: { tool: "hermes", path },
    });
  }
}

async function readSkills(
  fs: SourceFileSystem,
  root: string,
  skills: ImportSkillDraft[],
  skipped: ImportSkipped[],
): Promise<void> {
  const directory = `${root}/skills`;
  const stat = await fs.stat(directory);
  if (stat.kind !== "directory") {
    skipped.push({ path: "skills", reason: "not-readable", detail: "找不到技能資料夾" });
    return;
  }
  let entries;
  try {
    entries = await fs.list(directory);
  } catch {
    skipped.push({ path: "skills", reason: "not-readable" });
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.kind !== "directory" && entry.kind !== "symlink") continue;
    const skillDirectory = `${directory}/${entry.name}`;
    if (!(await staysInside(fs, root, skillDirectory))) {
      skipped.push({ path: `skills/${entry.name}`, reason: "symlink-outside-source" });
      continue;
    }
    const markdownPath = `${skillDirectory}/SKILL.md`;
    const markdownStat = await fs.stat(markdownPath);
    if (markdownStat.kind !== "file") {
      skipped.push({
        path: `skills/${entry.name}`,
        reason: "unsupported-format",
        detail: "沒有 SKILL.md",
      });
      continue;
    }
    const file = await fs.readText(markdownPath);
    if (looksBinary(file.text)) {
      skipped.push({ path: `skills/${entry.name}`, reason: "unsupported-format" });
      continue;
    }
    const frontmatter = skillFrontmatter(file.text);
    const name = frontmatter.name ?? entry.name;
    skills.push({
      key: `skill:hermes:${entry.name}`,
      name,
      description: frontmatter.description ?? "",
      slug: skillSlug(name),
      skillMarkdown: file.text,
      contentHash: skillContentHash(file.text),
      source: { tool: "hermes", path: markdownPath },
      attachmentsNotCopied: await countAttachments(fs, skillDirectory),
    });
  }
}

/** 逐層列出技能目錄裡的附屬檔案數量；只計數，不讀內容。 */
async function countAttachments(fs: SourceFileSystem, directory: string): Promise<number> {
  let count = 0;
  const queue = [directory];
  while (queue.length > 0 && count <= 5000) {
    const current = queue.shift();
    if (current === undefined) break;
    let entries;
    try {
      entries = await fs.list(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.kind === "directory") {
        queue.push(`${current}/${entry.name}`);
        continue;
      }
      if (entry.kind !== "file" && entry.kind !== "symlink") continue;
      if (current === directory && entry.name === "SKILL.md") continue;
      count += 1;
    }
  }
  return count;
}

/**
 * `config.yaml` 的形狀：只回報鍵名與數量。
 *
 * 這個檔案裡有 MCP 伺服器的 `headers.Authorization` 憑證；值不進回報、
 * 不進日誌，也不進任何卡片。
 */
async function readConfigShape(
  fs: SourceFileSystem,
  root: string,
  notes: ImportSourceNote[],
  skipped: ImportSkipped[],
): Promise<void> {
  const path = `${root}/config.yaml`;
  const stat = await fs.stat(path);
  if (stat.kind !== "file") return;
  let text: string;
  try {
    text = (await fs.readText(path, { maxBytes: 512 * 1024 })).text;
  } catch {
    skipped.push({ path: "config.yaml", reason: "not-readable" });
    return;
  }
  const shape = yamlKeyShape(text);
  notes.push({
    path: "config.yaml",
    detail: `只讀鍵名：頂層鍵 ${shape.topLevel.join("、") || "（空）"}；${
      shape.servers
    } 個 MCP 伺服器，${shape.sensitive} 個憑證欄位未讀取。`,
    count: shape.servers,
  });
}

/** 逐行取鍵名；縮排決定層級，值一律丟棄。 */
function yamlKeyShape(text: string): {
  readonly topLevel: readonly string[];
  readonly servers: number;
  readonly sensitive: number;
} {
  const topLevel: string[] = [];
  let servers = 0;
  let sensitive = 0;
  let section = "";
  for (const line of text.split(/\r?\n/u)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const match = /^(\s*)([A-Za-z0-9_.-]+):/u.exec(line);
    if (match === null) continue;
    const indent = match[1]?.length ?? 0;
    const key = match[2] ?? "";
    if (indent === 0) {
      topLevel.push(key);
      section = key;
      continue;
    }
    if (/authorization|api[-_]?key|secret|token|password|credential/iu.test(key)) {
      sensitive += 1;
      continue;
    }
    if (section === "mcp_servers" && indent === 2) servers += 1;
  }
  return { topLevel, servers, sensitive };
}

/**
 * `state.db` 的對話（第三方客戶端的簡化 schema，未驗證）。
 *
 * 只有使用者明確選了對話、而且指定時間範圍時才會開檔。找不到
 * `sessions`／`messages` 就跳過並標成未驗證，不猜測其他結構。
 */
async function readStateDatabase(
  openDatabase: ReadonlyDatabaseOpener,
  fs: SourceFileSystem,
  root: string,
  options: ImportScanOptions,
  skipped: ImportSkipped[],
  notes: ImportSourceNote[],
): Promise<ImportConversationCandidate[]> {
  const path = `${root}/state.db`;
  const stat = await fs.stat(path);
  if (stat.kind !== "file") {
    skipped.push({ path: "state.db", reason: "unverified-schema", detail: "找不到對話資料庫" });
    return [];
  }
  const range = options.range;
  if (range === undefined) return [];
  let database: ReadonlyQuery;
  try {
    database = openDatabase(path);
  } catch {
    skipped.push({ path: "state.db", reason: "not-readable" });
    return [];
  }
  try {
    const tables = database.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('sessions', 'messages')",
    );
    const names = new Set(tables.map((table) => table.name));
    if (!names.has("sessions") || !names.has("messages")) {
      skipped.push({
        path: "state.db",
        reason: "unverified-schema",
        detail: "找不到 sessions／messages；Hermes 的正式 schema 未驗證",
      });
      return [];
    }
    const sessions = database.all<{ id: string; title: string | null; started_at: string | null }>(
      `SELECT id, title, started_at FROM sessions
       WHERE started_at IS NOT NULL AND started_at >= ? AND started_at <= ?
       ORDER BY started_at`,
      range.start,
      range.end,
    );
    const candidates: ImportConversationCandidate[] = [];
    for (const session of sessions) {
      const stats = database.get<{ n: number | bigint; chars: number | bigint | null }>(
        "SELECT COUNT(*) AS n, SUM(LENGTH(content)) AS chars FROM messages WHERE session_id = ?",
        session.id,
      );
      const messageCount = Number(stats?.n ?? 0);
      if (messageCount === 0) continue;
      const transcript = transcriptOf(database, session.id);
      const createdAt = session.started_at ?? range.start;
      candidates.push({
        key: `hermes:conversation:${session.id}`,
        title: session.title?.trim() || "未命名對話",
        createdAt,
        messageCount,
        characterCount: transcript.length > 0 ? transcript.length : Number(stats?.chars ?? 0),
        ...(transcript === "" ? {} : { transcript }),
        contentHash: conversationContentHash({
          tool: "hermes",
          anchor: session.id,
          updatedAt: createdAt,
        }),
        source: { tool: "hermes", path: `${path}#sessions/${session.id}` },
        unverified: true,
      });
    }
    notes.push({
      path: "state.db",
      detail: "Hermes 的 state.db schema 來自第三方客戶端，沒有在真實安裝上驗證。",
      count: candidates.length,
    });
    return candidates;
  } catch {
    skipped.push({ path: "state.db", reason: "unverified-schema", detail: "讀取失敗" });
    return [];
  } finally {
    database.close();
  }
}

function optionalSummary(summary: string | undefined): { summary?: string } {
  return summary === undefined ? {} : { summary };
}

function firstLine(text: string): string | undefined {
  const line = text
    .split(/\r?\n/u)
    .map((entry) => entry.replace(/^#{1,6}\s*/u, "").trim())
    .find((entry) => entry.length > 0);
  return line === undefined ? undefined : [...line].slice(0, 200).join("");
}

/** 逐字稿只留在主機記憶體，給小模型摘要用；不進協定，也不落地。 */
function transcriptOf(database: ReadonlyQuery, sessionId: string): string {
  let rows: { role: string | null; content: string | null }[];
  try {
    rows = database.all<{ role: string | null; content: string | null }>(
      "SELECT role, content FROM messages WHERE session_id = ? ORDER BY timestamp, id",
      sessionId,
    );
  } catch {
    return "";
  }
  return rows
    .map((row) => {
      const role = row.role === "assistant" ? "助理" : "使用者";
      return `${role}：${(row.content ?? "").trim()}`;
    })
    .filter((line) => !line.endsWith("："))
    .join("\n")
    .slice(0, 120_000);
}
