/**
 * 主機服務的記憶體上限（規格第 13 章「記憶體」）。
 *
 * 主機定期量自己的 RSS；超過上限就走既有的乾淨關閉（`service.abort`：中止回合、
 * 收掉引擎與狀態庫），以專屬結束碼 `75` 退出。殼看到 `75` 會自動重啟服務，而且不算
 * 進連續失敗次數；引擎的斷點續跑讓重啟不丟工作。
 *
 * 上限預設 1536 MB，可用 `CARDIARY_MEMORY_LIMIT_MB` 覆寫。低於安全門檻（256 MB）
 * 的值只在 `CARDIARY_TEST_FAULTS=1` 時生效，正式環境誤設會被忽略並退回預設值，
 * 避免主機一啟動就不斷重啟。量測間隔可用 `CARDIARY_MEMORY_CHECK_MS` 調短，同樣只供測試。
 */

/** 記憶體超標後的結束碼；殼據此判斷是「預期的記憶體重啟」而不是當機。 */
export const EXIT_MEMORY_LIMIT = 75;

export const DEFAULT_MEMORY_LIMIT_MB = 1536;
/** 正式環境允許的最低上限；更低的值只供測試。 */
export const MIN_MEMORY_LIMIT_MB = 256;
export const DEFAULT_MEMORY_CHECK_MS = 30_000;
/** 正式環境允許的最短量測間隔。 */
const MIN_MEMORY_CHECK_MS = 1_000;

const MB = 1024 * 1024;

export interface MemoryLimitConfig {
  readonly limitBytes: number;
  readonly intervalMs: number;
  /** 覆寫值不合法或被忽略時的說明，交給日誌；沒有就是 `undefined`。 */
  readonly warning?: string;
}

type Env = Readonly<Record<string, string | undefined>>;

/** 從環境變數算出上限與量測間隔；不合法的覆寫退回預設值並附上說明。 */
export function memoryLimitConfig(env: Env = process.env): MemoryLimitConfig {
  const testing = env.CARDIARY_TEST_FAULTS === "1";
  const warnings: string[] = [];

  let limitMb = DEFAULT_MEMORY_LIMIT_MB;
  const rawLimit = env.CARDIARY_MEMORY_LIMIT_MB;
  if (rawLimit !== undefined && rawLimit.trim() !== "") {
    const parsed = Number(rawLimit);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      warnings.push(`CARDIARY_MEMORY_LIMIT_MB 不是正數：${rawLimit}，使用預設 ${limitMb} MB`);
    } else if (parsed < MIN_MEMORY_LIMIT_MB && !testing) {
      warnings.push(
        `CARDIARY_MEMORY_LIMIT_MB=${rawLimit} 低於 ${MIN_MEMORY_LIMIT_MB} MB，只在測試環境生效；使用預設 ${limitMb} MB`,
      );
    } else {
      limitMb = parsed;
    }
  }

  let intervalMs = DEFAULT_MEMORY_CHECK_MS;
  const rawInterval = env.CARDIARY_MEMORY_CHECK_MS;
  if (rawInterval !== undefined && rawInterval.trim() !== "") {
    const parsed = Number(rawInterval);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      warnings.push(
        `CARDIARY_MEMORY_CHECK_MS 不是正整數：${rawInterval}，使用預設 ${intervalMs} ms`,
      );
    } else if (parsed < MIN_MEMORY_CHECK_MS && !testing) {
      warnings.push(
        `CARDIARY_MEMORY_CHECK_MS=${rawInterval} 低於 ${MIN_MEMORY_CHECK_MS} ms，只在測試環境生效；使用預設 ${intervalMs} ms`,
      );
    } else {
      intervalMs = parsed;
    }
  }

  return {
    limitBytes: Math.round(limitMb * MB),
    intervalMs,
    ...(warnings.length === 0 ? {} : { warning: warnings.join("；") }),
  };
}

export interface MemoryWatchdogOptions {
  readonly limitBytes: number;
  readonly intervalMs: number;
  /** 超標時呼叫一次；之後監控停止。 */
  readonly onExceeded: (rssBytes: number, limitBytes: number) => void;
  /** 量 RSS；預設 `process.memoryUsage.rss()`。 */
  readonly sample?: () => number;
}

/** 定期量 RSS，第一次超過上限就回報並停止；計時器不會讓行程多活。 */
export class MemoryWatchdog {
  readonly #options: MemoryWatchdogOptions;
  readonly #sample: () => number;
  #timer: NodeJS.Timeout | null = null;
  #fired = false;

  constructor(options: MemoryWatchdogOptions) {
    this.#options = options;
    this.#sample = options.sample ?? (() => process.memoryUsage.rss());
  }

  start(): void {
    if (this.#timer !== null || this.#fired) return;
    this.#timer = setInterval(() => this.check(), this.#options.intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** 量一次；超標時停止並回報。回傳這次是否超標。 */
  check(): boolean {
    if (this.#fired) return false;
    const rss = this.#sample();
    if (rss <= this.#options.limitBytes) return false;
    this.#fired = true;
    this.stop();
    this.#options.onExceeded(rss, this.#options.limitBytes);
    return true;
  }
}
