import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Database } from "./db.js";
import type { FolderLayout } from "./paths.js";
import { removeFileSafely } from "./paths.js";
import { StorageError } from "./errors.js";
import { nowIso } from "./util.js";
import { sha256 } from "./json.js";

/** `state/cardiary.sqlite` 的 application_id（CDRY）。 */
export const STATE_APPLICATION_ID = 0x43445259;
/** `state/engine.sqlite` 的 application_id（CDEN）。 */
export const ENGINE_APPLICATION_ID = 0x4344454e;
/** `cache/index.sqlite` 的 application_id（CDIX）。 */
export const CACHE_APPLICATION_ID = 0x43444958;

/**
 * 快取資料庫的 schema 版本；快取可重建，版本不符就整檔重來。
 *
 * v2：卡片索引（`card_index`、`card_tags`、`card_links`、`card_sources`、
 * `asset_refs`、`asset_meta`、`fts_cards` 與 `card_index_meta`）。
 */
export const CACHE_SCHEMA_VERSION = 2;

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

const M1_SCHEMA = `
CREATE TABLE conversations (
  conversation_id         TEXT PRIMARY KEY,
  title                   TEXT,
  persona                 TEXT NOT NULL DEFAULT 'default',
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  last_activity_at        TEXT NOT NULL,
  archived_at             TEXT,
  purge_at                TEXT,
  archived_by             TEXT,
  archive_summary_card_id TEXT,
  pinned                  INTEGER NOT NULL DEFAULT 0,
  CHECK (archived_at IS NULL OR purge_at IS NOT NULL)
) STRICT;

CREATE INDEX conversations_by_archive ON conversations (archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX conversations_by_activity ON conversations (last_activity_at);

CREATE TABLE conversation_cards (
  conversation_id TEXT NOT NULL,
  card_id         TEXT NOT NULL,
  first_loaded_at TEXT NOT NULL,
  last_loaded_at  TEXT NOT NULL,
  load_count      INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (conversation_id, card_id)
) STRICT;

CREATE INDEX conversation_cards_by_card ON conversation_cards (card_id);

ALTER TABLE conversation_deletions ADD COLUMN card_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE conversation_deletions ADD COLUMN asset_ids TEXT NOT NULL DEFAULT '[]';

CREATE TABLE conversation_context (
  conversation_id        TEXT PRIMARY KEY,
  version                INTEGER NOT NULL DEFAULT 0,
  used_tokens            INTEGER NOT NULL DEFAULT 0,
  budget_tokens          INTEGER NOT NULL DEFAULT 0,
  context_window         INTEGER NOT NULL DEFAULT 0,
  compaction_threshold   REAL NOT NULL DEFAULT 0.75,
  reserve_tokens         INTEGER NOT NULL DEFAULT 8192,
  compaction_in_progress INTEGER NOT NULL DEFAULT 0,
  last_compacted_at      TEXT,
  updated_at             TEXT NOT NULL
) STRICT;

CREATE TABLE context_entries (
  entry_id            TEXT PRIMARY KEY,
  conversation_id     TEXT NOT NULL,
  layer               TEXT NOT NULL CHECK (layer IN (
                        'bedrock', 'persona', 'core-memory', 'opening-memory',
                        'short-term-memory', 'other-cards', 'working-context', 'volatile-state')),
  card_id             TEXT,
  title               TEXT NOT NULL,
  token_estimate      INTEGER NOT NULL,
  state               TEXT NOT NULL CHECK (state IN ('active', 'pending-removal')),
  position            INTEGER NOT NULL,
  added_at            TEXT NOT NULL,
  removed_requested_at TEXT
) STRICT;

CREATE INDEX context_entries_by_conversation ON context_entries (conversation_id, position);
CREATE INDEX context_entries_by_card ON context_entries (card_id) WHERE card_id IS NOT NULL;

CREATE TABLE conversation_usage (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id    TEXT NOT NULL,
  turn_id            TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL,
  output_tokens      INTEGER NOT NULL,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  request_tokens     INTEGER NOT NULL,
  recorded_at        TEXT NOT NULL,
  UNIQUE (conversation_id, turn_id)
) STRICT;

CREATE INDEX conversation_usage_by_conversation ON conversation_usage (conversation_id, recorded_at);

CREATE TABLE import_jobs (
  id           TEXT PRIMARY KEY,
  source_kind  TEXT NOT NULL CHECK (source_kind IN (
                 'generic', 'hermes', 'alma', 'openclaw', 'codex', 'claude-code', 'claude')),
  source_path  TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN (
                 'preview', 'running', 'completed', 'failed', 'cancelled')),
  range_start  TEXT,
  range_end    TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  report_json  TEXT
) STRICT;

CREATE TABLE import_items (
  job_id       TEXT NOT NULL REFERENCES import_jobs (id) ON DELETE CASCADE,
  item_key     TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN (
                 'persona', 'user', 'memory', 'rule', 'skill', 'conversation')),
  card_id      TEXT,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'written', 'skipped', 'failed')),
  reason       TEXT,
  PRIMARY KEY (job_id, item_key)
) STRICT;

CREATE INDEX import_items_by_hash ON import_items (content_hash);
CREATE INDEX import_items_by_status ON import_items (status, job_id);
`;

