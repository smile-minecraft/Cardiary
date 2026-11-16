import { spawn, execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

/**
 * 服務建立子行程的唯一入口。
 *
 * 硬規則（`shell-control` 第 2.1 節）：
 * - stdio 只能是 `"pipe"` 或 `"ignore"`；任何一個位置要求 `"inherit"` 就丟
 *   `invalid_stdio`，不啟動子行程。
 * - 一律 `detached: true` 建立獨立的 process group，`pid === pgid`；
 *   取消時對 `-pid` 送訊號，孫行程才殺得到。
 *
 * 這是唯一可以匯入 `node:child_process` 的檔案；其他模組只能透過這個 wrapper
 * 啟動子行程。
 */

export type ManagedStdio = "ignore" | "pipe";

export class InvalidStdioError extends Error {
  readonly code = "invalid_stdio";

  constructor(position: number, value: unknown) {
    super(`子行程 stdio[${position}] 只能是 "pipe" 或 "ignore"，收到 ${String(value)}`);
    this.name = "InvalidStdioError";
  }
}

export interface ManagedSpawnOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** 三個位置；省略時用 `["ignore", "pipe", "pipe"]`。 */
  readonly stdio?: readonly [unknown?, unknown?, unknown?];
}

export interface ExitInfo {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export class ManagedChild {
  readonly child: ChildProcess;
  readonly pid: number;
  readonly exited: Promise<ExitInfo>;
  #settled = false;

  constructor(child: ChildProcess, exited: Promise<ExitInfo>) {
    if (child.pid === undefined) {
      throw new Error("子行程沒有 pid");
    }
    this.child = child;
    this.pid = child.pid;
    this.exited = exited.finally(() => {
      this.#settled = true;
    });
    // 代理自行關閉 stdin 後仍存活時，write 會對已斷的管線觸發 EPIPE error event。
    // 沒有 listener 的 error event 會變成 uncaught exception，讓整個主機服務崩潰。
    // 對端已關閉代表寫入不可能成功，這裡當成安全 no-op 吞掉；呼叫端仍然可以
    // 從 write 的 callback 或 writeThenCloseInput 的結果知道寫入沒有送出去。
    child.stdin?.on("error", () => undefined);
  }

  get running(): boolean {
    return !this.#settled;
  }

  get stdout(): Readable | null {
    return this.child.stdout;
  }

  get stderr(): Readable | null {
    return this.child.stderr;
  }

  /** 對整個 process group 送訊號；找不到 group 時退回單一 pid。 */
  signal(signal: NodeJS.Signals): void {
    killGroup(this.pid, signal);
  }

  write(data: string): void {
    this.child.stdin?.write(data);
  }

  closeInput(): void {
    this.child.stdin?.end();
  }

  /**
   * 寫入 cancel／interrupt，等資料真正沖進管線之後才關 stdin。
   *
   * `write` 的 callback 在 chunk 被送進核心管線時才觸發；等它再 `end()`，
   * 才能保證代理先讀到 cancel 才看到 EOF，而不是讓兩件事的順序靠排程決定。
   * 以行程結束為上限，避免行程已死時 callback 不觸發而卡住收尾。
   */
  async writeThenCloseInput(data: string | null): Promise<void> {
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed) return;
    if (data !== null) {
      await Promise.race([
        new Promise<void>((resolve) => {
          // 對端可能在上一個檢查之後才關閉 stdin：write 在已毀損的串流上
          // 可能同步丟 ERR_STREAM_DESTROYED，也可能帶錯誤呼叫 callback。
          // 兩種都當成寫入沒送出去，照樣結束，不讓收尾卡住或拋出去。
          try {
            stdin.write(data, () => resolve());
          } catch {
            resolve();
          }
        }),
        this.exited.then(() => undefined),
      ]);
    }
    if (!stdin.destroyed) {
      try {
        stdin.end();
      } catch {
        // 對端已關閉；stdin 已經不需要再 end。
      }
    }
  }
}

/**
 * 讀出一個行程的啟動時間（`ps -o lstart=`）。
 *
 * 主機服務重啟後要用它分辨「同一個 PID 是不是同一個行程」。讀不到（行程已結束、
 * 沒有 ps、輸出格式不符）時回 `null`；呼叫端要自己決定要不要因此不殺。
 */
