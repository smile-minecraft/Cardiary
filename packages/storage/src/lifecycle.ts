import type { EventLog } from "./events.js";
import type { EventStream } from "./events.js";
import type { JsonValue } from "./json.js";
import type { RuntimeStateStore } from "./runtime-state.js";
import { StorageError } from "./errors.js";

/** 工具子行程的取消介面；實作必須等行程群組真的結束才回傳。 */
export interface ToolSupervisor {
  /** 取消所有工具；期限內沒結束的殺掉，回傳代表沒有工具在寫檔。 */
  cancelAll(deadlineMs: number): Promise<void>;
  /** 目前仍在執行的工具呼叫數；正常在 cancelAll 之後是 0。 */
  activeToolCalls(): number;
}

/** 引擎生命週期的埠；由轉接層實作。 */
export interface EngineLifecyclePort {
  suspend(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface LifecycleEventInput {
  readonly stream: EventStream;
  readonly kind: string;
  readonly payload: JsonValue;
}

export interface LifecycleCoordinatorOptions {
  readonly runtime: RuntimeStateStore;
  readonly events: EventLog;
  readonly supervisor: ToolSupervisor;
  readonly deadlineMs?: number;
}

/**
 * `control.pause` 與 `control.shutdown` 的固定順序。
 *
 * - pause：取消並殺掉工具 → 提交最後一則 `system.status` → checkpoint／關閉
 *   狀態庫 → 關閉引擎。不寫 `clean_shutdown`、不改 epoch。
 * - shutdown：取消工具 → 提交 `clean_shutdown = 1` → checkpoint／關閉狀態庫
 *   → 關閉引擎。
 */
export class LifecycleCoordinator {
  readonly #runtime: RuntimeStateStore;
  readonly #events: EventLog;
  readonly #supervisor: ToolSupervisor;
  readonly #deadlineMs: number;

  constructor(options: LifecycleCoordinatorOptions) {
    this.#runtime = options.runtime;
    this.#events = options.events;
    this.#supervisor = options.supervisor;
    this.#deadlineMs = options.deadlineMs ?? 5000;
  }

  /** `control.pause`：暫停但行程還在；之後可能 resume。 */
  async pause(options: {
    readonly finalStatus: LifecycleEventInput;
    readonly engine: EngineLifecyclePort;
  }): Promise<void> {
    await this.#stopTools();
    // 最後一則 system.status 先提交，提交後才 checkpoint 與關閉。
    this.#events.append(options.finalStatus);
    this.#runtime.checkpointAndClose();
    await options.engine.suspend();
  }

  /** `control.resume`：先重開狀態庫，再重開引擎與 Harness。 */
  async resume(options: { readonly engine: EngineLifecyclePort }): Promise<void> {
    this.#runtime.reopen();
    await options.engine.resume();
  }

  /** `control.shutdown`：唯一會把 `clean_shutdown` 寫成 1 的路徑。 */
  async shutdown(options: { readonly engine: EngineLifecyclePort }): Promise<void> {
    await this.#stopTools();
    this.#runtime.markCleanShutdown("control.shutdown");
    this.#runtime.checkpointAndClose();
    await options.engine.close();
  }

  /** stdin 中斷：把資料庫關乾淨，但沒有殼的確認，不算正常關閉。 */
  closeAfterDisconnect(): void {
    this.#runtime.checkpointAndClose();
  }

  /** `control.pause` 時也要在回應前確認沒有工具還在寫。 */
  assertNoActiveTools(): void {
    if (this.#supervisor.activeToolCalls() > 0) {
      throw new StorageError("busy", "仍有工具在執行，不能暫停或關閉");
    }
  }

  async #stopTools(): Promise<void> {
    await this.#supervisor.cancelAll(this.#deadlineMs);
    this.assertNoActiveTools();
  }
}