/** M1 的新表名稱（不含 conversation_deletions 的新欄位）。 */
export const M1_TABLES = [
  "conversations",
  "conversation_cards",
  "conversation_context",
  "context_entries",
  "conversation_usage",
  "import_jobs",
  "import_items",
] as const;

/** `conversation_deletions` 在 v2 增加的欄位。 */
export const M1_CONVERSATION_DELETION_COLUMNS = ["card_ids", "asset_ids"] as const;

/**
 * 程式的遷移清單。
 *
 * M1 的新表一次建好，之後的工作只寫資料列：`state-schema.ts` 是所有工作
 * 共用的檔案，只讓一個工作改一次，避免平行衝突。v3 追加在 v2 之後，
 * 舊有的 checksum 不變。
 */
export const M1_MIGRATIONS: readonly Migration[] = [
  ...M0_MIGRATIONS,
  { version: 2, name: "m1-cards-context-lifecycle", sql: M1_SCHEMA },
];

const M3_SCHEMA = `
CREATE TABLE schedules (
  schedule_id            TEXT PRIMARY KEY,
  persona                TEXT NOT NULL DEFAULT 'default',
  name                   TEXT NOT NULL,
  kind                   TEXT NOT NULL CHECK (kind IN ('once', 'daily', 'interval', 'heartbeat')),
  spec_json              TEXT NOT NULL,
  task_json              TEXT NOT NULL,
  enabled                INTEGER NOT NULL DEFAULT 1,
  created_by             TEXT NOT NULL CHECK (created_by IN ('user', 'agent')),
  source_conversation_id TEXT,
  next_run_at            TEXT NOT NULL,
  last_run_at            TEXT,
  last_status            TEXT CHECK (last_status IN ('ok', 'silent', 'notify', 'error')),
  last_error             TEXT,
  run_count              INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
) STRICT;

CREATE TABLE schedule_runs (
  run_id          TEXT PRIMARY KEY,
  schedule_id     TEXT NOT NULL REFERENCES schedules (schedule_id) ON DELETE CASCADE,
  conversation_id TEXT,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  status          TEXT NOT NULL CHECK (status IN ('ok', 'silent', 'notify', 'error', 'cancelled')),
  error           TEXT
) STRICT;

CREATE INDEX schedule_runs_by_schedule ON schedule_runs (schedule_id, started_at);

CREATE TABLE notifications (
  notification_id        TEXT PRIMARY KEY,
  kind                   TEXT NOT NULL CHECK (kind IN ('schedule', 'heartbeat', 'distillation')),
  title                  TEXT NOT NULL,
  body_md                TEXT NOT NULL,
  payload_json           TEXT NOT NULL DEFAULT '{}',
  source_schedule_id     TEXT,
  source_conversation_id TEXT,
  card_id                TEXT,
  created_at             TEXT NOT NULL,
  read_at                TEXT
) STRICT;

CREATE INDEX notifications_by_created ON notifications (created_at DESC, notification_id DESC);
CREATE INDEX notifications_by_unread ON notifications (read_at) WHERE read_at IS NULL;
CREATE INDEX notifications_by_card ON notifications (card_id) WHERE card_id IS NOT NULL;

CREATE TABLE pairing_sessions (
  id                 TEXT PRIMARY KEY,
  device_name        TEXT NOT NULL,
  device_kind        TEXT NOT NULL CHECK (device_kind IN ('web', 'ios')),
  short_code_hash    TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (
                       status IN ('requested', 'approved', 'completed', 'denied', 'expired')
                     ),
  connection_id      TEXT NOT NULL,
  code_attempts_used INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  expires_at         TEXT NOT NULL,
  approved_at        TEXT,
  completed_at       TEXT,
  closed_reason      TEXT CHECK (
                       closed_reason IN ('denied', 'expired', 'disconnected', 'attempts-exhausted')
                     )
) STRICT;

CREATE INDEX pairing_sessions_by_status ON pairing_sessions (status, created_at);
CREATE INDEX pairing_sessions_by_expiry ON pairing_sessions (expires_at)
  WHERE status IN ('requested', 'approved');

CREATE TABLE device_tokens (
  id           TEXT PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  device_name  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT,
  revoked_at   TEXT,
  last_used_at TEXT
) STRICT;

CREATE INDEX device_tokens_by_fingerprint ON device_tokens (fingerprint);
CREATE INDEX device_tokens_by_revoked ON device_tokens (revoked_at) WHERE revoked_at IS NOT NULL;

ALTER TABLE conversations ADD COLUMN origin TEXT NOT NULL DEFAULT 'user'
  CHECK (origin IN ('user', 'schedule'));
`;

