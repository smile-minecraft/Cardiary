process.env.TZ = "UTC";

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { openStateDatabase } from "@cardiary/storage";
import { afterEach, describe, expect, it } from "vitest";

import { HOST_SERVICE_NAMES } from "../../../src/modules/contract.js";
import {
  makeFolder,
  startTestHost,
  TestClient,
  type TestFolder,
  type TestHost,
} from "../../helpers.js";

/**
 * 組合主機把模組宣告的內建排程同步到 ScheduleStore。
 *
 * 這裡走真實的第一方模組（`dist/modules`），驗的是啟動組裝與重啟後的
 * 持久化行為；同步本身的情境測試在 `@cardiary/storage` 的
 * `test/schedules/builtin-sync.test.ts`。
 */

const MODULES_DIRECTORY = fileURLToPath(new URL("../../../dist/modules", import.meta.url));
const SCHEDULE_ID = "memory.distillation.daily";
const FIXED = new Date("2026-11-17T12:00:00.000Z");

const hosts: TestHost[] = [];
const folders: TestFolder[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.close().catch(() => undefined);
  }
  folders.length = 0;
});

async function folder(): Promise<TestFolder> {
  const created = await makeFolder();
  folders.push(created);
  return created;
}

async function boot(target: TestFolder, now: Date = FIXED): Promise<TestHost> {
  const host = await startTestHost({
    folder: target,
    assembly: "fake",
    modulesDirectory: MODULES_DIRECTORY,
    clock: { now: () => now },
  });
  hosts.push(host);
  return host;
}

function stateDb(host: TestHost) {
  return host.host.hostServices.require(HOST_SERVICE_NAMES.cardStorage).state;
}

interface ScheduleRow {
  readonly kind: string;
  readonly name: string;
  readonly spec_json: string;
  readonly task_json: string;
  readonly enabled: number;
  readonly created_by: string;
  readonly next_run_at: string;
  readonly run_count: number;
  readonly builtin_declaration: string | null;
  readonly builtin_orphaned: number;
}

function row(host: TestHost): ScheduleRow | undefined {
  return stateDb(host).get<ScheduleRow>(
    "SELECT * FROM schedules WHERE schedule_id = ?",
    SCHEDULE_ID,
  );
}

async function hello(host: TestHost): Promise<TestClient> {
  const client = await TestClient.connect(host.url);
  const reply = await client.waitForReply(await client.hello(host.token));
  if (reply.kind === "error") throw new Error(`hello 失敗：${String(reply.code)}`);
  await client.waitForReply(client.request("system.subscribe", {}));
  return client;
}

