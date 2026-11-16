/**
 * 通知的儲存；正本就是 `notifications` 表。
 *
 * 語義（對應 `docs/design/m2-scheduler.md` 第 5 節與規格書第 5 章）：
 *
 * - 90 天保留；未讀（`read_at IS NULL`）永遠不因保留清理而刪除。
 * - `payload_json` 是 JSON 物件，大小上限 64 KB；建立時檢查。
 * - `card_id` 是轉卡的去重鍵：`notification.create_card` 重送回同一張卡。
 * - 分頁的 `before` 是通知的 `notification_id`；排序固定
 *   `(created_at DESC, notification_id DESC)`。游標指到的列不存在時回空頁。
 */

import { newUlid } from "../ids.js";
import { StorageError } from "../errors.js";
import { nowIso } from "../util.js";
import type { Database } from "../db.js";

/** `notification.list` 的單頁上限。 */
export const NOTIFICATION_PAGE_MAX = 200;
/** 建立通知的 `payload` 上限。 */
export const NOTIFICATION_PAYLOAD_MAX_BYTES = 64 * 1024;
/** `notification.mark_read` 的 ids 上限。 */
export const NOTIFICATION_MARK_READ_MAX = 500;

export interface NotificationStoreOptions {
  readonly now?: () => Date;
}

export type { NotificationPage, NotificationRecord } from "@cardiary/domain";
import type {
  CreateNotificationInput as DomainCreateNotificationInput,
  NotificationPage,
  NotificationRecord,
} from "@cardiary/domain";

export interface NotificationListQuery {
  readonly limit?: number | undefined;
  readonly before?: string | undefined;
  readonly unreadOnly?: boolean | undefined;
}

export interface CreateNotificationInput extends DomainCreateNotificationInput {
  readonly id?: string | undefined;
  readonly createdAt?: string | undefined;
}

interface NotificationRow {
  readonly notification_id: string;
  readonly kind: string;
  readonly title: string;
  readonly body_md: string;
  readonly payload_json: string;
  readonly source_schedule_id: string | null;
  readonly source_conversation_id: string | null;
  readonly card_id: string | null;
  readonly created_at: string;
  readonly read_at: string | null;
}

export class NotificationStore {
  readonly #db: Database;
  readonly #now: () => Date;

  constructor(db: Database, options: NotificationStoreOptions = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
  }

