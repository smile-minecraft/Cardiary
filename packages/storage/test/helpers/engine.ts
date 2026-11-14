import type { Database } from "../../src/index.js";
import {
  CLIENT_REQUEST_FORWARD_KIND,
  CLIENT_REQUEST_REVERSE_KIND,
  openEngineDatabase,
} from "../../src/index.js";

const ENGINE_SCHEMA = `
CREATE TABLE record_ids (
  id INTEGER PRIMARY KEY,
  record_type TEXT NOT NULL
) STRICT;
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  owner_conversation_id INTEGER,
  owner_task_id INTEGER,
  record TEXT NOT NULL
) STRICT;
CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  head INTEGER,
  commit_seq INTEGER NOT NULL,
  record TEXT NOT NULL
) STRICT;
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  abort_requested INTEGER NOT NULL,
  background INTEGER NOT NULL,
  record TEXT NOT NULL
) STRICT;
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  request_id TEXT,
  status TEXT NOT NULL,
  record TEXT NOT NULL
) STRICT;
CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  family INTEGER NOT NULL,
  key_value TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  retired_at INTEGER,
  record TEXT NOT NULL
) STRICT;
CREATE TABLE document_revisions (
  document_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (document_id, seq)
) STRICT;
`;

/** 用 Pi Durable 1.5.2 的引擎表結構建立測試用資料庫；不匯入引擎套件。 */
export class EngineFixture {
  readonly db: Database;

  constructor(filePath: string) {
    this.db = openEngineDatabase({ filePath });
    this.db.exec(ENGINE_SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  insertConversation(
    id: number,
    options: { readonly parentId?: number; readonly text?: string } = {},
  ): void {
    const record = {
      id,
      title: options.text ?? `conversation-${id}`,
      ...(options.parentId === undefined
        ? {}
        : { parent: { conversationId: options.parentId, at: 1 } }),
    };
    this.db.run(
      "INSERT INTO conversations (id, owner_conversation_id, owner_task_id, record) VALUES (?, ?, NULL, ?)",
      id,
      options.parentId ?? null,
      JSON.stringify(record),
    );
    this.db.run("INSERT INTO record_ids (id, record_type) VALUES (?, 'conversation')", id);
  }

  insertEntry(id: number, conversationId: number, text: string): void {
    this.db.run(
      "INSERT INTO entries (id, conversation_id, head, commit_seq, record) VALUES (?, ?, NULL, 1, ?)",
      id,
      conversationId,
      JSON.stringify({ id, kind: "pi.assistant", text }),
    );
    this.db.run("INSERT INTO record_ids (id, record_type) VALUES (?, 'entry')", id);
  }

  insertTask(id: number, conversationId: number, text: string): void {
    this.db.run(
      `INSERT INTO tasks (id, conversation_id, kind, status, abort_requested, background, record)
       VALUES (?, ?, 'turn', 'terminal', 0, 0, ?)`,
      id,
      conversationId,
      JSON.stringify({ id, text }),
    );
    this.db.run("INSERT INTO record_ids (id, record_type) VALUES (?, 'task')", id);
  }

  insertSubmission(
    id: number,
    conversationId: number,
    requestId: string | null,
    text: string,
  ): void {
    this.db.run(
      "INSERT INTO submissions (id, conversation_id, request_id, status, record) VALUES (?, ?, ?, 'done', ?)",
      id,
      conversationId,
      requestId,
      JSON.stringify({ id, text }),
    );
    this.db.run("INSERT INTO record_ids (id, record_type) VALUES (?, 'submission')", id);
  }

  insertDocument(options: {
    readonly id: number;
    readonly kind: string;
    readonly family?: number;
    readonly keyValue: string;
    readonly scopeKind: "session" | "conversation" | "task";
    readonly ownerId: number;
    readonly text: string;
    readonly record?: Record<string, unknown>;
  }): void {
    this.db.run(
      `INSERT INTO documents (id, kind, family, key_value, scope_kind, owner_id, created_at, retired_at, record)
       VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?)`,
      options.id,
      options.kind,
      options.family ?? 0,
      options.keyValue,
      options.scopeKind,
      options.ownerId,
      JSON.stringify(options.record ?? { text: options.text }),
    );
    this.db.run(
      `INSERT INTO document_revisions (document_id, seq, kind, version, content)
       VALUES (?, 1, 'base', 1, ?)`,
      options.id,
      JSON.stringify({ text: options.text }),
    );
    this.db.run("INSERT INTO record_ids (id, record_type) VALUES (?, 'document')", options.id);
  }

  /** 寫入 `clientRequestId` 的正向與反向 session 索引文件。 */
  insertClientRequestIndexes(
    conversationId: number,
    clientRequestId: string,
    forwardDocumentId: number,
    reverseDocumentId: number,
  ): void {
    this.insertDocument({
      id: forwardDocumentId,
      kind: CLIENT_REQUEST_FORWARD_KIND,
      keyValue: JSON.stringify(clientRequestId),
      scopeKind: "session",
      ownerId: 0,
      text: `forward-${clientRequestId}`,
      record: { conversationId: String(conversationId) },
    });
    this.insertDocument({
      id: reverseDocumentId,
      kind: CLIENT_REQUEST_REVERSE_KIND,
      keyValue: JSON.stringify(String(conversationId)),
      scopeKind: "session",
      ownerId: 0,
      text: `reverse-${conversationId}`,
      record: { clientRequestId },
    });
  }

  /** 某張表針對被刪 ID 的列數；測試逐一斷言 0。 */
  count(sql: string, ...params: readonly unknown[]): number {
    const row = this.db.get<{ n: number }>(sql, ...params);
    return Number(row?.n ?? 0);
  }
}
