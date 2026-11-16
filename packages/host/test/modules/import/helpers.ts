import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { DatabaseSync } from "node:sqlite";

import type { ModelInvoker, ModuleLogger } from "@cardiary/module-api";
import {
  CardFileStore,
  CardIndexStore,
  LocalAssetStore,
  Storage,
  type Database,
} from "@cardiary/storage";

import { CardLibrary } from "../../../src/modules/cards/library.js";
import { CardStateStore } from "../../../src/modules/cards/state.js";
import { ImportCardWriter } from "../../../src/modules/import/card-writer.js";
import {
  nodeReadonlyDatabase,
  nodeSourceFileSystem,
  type ReadonlyDatabaseOpener,
  type SourceFileSystem,
} from "../../../src/modules/import/fs.js";
import { ImportService } from "../../../src/modules/import/service.js";
import { FileSkillCopier } from "../../../src/modules/import/skills.js";
import { createAlmaAdapter } from "../../../src/modules/import/sources/alma.js";
import { createGenericAdapter } from "../../../src/modules/import/sources/generic.js";
import { createHermesAdapter } from "../../../src/modules/import/sources/hermes.js";
import {
  createCodexAdapter,
  createClaudeCodeAdapter,
} from "../../../src/modules/import/sources/coding-agents.js";
import { ImportJobStore } from "../../../src/modules/import/store.js";

/**
 * 匯入模組的測試替身。
 *
 * 卡片是真的檔案、索引是真的 SQLite、來源是真的資料夾或資料庫；只有模型與
 * 檔案存取紀錄是替身。「來源沒有被讀取」「來源沒有被改」這兩件事靠注入的
 * 記錄版驗證，不靠程式碼自己說。
 */
export interface ImportFixture {
  readonly folder: string;
  readonly storage: Storage;
  readonly library: CardLibrary;
  readonly service: ImportService;
  readonly progress: Record<string, unknown>[];
  readonly logs: { level: string; message: string; fields?: unknown }[];
  readonly fs: RecordingFileSystem;
  readonly database: RecordingDatabase;
  close(): void;
}

export interface FixtureOptions {
  readonly models?: ModelInvoker | null;
  readonly homeDir?: string;
}

export async function makeImportFixture(options: FixtureOptions = {}): Promise<ImportFixture> {
  const folder = await mkdtemp(join(tmpdir(), "cardiary-import-"));
  const storage = Storage.open({ path: folder, initialize: true });
  const now = (): Date => new Date();
  const files = new CardFileStore({ layout: storage.layout, now });
  const indexFor = (database: Database): CardIndexStore =>
    new CardIndexStore({ db: database, now });
  let cachedDatabase: Database | null = null;
  let cachedIndex: CardIndexStore | null = null;
  const index = (): CardIndexStore => {
    const database = storage.cache;
    if (cachedIndex === null || cachedDatabase !== database) {
      cachedDatabase = database;
      cachedIndex = indexFor(database);
    }
    return cachedIndex;
  };
  let cachedAssets: LocalAssetStore | null = null;
  let cachedAssetDatabase: Database | null = null;
  const assets = (): LocalAssetStore => {
    const database = storage.cache;
    if (cachedAssets === null || cachedAssetDatabase !== database) {
      cachedAssetDatabase = database;
      cachedAssets = new LocalAssetStore({ layout: storage.layout, index: index(), now });
    }
    return cachedAssets;
  };
  const library = new CardLibrary({
    files,
    index,
    assets,
    state: new CardStateStore({ db: () => storage.state, now }),
    now,
  });
  await library.initialize();

  const fs = new RecordingFileSystem(nodeSourceFileSystem);
  const database = new RecordingDatabase(nodeReadonlyDatabase);
  const progress: Record<string, unknown>[] = [];
  const logs: { level: string; message: string; fields?: unknown }[] = [];
  const logger: ModuleLogger = {
    debug: (message, fields) =>
      logs.push({ level: "debug", message, ...(fields === undefined ? {} : { fields }) }),
    info: (message, fields) =>
      logs.push({ level: "info", message, ...(fields === undefined ? {} : { fields }) }),
    warn: (message, fields) =>
      logs.push({ level: "warn", message, ...(fields === undefined ? {} : { fields }) }),
    error: (message, fields) =>
      logs.push({ level: "error", message, ...(fields === undefined ? {} : { fields }) }),
  };
  const homeDir = options.homeDir ?? folder;
  const service = new ImportService({
    fs,
    openDatabase: database.open,
    adapters: new Map([
      ["generic", createGenericAdapter({ fs })],
      ["hermes", createHermesAdapter({ fs, openDatabase: database.open, homeDir })],
      ["alma", createAlmaAdapter({ fs, openDatabase: database.open, homeDir })],
      ["codex", createCodexAdapter({ fs })],
      ["claude-code", createClaudeCodeAdapter({ fs })],
    ]),
    store: new ImportJobStore({ db: storage.state, now }),
    cards: new ImportCardWriter({ cardsDirectory: storage.layout.subfolderPath("cards"), now }),
    skills: new FileSkillCopier({ skillsDirectory: storage.layout.subfolderPath("skills") }),
    rescanCards: async () => {
      await library.rescan();
    },
    ...(options.models === null ? {} : { models: () => options.models ?? undefined }),
    emitProgress: (payload) => progress.push(payload),
    logger,
    homeDir,
  });

  return {
    folder,
    storage,
    library,
    service,
    progress,
    logs,
    fs,
    database,
    close: () => storage.close(),
  };
}

