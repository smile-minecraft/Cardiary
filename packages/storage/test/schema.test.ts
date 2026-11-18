import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  CACHE_APPLICATION_ID,
  Database,
  ENGINE_APPLICATION_ID,
  M0_MIGRATIONS,
  M0_TABLES,
  M1_CONVERSATION_DELETION_COLUMNS,
  M1_MIGRATIONS,
  M1_TABLES,
  M2_CONVERSATION_COLUMNS,
  M2_MIGRATIONS,
  M2_TABLES,
  M3_MIGRATIONS,
  M3_TABLES,
  M4_CONTEXT_ENTRY_DEAL_COLUMNS,
  M4_MIGRATIONS,
  M5_MIGRATIONS,
  M6_MIGRATIONS,
  M6_TABLES,
  M7_MIGRATIONS,
  M7_TABLES,
  M8_MIGRATIONS,
  M8_TABLES,
  M9_MIGRATIONS,
  M10_SCHEDULE_COLUMNS,
  RESERVED_M1_TABLES,
  STATE_APPLICATION_ID,
  StorageError,
  migrate,
  openEngineDatabase,
  openStateDatabase,
  sha256,
} from "../src/index.js";
import { createTempRoot, openTestStorage, type TempRoot } from "./helpers/temp.js";

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

function temp(label = "schema"): TempRoot {
  const root = createTempRoot(label);
  cleanups.push(root.cleanup);
  return root;
}

function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "storage-schema-"));
  directories.push(directory);
  return directory;
}

