import { ProcessSupervisor } from "@cardiary/engine-adapter";
import type { ToolProcess, ToolProcessSpec } from "@cardiary/engine-adapter";

/**
 * 假引擎的工具子行程入口。
 *
 * 正式產品由 `packages/engine-adapter` 的監督器啟動工具子行程；假引擎
 * 沿用同一份實作，只補上「省略 `cwd` 時用工具的工作目錄」這一步，
 * 讓工具不需要知道自己跑在哪一種組裝下。
 */
export class FakeToolSpawner {
  readonly #supervisor: ProcessSupervisor;
  readonly #defaultWorkingDir: string;

  constructor(options: { readonly tempDir: string; readonly defaultWorkingDir: string }) {
    this.#supervisor = new ProcessSupervisor({ tempDir: options.tempDir });
    this.#defaultWorkingDir = options.defaultWorkingDir;
  }

  spawn(spec: ToolProcessSpec): ToolProcess {
    return this.#supervisor.spawn({
      command: spec.command,
      ...(spec.args === undefined ? {} : { args: spec.args }),
      cwd: spec.cwd ?? this.#defaultWorkingDir,
      ...(spec.env === undefined ? {} : { env: spec.env }),
      ...(spec.stdio === undefined ? {} : { stdio: spec.stdio }),
    });
  }

  /** 暫停或關閉時呼叫：對所有還在跑的子行程送訊號。 */
  async terminateAll(graceMs?: number): Promise<void> {
    await (graceMs === undefined
      ? this.#supervisor.terminateAll()
      : this.#supervisor.terminateAll(graceMs));
  }
}
