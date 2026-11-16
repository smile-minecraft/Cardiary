import type { JsonValue } from "@cardiary/engine-adapter";
import type { Card, CardService } from "@cardiary/domain";
import type { JSONObject } from "@cardiary/protocol";
import type { ProtocolEventEmitter, ProtocolRequestContext } from "@cardiary/module-api";
import {
  computeFirstRun,
  parseScheduleKind,
  parseScheduleSpec,
  parseScheduleTask,
} from "@cardiary/domain";
import type { Database, NotificationStore, ScheduleStore } from "@cardiary/storage";

import { ProtocolHandlerError } from "../contract.js";
import { notificationCardBody, wireNotification, wireRun, wireSchedule } from "./wire.js";

export interface NotificationProtocolDeps {
  readonly notifications: NotificationStore;
  readonly schedules: ScheduleStore;
  /** 卡片服務；`notification.create_card` 需要它。 */
  readonly cards: CardService | undefined;
  readonly db: Database;
  readonly now: () => Date;
  /** 新建或恢復過期排程時立刻補跑；省略時等下一次 30 秒 tick。 */
  readonly poke?: (() => void) | undefined;
}

export function registerNotificationProtocol(
  deps: NotificationProtocolDeps,
  protocol: ProtocolEventEmitter,
): void {
  protocol.registerNamespace(
    "notification",
    async (request: ProtocolRequestContext): Promise<JsonValue> => {
      try {
        switch (request.type) {
          case "notification.list":
            return listNotifications(deps, request.payload);
          case "notification.mark_read":
            return markRead(deps, request.payload);
          case "notification.create_card":
            return await createCard(deps, request.payload);
          default:
            throw new ProtocolHandlerError("not_found", `沒有這個通知訊息：${request.type}`);
        }
      } catch (error) {
        if (error instanceof ProtocolHandlerError) throw error;
        throw toHandlerError(error);
      }
    },
  );
}

export function registerSchedulerAdminProtocol(
  deps: NotificationProtocolDeps,
  protocol: ProtocolEventEmitter,
): void {
  protocol.registerNamespace(
    "module.scheduler",
    async (request: ProtocolRequestContext): Promise<JsonValue> => {
      const envelope = objectOf(request.payload);
      const payload = objectOf(envelope.data ?? {});
      try {
        const result = await dispatch(deps, request.type, payload);
        return { data: result } as unknown as JsonValue;
      } catch (error) {
        if (error instanceof ProtocolHandlerError) throw error;
        throw toHandlerError(error);
      }
    },
  );
}

// ---- notification.* ------------------------------------------------------

function listNotifications(deps: NotificationProtocolDeps, payload: JsonValue): JSONObject {
  const input = objectOf(payload);
  const limit = optionalInt(input, "limit", 1, 200);
  const before = optionalString(input, "before");
  const unreadOnly = input.unreadOnly === true ? true : undefined;
  if (input.unreadOnly !== undefined && typeof input.unreadOnly !== "boolean") {
    throw new ProtocolHandlerError("invalid_message", "unreadOnly 必須是布林值。", {
      field: "unreadOnly",
    });
  }
  const page = deps.notifications.list({
    ...(limit === undefined ? {} : { limit }),
    ...(before === undefined ? {} : { before }),
    ...(unreadOnly === true ? { unreadOnly: true } : {}),
  });
  return {
    notifications: page.notifications.map(wireNotification) as unknown as JsonValue[],
    totalUnread: page.totalUnread,
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  } as unknown as JSONObject;
}

function markRead(deps: NotificationProtocolDeps, payload: JsonValue): JSONObject {
  const input = objectOf(payload);
  const ids = input.ids;
  const all = input.all;
  const hasIds = ids !== undefined;
  const hasAll = all !== undefined;
  if (hasIds === hasAll) {
    throw new ProtocolHandlerError(
      "invalid_message",
      "notification.mark_read 需要 ids 或 all 其中之一（不能同時給）。",
      { field: hasAll ? "all" : "ids" },
    );
  }
  if (hasAll) {
    if (all !== true && all !== false) {
      throw new ProtocolHandlerError("invalid_message", "all 必須是布林值。", { field: "all" });
    }
    const result = deps.notifications.markRead({ all });
    return { updated: result.updated, totalUnread: result.totalUnread } as unknown as JSONObject;
  }
  if (!Array.isArray(ids) || ids.some((entry) => typeof entry !== "string")) {
    throw new ProtocolHandlerError("invalid_message", "ids 必須是字串陣列。", { field: "ids" });
  }
  if (ids.length > 500) {
    throw new ProtocolHandlerError("invalid_message", "ids 最多 500 筆。", { field: "ids" });
  }
  const result = deps.notifications.markRead({ ids: ids as string[] });
  return { updated: result.updated, totalUnread: result.totalUnread } as unknown as JSONObject;
}

async function createCard(deps: NotificationProtocolDeps, payload: JsonValue): Promise<JSONObject> {
  const input = objectOf(payload);
  const notificationId = requiredString(input, "notificationId");
  const record = deps.notifications.get(notificationId);
  if (record === null) {
    throw new ProtocolHandlerError("not_found", `找不到通知 ${notificationId}`, {
      notificationId,
    });
  }
  const cards = deps.cards;
  if (cards === undefined) {
    throw new ProtocolHandlerError("unavailable", "卡片服務不可用。");
  }
  if (record.cardId !== null) {
    // 已經轉過：回同一張卡。若卡被刪了，cardService.get 回 null，重新建一張。
    const existing = await cards.get(record.cardId);
    if (existing !== null) {
      return {
        card: wireCardSummary(existing, deps.db),
        deduped: true,
      } as unknown as JSONObject;
    }
  }
  const created = await cards.create({
    kind: "note",
    title: record.title,
    body: notificationCardBody(record),
    tags: ["通知"],
  });
  deps.notifications.setCardId(record.notificationId, created.cardId);
  return {
    card: wireCardSummary(created, deps.db),
    deduped: false,
  } as unknown as JSONObject;
}

