process.env.TZ = "UTC";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  Database,
  M8_MIGRATIONS,
  M10_SCHEDULE_COLUMNS,
  ScheduleStore,
  STATE_APPLICATION_ID,
  migrate,
  openStateDatabase,
  type BuiltinScheduleDeclaration,
} from "../../src/index.js";
import { createTempRoot, openTestStorage, type TempRoot } from "../helpers/temp.js";

const cleanups: Array<() => void> = [];
const directories: string[] = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  while (directories.length > 0) {
    rmSync(directories.pop() as string, { recursive: true, force: true });
  }
});

function temp(label = "builtin-sync"): TempRoot {
  const root = createTempRoot(label);
  cleanups.push(root.cleanup);
  return root;
}

const NOW = new Date("2026-11-16T10:00:00.000Z");

function setup(): { store: ScheduleStore; db: Database } {
  const root = temp();
  const storage = openTestStorage(root);
  cleanups.push(() => storage.close());
  const db = storage.state;
  return { store: new ScheduleStore(db, { now: () => NOW }), db };
}

function declaration(
  overrides: Partial<BuiltinScheduleDeclaration> = {},
): BuiltinScheduleDeclaration {
  return {
    scheduleId: "memory.distillation.daily",
    title: "每日蒸餾",
    trigger: { kind: "cron", expression: "00 04 * * *", timezone: "local" },
    defaultEnabled: true,
    requiresApproval: false,
    ...overrides,
  };
}

interface RawScheduleRow {
  readonly created_by: string;
  readonly enabled: number;
  readonly name: string;
  readonly spec_json: string;
  readonly task_json: string;
  readonly builtin_declaration: string | null;
  readonly builtin_orphaned: number;
}

function rawRow(db: Database, scheduleId: string): RawScheduleRow | undefined {
  return db.get<RawScheduleRow>("SELECT * FROM schedules WHERE schedule_id = ?", scheduleId);
}

