import type { Database, Queryable } from "./db.js";
import { StorageError } from "./errors.js";

/** 一筆回合對照：`turnId = turn_<triggerMessageId>`。 */
export interface TurnRecord {
  readonly turnId: string;
  readonly conversationId: string;
  readonly triggerMessageId: string;
  readonly startedAt: string;
}

interface TurnRow {
  readonly turn_id: string;
  readonly conversation_id: string;
  readonly trigger_message_id: string;
  readonly started_at: string;
}

/**
 * `turn_index`：回合結束後仍能把觸發訊息對回 `turnId`。
 *
 * 閘道在寫 `stream.turn_started` 的同一個交易呼叫 `record`。
 */
export class TurnIndex {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** 寫入一筆對照；同一個 `turnId` 重複寫入時不變更既有列。 */
  record(turn: TurnRecord, tx?: Queryable): TurnRecord {
    const target = tx ?? this.#db;
    const existing = this.get(turn.turnId, tx);
    if (existing !== undefined) {
      return existing;
    }
    try {
      target.run(
        "INSERT INTO turn_index (turn_id, conversation_id, trigger_message_id, started_at) VALUES (?, ?, ?, ?)",
        turn.turnId,
        turn.conversationId,
        turn.triggerMessageId,
        turn.startedAt,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/UNIQUE constraint failed/i.test(message)) {
        throw error;
      }
      const conflicted = this.findByMessage(turn.conversationId, turn.triggerMessageId, tx);
      if (conflicted === undefined) {
        throw error;
      }
      return conflicted;
    }
    return turn;
  }

  /** 用 `turnId` 查詢。 */
  get(turnId: string, tx?: Queryable): TurnRecord | undefined {
    const row = (tx ?? this.#db).get<TurnRow>(
      "SELECT turn_id, conversation_id, trigger_message_id, started_at FROM turn_index WHERE turn_id = ?",
      turnId,
    );
    return row === undefined ? undefined : rowToRecord(row);
  }

  /** 用對話與觸發訊息查詢；回合結束後仍可用。 */
  findByMessage(
    conversationId: string,
    triggerMessageId: string,
    tx?: Queryable,
  ): TurnRecord | undefined {
    const row = (tx ?? this.#db).get<TurnRow>(
      `SELECT turn_id, conversation_id, trigger_message_id, started_at
       FROM turn_index WHERE conversation_id = ? AND trigger_message_id = ?`,
      conversationId,
      triggerMessageId,
    );
    return row === undefined ? undefined : rowToRecord(row);
  }

  /** 刪除子樹的回合對照；刪除對話時在同一個 Cardiary 交易呼叫。 */
  deleteForConversations(conversationIds: readonly string[], tx?: Queryable): number {
    if (conversationIds.length === 0) {
      return 0;
    }
    const target = tx ?? this.#db;
    let deleted = 0;
    for (const conversationId of conversationIds) {
      deleted += target.run(
        "DELETE FROM turn_index WHERE conversation_id = ?",
        conversationId,
      ).changes;
    }
    return deleted;
  }

  /** 驗證 `turnId` 的格式；呼叫端建立鍵之前先檢查。 */
  static turnIdFor(triggerMessageId: string): string {
    if (triggerMessageId.length === 0) {
      throw new StorageError("invalid-path", "觸發訊息識別碼不能是空字串");
    }
    return `turn_${triggerMessageId}`;
  }
}

function rowToRecord(row: TurnRow): TurnRecord {
  return {
    turnId: row.turn_id,
    conversationId: row.conversation_id,
    triggerMessageId: row.trigger_message_id,
    startedAt: row.started_at,
  };
}
