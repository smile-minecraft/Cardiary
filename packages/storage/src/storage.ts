import { existsSync, statSync } from "node:fs";

import { ApprovalAllowlist, ApprovalLedger } from "./approvals.js";
import { Database } from "./db.js";
import { RequestDedupeStore } from "./dedupe.js";
import { ConversationDeletionService } from "./deletions.js";
import { EventLog } from "./events.js";
import { StorageError } from "./errors.js";
import { FolderManager, type FolderOpenResult } from "./folder.js";
import { FolderLayout, removeFileSafely } from "./paths.js";
import { DiagnosticLogger } from "./logs.js";
import { StorageMaintenance } from "./maintenance.js";
import { FileRegistry } from "./registry.js";
import { RuntimeStateStore } from "./runtime-state.js";
import { SettingsStore } from "./settings.js";
import {
  STATE_APPLICATION_ID,
  openCacheDatabase,
  openEngineDatabase,
  openStateDatabase,
} from "./state-schema.js";
import { TurnIndex } from "./turns.js";
import { newUlid } from "./ids.js";
import { addDaysIso, nowIso } from "./util.js";

export interface OpenStorageOptions {
  readonly path: string;
  /** 空資料夾且沒有 `folder.json` 時允許初始化。 */
  readonly initialize?: boolean;
  readonly expectedFolderId?: string;
  readonly appVersion?: string;
  readonly now?: () => Date;
  readonly statfs?: (path: string) => { type: number };
  readonly lock?: boolean;
  readonly trace?: (operation: string) => void;
  readonly createdBy?: string;
}

/**
 * 一個已開啟的 Cardiary 資料夾。
 *
 * `Storage.open()` 是行程啟動路徑：驗證或初始化資料夾、開資料庫、跑遷移、
 * 清空 `tmp/`、呼叫 `runtime.open()`。資料夾不可用時丟 `folder-unavailable`，
 * 呼叫端顯示「資料不可用」，不會建立任何目錄。
 */
export class Storage {
  readonly layout: FolderLayout;
  readonly folder: FolderManager;
  readonly folderResult: FolderOpenResult;
  readonly state: Database;
  readonly engine: Database;
  readonly runtime: RuntimeStateStore;
  readonly events: EventLog;
  readonly approvals: ApprovalLedger;
  readonly allowlist: ApprovalAllowlist;
  readonly dedupe: RequestDedupeStore;
  readonly turns: TurnIndex;
  readonly settings: SettingsStore;
  readonly registry: FileRegistry;
  readonly logs: DiagnosticLogger;
  readonly deletions: ConversationDeletionService;
  readonly maintenance: StorageMaintenance;
  #cache: Database;
  #closed = false;

  private constructor(init: {
    layout: FolderLayout;
    folder: FolderManager;
    folderResult: FolderOpenResult;
    state: Database;
    engine: Database;
    cache: Database;
    runtime: RuntimeStateStore;
    events: EventLog;
    approvals: ApprovalLedger;
    allowlist: ApprovalAllowlist;
    dedupe: RequestDedupeStore;
    turns: TurnIndex;
    settings: SettingsStore;
    registry: FileRegistry;
    logs: DiagnosticLogger;
    deletions: ConversationDeletionService;
    maintenance: StorageMaintenance;
  }) {
    this.layout = init.layout;
    this.folder = init.folder;
    this.folderResult = init.folderResult;
    this.state = init.state;
    this.engine = init.engine;
    this.#cache = init.cache;
    this.runtime = init.runtime;
    this.events = init.events;
    this.approvals = init.approvals;
    this.allowlist = init.allowlist;
    this.dedupe = init.dedupe;
    this.turns = init.turns;
    this.settings = init.settings;
    this.registry = init.registry;
    this.logs = init.logs;
    this.deletions = init.deletions;
    this.maintenance = init.maintenance;
  }