/** 記錄每一次檔案存取；產品實作照原樣轉呼。 */
export class RecordingFileSystem implements SourceFileSystem {
  readonly #inner: SourceFileSystem;
  readonly reads: string[] = [];
  readonly stats: string[] = [];
  readonly lists: string[] = [];

  constructor(inner: SourceFileSystem) {
    this.#inner = inner;
  }

  stat(path: string) {
    this.stats.push(path);
    return this.#inner.stat(path);
  }

  list(path: string) {
    this.lists.push(path);
    return this.#inner.list(path);
  }

  readText(path: string, options?: { readonly maxBytes?: number }) {
    this.reads.push(path);
    return this.#inner.readText(path, options);
  }

  realPath(path: string) {
    return this.#inner.realPath(path);
  }

  /** 有沒有開過這個檔名（不含目錄）。 */
  opened(fileName: string): boolean {
    return this.reads.some((path) => path.endsWith(`/${fileName}`) || path === fileName);
  }
}

/** 記錄每一條送出的 SQL；用來證明憑證表沒有被查。 */
export class RecordingDatabase {
  readonly statements: string[] = [];
  readonly #inner: ReadonlyDatabaseOpener;
  readonly open: ReadonlyDatabaseOpener;

  constructor(inner: ReadonlyDatabaseOpener) {
    this.#inner = inner;
    this.open = (path) => {
      const database = this.#inner(path);
      return {
        all: <T>(sql: string, ...params: readonly unknown[]) => {
          this.statements.push(sql);
          return database.all<T>(sql, ...params);
        },
        get: <T>(sql: string, ...params: readonly unknown[]) => {
          this.statements.push(sql);
          return database.get<T>(sql, ...params);
        },
        close: () => database.close(),
      };
    };
  }
}

/** 建立一棵來源檔案樹；回傳根目錄。 */
export async function makeTree(
  root: string,
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<string> {
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative);
    await mkdir(dirname(target), { recursive: true });
    if (typeof content === "string") {
      await writeFile(target, content, "utf8");
    } else {
      await writeFile(target, content);
    }
  }
  return root;
}

/** 來源目錄的快照：相對路徑、大小與修改時間。 */
export async function snapshotDirectory(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  const queue = [""];
  while (queue.length > 0) {
    const current = queue.shift() ?? "";
    const directory = current === "" ? root : join(root, current);
    const entries = await (
      await import("node:fs/promises")
    ).readdir(directory, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const relative = current === "" ? entry.name : `${current}/${entry.name}`;
      const target = join(root, relative);
      if (entry.isDirectory()) {
        queue.push(relative);
        snapshot[relative] = "directory";
        continue;
      }
      const stats = await stat(target);
      snapshot[relative] = `${stats.size}:${stats.mtimeMs}`;
    }
  }
  return snapshot;
}

export interface AlmaFixtureData {
  readonly memories: readonly {
    readonly id: string;
    readonly content: string;
    readonly importance?: number;
    readonly tags?: readonly string[];
    readonly createdAt?: string;
  }[];
  readonly archived?: readonly { readonly id: string; readonly content: string }[];
  readonly threads?: readonly {
    readonly id: string;
    readonly title: string;
    readonly createdAt: string;
    readonly updatedAt?: string;
    readonly messages?: number;
    readonly conclusions?: readonly string[];
  }[];
  readonly prompts?: readonly {
    readonly id: string;
    readonly name: string;
    readonly content: string;
  }[];
  readonly crystals?: number;
}

/**
 * 建立假的 `chat_threads.db`：表名與欄位照真實 Alma 的 schema，內容是合成的。
 *
 * 憑證表故意放進假金鑰；轉接器不該查它們，測試用送出的 SQL 驗證。
 */
