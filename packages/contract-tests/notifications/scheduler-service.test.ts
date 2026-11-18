import { rmSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isSilentHeartbeat,
  SchedulerService,
  type SchedulerServiceOptions,
} from "../../host/src/modules/scheduler/service.js";
import { scheduleProposeTool } from "../../host/src/modules/scheduler/tools.js";
import { createToolPermissionGate } from "../../host/src/permissions/gate.js";
import type { BackgroundTaskOutcome, BackgroundTaskRequest } from "../../module-api/src/index.js";
import { NotificationStore } from "../../storage/src/schedules/notifications.js";
import { ScheduleStore } from "../../storage/src/schedules/schedules.js";
import { createTempRoot, openTestStorage } from "../../storage/test/helpers/temp.js";

process.env.TZ = "UTC";

const FIXED_NOW = new Date("2026-11-16T10:00:00.000Z");
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
  readonly service: SchedulerService;
}

function fixture(
  runner: (request: BackgroundTaskRequest) => Promise<BackgroundTaskOutcome>,
  overrides: Partial<SchedulerServiceOptions> = {},
): Fixture {
  const temp = createTempRoot("scheduler-service");
  const storage = openTestStorage(temp);
  cleanups.push(() => storage.close());
  cleanups.push(() => rmSync(temp.root, { recursive: true, force: true }));
  const schedules = new ScheduleStore(storage.state, { now: () => FIXED_NOW });
  const notifications = new NotificationStore(storage.state, { now: () => FIXED_NOW });
  const runs: BackgroundTaskRequest[] = [];
  const emitted: string[] = [];
  const service = new SchedulerService({
    schedules,
    notifications,
    runBackgroundTask: {
      async run(request) {
        runs.push(request);
        return runner(request);
      },
    },
    isEngineRunning: () => true,
    emitChanged: (record) => emitted.push(record.notificationId),
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    now: () => FIXED_NOW,
    tickIntervalMs: 60_000,
    ...overrides,
  });
  return { schedules, notifications, runs, emitted, service };
}

function makeAgentSchedule(
  schedules: ScheduleStore,
  overrides: Record<string, unknown> = {},
): string {
  const schedule = schedules.create({
    name: "整理待辦",
    kind: "interval",
    rawSpec: { everyMs: 15 * 60_000 },
    rawTask: { type: "agent", prompt: "整理今天的待辦" },
    createdBy: "user",
    nextRunAt: "2026-11-16T09:00:00.000Z",
    ...overrides,
  } as Parameters<ScheduleStore["create"]>[0]);
  return schedule.scheduleId;
}

const completed = (conversationId: string, summary: string): BackgroundTaskOutcome => ({
  conversationId,
  status: "completed",
  summary,
});

async function settle(schedules: ScheduleStore, scheduleId: string): Promise<void> {
  await vi.waitFor(
    () => {
      expect(schedules.get(scheduleId)?.lastStatus).not.toBeNull();
    },
    { timeout: 2_000, interval: 10 },
  );
}

