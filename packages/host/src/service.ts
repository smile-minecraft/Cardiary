import type { Clock, EngineLogger } from "@cardiary/engine-adapter";
import { resolve } from "node:path";

import { ControlError } from "./errors.js";
import type { HostEngine } from "./engine/types.js";
import { Gateway } from "./gateway/server.js";
import {
  healthState,
  systemStatus,
  type HostStatusInput,
  type InternalFolderState,
  type InternalServiceState,
} from "./gateway/status.js";
import { prefixed, uptimeSeconds } from "./ids.js";
import type { SpawnRegistry } from "./spawn/wrapper.js";
import { FolderError, readFolderIdentity } from "./storage/folder.js";
import type { FolderIdentity, StorageBundle } from "./storage/interfaces.js";

export type Lifecycle =
  "idle" | "pausing" | "resuming" | "shutting-down" | "deleting" | "vacuuming";

export interface PauseResult {
  readonly state: "paused";
  readonly databasesClosed: boolean;
  readonly interruptedSessionIds: string[];
  readonly terminatedProcesses: number;
}

export interface ResumeResult {
  readonly state: "ready" | "paused" | "degraded";
  readonly epoch: string;
  readonly folderId: string;
  readonly engineReopened: boolean;
  readonly reason?: string;
}

export interface ShutdownResult {
  readonly state: "closed";
  readonly cleanShutdown: boolean;
  readonly reason?: string;
}

export interface HealthPayload {
  readonly state: "running" | "paused" | "degraded" | "storage-failed";
  readonly epoch: string;
  readonly uptimeSeconds: number;
  readonly folderId: string;
  readonly clientPort: number;
  readonly lifecycle: Lifecycle;
}

export interface HostServiceOptions {
  readonly storage: StorageBundle;
  readonly engine: HostEngine;
  readonly gateway: Gateway;
  readonly clientPort: number;
  readonly spawn: SpawnRegistry;
  readonly clock: Clock;
  readonly logger: EngineLogger;
  readonly version: string;
  readonly startedAt: string;
  readonly pauseDeadlineMs?: number;
  /** 刪除與 VACUUM 開始／結束時通知殼暫停 health。 */
  readonly onMaintenance?: (
    lifecycle: "deleting" | "vacuuming" | "idle",
    operationId: string,
  ) => Promise<void>;
  /** 儲存失效時送 `notify.fatal`；由控制面接上。 */
  readonly onFatal?: (reason: "storage_io" | "internal", detail: string) => Promise<void>;
}

/**
 * 主機服務的生命週期：啟動恢復、暫停、恢復、正常關閉與儲存失效。
 *
 * 生命週期操作共用一個全域槽位；`control.health` 不佔槽位、不讀資料庫。
 */
export class HostService {
  readonly #options: HostServiceOptions;
  #folder: FolderIdentity;
  readonly #gateway: Gateway;
  #folderState: InternalFolderState = "verifying";
  #serviceState: InternalServiceState = "degraded";
  #reason: string | undefined;
  #lifecycle: Lifecycle = "idle";
  #interrupted: string[] = [];
  #epochAtPause = "";
  #databasesClosed = false;
  #closed = false;
  #fatalHandled = false;

  constructor(options: HostServiceOptions) {
    this.#options = options;
    this.#gateway = options.gateway;
    this.#folder = options.storage.folder;
  }

  get lifecycle(): Lifecycle {
    return this.#lifecycle;
  }

  /** 資料庫是否真的關閉（暫停成功才為 true）；resume 部分失敗時必須為 false。 */
  get databasesClosed(): boolean {
    return this.#databasesClosed;
  }

  get epoch(): string {
    return this.#options.storage.runtime.current()?.epoch ?? "";
  }

  get clientPort(): number {
    return this.#options.clientPort;
  }

  get folder(): FolderIdentity {
    return this.#folder;
  }

