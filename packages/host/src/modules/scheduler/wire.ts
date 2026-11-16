import type { JSONObject } from "@cardiary/protocol";

import type { NotificationRecord, ScheduleRecord, ScheduleRunRecord } from "@cardiary/storage";

function parseJsonObject(text: string): JSONObject | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as JSONObject)
      : null;
  } catch {
    return null;
  }
}

/** 通知的 wire 形狀；與協定 `CardiaryNotification` 對齊。 */
export function wireNotification(record: NotificationRecord): JSONObject {
  let payload: JSONObject = {};
  try {
    const parsed = JSON.parse(record.payloadJson) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      payload = parsed as JSONObject;
    }
  } catch {
    // 儲存層已經保證是 JSON 物件；理論上到不了這裡。
  }
  return {
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
    payload,
  };
}

/** 排程的 wire 形狀；`spec` 與 `task` 已解析成物件。 */
export function wireSchedule(record: ScheduleRecord): JSONObject {
  const spec = parseJsonObject(record.spec);
  const task = parseJsonObject(record.task);
  return {
    scheduleId: record.scheduleId,
    persona: record.persona,
    name: record.name,
    kind: record.kind,
    spec,
    task,
    enabled: record.enabled,
    createdBy: record.createdBy,
    ...(record.sourceConversationId === null
      ? {}
      : { sourceConversationId: record.sourceConversationId }),
    nextRunAt: record.nextRunAt,
    ...(record.lastRunAt === null ? {} : { lastRunAt: record.lastRunAt }),
    ...(record.lastStatus === null ? {} : { lastStatus: record.lastStatus }),
    ...(record.lastError === null ? {} : { lastError: record.lastError }),
    runCount: record.runCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** 排程執行紀錄的 wire 形狀。 */
export function wireRun(record: ScheduleRunRecord): JSONObject {
  return {
    runId: record.runId,
    scheduleId: record.scheduleId,
    ...(record.conversationId === null ? {} : { conversationId: record.conversationId }),
    startedAt: record.startedAt,
    ...(record.finishedAt === null ? {} : { finishedAt: record.finishedAt }),
    status: record.status,
    ...(record.error === null ? {} : { error: record.error }),
  };
}

/**
 * 通知轉卡的內文：通知 body 之後附來源標記（規格書第 5 章「記錄來源」）。
 *
 * 來源標籤依通知 kind：排程、Heartbeat、每日蒸餾。
 */
export function notificationCardBody(record: NotificationRecord): string {
  const source =
    record.kind === "heartbeat"
      ? "Heartbeat"
      : record.kind === "distillation"
        ? "每日蒸餾"
        : "排程";
  return `${record.body}\n\n> 來源：${source}「${record.title}」${record.createdAt}`;
}
