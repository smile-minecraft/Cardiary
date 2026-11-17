process.env.TZ = "UTC";
import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { NotificationStore, ScheduleStore } from "../../src/index.js";
import { createTempRoot, openTestStorage } from "../helpers/temp.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

function fixture(): {
  readonly schedules: ScheduleStore;
  readonly notifications: NotificationStore;
  readonly storage: ReturnType<typeof openTestStorage>;
} {
  const temp = createTempRoot("schedules");
  const storage = openTestStorage(temp);
  cleanups.push(() => storage.close());
  cleanups.push(() => rmSync(temp.root, { recursive: true, force: true }));
  return {
    schedules: new ScheduleStore(storage.state, { now: () => FIXED_NOW }),
    notifications: new NotificationStore(storage.state),
    storage,
  };
}

const FIXED_NOW = new Date("2026-11-16T10:00:00.000Z");

function makeSchedule(store: ScheduleStore, overrides: Record<string, unknown> = {}) {
  return store.create({
    name: "每日蒸餾",
    kind: "daily",
    rawSpec: { time: "04:00" },
    rawTask: { type: "agent", prompt: "整理" },
    createdBy: "user",
    nextRunAt: "2026-11-17T04:00:00.000Z",
    ...overrides,
    // 保持型別檢查：nextRunAt 可被 overrides 蓋掉。
  } as Parameters<ScheduleStore["create"]>[0]);
}