  static open(options: OpenStorageOptions): Storage {
    const layout = new FolderLayout(options.path, {
      ...(options.statfs === undefined ? {} : { statfs: options.statfs }),
    });
    const folder = new FolderManager(layout);
    const now = options.now ?? (() => new Date());
    const trace = options.trace;
    const appVersion = options.appVersion ?? "0.1.0";
    const statePath = layout.absolute("state/cardiary.sqlite");
    const enginePath = layout.absolute("state/engine.sqlite");
    const backupDirectory = layout.subfolderPath("tmp");

    const onDatabaseFailure = (): void => {
      folder.markStorageFailed();
    };
    const openState = (): ReturnType<typeof openStateDatabase> =>
      openStateDatabase({
        filePath: statePath,
        appVersion,
        backupDirectory,
        now,
        ...(trace === undefined ? {} : { trace }),
        onFailure: onDatabaseFailure,
        onBackup: (absolutePath) => registerBackupRow(layout, statePath, absolutePath, now),
        onBackupRemoved: (absolutePath) => removeBackupRow(layout, statePath, absolutePath, trace),
      });

    const folderResult = folder.open({
      ...(options.initialize === undefined ? {} : { initialize: options.initialize }),
      ...(options.expectedFolderId === undefined
        ? {}
        : { expectedFolderId: options.expectedFolderId }),
      ...(options.lock === undefined ? {} : { lock: options.lock }),
      ...(options.createdBy === undefined ? {} : { createdBy: options.createdBy }),
      now,
      createDatabases: (paths) => {
        const engine = openEngineDatabase({
          filePath: paths.engine,
          ...(trace === undefined ? {} : { trace }),
        });
        engine.close();
        const state = openState();
        state.db.close();
      },
    });
    if (folderResult.state !== "ready") {
      folder.close();
      throw new StorageError("folder-unavailable", "資料夾不可用，服務不啟動", {
        state: folderResult.state,
        reason: folderResult.reason,
      });
    }

    let state: Database | null = null;
    let engine: Database | null = null;
    let cache: Database | null = null;
    try {
      state = openState().db;
      cache = openCacheDatabase({
        filePath: layout.absolute("cache/index.sqlite"),
        now,
        ...(trace === undefined ? {} : { trace }),
        onFailure: onDatabaseFailure,
      }).db;
      engine = openEngineDatabase({
        filePath: enginePath,
        ...(trace === undefined ? {} : { trace }),
        onFailure: onDatabaseFailure,
      });

      const runtime = new RuntimeStateStore(state, { now });
      runtime.open();
      const events = new EventLog(state, { now });
      const approvals = new ApprovalLedger(state, { now });
      const allowlist = new ApprovalAllowlist(state);
      const dedupe = new RequestDedupeStore(state, { now });
      const turns = new TurnIndex(state);
      const settings = new SettingsStore(state, { now });
      settings.seedDefaults();
      const registry = new FileRegistry(state, layout, { now });
      const logs = new DiagnosticLogger(layout, { now });

      registry.prepareStartup();
      registry.register({
        relPath: "cache/index.sqlite",
        ownerKind: "index",
        sizeBytes: cache.fileSize(),
      });

      let storage: Storage | null = null;
      const resetCacheIndex = (): Database => {
        cache?.close();
        for (const suffix of ["", "-wal", "-shm"]) {
          const target = `${layout.absolute("cache/index.sqlite")}${suffix}`;
          if (existsSync(target)) {
            removeFileSafely(layout, target, ["cache"]);
          }
        }
        const reopened = openCacheDatabase({
          filePath: layout.absolute("cache/index.sqlite"),
          now,
          ...(trace === undefined ? {} : { trace }),
          onFailure: onDatabaseFailure,
        }).db;
        registry.register({
          relPath: "cache/index.sqlite",
          ownerKind: "index",
          sizeBytes: reopened.fileSize(),
        });
        if (storage !== null) {
          storage.#cache = reopened;
        }
        cache = reopened;
        return reopened;
      };

      const deletions = new ConversationDeletionService({
        state,
        engine,
        layout,
        registry,
        resetCacheIndex: () => {
          resetCacheIndex();
        },
        now,
        ...(trace === undefined ? {} : { trace }),
      });
      const maintenance = new StorageMaintenance({
        state,
        engine,
        registry,
        logs,
        now,
        cacheLimitBytes: Number(settings.get("storage.cacheLimitBytes")?.value ?? 2 * 1024 ** 3),
        retainDays: Number(settings.get("storage.retainDays")?.value ?? 30),
      });

      const created = new Storage({
        layout,
        folder,
        folderResult,
        state,
        engine,
        cache,
        runtime,
        events,
        approvals,
        allowlist,
        dedupe,
        turns,
        settings,
        registry,
        logs,
        deletions,
        maintenance,
      });
      storage = created;
      return created;
    } catch (error) {
      state?.close();
      engine?.close();
      cache?.close();
      folder.close();
      throw error;
    }
  }

