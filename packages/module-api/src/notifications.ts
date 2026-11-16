import type { JsonValue } from "@cardiary/engine-adapter";

/** 通知的來源種類；與協定 `NotificationKind` 對齊。 */
export type NotificationKind = "schedule" | "heartbeat" | "distillation";

export interface NotificationInput {
  readonly kind: NotificationKind;
  /** 給人看的標題；不可空。 */
  readonly title: string;
  /** Markdown 內文；客戶端不渲染原始 HTML。 */
  readonly body: string;
  /**
   * `kind` 各自的結構化資料（例如蒸餾的逐項變更清單）。
   *
   * 必須是 JSON 物件；大小上限 64 KB——超過時 `create` 拋錯，不截斷、不靜默丟棄。
   */
  readonly payload?: { readonly [key: string]: JsonValue };
  /** 標明來源排程；排程模組執行時帶入。 */
  readonly sourceScheduleId?: string;
  /** 標明來源背景對話；排程模組執行時帶入。 */
  readonly sourceConversationId?: string;
}

export interface CreatedNotification {
  readonly notificationId: string;
}

/**
 * 給其他模組（目前是每日蒸餾）使用的受控通知介面。
 *
 * 蒸餾不自己寫通知儲存；一律經由這個服務建立通知，主機負責持久化、
 * 未讀計數、`notification.changed` 事件與 90 天保留。通知建立之後只有
 * 使用者或由使用者核准的路徑能把它轉成卡片；通知流本身是唯讀的。
 *
 * 取得方式：`context.services.host.require<NotificationService>(HOST_SERVICE_NAMES.notifications)`；
 * 沒有提供時主機回 `undefined`（模組自己降級，不要拋致命錯誤）。
 */
export interface NotificationService {
  /** 建立一則通知；回傳它的識別碼。 */
  create(input: NotificationInput): Promise<CreatedNotification>;
}
