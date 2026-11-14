import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Database } from "./db.js";
import { StorageError } from "./errors.js";
import { nowIso } from "./util.js";
import { sha256 } from "./json.js";

/** `state/cardiary.sqlite` 的 application_id（CDRY）。 */
export const STATE_APPLICATION_ID = 0x43445259;
/** `state/engine.sqlite` 的 application_id（CDEN）。 */
export const ENGINE_APPLICATION_ID = 0x4344454e;
/** `cache/index.sqlite` 的 application_id（CDIX）。 */
export const CACHE_APPLICATION_ID = 0x43444958;

/** 快取資料庫的 schema 版本；快取可重建，版本不符就整檔重來。 */
export const CACHE_SCHEMA_VERSION = 1;

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/**
 * M0 的 schema 與保留給 M1 的兩張表。
 *
 * `approval_allowlist` 與 `next_turn_injections` 先建立，讓刪除流程與
 * 「不動白名單」的驗收從 M0 就能測試；M0 不提供寫入白名單的路徑。
 */
const INITIAL_SCHEMA = `
CREATE TABLE file_registry (
  id           TEXT    PRIMARY KEY,
  zone         TEXT    NOT NULL CHECK (zone IN ('cache', 'tmp')),
  rel_path     TEXT    NOT NULL UNIQUE,
  owner_kind   TEXT    NOT NULL CHECK (
                 owner_kind IN ('conversation', 'task', 'tool-call', 'module', 'index', 'migration')
               ),
  owner_id     TEXT,
  state        TEXT    NOT NULL DEFAULT 'live' CHECK (state IN ('live', 'expired', 'orphan')),
  size_bytes   INTEGER,
  created_at   TEXT    NOT NULL,
  renewed_at   TEXT    NOT NULL,
  last_used_at TEXT    NOT NULL,
  expires_at   TEXT
) STRICT;

CREATE INDEX file_registry_by_expiry ON file_registry (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX file_registry_by_owner ON file_registry (owner_kind, owner_id);
CREATE INDEX file_registry_by_zone ON file_registry (zone, last_used_at);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  level      TEXT NOT NULL CHECK (level IN ('free', 'approval', 'human-only')),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
) STRICT;

CREATE TABLE setting_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT    NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  level       TEXT    NOT NULL,
  actor       TEXT    NOT NULL,
  approval_id TEXT,
  changed_at  TEXT    NOT NULL
) STRICT;

CREATE INDEX setting_changes_by_key ON setting_changes (key, changed_at);

CREATE TABLE event_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  stream     TEXT    NOT NULL,
  epoch      TEXT    NOT NULL,
  stream_seq INTEGER NOT NULL,
  kind       TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  UNIQUE (stream, epoch, stream_seq)
) STRICT;

CREATE INDEX event_log_by_stream ON event_log (stream, epoch, stream_seq);
CREATE INDEX event_log_by_epoch ON event_log (epoch);

CREATE TABLE card_state (
  card_id       TEXT PRIMARY KEY,
  persona       TEXT NOT NULL DEFAULT 'default',
  freshness     REAL NOT NULL DEFAULT 100,
  freshness_at  TEXT NOT NULL,
  pinned        INTEGER NOT NULL DEFAULT 0,
  pinned_at     TEXT,
  lifecycle     TEXT NOT NULL DEFAULT 'live' CHECK (lifecycle IN ('live', 'cold')),
  superseded_by TEXT,
  updated_at    TEXT NOT NULL
) STRICT;

CREATE INDEX card_state_by_freshness ON card_state (freshness) WHERE lifecycle = 'live';

CREATE TABLE card_loads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id         TEXT    NOT NULL REFERENCES card_state (card_id) ON DELETE CASCADE,
  conversation_id TEXT,
  kind            TEXT    NOT NULL CHECK (kind IN ('deal', 'search', 'flip', 'pin', 'manual')),
  counts_as_load  INTEGER NOT NULL,
  loaded_at       TEXT    NOT NULL
) STRICT;

CREATE INDEX card_loads_by_card ON card_loads (card_id, loaded_at);
CREATE INDEX card_loads_by_conversation ON card_loads (conversation_id, loaded_at);

CREATE TABLE approvals (
  id            TEXT PRIMARY KEY,
  approval_key  TEXT NOT NULL,
  scope         TEXT NOT NULL DEFAULT 'tool' CHECK (scope IN ('tool', 'task')),
  session_id    TEXT,
  turn_id       TEXT,
  tool_name     TEXT,
  subject_id    TEXT,
  tool_call_id  TEXT,
  action_kind   TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (
                  status IN ('pending', 'approved', 'denied', 'expired', 'withdrawn')
                ),
  request_json  TEXT NOT NULL,
  decision_json TEXT,
  requested_at  TEXT NOT NULL,
  expires_at    TEXT,
  decided_at    TEXT,
  decided_by    TEXT,
  CHECK (scope <> 'tool' OR tool_name IS NOT NULL),
  CHECK (scope <> 'task' OR tool_name IS NULL),
  CHECK (scope <> 'task' OR subject_id IS NOT NULL)
) STRICT;

CREATE INDEX approvals_by_status ON approvals (status, requested_at);
CREATE INDEX approvals_by_session ON approvals (session_id, status);
CREATE INDEX approvals_by_key ON approvals (approval_key, requested_at);
CREATE UNIQUE INDEX approvals_one_pending_per_key
  ON approvals (approval_key) WHERE status = 'pending';

CREATE TABLE turn_index (
  turn_id            TEXT PRIMARY KEY,
  conversation_id    TEXT NOT NULL,
  trigger_message_id TEXT NOT NULL,
  started_at         TEXT NOT NULL,
  UNIQUE (conversation_id, trigger_message_id)
) STRICT;

CREATE INDEX turn_index_by_message ON turn_index (conversation_id, trigger_message_id);

CREATE TABLE request_dedupe (
  key           TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('session-create', 'send-message')),
  state         TEXT NOT NULL CHECK (state IN ('pending', 'completed')),
  resource_id   TEXT,
  response_json TEXT,
  claimed_at    TEXT NOT NULL,
  completed_at  TEXT,
  expires_at    TEXT NOT NULL,
  CHECK ((state = 'completed') = (response_json IS NOT NULL AND completed_at IS NOT NULL))
) STRICT;

CREATE INDEX request_dedupe_by_expiry ON request_dedupe (expires_at);
CREATE INDEX request_dedupe_by_state ON request_dedupe (state, claimed_at);

CREATE TABLE runtime_state (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  epoch            TEXT    NOT NULL,
  clean_shutdown   INTEGER NOT NULL CHECK (clean_shutdown IN (0, 1)),
  started_at       TEXT    NOT NULL,
  last_shutdown_at TEXT,
  shutdown_reason  TEXT
) STRICT;

CREATE TABLE conversation_deletions (
  root_id            TEXT PRIMARY KEY,
  conversation_ids   TEXT NOT NULL,
  client_request_ids TEXT NOT NULL,
  phase              TEXT NOT NULL CHECK (phase IN ('rows', 'vacuum')),
  requested_at       TEXT NOT NULL,
  updated_at         TEXT NOT NULL
) STRICT;

CREATE TABLE subagent_runs (
  id              TEXT PRIMARY KEY,
  branch_id       TEXT NOT NULL,
  parent_id       TEXT NOT NULL,
  fork_entry_id   TEXT NOT NULL,
  mode            TEXT NOT NULL CHECK (mode IN ('sync', 'background')),
  status          TEXT NOT NULL CHECK (
                    status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
                  ),
  result_entry_id TEXT,
  result_card_id  TEXT,
  created_at      TEXT NOT NULL,
  started_at      TEXT,
  completed_at    TEXT,
  consumed_at     TEXT,
  error           TEXT
) STRICT;

CREATE INDEX subagent_runs_by_parent ON subagent_runs (parent_id, created_at);
CREATE INDEX subagent_runs_by_status ON subagent_runs (status);

CREATE TABLE approval_allowlist (
  id          TEXT PRIMARY KEY,
  tool_name   TEXT NOT NULL,
  scope_key   TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  UNIQUE (tool_name, scope_key)
) STRICT;

CREATE TABLE next_turn_injections (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  payload         TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  consumed_at     TEXT
) STRICT;

CREATE INDEX next_turn_injections_by_conversation
  ON next_turn_injections (conversation_id, created_at);
`;

