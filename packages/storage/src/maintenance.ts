import { ApprovalLedger } from "./approvals.js";
import { Database } from "./db.js";
import { RequestDedupeStore } from "./dedupe.js";
import { EventLog } from "./events.js";
import { StorageError } from "./errors.js";
import type { DiagnosticLogger } from "./logs.js";
import type { FileRegistry } from "./registry.js";

export interface MaintenanceReport {
  readonly scan: ReturnType<FileRegistry["scan"]>;
  readonly eviction: ReturnType<FileRegistry["evictCache"]>;
  readonly logRotation: ReturnType<DiagnosticLogger["rotate"]>;
  readonly stateSizeBefore: number;
  readonly stateSizeAfter: number;
  readonly engineSizeBefore: number;
  readonly engineSizeAfter: number;
  readonly prunedEvents: number;
}

export interface StorageMaintenanceOptions {
  readonly state: Database;
  readonly engine: Database;
  readonly registry: FileRegistry;
  readonly logs: DiagnosticLogger;
  readonly cacheLimitBytes?: number;
  readonly now?: () => Date;
  readonly retainDays?: number;
}

/**
 * 每日維護：掃描、容量淘汰、日誌輪替、兩個資料庫的完整 `VACUUM`。
 *
 * 完整 `VACUUM` 不放在刪除路徑；它會重寫整個檔案，成本隨資料庫大小成長。
 */
export class StorageMaintenance {
  readonly #state: Database;
  readonly #engine: Database;
  readonly #registry: FileRegistry;
  readonly #logs: DiagnosticLogger;
  readonly #cacheLimitBytes: number;
  readonly #now: () => Date;
  readonly #retainDays: number;

  constructor(options: StorageMaintenanceOptions) {
    this.#state = options.state;
    this.#engine = options.engine;
    this.#registry = options.registry;
    this.#logs = options.logs;
    this.#cacheLimitBytes = options.cacheLimitBytes ?? 2 * 1024 * 1024 * 1024;
    this.#now = options.now ?? (() => new Date());
    this.#retainDays = options.retainDays ?? 30;
  }

  /** 執行一次每日維護；兩個資料庫都做完整 `VACUUM` 並驗證。 */
  daily(): MaintenanceReport {
    const stateSizeBefore = this.#state.fileSize();
    const engineSizeBefore = this.#engine.fileSize();
    const scan = this.#registry.scan({ now: this.#now() });
    const eviction = this.#registry.evictCache({ limitBytes: this.#cacheLimitBytes });
    const logRotation = this.#logs.rotate();

    const events = new EventLog(this.#state, { now: this.#now });
    const approvals = new ApprovalLedger(this.#state, { now: this.#now });
    const dedupe = new RequestDedupeStore(this.#state, { now: this.#now });
    const prunedEvents = events.prune({ now: this.#now(), retainDays: this.#retainDays });
    approvals.prune({ now: this.#now(), retainDays: this.#retainDays });
    dedupe.prune({ now: this.#now(), retainDays: this.#retainDays });

    for (const db of [this.#state, this.#engine]) {
      db.checkpoint();
      db.vacuum();
      // VACUUM 的結果可能還在 WAL；再 checkpoint 才量得到主檔縮小。
      db.checkpoint();
      if (db.integrityCheck() !== "ok") {
        throw new StorageError("storage-failed", "每日維護的 integrity_check 失敗", {
          filePath: db.filePath,
        });
      }
    }

    return {
      scan,
      eviction,
      logRotation,
      stateSizeBefore,
      stateSizeAfter: this.#state.fileSize(),
      engineSizeBefore,
      engineSizeAfter: this.#engine.fileSize(),
      prunedEvents,
    };
  }
}

/**
 * 刪除後或維護後的縮檔：`incremental_vacuum` 之後一定要再 checkpoint，
 * 否則縮掉的頁面還留在 WAL，主檔大小不會下降。
 */
export function incrementalVacuumAndCheckpoint(db: Database): number {
  const before = db.fileSize();
  db.checkpoint();
  db.incrementalVacuum();
  db.checkpoint();
  return before - db.fileSize();
}

/** 完整 `VACUUM` 後 checkpoint，再回傳主檔大小。 */
export function fullVacuumAndMeasure(db: Database): number {
  db.checkpoint();
  db.vacuum();
  db.checkpoint();
  return db.fileSize();
}
