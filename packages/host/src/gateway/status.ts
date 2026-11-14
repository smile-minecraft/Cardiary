import type { FolderState, ServiceState, SystemStatus } from "@cardiary/protocol";

/** 服務內部的資料夾狀態（storage 第 5 章）。 */
export type InternalFolderState =
  | "unselected"
  | "verifying"
  | "ready"
  | "paused"
  | "unavailable"
  | "mismatch"
  | "migrating"
  | "migration-failed";

/** 服務內部的服務狀態；控制面的 `control.health` 也用它。 */
export type InternalServiceState = "running" | "paused" | "degraded" | "storage-failed";

export interface HostStatusInput {
  readonly folderState: InternalFolderState;
  readonly displayName: string;
  readonly writable: boolean;
  readonly serviceState: InternalServiceState;
  readonly version: string;
  readonly uptimeSeconds: number;
  readonly activeTasks: number;
  readonly reason?: string;
}

interface Projection {
  readonly folder: FolderState;
  readonly service: ServiceState;
  readonly reason?: string;
}

/**
 * 內部八態 → 協定粗粒度狀態的對照表（protocol 第 8 節）。
 *
 * 服務只在資料夾可用時啟動，所以 `unselected` 與「服務未啟動的 unavailable」
 * 不會出現在協定裡；這裡仍保留映射，讓呼叫端不必自己判斷。
 */
export function projectStatus(input: HostStatusInput): Projection {
  switch (input.folderState) {
    case "verifying":
      return { folder: "ready", service: "degraded", reason: "verifying" };
    case "ready":
      return { folder: "ready", service: "running" };
    case "paused":
      return { folder: "ready", service: "paused", reason: "paused" };
    case "unavailable":
      return { folder: "unavailable", service: "paused", reason: input.reason ?? "missing" };
    case "mismatch":
      return { folder: "unavailable", service: "degraded", reason: "mismatch" };
    case "migrating":
      return { folder: "unavailable", service: "paused", reason: "migrating" };
    case "migration-failed":
      return { folder: "unavailable", service: "degraded", reason: "migration_failed" };
    case "unselected":
      return { folder: "not_selected", service: "degraded" };
  }
}

export function systemStatus(input: HostStatusInput): SystemStatus {
  const projection = projectStatus(input);
  const serviceState = input.serviceState === "storage-failed" ? "degraded" : input.serviceState;
  return {
    folder: {
      state: projection.folder,
      displayName: input.displayName,
      writable: input.writable,
      ...(projection.reason === undefined ? {} : { reason: projection.reason }),
    },
    service: {
      state: serviceState,
      version: input.version,
      uptimeSeconds: input.uptimeSeconds,
      activeTasks: input.activeTasks,
    },
  };
}

/** 控制面 `control.health` 的 `state` 欄位。 */
export function healthState(
  input: HostStatusInput,
): "running" | "paused" | "degraded" | "storage-failed" {
  if (input.serviceState === "storage-failed") return "storage-failed";
  if (input.serviceState === "paused") return "paused";
  if (input.folderState !== "ready") return "degraded";
  return "running";
}