describe("內建排程宣告的組裝", () => {
  it("啟動後把記憶模組的每日蒸餾寫進排程表，時間與宣告一致", async () => {
    const host = await boot(await folder());
    const saved = row(host);
    expect(saved).toBeDefined();
    expect(saved?.kind).toBe("daily");
    expect(saved?.name).toBe("每日蒸餾");
    expect(JSON.parse(saved?.spec_json ?? "null")).toEqual({ kind: "daily", time: "04:00" });
    expect(JSON.parse(saved?.task_json ?? "null")).toEqual({ type: "distillation" });
    expect(saved?.enabled).toBe(1);
    expect(saved?.created_by).toBe("agent");
    expect(saved?.next_run_at).toBe("2026-11-18T04:00:00.000Z");
    expect(saved?.builtin_orphaned).toBe(0);
    const declaration = JSON.parse(saved?.builtin_declaration ?? "null");
    expect(declaration.trigger).toEqual({
      kind: "cron",
      expression: "00 04 * * *",
      timezone: "local",
    });
    expect(declaration.defaultEnabled).toBe(true);
  });

  it("使用者改過的時間與啟停狀態在重啟後保留", async () => {
    const target = await folder();
    const first = await boot(target);
    const client = await hello(first);
    const updated = await client.waitForReply(
      client.request("module.scheduler.update", {
        data: { scheduleId: SCHEDULE_ID, spec: { time: "05:30" } },
      }),
    );
    expect(updated.kind).toBe("response");
    const paused = await client.waitForReply(
      client.request("module.scheduler.update", {
        data: { scheduleId: SCHEDULE_ID, enabled: false },
      }),
    );
    expect(paused.kind).toBe("response");
    await client.close();
    await first.close();

    const second = await boot(target);
    const saved = row(second);
    expect(JSON.parse(saved?.spec_json ?? "null")).toEqual({ kind: "daily", time: "05:30" });
    expect(saved?.enabled).toBe(0);
    expect(saved?.next_run_at).toBe("2026-11-18T05:30:00.000Z");
  });

  it("關閉主機不把內建排程停用，重啟前資料庫保留原本的到期時間", async () => {
    const target = await folder();
    const first = await boot(target);
    const before = row(first);
    expect(before?.enabled).toBe(1);
    expect(before?.next_run_at).toBe("2026-11-18T04:00:00.000Z");
    await first.close();
    hosts.splice(hosts.indexOf(first), 1);

    const reopened = openStateDatabase({
      filePath: join(target.path, "state", "cardiary.sqlite"),
      appVersion: "test",
      backupDirectory: join(target.path, "tmp"),
    });
    try {
      const saved = reopened.db.get<ScheduleRow>(
        "SELECT * FROM schedules WHERE schedule_id = ?",
        SCHEDULE_ID,
      );
      expect(saved?.enabled).toBe(1);
      expect(saved?.builtin_orphaned).toBe(0);
      expect(saved?.next_run_at).toBe("2026-11-18T04:00:00.000Z");
    } finally {
      reopened.db.close();
    }
  });

  it("停用記憶模組時內建排程跟著停用，歷程保留；重新啟用後恢復", async () => {
    const host = await boot(await folder());
    stateDb(host).run(
      `INSERT INTO schedule_runs (run_id, schedule_id, started_at, finished_at, status)
       VALUES ('run_past', ?, '2026-11-16T04:00:00.000Z', '2026-11-16T04:00:05.000Z', 'ok')`,
      SCHEDULE_ID,
    );

    await host.host.modules.setModuleEnabled("memory", false);
    const disabled = row(host);
    expect(disabled?.enabled).toBe(0);
    expect(disabled?.builtin_orphaned).toBe(1);
    const runs = stateDb(host).all<{ run_id: string }>(
      "SELECT run_id FROM schedule_runs WHERE schedule_id = ?",
      SCHEDULE_ID,
    );
    expect(runs.map((run) => run.run_id)).toEqual(["run_past"]);

    await host.host.modules.setModuleEnabled("memory", true);
    const enabled = row(host);
    expect(enabled?.enabled).toBe(1);
    expect(enabled?.builtin_orphaned).toBe(0);
  });

  it("同步在排程第一次執行之前完成，過期的舊宣告不會先被執行", async () => {
    const target = await folder();
    const preseeded = openStateDatabase({
      filePath: join(target.path, "state", "cardiary.sqlite"),
      appVersion: "test",
      backupDirectory: join(target.path, "tmp"),
    });
    try {
      preseeded.db.run(
        `INSERT INTO schedules (
           schedule_id, persona, name, kind, spec_json, task_json, enabled, created_by,
           next_run_at, run_count, created_at, updated_at, builtin_declaration, builtin_orphaned
         ) VALUES (?, 'default', '每日蒸餾', 'daily', ?, ?, 1, 'agent',
           '2026-11-16T03:00:00.000Z', 0, '2026-11-16T12:00:00.000Z', '2026-11-16T12:00:00.000Z', ?, 0)`,
        SCHEDULE_ID,
        JSON.stringify({ kind: "daily", time: "03:00" }),
        JSON.stringify({ type: "distillation" }),
        JSON.stringify({
          scheduleId: SCHEDULE_ID,
          title: "每日蒸餾",
          trigger: { kind: "cron", expression: "00 03 * * *", timezone: "local" },
          defaultEnabled: true,
          requiresApproval: false,
          task: { type: "distillation" },
        }),
      );
    } finally {
      preseeded.db.close();
    }

    // 03:30 啟動：舊列的 03:00 已經過期，宣告說 04:00。若同步晚於第一次
    // claim，舊列會先被補跑（run_count 變 1、下次執行推到隔天 03:00）。
    const host = await boot(target, new Date("2026-11-17T03:30:00.000Z"));
    const saved = row(host);
    expect(JSON.parse(saved?.spec_json ?? "null")).toEqual({ kind: "daily", time: "04:00" });
    expect(saved?.next_run_at).toBe("2026-11-17T04:00:00.000Z");
    expect(saved?.run_count).toBe(0);
  });

  it("人工排程不受內建同步影響", async () => {
    const host = await boot(await folder());
    const client = await hello(host);
    const createdReply = await client.waitForReply(
      client.request("module.scheduler.create", {
        data: {
          name: "我的手動排程",
          kind: "daily",
          spec: { time: "08:00" },
          task: { type: "agent", prompt: "回報進度" },
        },
      }),
    );
    expect(createdReply.kind).toBe("response");
    const created = (createdReply.payload as { data: { schedule: { scheduleId: string } } }).data
      .schedule;

    await host.host.modules.setModuleEnabled("memory", false);
    const manual = stateDb(host).get<ScheduleRow>(
      "SELECT * FROM schedules WHERE schedule_id = ?",
      created.scheduleId,
    );
    expect(manual?.enabled).toBe(1);
    expect(manual?.next_run_at).toBe("2026-11-18T08:00:00.000Z");
    expect(manual?.builtin_declaration).toBeNull();
    expect(row(host)?.enabled).toBe(0);
    await client.close();
  });
});