describe("排程器服務", () => {
  it("服務關閉期間錯過多次，啟動後只補跑一次並把下次推到未來", async () => {
    const { schedules, notifications, runs, service } = fixture(async () =>
      completed("conv_1", "已完成"),
    );
    const scheduleId = makeAgentSchedule(schedules);

    expect(await service.tick()).toBe(1);
    await settle(schedules, scheduleId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.prompt).toBe("整理今天的待辦");

    const next = schedules.get(scheduleId);
    expect(next?.runCount).toBe(1);
    expect(next?.lastStatus).toBe("notify");
    expect(Date.parse(next?.nextRunAt ?? "")).toBeGreaterThan(FIXED_NOW.getTime());
    expect(notifications.list().notifications).toHaveLength(1);

    // 下一次 tick 沒有新的到期排程，不再執行。
    expect(await service.tick()).toBe(0);
    expect(runs).toHaveLength(1);
  });

  it("Heartbeat 回報無事不產生通知，執行紀錄標成 silent", async () => {
    const { schedules, notifications, emitted, service } = fixture(async () =>
      completed("conv_2", "無事。"),
    );
    const scheduleId = schedules.create({
      name: "每小時檢查",
      kind: "heartbeat",
      rawSpec: { everyMs: 60 * 60_000 },
      rawTask: { type: "agent", prompt: "檢查有沒有需要告知的事" },
      createdBy: "user",
      nextRunAt: "2026-11-16T09:30:00.000Z",
    }).scheduleId;

    await service.tick();
    await settle(schedules, scheduleId);

    expect(notifications.list().notifications).toHaveLength(0);
    expect(emitted).toHaveLength(0);
    expect(schedules.get(scheduleId)?.lastStatus).toBe("silent");
    expect(schedules.listRuns(scheduleId)[0]?.status).toBe("silent");
  });

  it("Heartbeat 有事只產生一則通知，並帶排程來源", async () => {
    const { schedules, notifications, emitted, service } = fixture(async () =>
      completed("conv_3", "磁碟剩餘空間低於 10%。"),
    );
    const scheduleId = schedules.create({
      name: "每小時檢查",
      kind: "heartbeat",
      rawSpec: { everyMs: 60 * 60_000 },
      rawTask: { type: "agent", prompt: "檢查有沒有需要告知的事" },
      createdBy: "user",
      nextRunAt: "2026-11-16T09:30:00.000Z",
    }).scheduleId;

    await service.tick();
    await settle(schedules, scheduleId);

    const page = notifications.list();
    expect(page.notifications).toHaveLength(1);
    expect(page.totalUnread).toBe(1);
    expect(page.notifications[0]).toMatchObject({
      kind: "heartbeat",
      sourceScheduleId: scheduleId,
      sourceConversationId: "conv_3",
    });
    expect(emitted).toHaveLength(1);
    expect(schedules.get(scheduleId)?.lastStatus).toBe("notify");
  });

  it("執行失敗時記 error 並發一則失敗通知", async () => {
    const { schedules, notifications, service } = fixture(async () => {
      throw new Error("引擎中斷");
    });
    const scheduleId = makeAgentSchedule(schedules);

    await service.tick();
    await settle(schedules, scheduleId);

    const page = notifications.list();
    expect(page.notifications).toHaveLength(1);
    expect(page.notifications[0]?.title).toBe("整理待辦 執行失敗");
    expect(page.notifications[0]?.body).toBe("引擎中斷");
    const schedule = schedules.get(scheduleId);
    expect(schedule?.lastStatus).toBe("error");
    expect(schedule?.lastError).toBe("引擎中斷");
    expect(schedules.listRuns(scheduleId)[0]?.status).toBe("error");
  });

  it("緊急暫停後不再搶新排程", async () => {
    const { schedules, runs, service } = fixture(async () => completed("conv_4", "不該執行"), {
      isEngineRunning: () => false,
    });
    makeAgentSchedule(schedules);

    expect(await service.tick()).toBe(0);
    expect(runs).toHaveLength(0);
    expect(schedules.list()[0]?.runCount).toBe(0);
  });

  it("無事的判定只接受明確的簡短回覆", () => {
    expect(isSilentHeartbeat("無事")).toBe(true);
    expect(isSilentHeartbeat("無事。")).toBe(true);
    expect(isSilentHeartbeat("Nothing to report")).toBe(true);
    expect(isSilentHeartbeat("")).toBe(true);
    expect(isSilentHeartbeat("無事，但磁碟快滿了")).toBe(false);
    expect(isSilentHeartbeat("今天有 3 則新訊息")).toBe(false);
  });
});