export async function makeAlmaDatabase(path: string, data: AlmaFixtureData): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE chat_threads (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, model TEXT,
        metadata TEXT DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, parent_id TEXT, slot_id TEXT,
        depth INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL, timestamp TEXT NOT NULL,
        metadata TEXT DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        parent_tool_call_id TEXT
      );
      CREATE TABLE memories (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, metadata TEXT NOT NULL,
        thread_id TEXT, message_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        user_id TEXT
      );
      CREATE TABLE memory_archive (
        id TEXT PRIMARY KEY, original_id TEXT NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL,
        thread_id TEXT, message_id TEXT, user_id TEXT, original_created_at TEXT NOT NULL,
        original_updated_at TEXT NOT NULL, archived_at TEXT NOT NULL, archived_reason TEXT NOT NULL,
        archived_by TEXT NOT NULL, merged_into TEXT
      );
      CREATE TABLE thread_briefs (
        thread_id TEXT PRIMARY KEY, brief TEXT NOT NULL, content_hash TEXT NOT NULL,
        material_len INTEGER NOT NULL DEFAULT 0, user_turns INTEGER NOT NULL DEFAULT 0,
        model TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE prompts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, content TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE skills (id TEXT PRIMARY KEY, path TEXT NOT NULL);
      CREATE TABLE crystals (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE providers (id TEXT PRIMARY KEY, api_key TEXT NOT NULL);
      CREATE TABLE secrets (id TEXT PRIMARY KEY, encrypted_value TEXT NOT NULL);
      CREATE TABLE mcp_oauth_tokens (
        id TEXT PRIMARY KEY, access_token TEXT NOT NULL, refresh_token TEXT NOT NULL, client_secret TEXT NOT NULL
      );
    `);
    const insertThread = database.prepare(
      "INSERT INTO chat_threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
    );
    const insertMessage = database.prepare(
      "INSERT INTO chat_messages (id, thread_id, message, timestamp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const thread of data.threads ?? []) {
      insertThread.run(
        thread.id,
        thread.title,
        thread.createdAt,
        thread.updatedAt ?? thread.createdAt,
      );
      for (let index = 0; index < (thread.messages ?? 0); index += 1) {
        insertMessage.run(
          `${thread.id}-m${index}`,
          thread.id,
          JSON.stringify({ role: index % 2 === 0 ? "user" : "assistant", parts: [] }),
          thread.createdAt,
          thread.createdAt,
          thread.createdAt,
        );
      }
      if (thread.conclusions !== undefined) {
        database
          .prepare(
            "INSERT INTO thread_briefs (thread_id, brief, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            thread.id,
            JSON.stringify({
              topic: "不該進卡片的主題",
              goal: "不該進卡片的目標",
              objects: ["不該進卡片的物件"],
              conclusions: thread.conclusions,
              followUp: ["不該進卡片的後續"],
            }),
            `hash-${thread.id}`,
            thread.createdAt,
            thread.createdAt,
          );
      }
    }
    const insertMemory = database.prepare(
      "INSERT INTO memories (id, content, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (const memory of data.memories) {
      insertMemory.run(
        memory.id,
        memory.content,
        JSON.stringify({
          source: "auto",
          tags: memory.tags ?? [],
          ...(memory.importance === undefined ? {} : { importance: memory.importance }),
          accessCount: 2,
        }),
        memory.createdAt ?? "2026-11-04T05:03:07.087Z",
        memory.createdAt ?? "2026-11-04T05:03:07.087Z",
      );
    }
    const insertArchive = database.prepare(
      `INSERT INTO memory_archive
        (id, original_id, content, metadata, original_created_at, original_updated_at,
         archived_at, archived_reason, archived_by)
       VALUES (?, ?, ?, '{}', ?, ?, ?, 'merged', 'auto')`,
    );
    for (const archived of data.archived ?? []) {
      insertArchive.run(
        archived.id,
        archived.id,
        archived.content,
        "2026-11-01T00:00:00.000Z",
        "2026-11-01T00:00:00.000Z",
        "2026-11-02T00:00:00.000Z",
      );
    }
    for (const [index, prompt] of (data.prompts ?? []).entries()) {
      database
        .prepare(
          "INSERT INTO prompts (id, name, content, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          prompt.id,
          prompt.name,
          prompt.content,
          index,
          "2026-11-01T00:00:00.000Z",
          "2026-11-01T00:00:00.000Z",
        );
    }
    for (let index = 0; index < (data.crystals ?? 0); index += 1) {
      database
        .prepare("INSERT INTO crystals (id, name) VALUES (?, ?)")
        .run(`crystal-${index}`, `主題 ${index}`);
    }
    database
      .prepare("INSERT INTO providers (id, api_key) VALUES (?, ?)")
      .run("openai", "sk-fake-provider-key");
    database
      .prepare("INSERT INTO secrets (id, encrypted_value) VALUES (?, ?)")
      .run("secret-1", "encrypted-fake-secret");
    database
      .prepare(
        "INSERT INTO mcp_oauth_tokens (id, access_token, refresh_token, client_secret) VALUES (?, ?, ?, ?)",
      )
      .run("token-1", "fake-access-token", "fake-refresh-token", "fake-client-secret");
  } finally {
    database.close();
  }
  return path;
}

/** 假的模型：回固定摘要，並記錄呼叫次數。 */
export function fakeImportModel(text = "使用者討論了儲藏室整理，決定週末再盤點。"): ModelInvoker & {
  readonly calls: { role: string; prompt: string }[];
} {
  const calls: { role: string; prompt: string }[] = [];
  return {
    calls,
    async invoke(request) {
      calls.push({ role: request.role, prompt: request.prompt });
      return { text };
    },
  };
}

/** 讀一張卡片檔的原文；測試看 frontmatter 用。 */
export async function readCardFile(folder: string, cardId: string): Promise<string> {
  return readFile(join(folder, "cards", `${cardId}.md`), "utf8");
}

/** 列出卡片檔名。 */
export async function cardFileNames(folder: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  return (await readdir(join(folder, "cards"))).filter((name) => name.endsWith(".md")).sort();
}
