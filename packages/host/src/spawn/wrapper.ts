import { spawn } from "node:child_process";
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