describe("排程提議工具", () => {
  it("核准後執行時固定記成代理建立，輸入不能改 createdBy", async () => {
    const temp = createTempRoot("schedule-propose");
    const storage = openTestStorage(temp);
    cleanups.push(() => storage.close());
    cleanups.push(() => rmSync(temp.root, { recursive: true, force: true }));
    const schedules = new ScheduleStore(storage.state, { now: () => FIXED_NOW });
    const tool = scheduleProposeTool({ schedules, now: () => FIXED_NOW });

    const outcome = await tool.execute(
      {
        title: "每日摘要",
        kind: "daily",
        spec: { time: "04:00" },
        task: { type: "agent", prompt: "整理" },
        createdBy: "user",
      } as never,
      {
        conversationId: "conv_agent",
        turnId: "turn_1",
        callId: "call_1",
        toolName: "schedule_propose",
        signal: new AbortController().signal,
        tempDir: temp.sysTmp,
        workingDir: temp.folder,
        requestApproval: vi.fn(),
        spawn: vi.fn(),
      } as never,
    );

    expect(outcome.ok).toBe(true);
    const created = schedules.list()[0];
    expect(created?.createdBy).toBe("agent");
    expect(created?.sourceConversationId).toBe("conv_agent");
  });

  it("權限閘道對 schedule_propose 一律詢問，不因工具輸入放行", async () => {
    const gate = createToolPermissionGate({
      workingDir: "/tmp/cardiary",
      folderRoot: "/tmp/cardiary",
      allowlist: { match: () => null },
    });

    const verdict = await gate.evaluate({
      toolName: "schedule_propose",
      input: {
        title: "每日摘要",
        kind: "daily",
        spec: { time: "04:00" },
        task: { type: "agent", prompt: "整理" },
      },
      conversationId: "conv_agent",
      turnId: "turn_1",
      callId: "call_1",
    });

    expect(verdict.kind).toBe("ask-human");
    if (verdict.kind !== "ask-human") return;
    expect(verdict.risk).toBe("high");
    // 沒有動作分類，審批就不提供「一律允許」。
    expect(verdict.action.kind).toBe("tool-execution");
  });
});

describe("排程管理協定的負面案例", () => {
  it("module.scheduler.create 一律記成使用者建立，payload 不能改成代理", async () => {
    const temp = createTempRoot("scheduler-protocol");
    const storage = openTestStorage(temp);
    cleanups.push(() => storage.close());
    cleanups.push(() => rmSync(temp.root, { recursive: true, force: true }));
    const schedules = new ScheduleStore(storage.state, { now: () => FIXED_NOW });
    const notifications = new NotificationStore(storage.state, { now: () => FIXED_NOW });
    const { registerSchedulerAdminProtocol } =
      await import("../../host/src/modules/scheduler/protocol.js");

    const handlers = new Map<string, (request: never) => Promise<unknown>>();
    const emitter = {
      registerNamespace(namespace: string, handler: never) {
        handlers.set(namespace, handler);
      },
      emit() {
        return undefined;
      },
    };
    registerSchedulerAdminProtocol(
      { notifications, schedules, cards: undefined, db: storage.state, now: () => FIXED_NOW },
      emitter as never,
    );

    const handler = handlers.get("module.scheduler");
    expect(handler).toBeDefined();
    // 代理若能打到這條路徑，最多只能建出 createdBy=user，不能冒充自己提議經核准。
    const response = (await handler!({
      type: "module.scheduler.create",
      payload: {
        data: {
          name: "每日摘要",
          kind: "daily",
          spec: { time: "04:00" },
          task: { type: "agent", prompt: "整理" },
          createdBy: "agent",
          sourceConversationId: "conv_agent",
        },
      },
      clientId: "client-1",
    } as never)) as { data: { schedule: { createdBy: string } } };

    expect(response.data.schedule.createdBy).toBe("user");
    const created = schedules.list()[0];
    expect(created?.createdBy).toBe("user");
    expect(created?.sourceConversationId).toBeNull();
  });
});