/** v3 新增的表名稱。 */
export const M2_TABLES = [
  "schedules",
  "schedule_runs",
  "notifications",
  "pairing_sessions",
  "device_tokens",
] as const;

/** v3 在既有表上新增的欄位。 */
export const M2_CONVERSATION_COLUMNS = ["origin"] as const;

/**
 * v3「m2-memory-schedule-remote」一次到位的新表。
 *
 * `notifications.card_id` 是通知轉卡的去重鍵：重複的 `notification.create_card`
 * 回同一張卡。`pairing_sessions` 與 `device_tokens` 是遠端配對的正本，這次只
 * 建表與遷移，配對流程由遠端工作實作；短碼只存雜湊，明文不落地。
 * `conversations.origin` 讓側欄不列排程背景對話。
 */
export const M2_MIGRATIONS: readonly Migration[] = [
  ...M1_MIGRATIONS,
  { version: 3, name: "m2-memory-schedule-remote", sql: M3_SCHEMA },
];

/**
 * v4「m2-distillation」的蒸餾表。
 *
 * 設計原訂把這些表放進 v3，但 v3 已由排程工作合併（6ac2aa4）且不含蒸餾表；
 * 派遣指示「v4 遷移，v3 已存在，往後加」，因此这里以 version 4 獨立追加。
 * 舊 migration 的 checksum 不變。
 *
 * - `distillation_runs`：一天一次（persona, day 唯一）；running 超過 30 分鐘視為中斷。
 * - `distillation_items`：每個單元的批次、來源卡、內容雜湊、輸出卡與寫入狀態。
 * - `core_memory`／`core_memory_daily`：核心記憶組成員與一天一次變動計數。
 */
