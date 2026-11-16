import type { ConversationSummary } from "@cardiary/engine-adapter";
import type { Database } from "@cardiary/storage";

/** 對話顯示標題存放在狀態庫；引擎對話仍是訊息正本。 */
export interface ConversationTitles {
  get(id: string): string | undefined;
  setFirst(summary: ConversationSummary, title: string): void;
}

export class MemoryConversationTitles implements ConversationTitles {
  readonly #titles = new Map<string, string>();

  get(id: string): string | undefined {
    return this.#titles.get(id);
  }

  setFirst(summary: ConversationSummary, title: string): void {
    if (!this.#titles.has(summary.id)) this.#titles.set(summary.id, title);
  }
}

export class StoredConversationTitles implements ConversationTitles {
  constructor(private readonly database: () => Database) {}

  get(id: string): string | undefined {
    return (
      this.database().get<{ title: string | null }>(
        "SELECT title FROM conversations WHERE conversation_id = ?",
        id,
      )?.title || undefined
    );
  }

  setFirst(summary: ConversationSummary, title: string): void {
    this.database().run(
      `INSERT INTO conversations (conversation_id, title, created_at, updated_at, last_activity_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (conversation_id) DO UPDATE SET title = excluded.title
       WHERE conversations.title IS NULL OR conversations.title = '' OR conversations.title = '新對話'`,
      summary.id,
      title,
      summary.createdAt,
      summary.updatedAt ?? summary.createdAt,
      summary.updatedAt ?? summary.createdAt,
    );
  }
}