  create(input: CreateNotificationInput): NotificationRecord {
    const title = input.title.trim();
    if (title.length === 0) {
      throw new StorageError("invalid-input", "通知標題不能是空的");
    }
    const payloadJson = encodePayload(input.payload);
    const now = input.createdAt ?? nowIso(this.#now);
    const id = input.id ?? `ntf_${newUlid(Date.parse(now) || Date.now())}`;
    this.#db.run(
      `INSERT INTO notifications (notification_id, kind, title, body_md, payload_json,
                                  source_schedule_id, source_conversation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.kind,
      title,
      input.body,
      payloadJson,
      input.sourceScheduleId ?? null,
      input.sourceConversationId ?? null,
      now,
    );
    const created = this.get(id);
    if (created === null) {
      throw new StorageError("storage-failed", "通知建立後讀不到，資料庫不一致");
    }
    return created;
  }

  get(notificationId: string): NotificationRecord | null {
    const row = this.#db.get<NotificationRow>(
      "SELECT * FROM notifications WHERE notification_id = ?",
      notificationId,
    );
    return row === undefined ? null : toNotification(row);
  }

  unreadCount(): number {
    const row = this.#db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL",
    );
    return row?.count ?? 0;
  }

  list(query: NotificationListQuery = {}): NotificationPage {
    const limit = clampLimit(query.limit);
    const totalUnread = this.unreadCount();
    let cursor: { created_at: string; notification_id: string } | undefined;
    if (query.before !== undefined) {
      const row = this.#db.get<NotificationRow>(
        "SELECT * FROM notifications WHERE notification_id = ?",
        query.before,
      );
      if (row === undefined) {
        // 游標指到的列不存在或已被清理：回空頁，讓客戶端重新同步。
        return { notifications: [], totalUnread };
      }
      cursor = { created_at: row.created_at, notification_id: row.notification_id };
    }
    const unreadOnly = query.unreadOnly === true ? 1 : 0;
    const rows = this.#db.all<NotificationRow>(
      `SELECT * FROM notifications
        WHERE (${cursor === undefined ? "1 = 1" : "(created_at, notification_id) < (?, ?)"})
          AND (? = 0 OR read_at IS NULL)
        ORDER BY created_at DESC, notification_id DESC
        LIMIT ?`,
      ...(cursor === undefined ? [] : [cursor.created_at, cursor.notification_id]),
      unreadOnly,
      limit + 1,
    );
    const page = rows.slice(0, limit).map(toNotification);
    const result: NotificationPage = { notifications: page, totalUnread };
    if (rows.length > limit) {
      const last = page.at(-1);
      if (last !== undefined) {
        return { ...result, nextCursor: last.notificationId };
      }
    }
    return result;
  }

  markRead(input: {
    readonly ids?: readonly string[] | undefined;
    readonly all?: boolean | undefined;
  }): {
    readonly updated: number;
    readonly totalUnread: number;
  } {
    const now = nowIso(this.#now);
    if (input.all === true) {
      const updated = this.#db.run(
        "UPDATE notifications SET read_at = ? WHERE read_at IS NULL",
        now,
      ).changes;
      return { updated, totalUnread: 0 };
    }
    const ids = input.ids ?? [];
    if (ids.length > NOTIFICATION_MARK_READ_MAX) {
      throw new StorageError(
        "invalid-input",
        `一次最多標記 ${NOTIFICATION_MARK_READ_MAX} 則通知為已讀`,
      );
    }
    if (ids.length === 0) {
      return { updated: 0, totalUnread: this.unreadCount() };
    }
    let updated = 0;
    this.#db.transaction((tx) => {
      for (const id of ids) {
        updated += tx.run(
          "UPDATE notifications SET read_at = ? WHERE notification_id = ? AND read_at IS NULL",
          now,
          id,
        ).changes;
      }
    });
    return { updated, totalUnread: this.unreadCount() };
  }

  /** 通知轉卡成功後記下卡片識別碼；之後重送回同一張卡。 */
  setCardId(notificationId: string, cardId: string): boolean {
    return (
      this.#db.run(
        "UPDATE notifications SET card_id = ? WHERE notification_id = ?",
        cardId,
        notificationId,
      ).changes > 0
    );
  }

  /** 90 天保留：只刪已讀且早於 `beforeIso` 的通知；回傳刪除的筆數。 */
  deleteOldReadNotifications(beforeIso: string): number {
    return this.#db.run(
      "DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < ?",
      beforeIso,
    ).changes;
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 50;
  }
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    return 50;
  }
  return Math.min(limit, NOTIFICATION_PAGE_MAX);
}

function encodePayload(payload: unknown): string {
  if (payload === undefined) {
    return "{}";
  }
  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StorageError("invalid-input", `通知 payload 不是可序列化的 JSON：${message}`);
  }
  if (json === undefined) {
    throw new StorageError("invalid-input", "通知 payload 不是可序列化的 JSON");
  }
  if (payload !== null && (typeof payload !== "object" || Array.isArray(payload))) {
    throw new StorageError("invalid-input", "通知 payload 必須是 JSON 物件");
  }
  if (Buffer.byteLength(json, "utf8") > NOTIFICATION_PAYLOAD_MAX_BYTES) {
    throw new StorageError("invalid-input", "通知 payload 超過 64 KB 上限");
  }
  return json;
}

function toNotification(row: NotificationRow): NotificationRecord {
  return {
    notificationId: row.notification_id,
    kind: row.kind as NotificationRecord["kind"],
    title: row.title,
    body: row.body_md,
    payloadJson: row.payload_json,
    sourceScheduleId: row.source_schedule_id,
    sourceConversationId: row.source_conversation_id,
    cardId: row.card_id,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}
