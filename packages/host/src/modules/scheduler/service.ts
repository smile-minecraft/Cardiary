import type { BackgroundTaskRunner, ModuleLogger, ScheduleDeclaration } from "@cardiary/module-api";
import type { DistillationTrigger } from "../contract.js";
import type {
  NotificationStore,
  NotificationRecord,
  ScheduleClaim,
  ScheduleStore,
} from "@cardiary/storage";
import { addDaysIso, nowIso } from "@cardiary/storage";
import { localDayKey, type ScheduleTask } from "@cardiary/domain";

/** 排程 tick 的間隔；30 秒。 */
export const SCHEDULER_TICK_MS = 30_000;
/** 同時進行的背景任務上限；心跳與排程任務共用。 */
export const SCHEDULER_MAX_CONCURRENT = 2;
/** 保留清理的週期；一天一次。 */
export const SCHEDULER_MAINTENANCE_MS = 24 * 60 * 60 * 1000;
/** 執行紀錄與已讀通知的保留天數。 */
const RETENTION_DAYS = 90;

/** 心跳任務「無事」的判定：回覆只有這些字樣（可帶結尾標點）時不發通知。 */
export const HEARTBEAT_SILENT_PATTERN =
  /^(無事|沒有需要告知(?:使用者)?的事(?:情)?|沒有要告知的事|silent|nothing to report)[。.!！]?$/i;

export interface SchedulerServiceOptions {
  readonly schedules: ScheduleStore;
  readonly notifications: NotificationStore;
  /** 背景任務執行器；由主機提供，等同一個不可對話的代理回合。 */
  readonly runBackgroundTask: BackgroundTaskRunner;
  /** 引擎是否接受新工作；緊急暫停時回 `false`。 */
  readonly isEngineRunning: () => boolean;
  /** 通知建立後發 `notification.changed`；由模組提供。 */
  readonly emitChanged: (record: NotificationRecord) => void;
  /** 蒸餾入口；由記憶模組提供。缺席時蒸餾任務記 error 並發通知。 */
  readonly distillation?: DistillationTrigger;
  /**
   * 模組宣告的排程。執行時以同 `scheduleId` 的宣告為準，找不到才照排程
   * 列上的任務走；傳函式是為了在模組重載後仍看得到最新的宣告清單。
   */
  readonly declarations?: () => readonly ScheduleDeclaration[];
  readonly logger: ModuleLogger;
  readonly now?: () => Date;
  readonly tickIntervalMs?: number;
  readonly maxConcurrent?: number;
}

const HEARTBEAT_SYSTEM_CONTEXT = `你是 Cardiary 的 Heartbeat 任務代理。這是一輪不可對話的背景執行：沒有人可以即時回答你的問題，也沒有人會出現在畫面前。
照常使用工具時請遵守權限規則；需要審批時照常進佇列，等人決定後才繼續。不得替自己提高權限。
只做定時檢查；如果沒有需要告知使用者的事，只回覆「無事」兩個字；否則回覆要告知使用者的內容（Markdown）。`;

const AGENT_SYSTEM_CONTEXT = `你是 Cardiary 的排程任務代理。這是一輪不可對話的背景執行：沒有人可以即時回答你的問題，也沒有人會出現在畫面前。
照常使用工具時請遵守權限規則；需要審批時照常進佇列，等人決定後才繼續。不得替自己提高權限。
完成後用簡短的 Markdown 回報結果。`;

/**
 * 排程器服務。
 *
 * `start()` 啟動 30 秒 tick 與到點喚醒；啟動時立刻跑一次 tick，把服務關閉
 * 期間錯過的排程補跑一次（不是補跑每一次錯過的；見 `ScheduleStore.claimDue`）。
 * 緊急暫停時不搶新排程；進行中的任務由引擎的 `pauseAll` 停下。
 */
export class SchedulerService {
  readonly #options: SchedulerServiceOptions;
  readonly #now: () => Date;
  #timer: ReturnType<typeof setInterval> | undefined;
  #wake: ReturnType<typeof setTimeout> | undefined;
  #running = new Set<string>();
  #declarationAborts = new Set<AbortController>();
  #lastMaintenanceAt = 0;
  #started = false;