const M4_SCHEMA = `
CREATE TABLE distillation_runs (
  run_id       TEXT PRIMARY KEY,
  persona      TEXT NOT NULL DEFAULT 'default',
  day          TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL CHECK (status IN ('running','completed','partial','failed')),
  stats_json   TEXT,
  UNIQUE (persona, day)
) STRICT;

CREATE TABLE distillation_items (
  run_id         TEXT NOT NULL REFERENCES distillation_runs (run_id) ON DELETE CASCADE,
  item_key       TEXT NOT NULL,
  batch_id       TEXT NOT NULL,
  persona        TEXT NOT NULL DEFAULT 'default',
  source_card_id TEXT NOT NULL,
  content_hash   TEXT,
  output_card_id TEXT,
  phase          TEXT NOT NULL CHECK (phase IN ('extract','merge','archive','core','notify')),
  status         TEXT NOT NULL CHECK (status IN ('pending','done','failed')),
  detail_json    TEXT,
  undone         INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (run_id, item_key)
) STRICT;

CREATE INDEX distillation_items_by_batch ON distillation_items (persona, batch_id);
CREATE INDEX distillation_items_by_hash ON distillation_items (persona, content_hash)
  WHERE content_hash IS NOT NULL;
CREATE INDEX distillation_items_by_source ON distillation_items (run_id, source_card_id);

CREATE TABLE core_memory (
  persona    TEXT NOT NULL DEFAULT 'default',
  card_id    TEXT NOT NULL,
  added_day  TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('distillation','import','user')),
  PRIMARY KEY (persona, card_id)
) STRICT;

CREATE INDEX core_memory_by_day ON core_memory (persona, added_day, card_id);

CREATE TABLE core_memory_daily (
  persona TEXT NOT NULL DEFAULT 'default',
  day     TEXT NOT NULL,
  changed INTEGER NOT NULL DEFAULT 0 CHECK (changed IN (0,1)),
  PRIMARY KEY (persona, day)
) STRICT;
`;

/** v4 新增的表名稱。 */
export const M3_TABLES = [
  "distillation_runs",
  "distillation_items",
  "core_memory",
  "core_memory_daily",
] as const;

/**
 * v4「m2-distillation」的遷移清單：在 v3 之後一次加好蒸餾長久記憶的四張表。
 * 舊 checksum 不變，只往後加一個版本。
 */
export const M3_MIGRATIONS: readonly Migration[] = [
  ...M2_MIGRATIONS,
  { version: 4, name: "m2-distillation", sql: M4_SCHEMA },
];

/**
 * v5「m2-dealing-probability」：把開局卡的發牌欄位寫進正本。
 *
 * v4 之前的 `context_entries` 沒有這兩欄，早期實作用行程內 Map 暫存，重啟
 * 就消失。這一版直接加欄，從 v4 升級時舊列的兩欄是 NULL，視圖讀成「省略」。
 * 舊 migration 的 checksum 不變。
 */
const M5_SCHEMA = `
ALTER TABLE context_entries ADD COLUMN deal_probability REAL;
ALTER TABLE context_entries ADD COLUMN deal_source TEXT
  CHECK (deal_source IN ('system-one','retrieval','manual'));
`;

/** v5 在 `context_entries` 新增的欄位。 */
export const M4_CONTEXT_ENTRY_DEAL_COLUMNS = ["deal_probability", "deal_source"] as const;

/** v5 的遷移清單：在 v4 之後補上發牌欄位。 */
export const M4_MIGRATIONS: readonly Migration[] = [
  ...M3_MIGRATIONS,
  { version: 5, name: "m2-dealing-probability", sql: M5_SCHEMA },
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
  /** 有值時，備份與快取檔的刪除也走路徑範圍檢查。 */
  readonly layout?: FolderLayout;
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
  const migrations = options.migrations ?? M4_MIGRATIONS;
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
    removeDatabaseFiles(backupPath, options.layout, "tmp");
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

/**
 * 刪除資料庫主檔與 SQLite 側車檔。
 *
 * 有 `layout` 時走 `removeFileSafely` 的範圍檢查；沒有時只刪傳入路徑的
 * 主檔與側車檔（呼叫端只會傳快取或遷移備份這種衍生檔案），不碰正本。
 */
function removeDatabaseFiles(
  databasePath: string,
  layout: FolderLayout | undefined,
  zone: "cache" | "tmp",
): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${databasePath}${suffix}`;
    if (layout !== undefined) {
      if (existsSync(target)) {
        removeFileSafely(layout, target, [zone]);
      }
      continue;
    }
    // 沒有 layout 的呼叫端是測試或內部建立流程；只刪已知的資料庫檔名。
    rmSync(target, { force: true });
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
  readonly layout?: FolderLayout;
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
      ...(options.layout === undefined ? {} : { layout: options.layout }),
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
  readonly layout?: FolderLayout;
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
    removeDatabaseFiles(options.filePath, options.layout, "cache");
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