/** M0 的十二張功能表；`approval_allowlist` 與 `next_turn_injections` 是 M1 保留表。 */
export const M0_TABLES = [
  "schema_migrations",
  "file_registry",
  "settings",
  "setting_changes",
  "event_log",
  "card_state",
  "card_loads",
  "approvals",
  "turn_index",
  "request_dedupe",
  "runtime_state",
  "conversation_deletions",
] as const;

/** M1 會用到、M0 先建立讓刪除與白名單行為可測試的保留表。 */
export const RESERVED_M1_TABLES = [
  "subagent_runs",
  "approval_allowlist",
  "next_turn_injections",
] as const;

/** M0 的遷移清單。 */
export const M0_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "m0-initial", sql: INITIAL_SCHEMA },
];

const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  checksum    TEXT    NOT NULL,
  applied_at  TEXT    NOT NULL,
  app_version TEXT    NOT NULL
) STRICT;
`;

export interface MigrateOptions {
  readonly migrations?: readonly Migration[];
  readonly appVersion: string;
  readonly now?: () => Date;
  readonly backupDirectory?: string;
  /** 備份檔建立後呼叫；呼叫端用它登記檔案。 */
  readonly onBackup?: (absolutePath: string) => void;
  /** 遷移成功、刪除備份後呼叫。 */
  readonly onBackupRemoved?: (absolutePath: string) => void;
}

export interface MigrationOutcome {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly appliedVersions: readonly number[];
  readonly backupPath: string | null;
}

interface AppliedMigrationRow {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

/**
 * 套用資料庫遷移。
 *
 * - `user_version` 大於程式支援的版本時拒絕啟動。
 * - 升級前先 `VACUUM INTO` 備份並對備份做 `integrity_check`。
 * - 每個版本在單一交易內完成 SQL、`user_version` 與 `schema_migrations`。
 */
export function migrate(db: Database, options: MigrateOptions): MigrationOutcome {
  const migrations = options.migrations ?? M0_MIGRATIONS;
  const now = options.now ?? (() => new Date());
  db.exec(SCHEMA_MIGRATIONS_DDL);

  const maxVersion = migrations.reduce((max, migration) => Math.max(max, migration.version), 0);
  const fromVersion = Number(db.pragma("user_version"));
  if (fromVersion > maxVersion) {
    throw new StorageError("storage-version-newer", "資料庫版本比程式新，拒絕啟動", {
      databaseVersion: fromVersion,
      supportedVersion: maxVersion,
    });
  }

  const appliedRows = db.all<AppliedMigrationRow>(
    "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
  );
  for (const row of appliedRows) {
    const migration = migrations.find((candidate) => candidate.version === row.version);
    if (migration === undefined) {
      throw new StorageError("migration-checksum-mismatch", "資料庫有程式不認識的遷移", {
        version: row.version,
      });
    }
    if (sha256(migration.sql) !== row.checksum) {
      throw new StorageError("migration-checksum-mismatch", "遷移內容與已套用的 checksum 不符", {
        version: row.version,
      });
    }
  }

  const pending = migrations
    .filter((migration) => migration.version > fromVersion)
    .sort((left, right) => left.version - right.version);
  if (pending.length === 0) {
    return { fromVersion, toVersion: fromVersion, appliedVersions: [], backupPath: null };
  }

  let backupPath: string | null = null;
  if (fromVersion > 0 && options.backupDirectory !== undefined) {
    backupPath = path.join(options.backupDirectory, `migration-backup-v${fromVersion}.sqlite`);
    db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
    verifyBackup(backupPath, fromVersion);
    options.onBackup?.(backupPath);
  }

  const appliedVersions: number[] = [];
  for (const migration of pending) {
    try {
      db.transaction((tx) => {
        tx.exec(migration.sql);
        tx.exec(`PRAGMA user_version = ${migration.version}`);
        tx.run(
          "INSERT INTO schema_migrations (version, name, checksum, applied_at, app_version) VALUES (?, ?, ?, ?, ?)",
          migration.version,
          migration.name,
          sha256(migration.sql),
          nowIso(now),
          options.appVersion,
        );
      });
      appliedVersions.push(migration.version);
    } catch (error) {
      throw new StorageError("migration-failed", "資料庫遷移失敗，保留備份", {
        version: migration.version,
        backupPath,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (backupPath !== null) {
    removeDatabaseFiles(backupPath);
    options.onBackupRemoved?.(backupPath);
  }
  return {
    fromVersion,
    toVersion: Number(db.pragma("user_version")),
    appliedVersions,
    backupPath,
  };
}

function verifyBackup(backupPath: string, version: number): void {
  const backup = new DatabaseSync(backupPath);
  try {
    const row = backup.prepare("PRAGMA integrity_check").get() as
      { integrity_check: string } | undefined;
    if (row?.integrity_check !== "ok") {
      throw new StorageError("migration-failed", "遷移備份的 integrity_check 失敗", {
        backupPath,
        version,
        result: row?.integrity_check,
      });
    }
    const applicationId = Number(
      (backup.prepare("PRAGMA application_id").get() as { application_id: number } | undefined)
        ?.application_id,
    );
    if (applicationId === 0) {
      throw new StorageError("migration-failed", "遷移備份沒有 application_id", {
        backupPath,
        version,
      });
    }
  } finally {
    backup.close();
  }
}

function removeDatabaseFiles(databasePath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

export interface StateDatabaseOptions {
  readonly filePath: string;
  readonly appVersion: string;
  readonly backupDirectory: string;
  readonly now?: () => Date;
  readonly trace?: (operation: string) => void;
  readonly onFailure?: (error: unknown, filePath: string) => void;
  readonly onBackup?: (absolutePath: string) => void;
  readonly onBackupRemoved?: (absolutePath: string) => void;
}

export interface StateDatabaseHandle {
  readonly db: Database;
  readonly migration: MigrationOutcome;
}

/** 建立或開啟 `state/cardiary.sqlite`，驗證 header 並跑遷移。 */
export function openStateDatabase(options: StateDatabaseOptions): StateDatabaseHandle {
  const db = Database.open(options.filePath, {
    create: { applicationId: STATE_APPLICATION_ID, pageSize: 4096, autoVacuum: "incremental" },
    expectedApplicationId: STATE_APPLICATION_ID,
    busyTimeoutMs: 5000,
    secureDelete: true,
    ...(options.trace === undefined ? {} : { trace: options.trace }),
    ...(options.onFailure === undefined ? {} : { onFailure: options.onFailure }),
  });
  try {
    const migration = migrate(db, {
      appVersion: options.appVersion,
      backupDirectory: options.backupDirectory,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.onBackup === undefined ? {} : { onBackup: options.onBackup }),
      ...(options.onBackupRemoved === undefined
        ? {}
        : { onBackupRemoved: options.onBackupRemoved }),
    });
    return { db, migration };
  } catch (error) {
    db.close();
    throw error;
  }
}

export interface CacheDatabaseOptions {
  readonly filePath: string;
  readonly now?: () => Date;
  readonly trace?: (operation: string) => void;
  readonly onFailure?: (error: unknown, filePath: string) => void;
}

export interface CacheDatabaseHandle {
  readonly db: Database;
  readonly rebuilt: boolean;
}

/**
 * 建立或開啟 `cache/index.sqlite`。
 *
 * 快取是衍生物：檔不存在、application_id 不對或版本不對時整個刪掉重建。
 */
export function openCacheDatabase(options: CacheDatabaseOptions): CacheDatabaseHandle {
  let rebuilt = false;
  if (existsSync(options.filePath)) {
    try {
      const existing = Database.open(options.filePath, {
        expectedApplicationId: CACHE_APPLICATION_ID,
        busyTimeoutMs: 5000,
        secureDelete: true,
        ...(options.trace === undefined ? {} : { trace: options.trace }),
        ...(options.onFailure === undefined ? {} : { onFailure: options.onFailure }),
      });
      const version = Number(existing.pragma("user_version"));
      if (version === CACHE_SCHEMA_VERSION) {
        return { db: existing, rebuilt: false };
      }
      existing.close();
      rebuilt = true;
    } catch {
      rebuilt = true;
    }
    removeDatabaseFiles(options.filePath);
  }

  const db = Database.open(options.filePath, {
    create: { applicationId: CACHE_APPLICATION_ID, pageSize: 4096, autoVacuum: "incremental" },
    expectedApplicationId: CACHE_APPLICATION_ID,
    busyTimeoutMs: 5000,
    secureDelete: true,
    ...(options.trace === undefined ? {} : { trace: options.trace }),
    ...(options.onFailure === undefined ? {} : { onFailure: options.onFailure }),
  });
  db.exec(`PRAGMA user_version = ${CACHE_SCHEMA_VERSION}`);
  return { db, rebuilt };
}

/** 建立或開啟 `state/engine.sqlite`；Cardiary 先寫 header，引擎之後自己建表。 */
export function openEngineDatabase(options: {
  readonly filePath: string;
  readonly trace?: (operation: string) => void;
  readonly onFailure?: (error: unknown, filePath: string) => void;
}): Database {
  return Database.open(options.filePath, {
    create: { applicationId: ENGINE_APPLICATION_ID, pageSize: 4096, autoVacuum: "incremental" },
    expectedApplicationId: ENGINE_APPLICATION_ID,
    busyTimeoutMs: 5000,
    secureDelete: true,
    ...(options.trace === undefined ? {} : { trace: options.trace }),
    ...(options.onFailure === undefined ? {} : { onFailure: options.onFailure }),
  });
}