describe("內建排程宣告的同步", () => {
  it("沒有列時建立每日蒸餾排程，原樣保存宣告的 cron 與時區", () => {
    const { store, db } = setup();
    const warnings: Array<{ message: string; scheduleId: string | undefined }> = [];
    const result = store.syncBuiltinSchedules([declaration()], {
      warn: (message, fields) => warnings.push({ message, scheduleId: fields?.scheduleId }),
    });
    expect(result).toEqual({
      created: ["memory.distillation.daily"],
      updated: [],
      disabled: [],
      reenabled: [],
      ignored: [],
    });
    expect(warnings).toEqual([]);

    const record = store.get("memory.distillation.daily");
    expect(record).not.toBeNull();
    expect(record?.kind).toBe("daily");
    expect(JSON.parse(record?.spec ?? "null")).toEqual({ kind: "daily", time: "04:00" });
    expect(JSON.parse(record?.task ?? "null")).toEqual({ type: "distillation" });
    expect(record?.enabled).toBe(true);
    expect(record?.createdBy).toBe("agent");
    expect(record?.nextRunAt).toBe("2026-11-17T04:00:00.000Z");

    const row = rawRow(db, "memory.distillation.daily");
    expect(row?.builtin_orphaned).toBe(0);
    expect(JSON.parse(row?.builtin_declaration ?? "null")).toEqual({
      scheduleId: "memory.distillation.daily",
      title: "每日蒸餾",
      trigger: { kind: "cron", expression: "00 04 * * *", timezone: "local" },
      defaultEnabled: true,
      requiresApproval: false,
      task: { type: "distillation" },
    });
  });

  it("宣告沒變時不重寫，使用者的時間與啟停不被覆蓋", () => {
    const { store } = setup();
    store.syncBuiltinSchedules([declaration()]);
    store.update("memory.distillation.daily", { rawSpec: { time: "05:30" } });
    store.pause("memory.distillation.daily");

    const second = store.syncBuiltinSchedules([declaration()]);
    expect(second.created).toEqual([]);
    expect(second.updated).toEqual([]);
    expect(second.disabled).toEqual([]);
    expect(second.reenabled).toEqual([]);

    const record = store.get("memory.distillation.daily");
    expect(JSON.parse(record?.spec ?? "null")).toEqual({ kind: "daily", time: "05:30" });
    expect(record?.enabled).toBe(false);
  });

  it("宣告變更時只套用使用者沒改過的欄位", () => {
    const { store, db } = setup();
    store.syncBuiltinSchedules([declaration()]);
    store.update("memory.distillation.daily", { rawSpec: { time: "05:30" } });

    const result = store.syncBuiltinSchedules([
      declaration({
        title: "每日蒸餾（新）",
        trigger: { kind: "cron", expression: "00 06 * * *", timezone: "local" },
      }),
    ]);
    expect(result.updated).toEqual(["memory.distillation.daily"]);

    const record = store.get("memory.distillation.daily");
    // 使用者改過時間：保留 05:30，不套用宣告的 06:00。
    expect(JSON.parse(record?.spec ?? "null")).toEqual({ kind: "daily", time: "05:30" });
    // 名稱沒被改過：跟著宣告更新。
    expect(record?.name).toBe("每日蒸餾（新）");
    // 原始宣告一律換成最新的一份。
    const stored = JSON.parse(
      rawRow(db, "memory.distillation.daily")?.builtin_declaration ?? "null",
    );
    expect(stored.trigger.expression).toBe("00 06 * * *");
    expect(stored.title).toBe("每日蒸餾（新）");
  });

  it("宣告消失時停用內建排程、保留執行歷程；宣告回來時重新啟用", () => {
    const { store, db } = setup();
    store.syncBuiltinSchedules([declaration()]);
    store.finishRun({
      runId: "run_seed",
      scheduleId: "memory.distillation.daily",
      conversationId: null,
      startedAt: "2026-11-15T04:00:00.000Z",
      finishedAt: "2026-11-15T04:00:05.000Z",
      status: "ok",
    });

    const removed = store.syncBuiltinSchedules([]);
    expect(removed.disabled).toEqual(["memory.distillation.daily"]);
    const disabled = store.get("memory.distillation.daily");
    expect(disabled?.enabled).toBe(false);
    expect(rawRow(db, "memory.distillation.daily")?.builtin_orphaned).toBe(1);
    // 列還在，歷程也還在。
    expect(store.listRuns("memory.distillation.daily")).toHaveLength(1);

    const restored = store.syncBuiltinSchedules([declaration()]);
    expect(restored.reenabled).toEqual(["memory.distillation.daily"]);
    const record = store.get("memory.distillation.daily");
    expect(record?.enabled).toBe(true);
    expect(rawRow(db, "memory.distillation.daily")?.builtin_orphaned).toBe(0);
    expect(record?.nextRunAt).toBe("2026-11-17T04:00:00.000Z");
    expect(store.listRuns("memory.distillation.daily")).toHaveLength(1);
  });

  it("重新啟用時規格壞掉就退回宣告正本，啟動不中斷", () => {
    const { store, db } = setup();
    store.syncBuiltinSchedules([declaration()]);
    store.syncBuiltinSchedules([]);
    // 模擬手動改壞資料庫：規格不是合法 JSON。
    db.run(
      "UPDATE schedules SET spec_json = '{壞掉' WHERE schedule_id = ?",
      "memory.distillation.daily",
    );

    const restored = store.syncBuiltinSchedules([declaration()]);
    expect(restored.reenabled).toEqual(["memory.distillation.daily"]);
    const record = store.get("memory.distillation.daily");
    expect(record?.enabled).toBe(true);
    expect(record?.kind).toBe("daily");
    expect(record?.nextRunAt).toBe("2026-11-17T04:00:00.000Z");
    expect(rawRow(db, "memory.distillation.daily")?.builtin_orphaned).toBe(0);
    expect(JSON.parse(rawRow(db, "memory.distillation.daily")?.spec_json ?? "null")).toEqual({
      kind: "daily",
      time: "04:00",
    });
  });

  it("同識別碼的人工列被認養：只補上內建欄位，使用者資料原封不動", () => {
    const { store, db } = setup();
    store.create({
      id: "memory.distillation.daily",
      name: "我自己的蒸餾",
      kind: "daily",
      rawSpec: { time: "09:00" },
      rawTask: { type: "agent", prompt: "整理卡片" },
      createdBy: "user",
      nextRunAt: "2026-11-17T09:00:00.000Z",
    });

    const result = store.syncBuiltinSchedules([declaration()]);
    expect(result.updated).toEqual(["memory.distillation.daily"]);
    expect(result.created).toEqual([]);

    const record = store.get("memory.distillation.daily");
    expect(record?.createdBy).toBe("user");
    expect(record?.name).toBe("我自己的蒸餾");
    expect(JSON.parse(record?.spec ?? "null")).toEqual({ kind: "daily", time: "09:00" });
    expect(JSON.parse(record?.task ?? "null")).toEqual({ type: "agent", prompt: "整理卡片" });
    expect(rawRow(db, "memory.distillation.daily")?.builtin_declaration).not.toBeNull();

    // 宣告消失時只停用，不刪使用者的列。
    expect(store.syncBuiltinSchedules([]).disabled).toEqual(["memory.distillation.daily"]);
    expect(store.get("memory.distillation.daily")?.createdBy).toBe("user");
  });

  it("支援 interval 與 heartbeat，間隔太短或形狀不對就略過", () => {
    const { store } = setup();
    const warnings: string[] = [];
    const result = store.syncBuiltinSchedules(
      [
        {
          scheduleId: "module.probe",
          title: "探測",
          trigger: { kind: "heartbeat", everyMs: 600_000 },
          defaultEnabled: true,
          requiresApproval: false,
        },
        {
          scheduleId: "module.too-fast",
          title: "太快",
          trigger: { kind: "interval", everyMs: 1_000 },
          defaultEnabled: true,
          requiresApproval: false,
        },
      ],
      { warn: (message) => warnings.push(message) },
    );
    expect(result.created).toEqual(["module.probe"]);
    expect(result.ignored.map((entry) => entry.scheduleId)).toEqual(["module.too-fast"]);
    expect(warnings).toHaveLength(1);
    const record = store.get("module.probe");
    expect(record?.kind).toBe("heartbeat");
    expect(JSON.parse(record?.spec ?? "null")).toEqual({ kind: "heartbeat", everyMs: 600_000 });
    expect(record?.nextRunAt).toBe("2026-11-16T10:10:00.000Z");
  });

  it("不支援的 cron 運算式與非本機時區只警告、不建立排程，也不讓啟動失敗", () => {
    const { store } = setup();
    const warnings: string[] = [];
    const result = store.syncBuiltinSchedules(
      [
        declaration({
          scheduleId: "module.every-five",
          trigger: { kind: "cron", expression: "*/5 * * * *" },
        }),
        declaration({
          scheduleId: "module.tokyo",
          trigger: { kind: "cron", expression: "00 04 * * *", timezone: "Asia/Tokyo" },
        }),
      ],
      { warn: (message) => warnings.push(message) },
    );
    expect(result.created).toEqual([]);
    expect(result.ignored).toHaveLength(2);
    expect(result.ignored[0]?.reason).toContain("cron");
    expect(result.ignored[1]?.reason).toContain("時區");
    expect(warnings).toHaveLength(2);
    expect(store.list()).toEqual([]);
  });

  it("需核准的宣告以停用狀態建立，等使用者開", () => {
    const { store } = setup();
    store.syncBuiltinSchedules([declaration({ requiresApproval: true })]);
    expect(store.get("memory.distillation.daily")?.enabled).toBe(false);
  });

  it("人工排程不受同步影響，宣告全部消失也不動它", () => {
    const { store, db } = setup();
    const manual = store.create({
      name: "人工排程",
      kind: "daily",
      rawSpec: { time: "08:00" },
      rawTask: { type: "agent", prompt: "回報" },
      createdBy: "user",
      nextRunAt: "2026-11-17T08:00:00.000Z",
    });
    store.syncBuiltinSchedules([declaration()]);
    const removed = store.syncBuiltinSchedules([]);
    expect(removed.disabled).toEqual(["memory.distillation.daily"]);
    const after = store.get(manual.scheduleId);
    expect(after?.enabled).toBe(true);
    expect(after?.name).toBe("人工排程");
    expect(after?.nextRunAt).toBe("2026-11-17T08:00:00.000Z");
    expect(rawRow(db, manual.scheduleId)?.builtin_declaration).toBeNull();
  });

  it("兩個模組宣告同一個識別碼時只採用第一個並警告", () => {
    const { store } = setup();
    const warnings: string[] = [];
    const result = store.syncBuiltinSchedules([declaration(), declaration({ title: "後來的" })], {
      warn: (message) => warnings.push(message),
    });
    expect(result.created).toEqual(["memory.distillation.daily"]);
    expect(result.ignored).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(store.get("memory.distillation.daily")?.name).toBe("每日蒸餾");
  });
});

