/**
 * 排程、排程執行紀錄與通知的領域型別（核心，不含儲存細節）。
 *
 * 儲存層（`@cardiary/storage`）產生與消費這些型別；主機與模組只依賴這裡。
 * 時間一律是 RFC 3339 字串；布林用 0／1 落在 SQLite 的地方在儲存層轉換。
 */

/** 排程執行的最終狀態；`schedule_runs.status` 的允許值。 */
export type ScheduleRunStatus = "ok" | "silent" | "notify" | "error" | "cancelled";

/** `schedules.last_status` 的允許值。 */
export type ScheduleLastStatus = "ok" | "silent" | "notify" | "error";

export interface ScheduleRecord {
  readonly scheduleId: string;
  readonly persona: string;
  readonly name: string;
  readonly kind: "once" | "daily" | "interval" | "heartbeat";
  readonly spec: string;
  readonly task: string;
  readonly enabled: boolean;
  readonly createdBy: "user" | "agent";
  readonly sourceConversationId: string | null;
  readonly nextRunAt: string;
  readonly lastRunAt: string | null;
  readonly lastStatus: ScheduleLastStatus | null;
  readonly lastError: string | null;
  readonly runCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ScheduleRunRecord {
  readonly runId: string;
  readonly scheduleId: string;
  readonly conversationId: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly status: ScheduleRunStatus;
  readonly error: string | null;
}

export type NotificationKind = "schedule" | "heartbeat" | "distillation";

export interface NotificationRecord {
  readonly notificationId: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  /** 結構化資料的 JSON 文字；上限 64 KB，由儲存層檢查。 */
  readonly payloadJson: string;
  readonly sourceScheduleId: string | null;
  readonly sourceConversationId: string | null;
  /** 通知轉成的卡片；重送回同一張。 */
  readonly cardId: string | null;
  readonly createdAt: string;
  readonly readAt: string | null;
}

/** `notification.changed` 事件與通知建立共用的結構。 */
export interface CreateNotificationInput {
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  /** JSON 物件；`null` 等於 `{}`。超過 64 KB 就拋錯。 */
  readonly payload?: unknown;
  readonly sourceScheduleId?: string | undefined;
  readonly sourceConversationId?: string | undefined;
}

/** `notification.list` 的分頁輸入。 */
export interface NotificationListQuery {
  readonly limit: number;
  readonly before?: string | undefined;
  readonly unreadOnly?: boolean | undefined;
}

export interface NotificationPage {
  readonly notifications: readonly NotificationRecord[];
  readonly totalUnread: number;
  /** 下一頁的游標；沒有更多時省略。 */
  readonly nextCursor?: string;
}