  constructor(options: SchedulerServiceOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#lastMaintenanceAt = Date.now();
    // 啟動即補跑：只搶到期的第一筆，不補跑每一次錯過的。
    void this.tick().catch((error: unknown) => {
      this.#options.logger.error("排程補跑失敗", { message: errorMessage(error) });
    });
    const tickMs = this.#options.tickIntervalMs ?? SCHEDULER_TICK_MS;
    this.#timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        this.#options.logger.error("排程 tick 失敗", { message: errorMessage(error) });
      });
    }, tickMs);
    this.#timer.unref?.();
  }

  /** 有排程新建或恢復時立刻補跑一次；不排進事件迴圈，避免目前 tick 的競態。 */
  poke(): void {
    if (!this.#started) {
      return;
    }
    void this.tick().catch((error: unknown) => {
      this.#options.logger.error("排程立即補跑失敗", { message: errorMessage(error) });
    });
  }

  stop(): void {
    this.#started = false;
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    if (this.#wake !== undefined) {
      clearTimeout(this.#wake);
      this.#wake = undefined;
    }
    // 進行中的宣告執行收不到新的中止訊號就會被丟著跑；停機時一併中止。
    for (const controller of this.#declarationAborts) {
      controller.abort();
    }
    this.#declarationAborts.clear();
  }

  /** 搶出一輪可執行的排程並開始執行；回傳搶到幾個。公開供啟動後立即補跑與測試使用。 */
  async tick(): Promise<number> {
    const maxConcurrent = this.#options.maxConcurrent ?? SCHEDULER_MAX_CONCURRENT;
    let started = 0;
    for (;;) {
      if (this.#running.size >= maxConcurrent) break;
      if (!this.#options.isEngineRunning()) break;
      const result = this.#options.schedules.claimDue(nowIso(this.#now));
      if (result === null) break;
      if (result.kind === "corrupt") {
        // 規格損毀的排程已停用並記下原因；繼續看下一筆。
        continue;
      }
      const { claim } = result;
      if (this.#running.has(claim.schedule.scheduleId)) {
        break;
      }
      this.#running.add(claim.schedule.scheduleId);
      started += 1;
      void this.#execute(claim)
        .catch((error: unknown) => {
          this.#options.logger.error("排程任務執行例外", {
            scheduleId: claim.schedule.scheduleId,
            message: errorMessage(error),
          });
        })
        .finally(() => {
          this.#running.delete(claim.schedule.scheduleId);
          this.#rearmWake();
        });
    }
    this.#maybeMaintenance();
    this.#rearmWake();
    return started;
  }

  /** 90 天保留：執行紀錄與已讀通知；一天最多跑一次。 */
  #maybeMaintenance(): void {
    const nowMs = this.#now().getTime();
    if (nowMs - this.#lastMaintenanceAt < SCHEDULER_MAINTENANCE_MS) {
      return;
    }
    this.#lastMaintenanceAt = nowMs;
    const cutoff = addDaysIso(nowIso(this.#now), -RETENTION_DAYS);
    const runs = this.#options.schedules.deleteOldRuns(cutoff);
    const notifications = this.#options.notifications.deleteOldReadNotifications(cutoff);
    if (runs > 0 || notifications > 0) {
      this.#options.logger.info("排程保留清理完成", {
        deletedRuns: runs,
        deletedNotifications: notifications,
      });
    }
  }

  /** 只在下一次到期時間距現在不到一個 tick 時掛一個喚醒；其他時候由 30 秒 tick 涵蓋。 */
  #rearmWake(): void {
    if (this.#wake !== undefined) {
      clearTimeout(this.#wake);
      this.#wake = undefined;
    }
    if (!this.#started) {
      return;
    }
    const nowMs = this.#now().getTime();
    const next = this.#options.schedules
      .list()
      .filter((schedule) => schedule.enabled)
      .map((schedule) => Date.parse(schedule.nextRunAt))
      .filter((value) => Number.isFinite(value))
      .sort((left, right) => left - right)[0];
    if (next === undefined) {
      return;
    }
    const tickMs = this.#options.tickIntervalMs ?? SCHEDULER_TICK_MS;
    const delay = next - nowMs;
    if (delay > tickMs || delay <= 0) {
      return;
    }
    this.#wake = setTimeout(
      () => {
        this.#wake = undefined;
        void this.tick().catch(() => undefined);
      },
      Math.max(1000, delay),
    );
    this.#wake.unref?.();
  }

  async #execute(claim: ScheduleClaim): Promise<void> {
    const { schedule } = claim;
    const declaration = this.#options
      .declarations?.()
      .find((candidate) => candidate.scheduleId === schedule.scheduleId);
    if (declaration !== undefined) {
      await this.#executeDeclaration(claim, declaration);
      return;
    }
    const isHeartbeat = schedule.kind === "heartbeat";
    if (claim.task.type === "distillation") {
      await this.#executeDistillation(claim);
      return;
    }
    const task: ScheduleTask = claim.task;
    const prompt =
      task.type === "agent" && isHeartbeat
        ? `${task.prompt}\n\n如果沒有需要告知使用者的事，只回覆「無事」兩個字。`
        : task.type === "agent"
          ? task.prompt
          : "";
    let outcome;
    try {
      outcome = await this.#options.runBackgroundTask.run({
        title: `排程：${schedule.name}`,
        purpose: "background-task",
        modelRole: "main",
        systemContext: isHeartbeat ? HEARTBEAT_SYSTEM_CONTEXT : AGENT_SYSTEM_CONTEXT,
        prompt,
        ...(schedule.sourceConversationId === null || schedule.sourceConversationId === undefined
          ? {}
          : { relatedConversationId: schedule.sourceConversationId }),
      });
    } catch (error) {
      const message = errorMessage(error);
      this.#notifyFailure(schedule, isHeartbeat, message, null);
      this.#options.schedules.finishRun({
        runId: claim.runId,
        scheduleId: schedule.scheduleId,
        conversationId: null,
        startedAt: claim.claimedAt,
        finishedAt: nowIso(this.#now),
        status: "error",
        error: message,
      });
      return;
    }
    const finishedAt = nowIso(this.#now);
    const summary = outcome.summary?.trim() ?? "";
    if (outcome.status === "completed") {
      if (isHeartbeat && isSilentHeartbeat(summary)) {
        this.#options.schedules.finishRun({
          runId: claim.runId,
          scheduleId: schedule.scheduleId,
          conversationId: outcome.conversationId,
          startedAt: claim.claimedAt,
          finishedAt,
          status: "silent",
        });
        return;
      }
      const title = isHeartbeat ? `Heartbeat：${schedule.name}` : schedule.name;
      const body =
        summary.length > 0 ? outcome.summary!.trim() : "（背景任務完成，但沒有回覆內容）";
      this.#createNotification({
        kind: isHeartbeat ? "heartbeat" : "schedule",
        title,
        body,
        payload: { scheduleId: schedule.scheduleId, runId: claim.runId },
        sourceScheduleId: schedule.scheduleId,
        sourceConversationId: outcome.conversationId,
      });
      this.#options.schedules.finishRun({
        runId: claim.runId,
        scheduleId: schedule.scheduleId,
        conversationId: outcome.conversationId,
        startedAt: claim.claimedAt,
        finishedAt,
        status: "notify",
      });
      return;
    }
    if (outcome.status === "cancelled") {
      this.#options.schedules.finishRun({
        runId: claim.runId,
        scheduleId: schedule.scheduleId,
        conversationId: outcome.conversationId,
        startedAt: claim.claimedAt,
        finishedAt,
        status: "cancelled",
      });
      return;
    }
    const message =
      outcome.status === "failed" ? "背景任務失敗" : `背景任務未正常結束（${outcome.status}）`;
    const body = summary.length > 0 ? outcome.summary!.trim() : message;
    this.#notifyFailure(schedule, isHeartbeat, body, outcome.conversationId);
    this.#options.schedules.finishRun({
      runId: claim.runId,
      scheduleId: schedule.scheduleId,
      conversationId: outcome.conversationId,
      startedAt: claim.claimedAt,
      finishedAt,
      status: "error",
      error: message,
    });
  }

  /**
   * 模組宣告的排程：交給宣告自己的 `run`。
   *
   * 成功不重複發通知（和蒸餾一樣，需要通知的任務自己發）；失敗記 error、
   * 發一則失敗通知，run 也記 error。停機中止時記 cancelled。
   */
  async #executeDeclaration(claim: ScheduleClaim, declaration: ScheduleDeclaration): Promise<void> {
    const { schedule } = claim;
    const base = {
      runId: claim.runId,
      scheduleId: schedule.scheduleId,
      conversationId: null,
      startedAt: claim.claimedAt,
    };
    const controller = new AbortController();
    this.#declarationAborts.add(controller);
    let failure: string | null = null;
    try {
      await declaration.run({
        scheduleId: schedule.scheduleId,
        firedAt: claim.claimedAt,
        signal: controller.signal,
      });
    } catch (error) {
      failure = errorMessage(error);
    } finally {
      this.#declarationAborts.delete(controller);
    }
    const finishedAt = nowIso(this.#now);
    if (controller.signal.aborted) {
      this.#options.schedules.finishRun({ ...base, finishedAt, status: "cancelled" });
      return;
    }
    if (failure !== null) {
      this.#options.logger.error("內建排程執行失敗", {
        scheduleId: schedule.scheduleId,
        message: failure,
      });
      this.#notifyFailure(schedule, false, failure, null);
      this.#options.schedules.finishRun({
        ...base,
        finishedAt,
        status: "error",
        error: failure,
      });
      return;
    }
    this.#options.schedules.finishRun({ ...base, finishedAt, status: "ok" });
  }

  /**
   * 蒸餾任務：呼叫記憶模組的蒸餾入口。
   *
   * 每日摘要通知由蒸餾服務自己發（payload 帶可復原的每一項），所以成功時
   * 排程這邊只記 run，不重複發通知。丟錯時記 error、發一則失敗通知， run
   * 也記 error；不讓蒸餾排程靜默略過。
   */
  async #executeDistillation(claim: ScheduleClaim): Promise<void> {
    const { schedule } = claim;
    const trigger = this.#options.distillation;
    const base = {
      runId: claim.runId,
      scheduleId: schedule.scheduleId,
      conversationId: null,
      startedAt: claim.claimedAt,
    };
    const finishedAt = nowIso(this.#now);
    if (trigger === undefined) {
      const message = "蒸餾服務尚未接上";
      this.#options.logger.error(message, { scheduleId: schedule.scheduleId });
      this.#notifyFailure(schedule, false, message, null);
      this.#options.schedules.finishRun({
        ...base,
        finishedAt,
        status: "error",
        error: message,
      });
      return;
    }
    try {
      const day = localDayKey(this.#now()) ?? this.#now().toISOString().slice(0, 10);
      await trigger.runForDay("default", day);
      this.#options.schedules.finishRun({ ...base, finishedAt, status: "ok" });
    } catch (error) {
      const message = errorMessage(error);
      this.#options.logger.error("蒸餾排程執行失敗", {
        scheduleId: schedule.scheduleId,
        message,
      });
      this.#notifyFailure(schedule, false, message, null);
      this.#options.schedules.finishRun({
        ...base,
        finishedAt,
        status: "error",
        error: message,
      });
    }
  }

  #notifyFailure(
    schedule: { readonly name: string; readonly scheduleId: string },
    isHeartbeat: boolean,
    body: string,
    conversationId: string | null,
  ): NotificationRecord {
    return this.#createNotification({
      kind: isHeartbeat ? "heartbeat" : "schedule",
      title: `${schedule.name} 執行失敗`,
      body,
      payload: { scheduleId: schedule.scheduleId },
      sourceScheduleId: schedule.scheduleId,
      ...(conversationId === null ? {} : { sourceConversationId: conversationId }),
    });
  }

  #createNotification(input: Parameters<NotificationStore["create"]>[0]): NotificationRecord {
    const record = this.#options.notifications.create(input);
    this.#options.emitChanged(record);
    return record;
  }
}

/** 心跳回覆是否代表「無事」。 */
export function isSilentHeartbeat(summary: string): boolean {
  const trimmed = summary.trim();
  if (trimmed.length === 0) {
    return true;
  }
  return HEARTBEAT_SILENT_PATTERN.test(trimmed);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message;
    return message.length > 500 ? `${message.slice(0, 500)}…` : message;
  }
  return String(error).slice(0, 500);
}