describe("v10 遷移", () => {
  function scratch(label: string): string {
    const directory = mkdtempSync(path.join(tmpdir(), `storage-${label}-`));
    directories.push(directory);
    return directory;
  }

  it("v9 升 v10：補上內建宣告欄位，既有排程保留", () => {
    const directory = scratch("builtin-upgrade");
    const filePath = path.join(directory, "state.sqlite");
    const v9 = Database.open(filePath, {
      create: { applicationId: STATE_APPLICATION_ID, pageSize: 4096, autoVacuum: "incremental" },
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    try {
      migrate(v9, { migrations: M8_MIGRATIONS, appVersion: "test" });
      expect(Number(v9.pragma("user_version"))).toBe(9);
      v9.run(
        `INSERT INTO schedules (schedule_id, name, kind, spec_json, task_json, created_by, next_run_at, created_at, updated_at)
         VALUES ('sch_manual', '使用者排程', 'daily', '{"kind":"daily","time":"08:00"}', '{"type":"agent","prompt":"回報"}', 'user', '2026-11-17T08:00:00.000Z', '2026-11-16T10:00:00.000Z', '2026-11-16T10:00:00.000Z')`,
      );
    } finally {
      v9.close();
    }

    const upgraded = openStateDatabase({
      filePath,
      appVersion: "test",
      backupDirectory: directory,
    });
    try {
      expect(upgraded.migration.toVersion).toBe(10);
      expect(upgraded.migration.appliedVersions).toEqual([10]);
      const columns = upgraded.db
        .all<{ name: string }>("PRAGMA table_info(schedules)")
        .map((column) => column.name);
      for (const column of M10_SCHEDULE_COLUMNS) {
        expect(columns, column).toContain(column);
      }
      const row = upgraded.db.get<RawScheduleRow>(
        "SELECT * FROM schedules WHERE schedule_id = 'sch_manual'",
      );
      expect(row?.name).toBe("使用者排程");
      expect(row?.created_by).toBe("user");
      expect(row?.builtin_declaration).toBeNull();
      expect(row?.builtin_orphaned).toBe(0);
    } finally {
      upgraded.db.close();
    }
  });
});
