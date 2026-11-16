/**
 * 通知服務的提供者：包住 storage 的 `NotificationStore`，對外只暴露
 * `NotificationService.create` 給蒸餾（與其他模組）使用。
 *
 * 蒸餾不自己寫通知表；通知的建立、未讀計數、`notification.changed` 事件與
 * 90 天保留都歸通知服務。通知建立後由 `ProtocolEventEmitter` 送完整的
 * `notification.changed`，客戶端才知道有新摘要。
 */

import type { NotificationService, NotificationInput, CreatedNotification } from "@cardiary/module-api";
import type { ProtocolEventEmitter } from "@cardiary/module-api";
import type { JsonValue } from "@cardiary/engine-adapter";
import { NotificationStore } from "@cardiary/storage";

export class HostNotificationService implements NotificationService {
  readonly #store: NotificationStore;
  readonly #protocol: ProtocolEventEmitter;

  constructor(store: NotificationStore, protocol: ProtocolEventEmitter) {
    this.#store = store;
    this.#protocol = protocol;
  }

  async create(input: NotificationInput): Promise<CreatedNotification> {
    const record = this.#store.create({
      kind: input.kind,
      title: input.title,
      body: input.body,
      ...(input.payload === undefined ? {} : { payload: input.payload }),
      ...(input.sourceScheduleId === undefined ? {} : { sourceScheduleId: input.sourceScheduleId }),
      ...(input.sourceConversationId === undefined
        ? {}
        : { sourceConversationId: input.sourceConversationId }),
    });
    this.#protocol.emit({
      kind: "notification-changed",
      notification: {
        notificationId: record.notificationId,
        kind: record.kind,
        title: record.title,
        body: record.body,
        createdAt: record.createdAt,
        ...(record.readAt === null ? {} : { readAt: record.readAt }),
        ...(record.sourceScheduleId === null ? {} : { sourceScheduleId: record.sourceScheduleId }),
        ...(record.sourceConversationId === null
          ? {}
          : { sourceConversationId: record.sourceConversationId }),
        payload: safeParseObject(record.payloadJson),
      } as JsonValue,
    });
    return { notificationId: record.notificationId };
  }

  store(): NotificationStore {
    return this.#store;
  }
}

function safeParseObject(text: string): Record<string, JsonValue> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, JsonValue>;
    }
  } catch {
    // 落入空物件。
  }
  return {};
}

/** 測試用的通知服務：記住建立過的通知，不碰資料庫。 */
export class InMemoryNotificationService implements NotificationService {
  readonly created: NotificationInput[] = [];

  async create(input: NotificationInput): Promise<CreatedNotification> {
    this.created.push(input);
    return { notificationId: `ntf_test_${this.created.length}` };
  }
}