export async function readProcessStartTime(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("ps", ["-p", String(pid), "-o", "lstart="], { timeout: 5_000 }, (error, stdout) => {
      const value = stdout?.toString().trim();
      if (error || !value) {
        resolve(null);
        return;
      }
      resolve(value);
    });
  });
}

/**
 * 讀出行程的群組 id（`ps -o pgid=`）。detached 啟動的代理 pgid 等於自己的 pid；
 * 但重啟後一定要重新讀一次，才不會殺到沿用同一 pid 的無關行程。
 */
async function readProcessGroupId(pid: number): Promise<number | null> {
  return new Promise((resolve) => {
    execFile("ps", ["-p", String(pid), "-o", "pgid="], { timeout: 5_000 }, (error, stdout) => {
      const value = Number(stdout?.toString().trim());
      resolve(!error && Number.isInteger(value) && value > 0 ? value : null);
    });
  });
}

/**
 * 讀出一個行程的身分，用來寫進耐久紀錄、之後比對是否為同一個行程。
 * 讀不到啟動時間或群組 id 時回 `null`。
 */
export async function describeProcess(pid: number): Promise<{
  readonly pid: number;
  readonly processGroupId: number;
  readonly startedAt: string;
} | null> {
  const [startedAt, processGroupId] = await Promise.all([
    readProcessStartTime(pid),
    readProcessGroupId(pid),
  ]);
  if (startedAt === null || processGroupId === null) return null;
  return { pid, processGroupId, startedAt };
}

export function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      // 沒有 group 時退回單一 pid。
    }
  }
  try {
    process.kill(pid, signal);
  } catch {
    // 已經結束。
  }
}

function normalizeStdio(
  stdio: readonly [unknown?, unknown?, unknown?] | undefined,
): ["ignore" | "pipe", "ignore" | "pipe", "ignore" | "pipe"] {
  const values = stdio ?? ["ignore", "pipe", "pipe"];
  const resolved: Array<"ignore" | "pipe"> = [];
  for (let index = 0; index < 3; index += 1) {
    const value = values[index] ?? (index === 0 ? "ignore" : "pipe");
    if (value !== "ignore" && value !== "pipe") {
      throw new InvalidStdioError(index, value);
    }
    resolved.push(value);
  }
  return resolved as ["ignore" | "pipe", "ignore" | "pipe", "ignore" | "pipe"];
}

export class SpawnRegistry {
  readonly #children = new Set<ManagedChild>();
  readonly #graceMs: number;

  constructor(options?: { readonly graceMs?: number }) {
    this.#graceMs = options?.graceMs ?? 1000;
  }

  get runningCount(): number {
    return this.#children.size;
  }

  spawn(options: ManagedSpawnOptions): ManagedChild {
    const stdio = normalizeStdio(options.stdio);
    const child = spawn(options.command, options.args ? [...options.args] : [], {
      cwd: options.cwd,
      env: options.env,
      stdio,
      detached: true,
      shell: false,
      windowsHide: true,
    });
    const exited = new Promise<ExitInfo>((resolve) => {
      child.once("exit", (code, signal) => {
        resolve({ code, signal });
      });
      child.once("error", () => {
        resolve({ code: null, signal: null });
      });
    });
    const managed = new ManagedChild(child, exited);
    this.#children.add(managed);
    void exited.then(() => {
      this.#children.delete(managed);
    });
    return managed;
  }

  /** 對所有執行中的子行程送取消訊號；回傳被終止的數量。 */
  async cancelAll(deadlineMs: number): Promise<number> {
    const running = [...this.#children].filter((child) => child.running);
    if (running.length === 0) return 0;
    for (const child of running) {
      child.signal("SIGTERM");
    }
    const deadline = Date.now() + Math.max(0, deadlineMs);
    while (Date.now() < deadline && running.some((child) => child.running)) {
      await delay(10);
    }
    const stubborn = running.filter((child) => child.running);
    for (const child of stubborn) {
      child.signal("SIGKILL");
    }
    const killDeadline = Date.now() + this.#graceMs;
    while (Date.now() < killDeadline && stubborn.some((child) => child.running)) {
      await delay(10);
    }
    return running.length;
  }

  async waitAll(): Promise<void> {
    while (this.#children.size > 0) {
      await Promise.all([...this.#children].map((child) => child.exited));
    }
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
