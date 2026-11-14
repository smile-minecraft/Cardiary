import type { Database } from "./db.js";
import { StorageError } from "./errors.js";
import { newUlid } from "./ids.js";
import type { FolderLayout } from "./paths.js";
import { readFolderIdentity } from "./identity.js";
import { nowIso } from "./util.js";

/** 執行期狀態的單列表內容。 */
export interface RuntimeSnapshot {
  readonly epoch: string;
  readonly cleanShutdown: boolean;
  readonly startedAt: string;
  readonly lastShutdownAt: string | null;
  readonly shutdownReason: string | null;
}

interface RuntimeRow {
  readonly epoch: string;
  readonly clean_shutdown: number;
  readonly started_at: string;
  readonly last_shutdown_at: string | null;
  readonly shutdown_reason: string | null;
}

export interface RuntimeStateOptions {
  readonly now?: () => Date;
  readonly newId?: (nowMs: number) => string;
}

/**
 * `runtime_state` 的存取。
 *
 * `open()` 只在行程啟動時呼叫一次；`reopen()` 只重開狀態庫連線，
 * 不換 epoch、不寫 `clean_shutdown`，供 `control.resume` 與暫停中關閉使用。
 */
export class RuntimeStateStore {
  readonly #db: Database;
  readonly #now: () => Date;
  readonly #newId: (nowMs: number) => string;

  constructor(db: Database, options: RuntimeStateOptions = {}) {
    this.#db = db;
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? ((nowMs: number) => newUlid(nowMs));
  }

  /** 行程啟動時呼叫一次；依 `clean_shutdown` 決定是否換 epoch。 */
  open(): RuntimeSnapshot {
    const now = this.#now();
    const timestamp = now.toISOString();
    const existing = this.read();
    if (existing === null) {
      const epoch = this.#newId(now.getTime());
      this.#db.run(
        "INSERT INTO runtime_state (id, epoch, clean_shutdown, started_at) VALUES (1, ?, 0, ?)",
        epoch,
        timestamp,
      );
      this.#db.trace("runtime_state:open:insert");
      return this.requireSnapshot();
    }
    if (!existing.cleanShutdown) {
      const epoch = this.#newId(now.getTime());
      this.#db.run(
        "UPDATE runtime_state SET epoch = ?, started_at = ?, clean_shutdown = 0 WHERE id = 1",
        epoch,
        timestamp,
      );
      this.#db.trace("runtime_state:open:new-epoch");
      return this.requireSnapshot();
    }
    this.#db.run(
      "UPDATE runtime_state SET started_at = ?, clean_shutdown = 0 WHERE id = 1",
      timestamp,
    );
    this.#db.trace("runtime_state:open:reuse-epoch");
    return this.requireSnapshot();
  }

  /**
   * 只重開狀態庫連線並讀回目前狀態。
   *
   * 不建立資料列、不改 epoch、不寫 `clean_shutdown`；資料列不存在時丟
   * `runtime-state-missing`，讓呼叫端走儲存失效畫面。
   */
  reopen(options: { readonly expectedEpoch?: string } = {}): RuntimeSnapshot {
    this.#db.reopen();
    const snapshot = this.read();
    if (snapshot === null) {
      throw new StorageError("runtime-state-missing", "重開後找不到 runtime_state", {});
    }
    if (options.expectedEpoch !== undefined && snapshot.epoch !== options.expectedEpoch) {
      throw new StorageError("folder-mismatch", "重開後的 epoch 與暫停時不同", {
        expectedEpoch: options.expectedEpoch,
        actualEpoch: snapshot.epoch,
      });
    }
    return snapshot;
  }

  /** 讀取目前狀態；尚未 open() 時回 null。 */
  read(): RuntimeSnapshot | null {
    const row = this.#db.get<RuntimeRow>(
      "SELECT epoch, clean_shutdown, started_at, last_shutdown_at, shutdown_reason FROM runtime_state WHERE id = 1",
    );
    if (row === undefined) {
      return null;
    }
    return {
      epoch: row.epoch,
      cleanShutdown: Number(row.clean_shutdown) === 1,
      startedAt: row.started_at,
      lastShutdownAt: row.last_shutdown_at,
      shutdownReason: row.shutdown_reason,
    };
  }

  /**
   * 在單一交易寫入 `clean_shutdown = 1`；只有 `control.shutdown` 會呼叫。
   *
   * 提交成功才回傳；資料庫已關閉時直接失敗，避免「先關再寫」的順序。
   */
  markCleanShutdown(reason: string): RuntimeSnapshot {
    if (this.#db.isClosed) {
      throw new StorageError("storage-failed", "資料庫已關閉，不能標記正常關閉");
    }
    const timestamp = nowIso(this.#now);
    this.#db.transaction((tx) => {
      const result = tx.run(
        "UPDATE runtime_state SET clean_shutdown = 1, last_shutdown_at = ?, shutdown_reason = ? WHERE id = 1",
        timestamp,
        reason,
      );
      if (result.changes !== 1) {
        throw new StorageError("runtime-state-missing", "找不到 runtime_state 資料列");
      }
    });
    this.#db.trace("runtime_state:mark-clean-shutdown");
    return this.requireSnapshot();
  }

  /** checkpoint 後關閉；不寫 `clean_shutdown`，順序由呼叫端保證。 */
  checkpointAndClose(): void {
    if (this.#db.isClosed) {
      throw new StorageError("storage-failed", "資料庫已關閉");
    }
    this.#db.checkpoint();
    this.#db.close();
  }

  /**
   * 暫停中收到 `control.shutdown`。
   *
   * 先驗 `folder.json` 的 `folderId`、再重開狀態庫驗 epoch；兩者都相符才寫
   * `clean_shutdown = 1`。任何一步不符都回 false，不碰別人的資料庫。
   */
  shutdownWhilePaused(options: {
    readonly layout: FolderLayout;
    readonly expectedFolderId: string;
    readonly expectedEpoch: string;
    readonly reason?: string;
  }): boolean {
    const identity = readFolderIdentity(options.layout);
    if (identity.kind !== "ok" || identity.identity.folderId !== options.expectedFolderId) {
      return false;
    }
    try {
      this.#db.reopen();
    } catch {
      return false;
    }
    try {
      const snapshot = this.read();
      if (snapshot === null || snapshot.epoch !== options.expectedEpoch) {
        this.#db.close();
        return false;
      }
      this.markCleanShutdown(options.reason ?? "control.shutdown");
      this.checkpointAndClose();
      return true;
    } catch {
      if (!this.#db.isClosed) {
        this.#db.close();
      }
      return false;
    }
  }

  private requireSnapshot(): RuntimeSnapshot {
    const snapshot = this.read();
    if (snapshot === null) {
      throw new StorageError("runtime-state-missing", "找不到 runtime_state 資料列");
    }
    return snapshot;
  }
}