describe("資料庫 header 與表結構", () => {
  it("Cardiary 狀態庫的 header 與 M0、M1 表齊全", () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    expect(Number(storage.state.pragma("application_id"))).toBe(STATE_APPLICATION_ID);
    expect(Number(storage.state.pragma("page_size"))).toBe(4096);
    expect(Number(storage.state.pragma("auto_vacuum"))).toBe(2);
    expect(Number(storage.state.pragma("user_version"))).toBe(10);
    expect(String(storage.state.pragma("journal_mode"))).toBe("wal");
    expect(Number(storage.state.pragma("secure_delete"))).toBe(1);
    expect(Number(storage.state.pragma("foreign_keys"))).toBe(1);
    expect(M0_TABLES).toHaveLength(12);
    for (const table of [
      ...M0_TABLES,
      ...RESERVED_M1_TABLES,
      ...M1_TABLES,
      ...M2_TABLES,
      ...M3_TABLES,
      ...M6_TABLES,
      ...M7_TABLES,
      ...M8_TABLES,
    ]) {
      expect(storage.state.tableExists(table), table).toBe(true);
    }
    const conversationColumns = storage.state
      .all<{ name: string }>("PRAGMA table_info(conversations)")
      .map((column) => column.name);
    for (const column of M2_CONVERSATION_COLUMNS) {
      expect(conversationColumns, column).toContain(column);
    }
    const entryColumns = storage.state
      .all<{ name: string }>("PRAGMA table_info(context_entries)")
      .map((column) => column.name);
    for (const column of M4_CONTEXT_ENTRY_DEAL_COLUMNS) {
      expect(entryColumns, column).toContain(column);
    }
    const scheduleColumns = storage.state
      .all<{ name: string }>("PRAGMA table_info(schedules)")
      .map((column) => column.name);
    for (const column of M10_SCHEDULE_COLUMNS) {
      expect(scheduleColumns, column).toContain(column);
    }
    const migrations = storage.state.all<{ version: number; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations ORDER BY version",
    );
    expect(migrations).toHaveLength(10);
    expect(migrations[0]?.version).toBe(1);
    expect(migrations[0]?.checksum).toBe(sha256(M0_MIGRATIONS[0]?.sql ?? ""));
    expect(migrations[1]?.version).toBe(2);
    expect(migrations[1]?.checksum).toBe(sha256(M1_MIGRATIONS[1]?.sql ?? ""));
    expect(migrations[2]?.version).toBe(3);
    expect(migrations[2]?.checksum).toBe(sha256(M2_MIGRATIONS[2]?.sql ?? ""));
    expect(migrations[3]?.version).toBe(4);
    expect(migrations[3]?.checksum).toBe(sha256(M3_MIGRATIONS[3]?.sql ?? ""));
    expect(migrations[4]?.version).toBe(5);
    expect(migrations[4]?.checksum).toBe(sha256(M4_MIGRATIONS[4]?.sql ?? ""));
    expect(migrations[5]?.version).toBe(6);
    expect(migrations[5]?.checksum).toBe(sha256(M5_MIGRATIONS[5]?.sql ?? ""));
    expect(migrations[6]?.version).toBe(7);
    expect(migrations[6]?.checksum).toBe(sha256(M6_MIGRATIONS[6]?.sql ?? ""));
    expect(migrations[7]?.version).toBe(8);
    expect(migrations[7]?.checksum).toBe(sha256(M7_MIGRATIONS[7]?.sql ?? ""));
    expect(migrations[8]?.version).toBe(9);
    expect(migrations[8]?.checksum).toBe(sha256(M8_MIGRATIONS[8]?.sql ?? ""));
    expect(migrations[9]?.version).toBe(10);
    expect(migrations[9]?.checksum).toBe(sha256(M9_MIGRATIONS[9]?.sql ?? ""));
    const approvalColumns = storage.state
      .all<{ name: string }>("PRAGMA table_info(mcp_server_approvals)")
      .map((column) => column.name);
    expect(approvalColumns).toContain("persistent_write");
  });

  it("引擎與快取資料庫的 header 正確，三條連線都開 secure_delete", () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    expect(Number(storage.engine.pragma("application_id"))).toBe(ENGINE_APPLICATION_ID);
    expect(Number(storage.engine.pragma("auto_vacuum"))).toBe(2);
    expect(Number(storage.engine.pragma("page_size"))).toBe(4096);
    expect(Number(storage.engine.pragma("secure_delete"))).toBe(1);
    expect(Number(storage.cache.pragma("application_id"))).toBe(CACHE_APPLICATION_ID);
    expect(Number(storage.cache.pragma("secure_delete"))).toBe(1);
  });

  it("runtime_state 只接受單列，turn_index 的對話與觸發訊息唯一", () => {
    const storage = openTestStorage(temp());
    cleanups.push(() => storage.close());
    expect(() =>
      storage.state.run(
        "INSERT INTO runtime_state (id, epoch, clean_shutdown, started_at) VALUES (2, 'e', 0, 'now')",
      ),
    ).toThrowError(/CHECK/);
    storage.state.run(
      "INSERT INTO turn_index (turn_id, conversation_id, trigger_message_id, started_at) VALUES ('turn_a', 'c1', 'm1', 'now')",
    );
    expect(() =>
      storage.state.run(
        "INSERT INTO turn_index (turn_id, conversation_id, trigger_message_id, started_at) VALUES ('turn_b', 'c1', 'm1', 'now')",
      ),
    ).toThrowError(/UNIQUE/);
  });

  it("重複開啟不重跑遷移", () => {
    const tempRoot = temp();
    const first = openTestStorage(tempRoot);
    const count = first.state.countRows("schema_migrations");
    first.close();
    const second = openTestStorage(tempRoot);
    cleanups.push(() => second.close());
    expect(second.state.countRows("schema_migrations")).toBe(count);
    expect(Number(second.state.pragma("user_version"))).toBe(10);
  });

  it("資料庫檔是符號連結時拒絕開啟，不碰外部檔案", () => {
    const directory = scratch();
    const outside = path.join(directory, "outside.sqlite");
    const target = path.join(directory, "db.sqlite");
    writeFileSync(outside, "keep");
    symlinkSync(outside, target);
    expect(() =>
      Database.open(target, {
        create: { applicationId: STATE_APPLICATION_ID },
      }),
    ).toThrowError(/符號連結/);
    expect(readFileSync(outside, "utf8")).toBe("keep");
  });

  it("引擎檔案可以只建立 header，之後由引擎自己建表", () => {
    const directory = scratch();
    const filePath = path.join(directory, "engine.sqlite");
    const db = openEngineDatabase({ filePath });
    db.close();
    const raw = new DatabaseSync(filePath);
    expect(
      Number(
        (raw.prepare("PRAGMA application_id").get() as { application_id: number }).application_id,
      ),
    ).toBe(ENGINE_APPLICATION_ID);
    expect(
      Number((raw.prepare("PRAGMA auto_vacuum").get() as { auto_vacuum: number }).auto_vacuum),
    ).toBe(2);
    raw.close();
  });
});