function wireCardSummary(card: Card, db: Database): JSONObject {
  const row = db.get<{ freshness: number; lifecycle: string }>(
    "SELECT freshness, lifecycle FROM card_state WHERE card_id = ?",
    card.cardId,
  );
  const summary: Record<string, JsonValue> = {
    cardId: card.cardId,
    kind: card.frontmatter.kind,
    title: card.frontmatter.title,
    ...(card.frontmatter.summary === undefined ? {} : { summary: card.frontmatter.summary }),
    tags: [...card.frontmatter.tags],
    persona: card.frontmatter.persona,
    createdAt: card.frontmatter.created,
    ...(card.frontmatter.updated === undefined ? {} : { updatedAt: card.frontmatter.updated }),
    freshness: typeof row?.freshness === "number" ? row.freshness : 100,
    lifecycle: row?.lifecycle === "cold" ? "cold" : "live",
  };
  return summary as unknown as JSONObject;
}

// ---- module.scheduler.* ---------------------------------------------------

async function dispatch(
  deps: NotificationProtocolDeps,
  type: string,
  payload: Record<string, JsonValue>,
): Promise<JSONObject> {
  switch (type) {
    case "module.scheduler.list":
      return {
        schedules: deps.schedules.list().map(wireSchedule) as unknown as JsonValue[],
      } as unknown as JSONObject;
    case "module.scheduler.create":
      return createSchedule(deps, payload);
    case "module.scheduler.update":
      return updateSchedule(deps, payload);
    case "module.scheduler.delete": {
      const scheduleId = requiredString(payload, "scheduleId");
      return { deleted: deps.schedules.delete(scheduleId) } as unknown as JSONObject;
    }
    case "module.scheduler.runs": {
      const scheduleId = requiredString(payload, "scheduleId");
      const limit = optionalInt(payload, "limit", 1, 200) ?? 50;
      return {
        runs: deps.schedules.listRuns(scheduleId, limit).map(wireRun) as unknown as JsonValue[],
      } as unknown as JSONObject;
    }
    default:
      throw new ProtocolHandlerError("not_found", `沒有這個排程管理訊息：${type}`);
  }
}

function createSchedule(
  deps: NotificationProtocolDeps,
  payload: Record<string, JsonValue>,
): JSONObject {
  const name = requiredString(payload, "name");
  const kind = parseScheduleKind(payload.kind);
  const spec = parseScheduleSpec(kind, payload.spec);
  parseScheduleTask(payload.task);
  const schedule = deps.schedules.create({
    name,
    kind,
    rawSpec: payload.spec,
    rawTask: payload.task,
    createdBy: "user",
    nextRunAt: computeFirstRun(spec, deps.now().toISOString()),
  });
  if (Date.parse(schedule.nextRunAt) <= deps.now().getTime()) {
    deps.poke?.();
  }
  return { schedule: wireSchedule(schedule) } as unknown as JSONObject;
}

function updateSchedule(
  deps: NotificationProtocolDeps,
  payload: Record<string, JsonValue>,
): JSONObject {
  const scheduleId = requiredString(payload, "scheduleId");
  const existing = deps.schedules.get(scheduleId);
  if (existing === null) {
    throw new ProtocolHandlerError("not_found", `找不到排程 ${scheduleId}`, { scheduleId });
  }
  const enabled = payload.enabled;
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new ProtocolHandlerError("invalid_message", "enabled 必須是布林值。", {
      field: "enabled",
    });
  }
  // 暫停／恢復走專用路徑：恢復時要把過期的下一次推到未來。
  if (enabled === false) {
    deps.schedules.pause(scheduleId);
  } else if (enabled === true) {
    deps.schedules.resume(scheduleId);
    deps.poke?.();
  }
  const name = optionalString(payload, "name");
  const rawSpec = payload.spec;
  const rawTask = payload.task;
  const updated =
    name !== undefined || rawSpec !== undefined || rawTask !== undefined
      ? deps.schedules.update(scheduleId, {
          ...(name === undefined ? {} : { name }),
          ...(rawSpec === undefined ? {} : { rawSpec }),
          ...(rawTask === undefined ? {} : { rawTask }),
        })
      : deps.schedules.get(scheduleId);
  if (updated === null) {
    throw new ProtocolHandlerError("not_found", `找不到排程 ${scheduleId}`, { scheduleId });
  }
  return { schedule: wireSchedule(updated) } as unknown as JSONObject;
}

// ---- 小工具 ---------------------------------------------------------------

function objectOf(payload: JsonValue): Record<string, JsonValue> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new ProtocolHandlerError("invalid_message", "payload 必須是物件。", { field: "payload" });
  }
  return payload as Record<string, JsonValue>;
}

function requiredString(payload: Record<string, JsonValue>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProtocolHandlerError("invalid_message", `缺少 ${field}。`, { field });
  }
  return value;
}

function optionalString(payload: Record<string, JsonValue>, field: string): string | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ProtocolHandlerError("invalid_message", `${field} 必須是字串。`, { field });
  }
  return value;
}

function optionalInt(
  payload: Record<string, JsonValue>,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = payload[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ProtocolHandlerError(
      "invalid_message",
      `${field} 必須是 ${minimum} 到 ${maximum} 的整數。`,
      { field },
    );
  }
  return value;
}

function toHandlerError(error: unknown): ProtocolHandlerError {
  const message = error instanceof Error ? error.message : String(error);
  return new ProtocolHandlerError("invalid_message", message);
}
