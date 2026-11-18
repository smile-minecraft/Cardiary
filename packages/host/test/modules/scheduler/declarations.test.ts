process.env.TZ = "UTC";

import { rmSync } from "node:fs";

import type { BackgroundTaskRequest, ScheduleDeclaration } from "@cardiary/module-api";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SchedulerService } from "../../../src/modules/scheduler/service.js";
import { NotificationStore } from "../../../../storage/src/schedules/notifications.js";
import { ScheduleStore } from "../../../../storage/src/schedules/schedules.js";
import { createTempRoot, openTestStorage } from "../../../../storage/test/helpers/temp.js";

/**
 * 模組宣告的排程由宣告自己的 `run` 執行，不是排程列上的任務。
 *
 * 這裡直接組 SchedulerService，驗的是執行路徑與 run 的狀態記錄；宣告怎麼
 * 變成排程表的一列在 `@cardiary/storage` 的 `builtin-sync.test.ts`。
 */

const FIXED_NOW = new Date("2026-11-16T10:00:00.000Z");
const SCHEDULE_ID = "memory.distillation.daily";
const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

interface Fixture {
  readonly schedules: ScheduleStore;
  readonly notifications: NotificationStore;
  readonly runs: BackgroundTaskRequest[];
  readonly emitted: string[];
  readonly logged: Array<{ readonly message: string; readonly fields?: unknown }>;
  readonly service: SchedulerService;
  /** 把服務看到的現在時間往後推，讓排程到期。 */
  advance(ms: number): void;
}

function setup(declarations: () => readonly ScheduleDeclaration[]): Fixture {
  const temp = createTempRoot("scheduler-declarations");
  const storage = openTestStorage(temp);
  cleanups.push(() => storage.close());
  cleanups.push(() => rmSync(temp.root, { recursive: true, force: true }));
  let nowValue = FIXED_NOW;
  const now = (): Date => nowValue;
  const schedules = new ScheduleStore(storage.state, { now });
  const notifications = new NotificationStore(storage.state, { now });
  const runs: BackgroundTaskRequest[] = [];
  const emitted: string[] = [];
  const logged: Array<{ readonly message: string; readonly fields?: unknown }> = [];
  const service = new SchedulerService({
    schedules,
    notifications,
    runBackgroundTask: {
      async run(request) {
        runs.push(request);
        return { conversationId: "conv_1", status: "completed", summary: "不該跑到這裡" };
      },
    },
    isEngineRunning: () => true,
    emitChanged: (record) => emitted.push(record.notificationId),
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (message, fields) => logged.push({ message, fields }),
    },
    now,
    tickIntervalMs: 60_000,
    declarations,
  });
  return {
    schedules,
    notifications,
    runs,
    emitted,
    logged,
    service,
    advance(ms) {
      nowValue = new Date(nowValue.getTime() + ms);
    },
  };
}

function dailyDeclaration(
  run: ScheduleDeclaration["run"],
  overrides: Partial<ScheduleDeclaration> = {},
): ScheduleDeclaration {
  return {
    scheduleId: SCHEDULE_ID,
    title: "每日蒸餾",
    trigger: { kind: "interval", everyMs: 5 * 60_000 },
    defaultEnabled: true,
    requiresApproval: false,
    run,
    ...overrides,
  };
}

async function settle(schedules: ScheduleStore): Promise<void> {
  await vi.waitFor(
    () => {
      expect(schedules.get(SCHEDULE_ID)?.lastStatus).not.toBeNull();
    },
    { timeout: 2_000, interval: 10 },
  );
}

describe("宣告的排程執行", () => {
  it("同識別碼的宣告優先執行，不跑排程列上的任務", async () => {
    const fired: string[] = [];
    const declaration = dailyDeclaration(async (context) => {
      fired.push(`${context.scheduleId}@${context.firedAt}`);
    });
    const { schedules, runs, service, advance } = setup(() => [declaration]);
    schedules.syncBuiltinSchedules([declaration]);

    advance(5 * 60_000 + 1_000);
    expect(await service.tick()).toBe(1);
    await settle(schedules);

    expect(fired).toEqual([`${SCHEDULE_ID}@2026-11-16T10:05:01.000Z`]);
    expect(runs).toEqual([]);
    const record = schedules.get(SCHEDULE_ID);
    expect(record?.lastStatus).toBe("ok");
    expect(record?.runCount).toBe(1);
    // 成功不重複發通知：需要通知的任務自己發。
    expect(record?.lastError).toBeNull();
  });

  it("宣告丟錯時記 error、發失敗通知，下一個排程照常執行", async () => {
    const declaration = dailyDeclaration(async () => {
      throw new Error("蒸餾壞了");
    });
    const { schedules, notifications, runs, service, logged, advance } = setup(() => [declaration]);
    schedules.syncBuiltinSchedules([declaration]);

    advance(5 * 60_000 + 1_000);
    await service.tick();
    await settle(schedules);

    const record = schedules.get(SCHEDULE_ID);
    expect(record?.lastStatus).toBe("error");
    expect(record?.lastError).toContain("蒸餾壞了");
    expect(runs).toEqual([]);
    expect(logged.map((entry) => entry.message)).toContain("內建排程執行失敗");
    const [notification] = notifications.list().notifications;
    expect(notification?.kind).toBe("schedule");
    expect(notification?.title).toBe("每日蒸餾 執行失敗");
    expect(notification?.body).toBe("蒸餾壞了");
  });

  it("stop() 中止進行中的宣告執行並記 cancelled", async () => {
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const declaration = dailyDeclaration(async (context) => {
      started();
      await new Promise<void>((resolve) => {
        context.signal.addEventListener("abort", () => resolve(), { once: true });
      });
    });
    const { schedules, service, advance } = setup(() => [declaration]);
    schedules.syncBuiltinSchedules([declaration]);

    advance(5 * 60_000 + 1_000);
    await service.tick();
    await running;
    service.stop();

    await vi.waitFor(
      () => {
        expect(schedules.listRuns(SCHEDULE_ID)[0]?.status).toBe("cancelled");
      },
      { timeout: 2_000, interval: 10 },
    );
    // 既有語意：取消在排程列上算失敗，執行紀錄才保留 cancelled。
    expect(schedules.get(SCHEDULE_ID)?.lastStatus).toBe("error");
    expect(schedules.get(SCHEDULE_ID)?.lastError).toBeNull();
  });
});