describe("遷移", () => {
  it("從空檔建立、重複執行不出錯", () => {
    const directory = scratch();
    const filePath = path.join(directory, "state.sqlite");
    const first = openStateDatabase({
      filePath,
      appVersion: "test",
      backupDirectory: directory,
    });
    expect(first.migration.appliedVersions).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    first.db.close();

    const second = openStateDatabase({
      filePath,
      appVersion: "test",
      backupDirectory: directory,
    });
    expect(second.migration.appliedVersions).toEqual([]);
    second.db.close();
  });

  it("降級：user_version 比程式新時拒絕啟動", () => {
    const directory = scratch();
    const filePath = path.join(directory, "state.sqlite");
    const first = openStateDatabase({
      filePath,
      appVersion: "test",
      backupDirectory: directory,
    });
    first.db.exec("PRAGMA user_version = 99");
    first.db.close();
    expect(() =>
      openStateDatabase({ filePath, appVersion: "test", backupDirectory: directory }),
    ).toThrowError(StorageError);
    try {
      openStateDatabase({ filePath, appVersion: "test", backupDirectory: directory });
    } catch (error) {
      expect((error as StorageError).code).toBe("storage-version-newer");
    }
  });

  it("遷移內容改了但版本號沒動：checksum 不符就報錯", () => {
    const directory = scratch();
    const filePath = path.join(directory, "state.sqlite");
    const first = Database.open(filePath, {
      create: { applicationId: STATE_APPLICATION_ID, pageSize: 4096, autoVacuum: "incremental" },
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    try {
      migrate(first, { migrations: M0_MIGRATIONS, appVersion: "test" });
    } finally {
      first.close();
    }
    const altered = [
      {
        ...(M0_MIGRATIONS[0] as { version: number; name: string; sql: string }),
        sql: `${M0_MIGRATIONS[0]?.sql}\n-- changed`,
      },
    ];
    const db = Database.open(filePath, {
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    try {
      expect(() => migrate(db, { migrations: altered, appVersion: "test" })).toThrowError(
        /checksum/,
      );
    } finally {
      db.close();
    }
  });

  it("v1 升 v8：八張新表、蒸餾四表、context_entries 的發牌欄位、版本歷史表與待決補丁表都在，成功後刪除備份", () => {
    const directory = scratch();
    const filePath = path.join(directory, "state.sqlite");
    const v1 = Database.open(filePath, {
      create: { applicationId: STATE_APPLICATION_ID, pageSize: 4096, autoVacuum: "incremental" },
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    try {
      migrate(v1, { migrations: M0_MIGRATIONS, appVersion: "test" });
      expect(Number(v1.pragma("user_version"))).toBe(1);
      for (const table of M1_TABLES) {
        expect(v1.tableExists(table), table).toBe(false);
      }
      v1.run(
        "INSERT INTO conversation_deletions (root_id, conversation_ids, client_request_ids, phase, requested_at, updated_at) VALUES ('c1', '[]', '[]', 'rows', 'now', 'now')",
      );
    } finally {
      v1.close();
    }

    let backupSeen: string | null = null;
    const upgraded = openStateDatabase({
      filePath,
      appVersion: "test",
      backupDirectory: directory,
      onBackup: (backupPath) => {
        backupSeen = backupPath;
        expect(existsSync(backupPath)).toBe(true);
        const backup = new DatabaseSync(backupPath);
        const row = backup.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
        expect(row.integrity_check).toBe("ok");
        backup.close();
      },
    });
    try {
      expect(upgraded.migration.fromVersion).toBe(1);
      expect(upgraded.migration.toVersion).toBe(10);
      expect(upgraded.migration.appliedVersions).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(backupSeen).not.toBeNull();
      expect(existsSync(backupSeen as unknown as string)).toBe(false);

      for (const table of [
        ...M1_TABLES,
        ...M2_TABLES,
        ...M3_TABLES,
        ...M6_TABLES,
        ...M7_TABLES,
        ...M8_TABLES,
      ]) {
        expect(upgraded.db.tableExists(table), table).toBe(true);
      }
      const columns = upgraded.db
        .all<{ name: string }>("PRAGMA table_info(conversation_deletions)")
        .map((column) => column.name);
      for (const column of M1_CONVERSATION_DELETION_COLUMNS) {
        expect(columns, column).toContain(column);
      }
      const entryColumns = upgraded.db
        .all<{ name: string }>("PRAGMA table_info(context_entries)")
        .map((column) => column.name);
      for (const column of M4_CONTEXT_ENTRY_DEAL_COLUMNS) {
        expect(entryColumns, column).toContain(column);
      }
      // 舊的刪除紀錄在加欄之後仍然讀得到，新欄位是空陣列。
      expect(
        upgraded.db.get<{ card_ids: string; asset_ids: string }>(
          "SELECT card_ids, asset_ids FROM conversation_deletions WHERE root_id = 'c1'",
        ),
      ).toEqual({ card_ids: "[]", asset_ids: "[]" });
      upgraded.db.run(
        "INSERT INTO conversations (conversation_id, created_at, updated_at, last_activity_at) VALUES ('c1', 'now', 'now', 'now')",
      );
      expect(upgraded.db.countRows("conversations")).toBe(1);
    } finally {
      upgraded.db.close();
    }
  });

  it("v2 升 v7：五張排程新表、蒸餾四表、發牌欄位、版本歷史表與待決補丁表都在，舊資料保留", () => {
    const directory = scratch();
    const filePath = path.join(directory, "state.sqlite");
    const v2 = Database.open(filePath, {
      create: { applicationId: STATE_APPLICATION_ID, pageSize: 4096, autoVacuum: "incremental" },
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    try {
      migrate(v2, { migrations: M1_MIGRATIONS, appVersion: "test" });
      expect(Number(v2.pragma("user_version"))).toBe(2);
      for (const table of M2_TABLES) {
        expect(v2.tableExists(table), table).toBe(false);
      }
      v2.run(
        "INSERT INTO conversations (conversation_id, title, created_at, updated_at, last_activity_at) VALUES ('keep', '保留我', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')",
      );
      v2.run(
        "INSERT INTO conversation_deletions (root_id, conversation_ids, client_request_ids, phase, requested_at, updated_at) VALUES ('del1', '[]', '[]', 'rows', 'now', 'now')",
      );
    } finally {
      v2.close();
    }

    let backupSeen: string | null = null;
    const upgraded = openStateDatabase({
      filePath,
      appVersion: "test",
      backupDirectory: directory,
      onBackup: (backupPath) => {
        backupSeen = backupPath;
      },
    });
    try {
      expect(upgraded.migration.fromVersion).toBe(2);
      expect(upgraded.migration.toVersion).toBe(10);
      expect(upgraded.migration.appliedVersions).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
      expect(backupSeen).not.toBeNull();

      for (const table of M2_TABLES) {
        expect(upgraded.db.tableExists(table), table).toBe(true);
      }
      for (const table of M3_TABLES) {
        expect(upgraded.db.tableExists(table), table).toBe(true);
      }
      // 舊對話保留，origin 的預設值是 'user'。
      expect(
        upgraded.db.get<{ origin: string; title: string }>(
          "SELECT origin, title FROM conversations WHERE conversation_id = 'keep'",
        ),
      ).toEqual({ origin: "user", title: "保留我" });
      // origin 只接受 'user' 與 'schedule'。
      expect(() =>
        upgraded.db.run(
          "INSERT INTO conversations (conversation_id, created_at, updated_at, last_activity_at, origin) VALUES ('bad', 'now', 'now', 'now', 'machine')",
        ),
      ).toThrowError(/CHECK/);
      upgraded.db.run(
        "INSERT INTO conversations (conversation_id, created_at, updated_at, last_activity_at, origin) VALUES ('sched', 'now', 'now', 'now', 'schedule')",
      );
      expect(
        upgraded.db.get<{ origin: string }>(
          "SELECT origin FROM conversations WHERE conversation_id = 'sched'",
        ),
      ).toEqual({ origin: "schedule" });

      upgraded.db.run(
        `INSERT INTO schedules (schedule_id, name, kind, spec_json, task_json, created_by, next_run_at, created_at, updated_at)
         VALUES ('sch_test', '每日蒸餾', 'daily', '{"time":"04:00"}', '{"type":"distillation"}', 'user', '2026-11-17T04:00:00.000Z', 'now', 'now')`,
      );
      upgraded.db.run(
        `INSERT INTO schedule_runs (run_id, schedule_id, started_at, status)
         VALUES ('run_test', 'sch_test', 'now', 'notify')`,
      );
      upgraded.db.run(
        `INSERT INTO notifications (notification_id, kind, title, body_md, created_at)
         VALUES ('ntf_test', 'heartbeat', '標題', '內文', 'now')`,
      );
      expect(upgraded.db.countRows("schedules")).toBe(1);
      expect(upgraded.db.countRows("schedule_runs")).toBe(1);
      expect(upgraded.db.countRows("notifications")).toBe(1);
      // 刪排程時 run 記錄跟著刪掉。
      upgraded.db.run("DELETE FROM schedules WHERE schedule_id = 'sch_test'");
      expect(upgraded.db.countRows("schedule_runs")).toBe(0);

      upgraded.db.run(
        `INSERT INTO pairing_sessions (id, device_name, device_kind, short_code_hash, status, connection_id, created_at, expires_at)
         VALUES ('pair_test', 'iPhone', 'ios', 'hash', 'requested', 'conn_1', 'now', 'later')`,
      );
      upgraded.db.run(
        `INSERT INTO device_tokens (id, token_hash, prefix, fingerprint, device_name, created_at)
         VALUES ('dev_test', 'hash', 'cdt_12345678', 'AAAA-BBBB-CCCC-DDDD', 'iPhone', 'now')`,
      );
      expect(upgraded.db.countRows("pairing_sessions")).toBe(1);
      expect(upgraded.db.countRows("device_tokens")).toBe(1);
      // token_hash 唯一。
      expect(() =>
        upgraded.db.run(
          `INSERT INTO device_tokens (id, token_hash, prefix, fingerprint, device_name, created_at)
           VALUES ('dev_test2', 'hash', 'cdt_87654321', 'EEEE-FFFF-0000-1111', 'iPad', 'now')`,
        ),
      ).toThrowError(/UNIQUE/);
    } finally {
      upgraded.db.close();
    }
  });

  it("v3 升 v7：蒸餾四表、發牌欄位、版本歷史表與待決補丁表一次到位，既有資料與舊 migration checksum 不變", () => {
    const directory = scratch();
    const filePath = path.join(directory, "state.sqlite");
    const v3 = Database.open(filePath, {
      create: { applicationId: STATE_APPLICATION_ID, pageSize: 4096, autoVacuum: "incremental" },
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    try {
      migrate(v3, { migrations: M2_MIGRATIONS, appVersion: "test" });
      expect(Number(v3.pragma("user_version"))).toBe(3);
      for (const table of M3_TABLES) {
        expect(v3.tableExists(table), table).toBe(false);
      }
      v3.run(
        "INSERT INTO conversations (conversation_id, title, created_at, updated_at, last_activity_at) VALUES ('keep', '留住我', '2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z')",
      );
    } finally {
      v3.close();
    }

    const upgraded = openStateDatabase({
      filePath,
      appVersion: "test",
      backupDirectory: directory,
    });
    try {
      expect(upgraded.migration.fromVersion).toBe(3);
      expect(upgraded.migration.toVersion).toBe(10);
      expect(upgraded.migration.appliedVersions).toEqual([4, 5, 6, 7, 8, 9, 10]);
      for (const table of [...M3_TABLES, ...M6_TABLES, ...M7_TABLES, ...M8_TABLES]) {
        expect(upgraded.db.tableExists(table), table).toBe(true);
      }
      const entryColumns = upgraded.db
        .all<{ name: string }>("PRAGMA table_info(context_entries)")
        .map((column) => column.name);
      for (const column of M4_CONTEXT_ENTRY_DEAL_COLUMNS) {
        expect(entryColumns, column).toContain(column);
      }
      // 既有對話還在。
      expect(
        upgraded.db.get<{ title: string }>(
          "SELECT title FROM conversations WHERE conversation_id = 'keep'",
        ),
      ).toEqual({ title: "留住我" });
      // 前五條 migration 的 checksum 沒變，只是追加第六條。
      const rows = upgraded.db.all<{ version: number; checksum: string }>(
        "SELECT version, checksum FROM schema_migrations ORDER BY version",
      );
      expect(rows).toHaveLength(10);
      expect(rows[2]?.checksum).toBe(sha256(M2_MIGRATIONS[2]?.sql ?? ""));
      expect(rows[3]?.checksum).toBe(sha256(M3_MIGRATIONS[3]?.sql ?? ""));
      expect(rows[4]?.checksum).toBe(sha256(M4_MIGRATIONS[4]?.sql ?? ""));
      expect(rows[5]?.checksum).toBe(sha256(M5_MIGRATIONS[5]?.sql ?? ""));
      expect(rows[6]?.checksum).toBe(sha256(M6_MIGRATIONS[6]?.sql ?? ""));
      expect(rows[7]?.checksum).toBe(sha256(M7_MIGRATIONS[7]?.sql ?? ""));
      expect(rows[8]?.checksum).toBe(sha256(M8_MIGRATIONS[8]?.sql ?? ""));
      expect(rows[9]?.checksum).toBe(sha256(M9_MIGRATIONS[9]?.sql ?? ""));

      // 四張表的基本約束：run 一天一次、item 的 phase/status CHECK、核心組一天一次。
      upgraded.db.run(
        `INSERT INTO distillation_runs (run_id, persona, day, started_at, status)
         VALUES ('dst_1', 'default', '2026-11-16', 'now', 'running')`,
      );
      expect(() =>
        upgraded.db.run(
          `INSERT INTO distillation_runs (run_id, persona, day, started_at, status)
           VALUES ('dst_2', 'default', '2026-11-16', 'now', 'running')`,
        ),
      ).toThrowError(/UNIQUE/);
      expect(() =>
        upgraded.db.run(
          `INSERT INTO distillation_items (run_id, item_key, batch_id, source_card_id, phase, status, updated_at)
           VALUES ('dst_1', 'k', 'b', 'c', 'bad', 'done', 'now')`,
        ),
      ).toThrowError(/CHECK/);
      upgraded.db.run(
        `INSERT INTO core_memory (persona, card_id, added_day, source)
         VALUES ('default', 'card_1', '2026-11-16', 'distillation')`,
      );
      expect(() =>
        upgraded.db.run(
          `INSERT INTO core_memory (persona, card_id, added_day, source)
           VALUES ('default', 'card_2', '2026-11-16', 'nope')`,
        ),
      ).toThrowError(/CHECK/);
      expect(() =>
        upgraded.db.run(
          `INSERT INTO core_memory_daily (persona, day, changed)
           VALUES ('default', '2026-11-16', 2)`,
        ),
      ).toThrowError(/CHECK/);
    } finally {
      upgraded.db.close();
    }
  });

  it("v4 升 v7：context_entries 補上發牌兩欄、版本歷史表與待決補丁表，舊列保留且新欄是 NULL", () => {
    const directory = scratch();
    const filePath = path.join(directory, "state.sqlite");
    const v4 = Database.open(filePath, {
      create: { applicationId: STATE_APPLICATION_ID, pageSize: 4096, autoVacuum: "incremental" },
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    try {
      migrate(v4, { migrations: M3_MIGRATIONS, appVersion: "test" });
      expect(Number(v4.pragma("user_version"))).toBe(4);
      const before = v4
        .all<{ name: string }>("PRAGMA table_info(context_entries)")
        .map((column) => column.name);
      for (const column of M4_CONTEXT_ENTRY_DEAL_COLUMNS) {
        expect(before, column).not.toContain(column);
      }
      v4.run(
        `INSERT INTO context_entries (entry_id, conversation_id, layer, card_id, title, token_estimate, state, position, added_at)
         VALUES ('old-entry', 'keep', 'opening-memory', 'card-1', '舊開局卡', 12, 'active', 0, 'now')`,
      );
    } finally {
      v4.close();
    }

    const upgraded = openStateDatabase({
      filePath,
      appVersion: "test",
      backupDirectory: directory,
    });
    try {
      expect(upgraded.migration.fromVersion).toBe(4);
      expect(upgraded.migration.toVersion).toBe(10);
      expect(upgraded.migration.appliedVersions).toEqual([5, 6, 7, 8, 9, 10]);
      const columns = upgraded.db
        .all<{ name: string }>("PRAGMA table_info(context_entries)")
        .map((column) => column.name);
      for (const column of M4_CONTEXT_ENTRY_DEAL_COLUMNS) {
        expect(columns, column).toContain(column);
      }
      // 舊列還在，兩欄是 NULL（視圖讀成省略）。
      expect(
        upgraded.db.get<{
          title: string;
          deal_probability: number | null;
          deal_source: string | null;
        }>(
          "SELECT title, deal_probability, deal_source FROM context_entries WHERE entry_id = 'old-entry'",
        ),
      ).toEqual({ title: "舊開局卡", deal_probability: null, deal_source: null });
      // 前五條 checksum 不變，追加第五與第六條。
      const rows = upgraded.db.all<{ version: number; checksum: string }>(
        "SELECT version, checksum FROM schema_migrations ORDER BY version",
      );
      expect(rows).toHaveLength(10);
      expect(rows[3]?.checksum).toBe(sha256(M3_MIGRATIONS[3]?.sql ?? ""));
      expect(rows[4]?.checksum).toBe(sha256(M4_MIGRATIONS[4]?.sql ?? ""));
      expect(rows[5]?.checksum).toBe(sha256(M5_MIGRATIONS[5]?.sql ?? ""));
      expect(rows[6]?.checksum).toBe(sha256(M6_MIGRATIONS[6]?.sql ?? ""));
      expect(rows[7]?.checksum).toBe(sha256(M7_MIGRATIONS[7]?.sql ?? ""));
      expect(rows[8]?.checksum).toBe(sha256(M8_MIGRATIONS[8]?.sql ?? ""));
      expect(rows[9]?.checksum).toBe(sha256(M9_MIGRATIONS[9]?.sql ?? ""));
      for (const table of [...M6_TABLES, ...M7_TABLES, ...M8_TABLES]) {
        expect(upgraded.db.tableExists(table), table).toBe(true);
      }

      // 新欄位可以寫入，來源只接受三種值。
      upgraded.db.run(
        `UPDATE context_entries SET deal_probability = 0.9, deal_source = 'system-one' WHERE entry_id = 'old-entry'`,
      );
      expect(
        upgraded.db.get<{ deal_probability: number; deal_source: string }>(
          "SELECT deal_probability, deal_source FROM context_entries WHERE entry_id = 'old-entry'",
        ),
      ).toEqual({ deal_probability: 0.9, deal_source: "system-one" });
      expect(() =>
        upgraded.db.run(
          `UPDATE context_entries SET deal_source = 'bogus' WHERE entry_id = 'old-entry'`,
        ),
      ).toThrowError(/CHECK/);
    } finally {
      upgraded.db.close();
    }
  });

  it("遷移失敗保留備份，資料庫停在 v1", () => {
    const directory = scratch();
    const filePath = path.join(directory, "state.sqlite");
    const db = Database.open(filePath, {
      create: { applicationId: STATE_APPLICATION_ID, pageSize: 4096, autoVacuum: "incremental" },
      expectedApplicationId: STATE_APPLICATION_ID,
    });
    try {
      migrate(db, { migrations: M0_MIGRATIONS, appVersion: "test" });
      let backupSeen: string | null = null;
      expect(() =>
        migrate(db, {
          migrations: [
            ...M0_MIGRATIONS,
            { version: 2, name: "broken", sql: "CREATE TABLE broken_table (" },
          ],
          appVersion: "test",
          backupDirectory: directory,
          onBackup: (backupPath) => {
            backupSeen = backupPath;
          },
        }),
      ).toThrowError(StorageError);
      expect(backupSeen).not.toBeNull();
      expect(existsSync(backupSeen as unknown as string)).toBe(true);
      expect(Number(db.pragma("user_version"))).toBe(1);
      expect(db.tableExists("broken_table")).toBe(false);

      const backup = new DatabaseSync(backupSeen as unknown as string);
      try {
        const integrity = backup.prepare("PRAGMA integrity_check").get() as {
          integrity_check: string;
        };
        expect(integrity.integrity_check).toBe("ok");
        const version = backup.prepare("PRAGMA user_version").get() as { user_version: number };
        expect(Number(version.user_version)).toBe(1);
      } finally {
        backup.close();
      }
    } finally {
      db.close();
    }
  });
});