describe("排程儲存", () => {
  it("建立、讀取、列出；next_run_at 順序由近到遠", () => {
    const { schedules } = fixture();
    const created = makeSchedule(schedules);
    expect(created.scheduleId).toMatch(/^sch_/);
    expect(created.enabled).toBe(true);
    expect(created.runCount).toBe(0);
    expect(schedules.get(created.scheduleId)?.name).toBe("每日蒸餾");
    expect(schedules.list()).toHaveLength(1);
    expect(() =>
      schedules.create({
        name: "壞的",
        kind: "cron",
        rawSpec: { expression: "* * * * *" },
        rawTask: { type: "agent", prompt: "x" },
        createdBy: "user",
        nextRunAt: FIXED_NOW.toISOString(),
      }),
    ).toThrowError(/cron/);
  });

  it("claimDue 只搶一筆；搶到後推到未來，同時間不會搶兩次", () => {
    const { schedules } = fixture();
    // 明確落在過去 3 次原應觸發的每日排程。
    const created = makeSchedule(schedules, {
      nextRunAt: "2026-11-13T04:00:00.000Z",
    });
    const result1 = schedules.claimDue("2026-11-16T10:00:00.000Z");
    const claim1 = result1?.kind === "claimed" ? result1.claim : null;
    expect(claim1?.schedule.scheduleId).toBe(created.scheduleId);
    // 只補跑一次：最近一次每日時間是 2026-11-16T04:00，但因為現在已過 04:00，推到明天 04:00。
    expect(claim1?.schedule.nextRunAt).toBe("2026-11-17T04:00:00.000Z");
    expect(claim1?.schedule.runCount).toBe(1);
    const claim2 = schedules.claimDue("2026-11-16T10:00:30.000Z");
    expect(claim2).toBeNull();
  });

  it("間隔排程錯過多次只搶一次，下次是從現在起算", () => {
    const { schedules } = fixture();
    makeSchedule(schedules, {
      name: "心跳",
      kind: "heartbeat",
      rawSpec: { everyMs: 30 * 60_000 },
      rawTask: { type: "agent", prompt: "看有沒有事" },
      nextRunAt: "2026-11-10T10:00:00.000Z",
    });
    const result = schedules.claimDue("2026-11-16T10:00:00.000Z");
    const claim = result?.kind === "claimed" ? result.claim : null;
    expect(claim?.schedule.nextRunAt).toBe("2026-11-16T10:30:00.000Z");
  });

  it("暫停的排程不 claim、不推進；恢復後過期的 daily 推到未來", () => {
    const { schedules } = fixture();
    const created = makeSchedule(schedules, {
      nextRunAt: "2026-11-13T04:00:00.000Z",
    });
    expect(schedules.pause(created.scheduleId)).toBe(true);
    expect(schedules.claimDue("2026-11-16T10:00:00.000Z")).toBeNull();
    expect(schedules.get(created.scheduleId)?.nextRunAt).toBe("2026-11-13T04:00:00.000Z");
    const resumed = schedules.resume(created.scheduleId);
    expect(resumed?.enabled).toBe(true);
    expect(resumed?.nextRunAt).toBe("2026-11-17T04:00:00.000Z");
  });

  it("once 排程 claim 後自動關閉，不重複執行", () => {
    const { schedules } = fixture();
    makeSchedule(schedules, {
      name: "一次性",
      kind: "once",
      rawSpec: { at: "2026-11-15T04:00:00.000Z" },
      nextRunAt: "2026-11-15T04:00:00.000Z",
    });
    const result = schedules.claimDue("2026-11-16T10:00:00.000Z");
    const claim = result?.kind === "claimed" ? result.claim : null;
    expect(claim?.schedule.enabled).toBe(false);
    expect(schedules.claimDue("2026-11-17T10:00:00.000Z")).toBeNull();
  });

  it("finishRun 同一交易寫入 run 與 last_*；刪排程連 runs 一起刪", () => {
    const { schedules } = fixture();
    const created = makeSchedule(schedules, {
      nextRunAt: "2026-11-15T04:00:00.000Z",
    });
    const result = schedules.claimDue("2026-11-16T10:00:00.000Z");
    const claim = result?.kind === "claimed" ? result.claim : null;
    schedules.finishRun({
      runId: claim?.runId ?? "run_x",
      scheduleId: created.scheduleId,
      conversationId: "conv_test",
      startedAt: claim?.claimedAt ?? "2026-11-16T10:00:00.000Z",
      finishedAt: "2026-11-16T10:01:00.000Z",
      status: "notify",
    });
    expect(schedules.get(created.scheduleId)?.lastStatus).toBe("notify");
    expect(schedules.listRuns(created.scheduleId)).toHaveLength(1);
    expect(schedules.listRuns(created.scheduleId)[0]?.conversationId).toBe("conv_test");
    expect(schedules.delete(created.scheduleId)).toBe(true);
    expect(schedules.listRuns(created.scheduleId)).toHaveLength(0);
  });

  it("90 天保留：清掉早於界線的 run 與已讀通知，未讀保留", () => {
    const { schedules, notifications, storage } = fixture();
    const created = makeSchedule(schedules, {
      nextRunAt: "2026-11-15T04:00:00.000Z",
    });
    const result = schedules.claimDue("2026-11-16T10:00:00.000Z");
    const claim = result?.kind === "claimed" ? result.claim : null;
    schedules.finishRun({
      runId: claim?.runId ?? "run_x",
      scheduleId: created.scheduleId,
      conversationId: null,
      startedAt: "2026-08-01T10:00:00.000Z",
      finishedAt: "2026-08-01T10:01:00.000Z",
      status: "ok",
    });
    expect(schedules.deleteOldRuns("2026-09-01T00:00:00.000Z")).toBe(1);

    const old1 = notifications.create({
      kind: "schedule",
      title: "舊的已讀",
      body: "x",
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    const old2 = notifications.create({
      kind: "heartbeat",
      title: "舊的未讀",
      body: "x",
      createdAt: "2026-08-01T00:00:01.000Z",
    });
    // 用注入舊時鐘的 store 把 old1 標記已讀（read_at 落在 90 天前）。
    const oldStore = new NotificationStore(storage.state, {
      now: () => new Date("2026-08-02T00:00:00.000Z"),
    });
    expect(oldStore.markRead({ ids: [old1.notificationId] }).updated).toBe(1);
    expect(notifications.deleteOldReadNotifications("2026-09-01T00:00:00.000Z")).toBe(1);
    expect(notifications.get(old1.notificationId)).toBeNull();
    expect(notifications.get(old2.notificationId)).not.toBeNull();
  });
});

describe("通知儲存", () => {
  it("建立、未讀計數、分頁與未讀游標", () => {
    const { notifications } = fixture();
    for (let index = 0; index < 5; index += 1) {
      notifications.create({
        kind: "schedule",
        title: `通知 ${index}`,
        body: `內文 ${index}`,
        createdAt: new Date(Date.parse("2026-11-16T10:00:00.000Z") + index * 1000).toISOString(),
      });
    }
    expect(notifications.unreadCount()).toBe(5);
    const first = notifications.list({ limit: 2 });
    expect(first.notifications.map((n) => n.title)).toEqual(["通知 4", "通知 3"]);
    expect(first.nextCursor).toBe(first.notifications[1]?.notificationId);
    const second = notifications.list({ limit: 2, before: first.nextCursor });
    expect(second.notifications.map((n) => n.title)).toEqual(["通知 2", "通知 1"]);
    expect(notifications.list({ unreadOnly: true }).totalUnread).toBe(5);
  });

  it("標記已讀：ids 與 all 兩種路徑，未讀數跟著減少", () => {
    const { notifications } = fixture();
    const a = notifications.create({ kind: "schedule", title: "a", body: "x" });
    notifications.create({ kind: "schedule", title: "b", body: "x" });
    const marked = notifications.markRead({ ids: [a.notificationId] });
    expect(marked.updated).toBe(1);
    expect(marked.totalUnread).toBe(1);
    const all = notifications.markRead({ all: true });
    expect(all.totalUnread).toBe(0);
    expect(() =>
      notifications.markRead({ ids: Array.from({ length: 501 }, (_, i) => `ntf_${i}`) }),
    ).toThrowError(/500/);
  });

  it("payload 超過 64 KB 就拒絕；非物件 payload 也拒絕", () => {
    const { notifications } = fixture();
    expect(() =>
      notifications.create({
        kind: "schedule",
        title: "太大",
        body: "x",
        payload: { text: "a".repeat(70 * 1024) },
      }),
    ).toThrowError(/64/);
    expect(() =>
      notifications.create({ kind: "schedule", title: "型別錯", body: "x", payload: [1, 2, 3] }),
    ).toThrowError(/物件/);
  });

  it("轉卡去重鍵：setCardId 之後可以取回同一張卡", () => {
    const { notifications } = fixture();
    const created = notifications.create({ kind: "schedule", title: "t", body: "x" });
    expect(created.cardId).toBeNull();
    expect(notifications.setCardId(created.notificationId, "01CARDULID0000000000000000")).toBe(
      true,
    );
    expect(notifications.get(created.notificationId)?.cardId).toBe("01CARDULID0000000000000000");
  });
});
