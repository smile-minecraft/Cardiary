import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";

import { engineError } from "./errors.js";

/** 子行程的 stdio 設定；只允許 pipe 或 ignore，`inherit` 會把控制通道帶進工具。 */
export type ChildStdio = "pipe" | "ignore";

/** 建立子行程的規格；所有工具子行程都用這一個形狀。 */
export interface SpawnSpec {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  /** 預設 `pipe`；`inherit` 一律拒絕。 */
  readonly stdio?: ChildStdio;
}

/** 由共用 wrapper 管理的子行程。 */
export interface ManagedChild {
  readonly pid: number;
  readonly child: ChildProcess;
  /** 讀完 stdout／stderr；`stdio: "ignore"` 時是空字串。 */
  collect(): Promise<{
    readonly stdout: string;
    readonly stderr: string;
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>;
  /** 對整個 process group 送訊號；預設 SIGTERM。 */
  terminate(signal?: NodeJS.Signals): void;
  /** 等到行程結束。 */
  readonly exited: Promise<void>;
}

/** 子行程的環境變數：暫存一律指向轉接層指定的 `tempDir`。 */
export function childEnvironment(input: {
  readonly tempDir: string;
  readonly homeDir?: string;
  readonly base?: Readonly<Record<string, string | undefined>>;
  readonly extra?: Readonly<Record<string, string>>;
}): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.base ?? process.env)) {
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  if (input.homeDir !== undefined) {
    environment.HOME = input.homeDir;
  }
  environment.TMPDIR = input.tempDir;
  environment.TMP = input.tempDir;
  environment.TEMP = input.tempDir;
  for (const [key, value] of Object.entries(input.extra ?? {})) {
    environment[key] = value;
  }
  return environment;
}

/** 確認 stdio 設定合法；`inherit` 代表控制通道會外流，直接拒絕。 */
export function assertAllowedStdio(stdio: string | undefined): ChildStdio {
  if (stdio === undefined) {
    return "pipe";
  }
  if (stdio === "pipe" || stdio === "ignore") {
    return stdio;
  }
  throw engineError("invalid-request", `子行程的 stdio 只允許 pipe 或 ignore，收到 ${stdio}`);
}

/**
 * 工具子行程的唯一入口。
 *
 * 每個子行程自成一個 process group（`detached: true`），暫停或刪除時對整個
 * group 送訊號，孫行程不會被留下。stdio 只能是 pipe 或 ignore。
 */
export class ProcessSupervisor {
  readonly #tempDir: string;
  readonly #homeDir: string | undefined;
  readonly #children = new Set<ManagedChild>();

  constructor(options: { readonly tempDir: string; readonly homeDir?: string }) {
    this.#tempDir = resolve(options.tempDir);
    this.#homeDir = options.homeDir === undefined ? undefined : resolve(options.homeDir);
  }

  get tempDir(): string {
    return this.#tempDir;
  }

  spawn(spec: SpawnSpec): ManagedChild {
    const stdio = assertAllowedStdio(spec.stdio);
    const child = spawn(spec.command, [...(spec.args ?? [])], {
      cwd: spec.cwd,
      env: childEnvironment({
        tempDir: this.#tempDir,
        ...(this.#homeDir === undefined ? {} : { homeDir: this.#homeDir }),
        extra: spec.env ?? {},
      }),
      stdio: [stdio === "ignore" ? "ignore" : "pipe", stdio, stdio],
      detached: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const exited = new Promise<void>((resolveExit) => {
      child.once("exit", () => resolveExit());
      child.once("error", () => resolveExit());
    });

    const managed: ManagedChild = {
      pid: child.pid ?? -1,
      child,
      async collect() {
        await exited;
        return {
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          code: child.exitCode,
          signal: child.signalCode,
        };
      },
      terminate(signal: NodeJS.Signals = "SIGTERM") {
        killProcessGroup(child, signal);
      },
      exited,
    };

    this.#children.add(managed);
    void exited.then(() => this.#children.delete(managed));
    return managed;
  }

  /** 對所有還在跑的 process group 送 SIGTERM，超時後 SIGKILL。 */
  async terminateAll(graceMs = 2000): Promise<void> {
    const running = [...this.#children];
    for (const managed of running) {
      managed.terminate("SIGTERM");
    }
    const done = Promise.all(running.map((managed) => managed.exited));
    const timeout = new Promise<void>((resolveTimeout) => {
      const timer = setTimeout(resolveTimeout, graceMs);
      timer.unref?.();
    });
    await Promise.race([done, timeout]);
    for (const managed of running) {
      if (managed.child.exitCode === null && managed.child.signalCode === null) {
        managed.terminate("SIGKILL");
      }
    }
    await Promise.all(running.map((managed) => managed.exited));
  }
}

/** 對子行程的整個 process group 送訊號；沒有權限時退回只殺直接子行程。 */
function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // 行程已經結束。
    }
  }
}
