import type {
  ExternalAgentSessionRecord,
  ExternalAgentStatus,
  NormalizedAgentEvent,
} from "./types.js";

/**
 * 外部代理的最小狀態機。
 *
 * 只放純函式：主機層把 `NormalizedAgentEvent` 套上事件序號後餵進來，
 * 得到新的 `ExternalAgentSessionRecord`。任何時候狀態都能由
 * (record, event) 推出，重啟後即使只讀得到耐久紀錄，也能安全作業。
 */
export type { ExternalAgentSessionRecord };

export interface ReducedAgentState {
  readonly record: ExternalAgentSessionRecord;
  /** 這個事件是否實際改變了紀錄；分辨重複套用。 */
  readonly applied: boolean;
}

const TERMINAL: readonly ExternalAgentStatus[] = ["completed", "stopped", "failed"];

export function isTerminalAgentStatus(status: ExternalAgentStatus): boolean {
  return TERMINAL.includes(status);
}

export function nextEventSeq(record: ExternalAgentSessionRecord): number {
  return record.lastEventSeq + 1;
}

/**
 * 把一個事件套到耐久紀錄上。
 *
 * 重複套用具有相同 `eventSeq` 的事件時不改變紀錄（`applied: false`），
 * 這是「斷線重連不重複執行」的領域層保證。
 */
export function applyAgentEvent(
  record: ExternalAgentSessionRecord,
  event: NormalizedAgentEvent,
  eventSeq: number,
  now: Date,
): ReducedAgentState {
  if (eventSeq <= record.lastEventSeq) {
    return { record, applied: false };
  }
  const base = {
    ...record,
    lastEventSeq: eventSeq,
    updatedAt: now.toISOString(),
  };
  switch (event.kind) {
    case "output":
      return { record: base, applied: true };
    case "progress": {
      const completed = Math.max(record.completedSteps, event.completed);
      const total = Math.max(0, event.total);
      return {
        record: {
          ...base,
          status: record.pendingPermission ? "waiting-approval" : "running",
          completedSteps: completed,
          progress: {
            step: completed,
            label: event.label,
            completed,
            total,
          },
        },
        applied: true,
      };
    }
    case "permission":
      return {
        record: {
          ...base,
          status: "waiting-approval",
          message: event.description ?? `需要核准才能執行 ${event.toolName}`,
          pendingPermission: {
            requestKey: event.requestKey,
            approvalId: "",
            toolName: event.toolName,
            ...(event.description ? { description: event.description } : {}),
            input: event.input,
            replyToken: event.replyToken,
            ...(event.allowOptionId ? { allowOptionId: event.allowOptionId } : {}),
            ...(event.denyOptionId ? { denyOptionId: event.denyOptionId } : {}),
          },
        },
        applied: true,
      };
    case "completed":
      return {
        record: {
          ...base,
          status: "completed",
          message: event.message,
          pendingPermission: null,
          progress: record.progress
            ? {
                ...record.progress,
                completed: record.progress.total,
                step: record.progress.total,
              }
            : record.progress,
        },
        applied: true,
      };
    case "failed":
      return {
        record: {
          ...base,
          status: "failed",
          message: event.message,
          pendingPermission: null,
        },
        applied: true,
      };
  }
}

export function attachPermissionApproval(
  record: ExternalAgentSessionRecord,
  approvalId: string,
): ExternalAgentSessionRecord {
  if (!record.pendingPermission) return record;
  return {
    ...record,
    pendingPermission: { ...record.pendingPermission, approvalId },
  };
}

export function clearPermission(record: ExternalAgentSessionRecord): ExternalAgentSessionRecord {
  if (!record.pendingPermission) return record;
  return { ...record, pendingPermission: null, status: "running" };
}

/**
 * 使用者把一個還沒到終態的 session 停止。
 *
 * 已完成的步驟保留；待核准的權限請求由主機層撤回（這裡只清空紀錄上的
 * `pendingPermission`，真正的審批由呼叫端撤回）。
 *
 * 這裡不碰 `child`：狀態機不知道行程是否真的結束。stop 的終止是有限時等待，
 * 可能殺不掉行程；清掉身分會讓重啟後認不出還活著的孤兒。清 child 是已確認
 * 退出的 host 路徑（`#onExit`、`startupCleanup`）的責任。
 */
export function markStopped(
  record: ExternalAgentSessionRecord,
  message: string,
  now: Date,
): ExternalAgentSessionRecord {
  if (isTerminalAgentStatus(record.status)) return record;
  return {
    ...record,
    status: "stopped",
    message,
    pendingPermission: null,
    updatedAt: now.toISOString(),
    lastEventSeq: record.lastEventSeq + 1,
  };
}

/**
 * 主機服務重啟後對未完成 session 的處置。
 *
 * 執行中的工具中斷後拿不到供應商的續跑保證，
 * 所以標記為 `failed` 並說明結果未知；已完成的步驟不會重跑。
 * 尚未確認結束的子行程身分由呼叫端保留，供下次啟動時清理。
 */
export function markUnknownAfterRestart(
  record: ExternalAgentSessionRecord,
  now: Date,
): ExternalAgentSessionRecord {
  if (isTerminalAgentStatus(record.status)) return record;
  return {
    ...record,
    status: "failed",
    resultUnknown: true,
    pendingPermission: null,
    message: "主機重啟，未完成的步驟結果未知",
    updatedAt: now.toISOString(),
    lastEventSeq: record.lastEventSeq + 1,
  };
}
