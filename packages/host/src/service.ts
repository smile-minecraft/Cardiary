import type { Clock, EngineLogger } from "@cardiary/engine-adapter";

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
import { readFolderIdentity } from "./storage/folder.js";
import type { FolderIdentity, StorageBundle } from "./storage/interfaces.js";

export type Lifecycle =
  "idle" | "pausing" | "resuming" | "shutting-down" | "deleting" | "vacuuming";

export interface PauseResult {
  readonly state: "paused";
  readonly databasesClosed: true;
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
  readonly #folder: FolderIdentity;
  readonly #gateway: Gateway;
  #folderState: InternalFolderState = "verifying";
  #serviceState: InternalServiceState = "degraded";
  #reason: string | undefined;
  #lifecycle: Lifecycle = "idle";
  #interrupted: string[] = [];
  #epochAtPause = "";
  #closed = false;

  constructor(options: HostServiceOptions) {
    this.#options = options;
    this.#gateway = options.gateway;
    this.#folder = options.storage.folder;
  }

  get lifecycle(): Lifecycle {
    return this.#lifecycle;
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
      if (this.#serviceState === "paused") {
        return {
          state: "paused" as const,
          databasesClosed: true as const,
          interruptedSessionIds: this.#interrupted,
          terminatedProcesses: 0,
        };
      }
      this.#gateway.stopAccepting();
      const interrupted = this.#gateway.interruptedSessionIds();
      const terminated = await this.#options.spawn.cancelAll(
        deadlineMs ?? this.#options.pauseDeadlineMs ?? 5000,
      );
      await this.#options.engine.suspend();
      await this.#gateway.drain();
      this.#epochAtPause = this.epoch;
      this.#interrupted = interrupted;
      this.#folderState = "paused";
      this.#serviceState = "paused";
      this.#reason = reason === "unmount" ? "unmounting" : "paused";
      // 先提交最後一則 system.status，提交後才 checkpoint 與關閉資料庫。
      await this.#gateway.emitSystemStatus();
      await this.#gateway.drain();
      await this.#options.storage.events.flush();
      await this.#options.storage.runtime.checkpointAndClose();
      await this.#options.storage.events.close();
      return {
        state: "paused" as const,
        databasesClosed: true as const,
        interruptedSessionIds: interrupted,
        terminatedProcesses: terminated,
      };
    });
  }

  async resume(): Promise<ResumeResult> {
    return this.#withLifecycle("resuming", async () => {
      const epochBefore = this.#epochAtPause || this.epoch;
      try {
        await readFolderIdentity(this.#folder.path, { expectedFolderId: this.#folder.folderId });
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
        } catch {
          return { state: "closed" as const, cleanShutdown: false, reason: "storage_unavailable" };
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
        await this.#options.storage.runtime.markCleanShutdown(reason);
        await this.#options.storage.runtime.checkpointAndClose();
        return { state: "closed" as const, cleanShutdown: true };
      }
      this.#gateway.stopAccepting();
      await this.#options.spawn.cancelAll(this.#options.pauseDeadlineMs ?? 5000);
      await this.#options.engine.close();
      await this.#gateway.drain();
      await this.#options.storage.events.flush();
      await this.#options.storage.runtime.markCleanShutdown(reason);
      await this.#options.storage.runtime.checkpointAndClose();
      await this.#options.storage.events.close();
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
    this.#options.logger.info("服務結束（未經殼確認，不設 clean_shutdown）", { reason });
  }

  /** 儲存失效：停止寫入、送 notify.fatal、關閉客戶端連線（1011）。 */
  async failStorage(detail: string): Promise<void> {
    if (this.#closed) return;
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