  /** 目前快取資料庫；刪除流程重建快取後會換一個連線。 */
  get cache(): Database {
    return this.#cache;
  }

  /** 引擎與工具子行程的暫存目錄；殼把 TMPDIR 指到這裡。 */
  get tempDir(): string {
    return this.layout.subfolderPath("tmp");
  }

  get cacheDir(): string {
    return this.layout.subfolderPath("cache");
  }

  get logsDir(): string {
    return this.layout.subfolderPath("logs");
  }

  get folderState(): string {
    return this.folder.state;
  }

  get folderId(): string | null {
    return this.folder.folderId;
  }

  /** 正常關閉：標記 `clean_shutdown = 1` 後 checkpoint 與關閉。 */
  shutdown(): void {
    this.runtime.markCleanShutdown("control.shutdown");
    this.runtime.checkpointAndClose();
    this.engine.close();
    this.#cache.close();
    this.folder.close();
    this.#closed = true;
  }

  /** 測試與異常結束用：只關閉資源，不標記正常關閉。 */
  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (!this.state.isClosed) {
      try {
        this.state.checkpoint();
      } catch {
        // 資料庫已損壞時 checkpoint 可能失敗；仍然關閉資源。
      }
      this.state.close();
    }
    this.engine.close();
    this.#cache.close();
    this.folder.close();
  }
}

/** 遷移備份要在登記簿留一列，否則啟動清空 tmp 時會被當成垃圾。 */
function registerBackupRow(
  layout: FolderLayout,
  statePath: string,
  absolutePath: string,
  now: () => Date,
): void {
  if (!existsSync(statePath)) {
    return;
  }
  const relativePath = layout.relative(absolutePath);
  const timestamp = nowIso(now);
  const database = Database.open(statePath, {
    expectedApplicationId: STATE_APPLICATION_ID,
    busyTimeoutMs: 5000,
  });
  try {
    database.run(
      `INSERT INTO file_registry (
         id, zone, rel_path, owner_kind, owner_id, state, size_bytes,
         created_at, renewed_at, last_used_at, expires_at
       ) VALUES (?, 'tmp', ?, 'migration', NULL, 'live', ?, ?, ?, ?, ?)
       ON CONFLICT (rel_path) DO UPDATE SET
         state = 'live', renewed_at = excluded.renewed_at, expires_at = excluded.expires_at`,
      newUlid(now().getTime()),
      relativePath,
      fileSize(absolutePath),
      timestamp,
      timestamp,
      timestamp,
      addDaysIso(timestamp, 7),
    );
  } finally {
    database.close();
  }
}

function removeBackupRow(
  layout: FolderLayout,
  statePath: string,
  absolutePath: string,
  trace: ((operation: string) => void) | undefined,
): void {
  const database = Database.open(statePath, {
    expectedApplicationId: STATE_APPLICATION_ID,
    busyTimeoutMs: 5000,
    ...(trace === undefined ? {} : { trace }),
  });
  try {
    database.run("DELETE FROM file_registry WHERE rel_path = ?", layout.relative(absolutePath));
  } finally {
    database.close();
  }
}

function fileSize(filePath: string): number {
  try {
    return existsSync(filePath) ? statSync(filePath).size : 0;
  } catch {
    return 0;
  }
}