  statusInput(): HostStatusInput {
    return {
      folderState: this.#folderState,
      displayName: this.#folder.displayName,
      writable: this.#folder.writable,
      serviceState: this.#serviceState,
      version: this.#options.version,
      uptimeSeconds: uptimeSeconds(this.#options.startedAt, this.#options.clock),
      activeTasks: this.#gateway.activeTasks,
      ...(this.#reason === undefined ? {} : { reason: this.#reason }),
    };
  }

  /** 從記憶體回答；不讀 SQLite。 */
  health(): HealthPayload {
    return {
      state: healthState(this.statusInput()),
      epoch: this.epoch,
      uptimeSeconds: uptimeSeconds(this.#options.startedAt, this.#options.clock),
      folderId: this.#folder.folderId,
      clientPort: this.#options.clientPort,
      lifecycle: this.#lifecycle,
    };
  }

  async start(): Promise<void> {
    await this.#recoverDeletions();
    await this.#options.engine.open();
    this.#folderState = "ready";
    this.#serviceState = "running";
    this.#reason = undefined;
    await this.#gateway.emitSystemStatus();
  }

  /**
   * 在建立 Harness 之前完成未結束的刪除。
   *
   * 若某個恢復路徑已經開了 Harness，先 `suspend()`，完成後再 `resume()`。
   */
  async #recoverDeletions(): Promise<void> {
    const pending = await this.#options.storage.deletions.pending();
    if (pending.length === 0) return;
    const state = this.#options.engine.getStatus().state;
    const engineOpened = state !== "starting" && state !== "stopped";
    if (engineOpened) await this.#options.engine.suspend();
    for (const conversationId of pending) {
      await this.#options.engine.deleteConversation(conversationId, { includeBranches: true });
      await this.#options.storage.deletions.remove(conversationId);
    }
    if (engineOpened) await this.#options.engine.resume();
  }

  async #withLifecycle<T>(lifecycle: Lifecycle, work: () => Promise<T>): Promise<T> {
    if (this.#closed) throw new ControlError("unavailable", "服務已關閉");
    if (this.#lifecycle !== "idle") {
      throw new ControlError("busy", `生命週期操作正在進行：${this.#lifecycle}`);
    }
    this.#lifecycle = lifecycle;
    try {
      return await work();
    } finally {
      this.#lifecycle = "idle";
    }
  }

  async pause(reason: string, deadlineMs?: number): Promise<PauseResult> {
    return this.#withLifecycle("pausing", async () => {
      // 只有「上次暫停真的把資料庫關掉」才可以直接回同一個結果；
      // 半暫停（例如上次在提交前失敗）不能回 databasesClosed:true。
      if (this.#databasesClosed) {
        return {
          state: "paused" as const,
          databasesClosed: true,
          interruptedSessionIds: this.#interrupted,
          terminatedProcesses: 0,
        };
      }
      if (this.#serviceState === "paused") {
        await this.failStorage("暫停狀態不完整，資料庫仍在開啟");
        throw new ControlError("unavailable", "暫停狀態不完整，儲存已停止寫入。");
      }
      try {
        this.#gateway.stopAccepting();
        const interrupted = this.#gateway.interruptedSessionIds();
        const terminated = await this.#options.spawn.cancelAll(
          deadlineMs ?? this.#options.pauseDeadlineMs ?? 5000,
        );
        await this.#options.engine.suspend();
        await this.#gateway.drain();
        this.#epochAtPause = this.epoch;
        this.#interrupted = interrupted;
        // 為了讓最後一則 system.status 帶 paused，先投影狀態；但真正的
        // 「已暫停」要等提交、checkpoint 與關閉都成功才成立。
        this.#folderState = "paused";
        this.#serviceState = "paused";
        this.#reason = reason === "unmount" ? "unmounting" : "paused";
        await this.#gateway.emitSystemStatus();
        await this.#gateway.drain();
        await this.#options.storage.events.flush();
        await this.#options.storage.runtime.checkpointAndClose();
        await this.#options.storage.events.close();
        this.#databasesClosed = true;
        return {
          state: "paused" as const,
          databasesClosed: true,
          interruptedSessionIds: interrupted,
          terminatedProcesses: terminated,
        };
      } catch (error) {
        this.#databasesClosed = false;
        // 提交、checkpoint 或關閉失敗都算儲存失效，不假裝暫停成功。
        await this.failStorage(error instanceof Error ? error.message : "暫停時儲存失效");
        throw new ControlError("unavailable", "儲存失效，暫停未完成。");
      }
    });
  }

  async resume(requestedFolderPath?: string): Promise<ResumeResult> {
    return this.#withLifecycle("resuming", async () => {
      const epochBefore = this.#epochAtPause || this.epoch;
      const targetPath = requestedFolderPath ?? this.#folder.path;
      if (resolve(targetPath) !== resolve(this.#folder.path)) {
        // M0 的儲存與引擎路徑在啟動時固定；換路徑等於要重綁兩個資料庫，
        // 先要求殼重啟服務，不假裝恢復成功。
        throw new ControlError("unavailable", "資料夾路徑與暫停時不同；M0 請由殼重啟服務。");
      }
      try {
        this.#folder = await readFolderIdentity(targetPath, {
          expectedFolderId: this.#folder.folderId,
        });
      } catch {
        this.#folderState = "unavailable";
        this.#serviceState = "paused";
        this.#reason = "missing";
        return {
          state: "paused" as const,
          epoch: epochBefore,
          folderId: this.#folder.folderId,
          engineReopened: false,
          reason: "storage_unavailable",
        };
      }
      let snapshot;
      try {
        snapshot = await this.#options.storage.runtime.reopen();
      } catch {
        this.#serviceState = "paused";
        this.#reason = "state_reopen_failed";
        return {
          state: "paused" as const,
          epoch: epochBefore,
          folderId: this.#folder.folderId,
          engineReopened: false,
          reason: "state_reopen_failed",
        };
      }
      // 狀態庫一重開，handle 就是開著的；後面 events.reopen／epoch 檢查／
      // engine.resume 任何一步失敗都不能再宣稱 databasesClosed。
      this.#databasesClosed = false;
      try {
        await this.#options.storage.events.reopen();
      } catch {
        this.#serviceState = "paused";
        this.#reason = "state_reopen_failed";
        return {
          state: "paused" as const,
          epoch: snapshot.epoch,
          folderId: this.#folder.folderId,
          engineReopened: false,
          reason: "state_reopen_failed",
        };
      }
      if (snapshot.epoch !== epochBefore) {
        this.#folderState = "mismatch";
        this.#serviceState = "degraded";
        this.#reason = "mismatch";
        return {
          state: "degraded" as const,
          epoch: snapshot.epoch,
          folderId: this.#folder.folderId,
          engineReopened: false,
          reason: "folder_mismatch",
        };
      }
      try {
        await this.#options.engine.resume();
        // 緊急全部暫停（pause_all）也要一併解除；M0 沒有獨立的 resume_all 訊息。
        await this.#options.engine.resumeAll();
      } catch {
        this.#serviceState = "degraded";
        this.#reason = "engine_reopen_failed";
        return {
          state: "degraded" as const,
          epoch: snapshot.epoch,
          folderId: this.#folder.folderId,
          engineReopened: false,
          reason: "engine_reopen_failed",
        };
      }
      this.#folderState = "ready";
      this.#serviceState = "running";
      this.#reason = undefined;
      this.#databasesClosed = false;
      this.#gateway.allowAccepting();
      await this.#gateway.emitSystemStatus();
      return {
        state: "ready" as const,
        epoch: snapshot.epoch,
        folderId: this.#folder.folderId,
        engineReopened: true,
      };
    });
  }

  async shutdown(reason: string): Promise<ShutdownResult> {
    return this.#withLifecycle("shutting-down", async () => {
      this.#closed = true;
      if (this.#serviceState === "paused") {
        try {
          await readFolderIdentity(this.#folder.path, { expectedFolderId: this.#folder.folderId });
        } catch (error) {
          const mismatched =
            error instanceof FolderError &&
            (error.reason === "mismatch" || error.reason === "invalid_identity");
          return {
            state: "closed" as const,
            cleanShutdown: false,
            reason: mismatched ? "folder_mismatch" : "storage_unavailable",
          };
        }
        let snapshot;
        try {
          snapshot = await this.#options.storage.runtime.reopen();
        } catch {
          return { state: "closed" as const, cleanShutdown: false, reason: "state_reopen_failed" };
        }
        if (snapshot.epoch !== (this.#epochAtPause || snapshot.epoch)) {
          return { state: "closed" as const, cleanShutdown: false, reason: "folder_mismatch" };
        }
        try {
          await this.#options.storage.runtime.markCleanShutdown(reason);
          await this.#options.storage.runtime.checkpointAndClose();
        } catch (error) {
          // 已暫停時的寫入失敗也要走致命路徑；#fatalHandled 讓 #closed 不擋住它。
          await this.failStorage(error instanceof Error ? error.message : "關閉時儲存失效");
          throw new ControlError("unavailable", "儲存失效，關閉未完成。");
        }
        this.#databasesClosed = true;
        this.#fatalHandled = true;
        return { state: "closed" as const, cleanShutdown: true };
      }
      try {
        this.#gateway.stopAccepting();
        await this.#options.spawn.cancelAll(this.#options.pauseDeadlineMs ?? 5000);
        await this.#options.engine.close();
        await this.#gateway.drain();
        await this.#options.storage.events.flush();
        await this.#options.storage.runtime.markCleanShutdown(reason);
        await this.#options.storage.runtime.checkpointAndClose();
        await this.#options.storage.events.close();
      } catch (error) {
        // flush／markCleanShutdown／checkpoint／close 失敗都是儲存失效；
        // 不能因為 shutdown 先把 #closed 設起來就吞掉 fatal。
        await this.failStorage(error instanceof Error ? error.message : "關閉時儲存失效");
        throw new ControlError("unavailable", "儲存失效，關閉未完成。");
      }
      this.#databasesClosed = true;
      this.#fatalHandled = true;
      await this.#gateway.close();
      return { state: "closed" as const, cleanShutdown: true };
    });
  }

  /** stdin 中斷、SIGTERM、SIGINT：關資料庫但不寫 `clean_shutdown = 1`。 */
  async abort(reason: string): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#gateway.stopAccepting();
    await this.#options.spawn.cancelAll(1000);
    try {
      await this.#options.engine.close();
    } catch {
      // 已經關閉。
    }
    await this.#gateway.drain().catch(() => undefined);
    await this.#options.storage.events.flush().catch(() => undefined);
    await this.#options.storage.events.close().catch(() => undefined);
    await this.#options.storage.runtime.checkpointAndClose().catch(() => undefined);
    this.#fatalHandled = true;
    this.#options.logger.info("服務結束（未經殼確認，不設 clean_shutdown）", { reason });
  }

  /** 儲存失效：停止寫入、送 notify.fatal、關閉客戶端連線（1011）。 */
  async failStorage(detail: string): Promise<void> {
    if (this.#fatalHandled) return;
    this.#fatalHandled = true;
    this.#closed = true;
    this.#folderState = "unavailable";
    this.#serviceState = "storage-failed";
    this.#reason = "io_error";
    this.#gateway.stopAccepting();
    await this.#options.onFatal?.("storage_io", detail);
    this.#gateway.closeClientConnections(1011, "storage_failure");
  }

  /** 刪除或 VACUUM：開始與結束都送 notify.maintenance，殼暫停 health。 */
  async withMaintenance<T>(
    lifecycle: "deleting" | "vacuuming",
    work: () => Promise<T>,
  ): Promise<T> {
    return this.#withLifecycle(lifecycle, async () => {
      const operationId = prefixed("maint");
      await this.#options.onMaintenance?.(lifecycle, operationId);
      try {
        return await work();
      } finally {
        await this.#options.onMaintenance?.("idle", operationId);
      }
    });
  }

  /** 目前的 `system.status` 投影；控制面與測試用。 */
  systemStatus(): ReturnType<typeof systemStatus> {
    return systemStatus(this.statusInput());
  }
}
