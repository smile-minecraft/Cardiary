/**
 * 排程規格：型別、解析與下次執行時間的計算。
 *
 * 純函式；時間一律由呼叫端注入（RFC 3339 字串）。所有解析失敗都用
 * `ScheduleSpecError` 拋出，錯誤碼給呼叫端判斷要不要對使用者報錯。
 *
 * `daily` 的 `time` 以本機時區的 `HH:MM` 解析；不為 DST 過渡做特殊處理
 * （那一天會差一小時或跳過一次）。`interval` 與 `heartbeat` 的
 * `everyMs` 最短 5 分鐘，防止模組把自己寫成 busy loop。
 */

/** 排程的四種觸發方式。 */
export type ScheduleKind = "once" | "daily" | "interval" | "heartbeat";

export interface OnceSpec {
  readonly kind: "once";
  /** 執行時間，RFC 3339。 */
  readonly at: string;
}

export interface DailySpec {
  readonly kind: "daily";
  /** 本機時區的 `HH:MM`，24 小時制。 */
  readonly time: string;
}

export interface IntervalSpec {
  readonly kind: "interval" | "heartbeat";
  /** 間隔毫秒數；最短 5 分鐘。 */
  readonly everyMs: number;
}

export type ScheduleSpec = OnceSpec | DailySpec | IntervalSpec;

/** `interval`／`heartbeat` 允許的最短間隔。 */
export const MIN_INTERVAL_MS = 5 * 60 * 1000;

export class ScheduleSpecError extends Error {
  readonly code:
    | "invalid-kind"
    | "invalid-spec-shape"
    | "invalid-at"
    | "invalid-time"
    | "interval-too-short"
    | "invalid-task";

  constructor(code: ScheduleSpecError["code"], message: string) {
    super(message);
    this.name = "ScheduleSpecError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 解析 kind；不認得的 kind 拋 `ScheduleSpecError`。 */
export function parseScheduleKind(raw: unknown): ScheduleKind {
  if (raw === "once" || raw === "daily" || raw === "interval" || raw === "heartbeat") {
    return raw;
  }
  throw new ScheduleSpecError(
    "invalid-kind",
    `排程 kind 只能是 once／daily／interval／heartbeat：${String(raw)}`,
  );
}

/** 解析 spec；形狀或值不合法就拋 `ScheduleSpecError`。 */
export function parseScheduleSpec(kind: ScheduleKind, raw: unknown): ScheduleSpec {
  if (!isRecord(raw)) {
    throw new ScheduleSpecError("invalid-spec-shape", "排程 spec 必須是物件");
  }
  switch (kind) {
    case "once": {
      const at = raw.at;
      if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) {
        throw new ScheduleSpecError("invalid-at", "once 排程的 at 必須是合法的 RFC 3339 時間");
      }
      return { kind, at: new Date(at).toISOString() };
    }
    case "daily": {
      const time = raw.time;
      if (typeof time !== "string" || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
        throw new ScheduleSpecError("invalid-time", "daily 排程的 time 必須是 24 小時制的 HH:MM");
      }
      return { kind, time };
    }
    case "interval":
    case "heartbeat": {
      const everyMs = raw.everyMs;
      if (typeof everyMs !== "number" || !Number.isFinite(everyMs) || !Number.isInteger(everyMs)) {
        throw new ScheduleSpecError(
          "invalid-spec-shape",
          "interval／heartbeat 的 everyMs 必須是整數",
        );
      }
      if (everyMs < MIN_INTERVAL_MS) {
        throw new ScheduleSpecError(
          "interval-too-short",
          `everyMs 不得短於 ${MIN_INTERVAL_MS} 毫秒（5 分鐘）`,
        );
      }
      return { kind, everyMs };
    }
  }
}

const TIME_PATTERN = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

/** 本機時區 `HH:MM` 在 `afterIso` 之後（含之後的同一天）的下一次出現時間。 */
function nextDailyOccurrence(time: string, afterIso: string): string {
  const match = TIME_PATTERN.exec(time);
  if (match === null) {
    throw new ScheduleSpecError("invalid-time", `daily 排程的 time 不合法：${time}`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const after = new Date(afterIso);
  const candidate = new Date(after);
  candidate.setHours(hour, minute, 0, 0);
  if (candidate.getTime() > after.getTime()) {
    return candidate.toISOString();
  }
  candidate.setDate(candidate.getDate() + 1);
  candidate.setHours(hour, minute, 0, 0);
  return candidate.toISOString();
}

/**
 * 計算 `afterIso` 之後的下一次執行時間；沒有未來的執行時間時回 `null`（`once`）。
 */
export function computeNextRunAfter(spec: ScheduleSpec, afterIso: string): string | null {
  if (spec.kind === "once") {
    return null;
  }
  if (spec.kind === "daily") {
    return nextDailyOccurrence(spec.time, afterIso);
  }
  return new Date(Date.parse(afterIso) + spec.everyMs).toISOString();
}

/** 建立排程時的首次執行時間。 */
export function computeFirstRun(spec: ScheduleSpec, nowIso: string): string {
  if (spec.kind === "once") {
    return spec.at;
  }
  if (spec.kind === "daily") {
    return nextDailyOccurrence(spec.time, nowIso);
  }
  return new Date(Date.parse(nowIso) + spec.everyMs).toISOString();
}

/** 排程任務的兩類：內建（蒸餾）與背景代理。 */
export type ScheduleTask =
  { readonly type: "distillation" } | { readonly type: "agent"; readonly prompt: string };

/** 解析 `task_json`；形狀不合法就拋 `ScheduleSpecError`。 */
export function parseScheduleTask(raw: unknown): ScheduleTask {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    throw new ScheduleSpecError("invalid-task", "排程 task 必須是帶 type 的物件");
  }
  if (raw.type === "distillation") {
    return { type: "distillation" };
  }
  if (raw.type === "agent") {
    const prompt = raw.prompt;
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      throw new ScheduleSpecError("invalid-task", "背景代理排程的 prompt 不能是空的");
    }
    return { type: "agent", prompt };
  }
  throw new ScheduleSpecError("invalid-task", `不支援的排程 task 類型：${raw.type}`);
}

/** 序列化 spec 與 task 為 JSON。 */
export function specToJson(spec: ScheduleSpec): string {
  return JSON.stringify(spec);
}

export function taskToJson(task: ScheduleTask): string {
  return JSON.stringify(task);
}
