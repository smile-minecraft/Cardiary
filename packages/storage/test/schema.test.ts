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
  it("Cardiary 狀態庫的 header 與 M0 表齊全", () => {
    const tempRoot = temp();
    const storage = openTestStorage(tempRoot);
    cleanups.push(() => storage.close());
    expect(Number(storage.state.pragma("application_id"))).toBe(STATE_APPLICATION_ID);
    expect(Number(storage.state.pragma("page_size"))).toBe(4096);
    expect(Number(storage.state.pragma("auto_vacuum"))).toBe(2);
    expect(Number(storage.state.pragma("user_version"))).toBe(1);
    expect(String(storage.state.pragma("journal_mode"))).toBe("wal");
    expect(Number(storage.state.pragma("secure_delete"))).toBe(1);
    expect(Number(storage.state.pragma("foreign_keys"))).toBe(1);
    expect(M0_TABLES).toHaveLength(12);
    for (const table of M0_TABLES) {
      expect(storage.state.tableExists(table), table).toBe(true);
    }
    for (const table of RESERVED_M1_TABLES) {
      expect(storage.state.tableExists(table), table).toBe(true);
    }
    const migration = storage.state.get<{ version: number; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations ORDER BY version",
    );
    expect(migration?.version).toBe(1);
    expect(migration?.checksum).toBe(sha256(M0_MIGRATIONS[0]?.sql ?? ""));
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
    expect(Number(second.state.pragma("user_version"))).toBe(1);
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
    expect(first.migration.appliedVersions).toEqual([1]);
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
    const first = openStateDatabase({
      filePath,
      appVersion: "test",
      backupDirectory: directory,
    });
    first.db.close();
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

  it("升級前備份、備份通過 integrity_check、成功後刪除", () => {
    const directory = scratch();
    const filePath = path.join(directory, "state.sqlite");
    const first = openStateDatabase({
      filePath,
      appVersion: "test",
      backupDirectory: directory,
    });
    first.db.close();

    const versionTwo = {
      version: 2,
      name: "add-test-table",
      sql: "CREATE TABLE migration_probe (id TEXT PRIMARY KEY) STRICT;",
    };
    const db = Database.open(filePath, { expectedApplicationId: STATE_APPLICATION_ID });
    let backupSeen: string | null = null;
    try {
      const outcome = migrate(db, {
        migrations: [...M0_MIGRATIONS, versionTwo],
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
      expect(outcome.appliedVersions).toEqual([2]);
      expect(backupSeen).not.toBeNull();
      expect(existsSync(backupSeen as unknown as string)).toBe(false);
      expect(db.tableExists("migration_probe")).toBe(true);
      expect(Number(db.pragma("user_version"))).toBe(2);
    } finally {
      db.close();
    }
  });
});
