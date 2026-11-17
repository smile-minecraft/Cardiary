/**
 * 外部代理橋接服務：啟動、審批、進度、停止、重啟接手與用量統計。
 *
 * 這是 Cardiary 與 OpenCode／Claude Code 之間唯一的橋：代理自己跑在獨立行程，
 * Cardiary 攔不到它自己的工具呼叫，只能在對方主動問的時候把問題送進原生審批
 * 佇列。所有子行程都經 `SpawnRegistry` + `sandbox-exec` 啟動；沙盒不可用時
 * 一律拒絕啟動（fail closed）。
 */
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { mkdir, stat, writeFile } from "node:fs/promises";
import type { Readable } from "node:stream";

import {
  applyAgentEvent,
  attachPermissionApproval,
  classifyAcpLine,
  clearPermission,
  isTerminalAgentStatus,
  markStopped,
  markUnknownAfterRestart,
  nextEventSeq,
  normalizeAcpFrame,
  normalizeStreamJsonLine,
  type ExternalAgentChildProcess,
  type ExternalAgentKind,
  type ExternalAgentSessionRecord,
  type ExternalAgentStatus,
  type NormalizedAgentEvent,
} from "@cardiary/domain";
import type { JsonValue } from "@cardiary/engine-adapter";
import type { CardiaryPaths } from "@cardiary/module-api";

import { prefixed } from "../../ids.js";
import { createCommandSandbox } from "../../permissions/sandbox.js";
import { describeProcess, type ManagedChild, type SpawnRegistry } from "../../spawn/wrapper.js";
import type { AgentApprovalsService } from "../contract.js";
import {
  agentStoragePaths,
  clearScratch,
  computeOutsideWrites,
  computeUsage,
  ensureSessionDirs,
  homeDir,
  isProtectedWorkingDirectory,
  listRecords,
  markOrphansAfterRestart,
  purgeStaleCache,
  readRecord,
  removeScratch,
  scratchDir,
  writeRecord,
  type AgentStoragePaths,
} from "./store.js";
import {
  ACP_IDS,
  agentArgs,
  agentEnv,
  encodeAcpCancel,
  encodeAcpInitialize,
  encodeAcpPermissionReply,
  encodeAcpPrompt,
  encodeAcpSessionNew,
  encodeAcpSetModel,
  encodeClaudeInitialize,
  encodeClaudeInterrupt,
  encodeClaudePermissionReply,
  encodeClaudeUser,
  resolveAgentCommand,
} from "./transport.js";

/** 協定 `pendingPermission` 的投影形狀；list 與 state_changed 共用同一份。 */
export interface PendingPermissionWire {
  readonly approvalId: string;
  readonly toolName: string;
  readonly description?: string;
}

/** `module.external-agents.state` 事件的 `data`。 */
export interface ExternalAgentStateData {
  readonly agentSessionId: string;
  readonly agentKind: ExternalAgentKind;
  readonly status: ExternalAgentStatus;
  readonly progress?: ExternalAgentSessionRecord["progress"];
  readonly message?: string;
  readonly resultUnknown?: boolean;
  readonly pendingPermission?: PendingPermissionWire;
}

/**
 * 把一筆代理紀錄投影成協定的 `pendingPermission`。
 *
 * 代理卡住有兩種原因，兩者都要讓客戶端畫出核准／拒絕鈕：
 * 1. 代理行程真的提出工具權限請求（`pendingPermission`）；
 * 2. 代理還沒啟動，正在等啟動審批（`startApprovalId`）。
 *
 * 舊版只投影第一種，而啟動時 `pendingPermission` 永遠是 null，於是狀態卡上
 * 沒有核准鈕，整個啟動流程卡死。這裡把第二種也投影成同一個形狀；工具權限
 * 請求優先，因為它才是代理正在等待的東西。`startApprovalId` 仍舊只存在於
 * 耐久紀錄，這裡純粹讀它、不改它，清掉時機交給原本的生命週期。
 */
function projectPendingPermission(
  record: ExternalAgentSessionRecord,
): PendingPermissionWire | undefined {
  // 代理提出過工具權限請求時，一律以它為準。即使 approvalId 還沒填上
  // （要求與建立審批之間的非同步窗口），也不能回退到啟動審批，否則狀態卡
  // 會把真正的工具請求顯示成「啟動代理」，點下去等於核准了錯誤的東西。
  if (record.pendingPermission) {
    if (record.pendingPermission.approvalId === "") return undefined;
    return {
      approvalId: record.pendingPermission.approvalId,
      toolName: record.pendingPermission.toolName,
      ...(record.pendingPermission.description
        ? { description: record.pendingPermission.description }
        : {}),
    };
  }
  if (record.status === "waiting-approval" && record.startApprovalId) {
    const label = record.agentKind === "opencode" ? "OpenCode" : "Claude Code";
    return {
      approvalId: record.startApprovalId,
      toolName: record.agentKind === "opencode" ? "opencode-acp" : "claude-code-stream-json",
      description: `啟動 ${label}：${record.workingDirectory}`,
    };
  }
  return undefined;
}

/** 協定 `AgentSessionInfo` 的形狀；`completed` 在協定列舉裡映射到 `stopped`。 */
export interface AgentSessionInfoWire {
  readonly agentSessionId: string;
  readonly agentKind: ExternalAgentKind;
  readonly status: "starting" | "running" | "waiting-approval" | "stopped" | "failed";
  readonly workingDirectory: string;
  readonly startedAt: string;
  readonly progress?: { step: string; label: string; completed: number; total: number };
  readonly message?: string;
  readonly resultUnknown?: boolean;
  readonly pendingPermission?: PendingPermissionWire;
}

export interface StartAgentInput {
  readonly agentKind: ExternalAgentKind;
  readonly workingDirectory: string;
  readonly prompt?: string;
  readonly clientRequestId?: string;
}

export interface StartAgentResult {
  readonly agentSessionId: string;
  /**
   * 啟動審批還在等待時才有值；已經過了那個階段（審批決定、撤回或逾時）就省略。
   * 客戶端不該拿它當按鈕表達式之外的參考。
   */
  readonly approvalId?: string;
}

/** 啟動被拒絕時的原因，`protocol.ts` 把它映射到適當的錯誤碼。 */
export class AgentStartError extends Error {
  readonly code: "invalid-workspace" | "sandbox-unavailable" | "unsupported-kind";

  constructor(
    code: "invalid-workspace" | "sandbox-unavailable" | "unsupported-kind",
    message: string,
  ) {
    super(message);
    this.name = "AgentStartError";
    this.code = code;
  }
}

export interface ExternalAgentsDeps {
  readonly paths: CardiaryPaths;
  readonly spawn: SpawnRegistry;
  readonly approvals: AgentApprovalsService;
  /** 發出 `module.external-agents.state` 事件。 */
  readonly emitState: (data: ExternalAgentStateData) => void;
  readonly logger?: { warn(message: string): void };
  readonly now?: () => Date;
  readonly homeDir?: string;
  /** OpenCode 的預設模型；spike 實測的免費模型，代理沒登入也能跑。 */
  readonly openCodeModel?: string;
  /** 以下為測試可調的等待上限；正式環境用預設值。 */
  readonly timeouts?: {
    readonly cancelGraceMs?: number;
    readonly termGraceMs?: number;
    readonly killGraceMs?: number;
    readonly exitTaskTimeoutMs?: number;
    readonly startupCleanupBudgetMs?: number;
  };
}

interface TrackedPermission {
  readonly approvalId: string;
  readonly replyToken: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  /** OpenCode ACP 伺服器實際给的 optionId；回錯會被當成拒絕。 */
  readonly allowOptionId?: string;
  readonly denyOptionId?: string;
  resolved: boolean;
}

interface LiveSession {
  record: ExternalAgentSessionRecord;
  child: ManagedChild | null;
  /** `child.exited` 的 promise，`#onExit` 完成後 resolve。 */
  exitTask: Promise<void> | null;
  acpSessionId: string | null;
  permissionPromptSent: boolean;
  stopping: boolean;
  /**
   * 完成／失敗事件正在處理時的 promise；處理完之後紀錄才會是終態。
   * stop、pauseAll、shutdown 要等它結束，才知道 child 是不是已經被清掉。
   */
  termination: Promise<void> | null;
  /** 同一個 session 的 stdout／stderr 行依序處理的鏈結。 */
  queue: Promise<void>;
  readonly abort: AbortController;
  readonly permissions: Map<string, TrackedPermission>;
  readonly stderrTail: string[];
}

/** 預設用不帶登入的免費模型；環境變數可覆寫。 */
const DEFAULT_OPENCODE_MODEL = "opencode/iceman-free";

/** 等 `exitTask` 收尾的預設上限；真正殺不掉的行程不能讓 stop/shutdown 無限期卡住。 */
const DEFAULT_EXIT_TASK_TIMEOUT_MS = 5_000;
/** startupCleanup 收拾舊行程的預設總預算，避免逐筆等待無界累加拖慢啟動。 */
const DEFAULT_STARTUP_CLEANUP_BUDGET_MS = 10_000;
/** 終止行程各階段的預設寬限時間。 */
const DEFAULT_CANCEL_GRACE_MS = 1_000;
const DEFAULT_TERM_GRACE_MS = 2_000;
const DEFAULT_KILL_GRACE_MS = 2_000;

export class ExternalAgentsService {
  readonly #deps: ExternalAgentsDeps;
  readonly #storage: AgentStoragePaths;
  readonly #approvals: AgentApprovalsService;
  readonly #live = new Map<string, LiveSession>();
  readonly #cancelGraceMs: number;
  readonly #termGraceMs: number;
  readonly #killGraceMs: number;
  readonly #exitTaskTimeoutMs: number;
  readonly #startupCleanupBudgetMs: number;

  constructor(deps: ExternalAgentsDeps) {
    this.#deps = deps;
    this.#storage = agentStoragePaths(deps.paths);
    this.#approvals = deps.approvals;
    const timeouts = deps.timeouts ?? {};
    this.#cancelGraceMs = timeouts.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
    this.#termGraceMs = timeouts.termGraceMs ?? DEFAULT_TERM_GRACE_MS;
    this.#killGraceMs = timeouts.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.#exitTaskTimeoutMs = timeouts.exitTaskTimeoutMs ?? DEFAULT_EXIT_TASK_TIMEOUT_MS;
    this.#startupCleanupBudgetMs =
      timeouts.startupCleanupBudgetMs ?? DEFAULT_STARTUP_CLEANUP_BUDGET_MS;
  }

  /** 服務啟動時：清暫存、清掉舊行程、把懸空 session 標結果未知、清 30 天快取。 */
  async startupCleanup(): Promise<{ orphaned: number; purged: number }> {
    const records = await listRecords(this.#storage);
    // 先處理上次強制結束留下的行程；PID 重用時身分對不上就不動它。
    // 有總預算：萬一某一筆行程殺不掉，也不能讓每台的主機啟動無界累加等待。
    const budgetDeadline = Date.now() + this.#startupCleanupBudgetMs;
    // 只記已確認結束的行程。沒確認的保留 child 身分，下次啟動還能認出它再殺。
    const terminated = new Set<string>();
    for (const record of records) {
      if (!record.child) continue;
      if (Date.now() >= budgetDeadline) {
        this.#deps.logger?.warn(
          `啟動清理超過 ${this.#startupCleanupBudgetMs}ms，略過剩餘舊行程的終止`,
        );
        break;
      }
      const remaining = budgetDeadline - Date.now();
      if (await this.#terminateRecordedChild(record.child, remaining)) {
        terminated.add(record.agentSessionId);
      }
    }
    await clearScratch(this.#storage);
    for (const record of records) {
      // 撤回這個代理還卡在 pending 的審批；不只是紀錄上記得的那幾筆。
      await this.#approvals.withdrawPendingForAgent(record.agentSessionId, "主機重新啟動");
      // 只有確認行程已結束才清 child 身分；沒殺掉的留著，下次啟動再認。
      if (record.child && terminated.has(record.agentSessionId)) {
        await writeRecord(this.#storage, { ...record, child: undefined });
      }
    }
    const marked = await markOrphansAfterRestart(this.#storage, this.#now());
    for (const record of marked) this.#emit(record);
    const purged = await purgeStaleCache(this.#storage, this.#now().getTime());
    return { orphaned: marked.length, purged: purged.length };
  }

  /** `agent.start`：建立工作階段與啟動審批；核准後才會真的啟動行程。 */
  async start(input: StartAgentInput): Promise<StartAgentResult> {
    const kind = input.agentKind;
    if (kind !== "opencode" && kind !== "claude-code") {
      throw new AgentStartError("unsupported-kind", `不支援的代理種類：${String(kind)}`);
    }
    if (!isAbsolute(input.workingDirectory)) {
      throw new AgentStartError("invalid-workspace", "工作目錄必須是絕對路徑。");
    }
    const workingDirectory = resolve(input.workingDirectory);
    const info = await stat(workingDirectory).catch(() => null);
    if (info === null || !info.isDirectory()) {
      throw new AgentStartError("invalid-workspace", "工作目錄不存在或不是資料夾。");
    }
    if (isProtectedWorkingDirectory(this.#deps.paths.root, workingDirectory)) {
      throw new AgentStartError(
        "invalid-workspace",
        "外部代理不能以 Cardiary 的資料夾（除了 tmp/）當工作目錄。",
      );
    }
    if (input.clientRequestId) {
      const records = await listRecords(this.#storage);
      const existing = records.find((record) => record.clientRequestId === input.clientRequestId);
      if (existing) {
        // 已經過了等待審批的階段就不要回傳上一場審批的 id，
        // 客戶端容易把它當成還可以按的按鈕。
        const waitingOnStart =
          existing.status === "waiting-approval" &&
          existing.startApprovalId !== undefined &&
          existing.startApprovalId.length > 0;
        return waitingOnStart
          ? { agentSessionId: existing.agentSessionId, approvalId: existing.startApprovalId }
          : { agentSessionId: existing.agentSessionId };
      }
    }

    const agentSessionId = prefixed("agent");
    const sandboxOptions = {
      workingDir: workingDirectory,
      folderRoot: this.#deps.paths.root,
      agentHomeDir: homeDir(this.#storage, agentSessionId),
      extraWritableDirs: this.#extraWritableDirs(kind, agentSessionId),
    };
    // 先確認沙盒可用；不可用時連審批都不建立，直接 fail closed。
    if (createCommandSandbox(sandboxOptions) === null) {
      throw new AgentStartError(
        "sandbox-unavailable",
        "這台電腦的作業系統沙盒不可用；為了安全起見，代理沒有啟動。",
      );
    }
    await ensureSessionDirs(this.#storage, agentSessionId);

    const label = kind === "opencode" ? "OpenCode" : "Claude Code";
    const { approvalId } = await this.#approvals.request({
      agentSessionId,
      requestId: "start",
      kind: "tool-execution",
      summary: `啟動 ${label}：${workingDirectory}`,
      details: [
        { label: "代理", value: label },
        { label: "工作目錄", value: workingDirectory },
        { label: "任務", value: input.prompt ?? "（只啟動，不下任務）" },
      ],
      ...(kind === "opencode"
        ? { toolName: "opencode-acp" }
        : { toolName: "claude-code-stream-json" }),
      // 每個工作階段都是獨立的審批：同一個工具名稱不能讓後面的啟動沿用前面的決定。
      toolInput: { agentSessionId, workingDirectory },
      risk: "medium",
    });
    const now = this.#now().toISOString();
    const record: ExternalAgentSessionRecord = {
      agentSessionId,
      agentKind: kind,
      workingDirectory,
      ...(input.prompt ? { prompt: input.prompt } : {}),
      startedAt: now,
      updatedAt: now,
      status: "waiting-approval",
      completedSteps: 0,
      lastEventSeq: 0,
      pendingPermission: null,
      resultUnknown: false,
      startApprovalId: approvalId,
      ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
    };
    await writeRecord(this.#storage, record);
    this.#emit(record);
    this.#live.set(agentSessionId, {
      record,
      child: null,
      exitTask: null,
      acpSessionId: null,
      permissionPromptSent: false,
      stopping: false,
      termination: null,
      queue: Promise.resolve(),
      abort: new AbortController(),
      permissions: new Map(),
      stderrTail: [],
    });
    void this.#awaitStartApproval(agentSessionId, approvalId);
    return { agentSessionId, approvalId };
  }

  /** `agent.stop`：撤回還沒決定的審批，中斷行程並記為 stopped。 */
  async stop(agentSessionId: string): Promise<{ agentSessionId: string; stopped: boolean }> {
    const live = this.#live.get(agentSessionId);
    const current = live?.record ?? (await readRecord(this.#storage, agentSessionId));
    if (current === null) {
      throw new Error(`沒有這個代理工作階段：${agentSessionId}`);
    }
    if (live?.termination) {
      // 完成／失敗事件正在處理；等它收尾（殺行程、清暫存、寫終態）再看紀錄。
      await live.termination;
      return { agentSessionId, stopped: false };
    }
    if (isTerminalAgentStatus(current.status)) {
      // 狀態是終態，但行程可能還沒清乾淨；該清就清。
      if (live?.child?.running) {
        await this.#terminateChild(live);
        await removeScratch(this.#storage, agentSessionId);
      }
      return { agentSessionId, stopped: false };
    }
    if (live) live.stopping = true;
    await this.#withdrawPending(agentSessionId, current, "代理已停止");
    live?.abort.abort();
    if (live) {
      await this.#terminateChild(live);
    }
    // #onExit 可能已經用「代理行程結束」蓋過紀錄；以紀錄目前的值為準。
    const latest = live?.record ?? current;
    const updated = markStopped(latest, "使用者停止", this.#now());
    if (live) live.record = updated;
    await writeRecord(this.#storage, updated);
    this.#emit(updated);
    await removeScratch(this.#storage, agentSessionId);
    return { agentSessionId, stopped: true };
  }

  /** `agent.list`：以耐久紀錄為準，重新啟動後 still 對得上。 */
  async list(): Promise<readonly AgentSessionInfoWire[]> {
    const records = await listRecords(this.#storage);
    return records
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((record) => {
        const pendingPermission = projectPendingPermission(record);
        return {
          agentSessionId: record.agentSessionId,
          agentKind: record.agentKind,
          // 協定的 AgentStatus 沒有 completed；完成的 session 以 stopped 呈現，
          // 真正的結果寫在 message，模組事件則保留完整的領域狀態。
          status: record.status === "completed" ? "stopped" : record.status,
          workingDirectory: record.workingDirectory,
          startedAt: record.startedAt,
          ...(record.progress
            ? {
                progress: {
                  step: String(record.progress.step),
                  label: record.progress.label,
                  completed: record.progress.completed,
                  total: record.progress.total,
                },
              }
            : {}),
          ...(record.message ? { message: record.message } : {}),
          ...(record.resultUnknown ? { resultUnknown: true } : {}),
          ...(pendingPermission ? { pendingPermission } : {}),
        };
      });
  }

  /** `module.external-agents.usage` 的資料來源；含資料夾外的 Claude 固定目錄。 */
  async usage(): Promise<Awaited<ReturnType<typeof computeUsage>>> {
    return computeUsage(this.#storage);
  }

  /**
   * `storage.usage` 的選用 `outsideWrites` 資料來源；只量測四個資料夾外位置，
   * 不碰 legacy 的 cacheBytes／tempBytes。home 優先用建構時注入的 fixture。
   */
  async outsideWrites(): Promise<Awaited<ReturnType<typeof computeOutsideWrites>>> {
    return computeOutsideWrites(this.#deps.homeDir ?? homedir());
  }

  /**
   * 還在 `#live` 中被追蹤的行程 id；診斷與測試用。
   *
   * 行程結束且紀錄進入終態後，對應的 id 不應再出現在這裡。對外公開只是為了
   * 讓回歸測試直接檢查追蹤表，不必用 list() 或 emitState 間接猜測。
   */
  trackedLiveSessionIds(): readonly string[] {
    return [...this.#live.keys()];
  }

  /** 緊急全部暫停：撤回等待中的審批並中止代理，避免核准後才冒出新行程。 */
  async pauseAll(reason: string): Promise<void> {
    for (const [agentSessionId, live] of this.#live) {
      if (live.termination) {
        // 完成／失敗事件正在處理；等它收尾，避免兩邊搶寫終態。
        await live.termination;
      }
      if (isTerminalAgentStatus(live.record.status)) {
        // 終態但行程還沒清乾淨：該殺就殺、該清暫存就清。
        if (live.child?.running) {
          await this.#terminateChild(live);
        }
        await removeScratch(this.#storage, agentSessionId);
        continue;
      }
      // 先記下「還沒生出行程」，撤回審批時等待中的啟動流程可能同步改寫紀錄。
      const waitedOnly = live.record.status === "waiting-approval" && live.child === null;
      live.stopping = true;
      live.abort.abort();
      await this.#withdrawPending(agentSessionId, live.record, reason);
      if (live.child) {
        await this.#terminateChild(live);
      }
      const latest = live.record;
      if (!isTerminalAgentStatus(latest.status)) {
        const updated = waitedOnly
          ? markStopped(latest, `緊急暫停：代理沒有啟動（${reason}）`, this.#now())
          : markUnknownAfterRestart(latest, this.#now());
        live.record = updated;
        await writeRecord(this.#storage, updated);
        this.#emit(updated);
      }
    }
    await clearScratch(this.#storage);
  }

  /** 主機關閉：中斷還活著的行程、撤回審批、把結果標成未知。 */
  async shutdown(): Promise<void> {
    for (const [agentSessionId, live] of this.#live) {
      if (live.termination) {
        await live.termination;
      }
      if (isTerminalAgentStatus(live.record.status)) {
        if (live.child?.running) {
          await this.#terminateChild(live);
        }
        await removeScratch(this.#storage, agentSessionId);
        continue;
      }
      live.stopping = true;
      live.abort.abort();
      await this.#withdrawPending(agentSessionId, live.record, "主機關閉");
      if (live.child) {
        await this.#terminateChild(live);
      }
      const latest = live.record;
      // #onExit 可能已經把紀錄寫成終態；那時不要再蓋或重寫。
      if (!isTerminalAgentStatus(latest.status)) {
        const updated = markUnknownAfterRestart(latest, this.#now());
        live.record = updated;
        await writeRecord(this.#storage, updated);
        this.#emit(updated);
      }
    }
    await clearScratch(this.#storage);
  }

  // ---- 啟動審批與行程 ---------------------------------------------------

  async #awaitStartApproval(agentSessionId: string, approvalId: string): Promise<void> {
    const live = this.#live.get(agentSessionId);
    if (!live) return;
    let resolution;
    try {
      resolution = await this.#approvals.waitForDecision(approvalId, {
        signal: live.abort.signal,
      });
    } catch {
      return;
    }
    if (resolution.outcome !== "approved") {
      // 停止或緊急暫停由呼叫端負責寫最終狀態，這裡不要再蓋成失敗。
      if (live.stopping) return;
      if (live.record.status === "waiting-approval") {
        const denied = resolution.outcome === "denied";
        const updated: ExternalAgentSessionRecord = {
          ...live.record,
          status: "failed",
          message: denied ? "啟動審批被拒絕，代理沒有啟動" : "啟動審批逾時或撤回，代理沒有啟動",
          startApprovalId: undefined,
          updatedAt: this.#now().toISOString(),
          lastEventSeq: live.record.lastEventSeq + 1,
        };
        live.record = updated;
        await writeRecord(this.#storage, updated);
        this.#emit(updated);
        await removeScratch(this.#storage, agentSessionId);
      }
      return;
    }
    if (!live.stopping && live.record.status === "waiting-approval") {
      await this.#spawnAgent(live);
    }
  }

  async #spawnAgent(live: LiveSession): Promise<void> {
    const record = live.record;
    const agentSessionId = record.agentSessionId;
    const home = homeDir(this.#storage, agentSessionId);
    if (record.agentKind === "opencode") {
      await mkdir(join(home, ".config", "opencode"), { recursive: true });
      if (live.stopping) return;
      // 沒有這份設定，OpenCode 會直接執行 bash，不會送 permission 請求。
      await writeFile(
        join(home, ".config", "opencode", "opencode.json"),
        `${JSON.stringify(
          {
            $schema: "https://opencode.ai/config.json",
            permission: { bash: "ask", edit: "ask" },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
    if (live.stopping) return;
    const sandbox = createCommandSandbox({
      workingDir: record.workingDirectory,
      folderRoot: this.#deps.paths.root,
      agentHomeDir: home,
      extraWritableDirs: this.#extraWritableDirs(record.agentKind, agentSessionId),
    });
    if (sandbox === null) {
      this.#deps.logger?.warn(`代理 ${agentSessionId} 啟動失敗：沙盒不可用`);
      const updated: ExternalAgentSessionRecord = {
        ...record,
        status: "failed",
        message: "沙盒不可用，代理沒有啟動",
        startApprovalId: undefined,
        updatedAt: this.#now().toISOString(),
        lastEventSeq: record.lastEventSeq + 1,
      };
      live.record = updated;
      await writeRecord(this.#storage, updated);
      this.#emit(updated);
      return;
    }
    const command = resolveAgentCommand(record.agentKind);
    const args = agentArgs(record.agentKind);
    const child = this.#deps.spawn.spawn({
      command: sandbox.executable,
      args: ["-p", sandbox.profile, command, ...args],
      cwd: record.workingDirectory,
      env: agentEnv(record.agentKind, {
        home,
        tmpDir: scratchDir(this.#storage, agentSessionId),
        pathEnv: process.env.PATH,
      }),
      stdio: ["pipe", "pipe", "pipe"],
    });
    live.child = child;
    // 掛上 stdout/stderr 之前不會丟資料：pipe 在沒有消費者的時候會自己緩衝。
    if (child.stdout) {
      this.#consumeLines(child.stdout, (line) => {
        this.#enqueueLine(live, line);
      });
    }
    if (child.stderr) {
      this.#consumeLines(child.stderr, (line) => {
        live.stderrTail.push(line.slice(-500));
        if (live.stderrTail.length > 20) live.stderrTail.shift();
      });
    }
    live.exitTask = child.exited.then((exit) => this.#onExit(live, exit));
    // 先確認停止沒有在 spawn 之後生效，再讓 child 開始聊。
    if (live.stopping) {
      await this.#terminateChild(live);
      return;
    }

    if (record.agentKind === "opencode") {
      child.write(encodeAcpInitialize());
    } else {
      child.write(encodeClaudeInitialize());
      if (record.prompt) child.write(encodeClaudeUser(record.prompt));
    }
    // 記住行程的身分，之後重啟可以認出它；讀不到就回報並繼續啟動。
    const identity = await describeProcess(child.pid);
    if (identity === null) {
      this.#deps.logger?.warn(
        `無法讀取代理 ${agentSessionId} 的行程啟動時間；重啟時將無法認出這個行程`,
      );
    }
    // 代理可能在這個空檔就發了事件；以目前的紀錄為準，不要蓋回剛才的等待狀態。
    const current = live.record;
    if (live.stopping || isTerminalAgentStatus(current.status)) return;
    const updated: ExternalAgentSessionRecord = {
      ...current,
      status: current.pendingPermission ? "waiting-approval" : "running",
      message: undefined,
      startApprovalId: undefined,
      updatedAt: this.#now().toISOString(),
      lastEventSeq: current.lastEventSeq + 1,
      ...(identity ? { child: identity } : {}),
    };
    live.record = updated;
    await writeRecord(this.#storage, updated);
    this.#emit(updated);
  }

  #consumeLines(stream: Readable, onLine: (line: string) => void): void {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line.length > 0) onLine(line);
      }
    });
  }

  /** 同一個 session 的事件要依序處理，否則兩次權限請求會互相踩。 */
  #enqueueLine(live: LiveSession, line: string): void {
    // 事件要照順序；出錯也不能把整條鏈卡住。
    const next = live.queue.then(() => this.#onLine(live, line));
    live.queue = next.catch((error: unknown) => {
      this.#deps.logger?.warn(
        `處理代理輸出失敗：${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  // ---- 訊息與事件 -------------------------------------------------------

  async #onLine(live: LiveSession, line: string): Promise<void> {
    const kind = live.record.agentKind;
    let events: readonly NormalizedAgentEvent[] = [];
    if (kind === "opencode") {
      const frame = classifyAcpLine(line);
      if (frame.kind === "response") {
        await this.#onAcpResponse(live, frame.frame.id, frame.frame.result ?? {}, line);
        return;
      }
      events = normalizeAcpFrame(frame);
    } else if (kind === "claude-code") {
      events = normalizeStreamJsonLine(line);
    }
    for (const event of events) {
      await this.#applyEvent(live, event);
    }
  }

  async #onAcpResponse(
    live: LiveSession,
    id: number | string,
    result: Record<string, unknown>,
    raw: string,
  ): Promise<void> {
    const child = live.child;
    if (!child || !child.running) return;
    if (id === ACP_IDS.initialize) {
      child.write(encodeAcpSessionNew(live.record.workingDirectory));
      return;
    }
    if (id === ACP_IDS.sessionNew) {
      const sessionId = result.sessionId;
      live.acpSessionId = typeof sessionId === "string" ? sessionId : null;
      const model =
        this.#deps.openCodeModel ??
        process.env.CARDIARY_AGENT_OPENCODE_MODEL ??
        DEFAULT_OPENCODE_MODEL;
      if (model.length > 0 && live.acpSessionId) {
        child.write(encodeAcpSetModel(model, live.acpSessionId));
      }
      if (live.record.prompt && live.acpSessionId) {
        child.write(encodeAcpPrompt(live.acpSessionId, live.record.prompt));
        live.permissionPromptSent = true;
      }
      return;
    }
    if (id === 100) {
      // ACP 的 session/prompt 回覆就是一輪的結束點。
      let stopReason: string | undefined;
      try {
        stopReason = (JSON.parse(raw) as { result?: { stopReason?: string } }).result?.stopReason;
      } catch {
        stopReason = undefined;
      }
      if (stopReason === "cancelled") {
        if (!live.stopping) {
          await this.#applyEvent(live, { kind: "failed", message: "代理取消了這次任務" });
        }
        return;
      }
      await this.#applyEvent(live, {
        kind: "completed",
        message:
          stopReason === "end_turn" ? "代理完成任務" : `代理結束（${stopReason ?? "unknown"}）`,
      });
      return;
    }
    // session/set_config_option 的回應（包括失敗）不需要動作；模型選不到也能繼續跑。
  }

  async #applyEvent(live: LiveSession, event: NormalizedAgentEvent): Promise<void> {
    // 正在收尾或停止中時，不要把任何事件再套進紀錄。
    if (live.stopping || isTerminalAgentStatus(live.record.status)) return;

    // 完成／失敗事件會走一輪完整的收尾：殺行程 → 清暫存 → 才寫終態。
    if (event.kind === "completed" || event.kind === "failed") {
      await this.#finishSession(live, event);
      return;
    }

    if (event.kind === "permission") {
      // 先擋住，再等審批；回來時會再擋一次。
      const now = this.#now();
      const approval = await this.#approvals.request({
        agentSessionId: live.record.agentSessionId,
        requestId: `permission:${event.requestKey}`,
        kind: "tool-execution",
        summary: `${this.#label(live.record.agentKind)} 想執行 ${event.toolName}`,
        details: [
          {
            label: "內容",
            value: event.description ?? JSON.stringify(event.input).slice(0, 2000),
          },
        ],
        toolName: event.toolName,
        toolInput: event.input as JsonValue,
        risk: "high",
      });
      // 等待審批的時候，使用者可能已經按停止，或事件已經被別的流程處理；
      // 不要把「等待核准」寫回已經是終態的紀錄。
      if (live.stopping || isTerminalAgentStatus(live.record.status)) {
        await this.#approvals.withdraw(approval.approvalId, "代理已不存在");
        return;
      }
      const reapplied = applyAgentEvent(live.record, event, nextEventSeq(live.record), now);
      if (!reapplied.applied) return;
      const updated = attachPermissionApproval(reapplied.record, approval.approvalId);
      live.record = updated;
      live.permissions.set(event.requestKey, {
        approvalId: approval.approvalId,
        replyToken: event.replyToken,
        toolName: event.toolName,
        input: event.input,
        ...(event.allowOptionId ? { allowOptionId: event.allowOptionId } : {}),
        ...(event.denyOptionId ? { denyOptionId: event.denyOptionId } : {}),
        resolved: false,
      });
      await writeRecord(this.#storage, updated);
      this.#emit(updated);
      void this.#awaitPermissionApproval(live, event.requestKey);
      return;
    }

    const now = this.#now();
    const reduced = applyAgentEvent(live.record, event, nextEventSeq(live.record), now);
    if (!reduced.applied) return;
    live.record = reduced.record;
    await writeRecord(this.#storage, reduced.record);
    this.#emit(reduced.record);
  }

  async #awaitPermissionApproval(live: LiveSession, requestKey: string): Promise<void> {
    const tracked = live.permissions.get(requestKey);
    if (!tracked || tracked.resolved) return;
    let resolution;
    try {
      resolution = await this.#approvals.waitForDecision(tracked.approvalId, {
        signal: live.abort.signal,
      });
    } catch {
      return;
    }
    if (tracked.resolved) return;
    tracked.resolved = true;
    const allow = resolution.outcome === "approved";
    // 先把決定寫進紀錄再回覆代理：代理收到拒絕後可能立刻結束，若先回覆，
    // 「權限請求被拒絕」的狀態會被完成事件蓋掉，客戶端就看不到這次拒絕。
    const current = live.record;
    if (current.pendingPermission?.approvalId === tracked.approvalId) {
      const updated = clearPermission(current);
      live.record = {
        ...updated,
        message: allow ? current.message : `權限請求被拒絕：${tracked.toolName}`,
        updatedAt: this.#now().toISOString(),
        lastEventSeq: current.lastEventSeq + 1,
      };
      await writeRecord(this.#storage, live.record);
      this.#emit(live.record);
    }
    const child = live.child;
    if (child?.running) {
      const message =
        resolution.outcome === "denied"
          ? "使用者拒絕了這個動作"
          : resolution.outcome === "expired"
            ? "審批逾時"
            : "審批已撤回";
      const reply =
        live.record.agentKind === "opencode"
          ? encodeAcpPermissionReply(
              tracked.replyToken,
              allow
                ? (tracked.allowOptionId ?? "allow_once")
                : (tracked.denyOptionId ?? "reject_once"),
            )
          : encodeClaudePermissionReply(tracked.replyToken, allow ? "allow" : "deny", {
              ...(allow ? { updatedInput: tracked.input as JsonValue } : { message }),
            });
      child.write(reply);
    }
    live.permissions.delete(requestKey);
  }

  async #onExit(
    live: LiveSession,
    exit: { code: number | null; signal: NodeJS.Signals | null },
  ): Promise<void> {
    const agentSessionId = live.record.agentSessionId;
    await this.#withdrawPending(agentSessionId, live.record, "代理行程已結束");
    live.abort.abort();
    live.child = null;
    const current = live.record;
    if (!live.stopping && !isTerminalAgentStatus(current.status)) {
      const tail = live.stderrTail.slice(-3).join(" ");
      const detail = tail.length > 0 ? `：${tail}` : "";
      const updated: ExternalAgentSessionRecord = {
        ...current,
        status: "failed",
        message: `代理行程結束（code ${exit.code ?? "null"}，signal ${exit.signal ?? "null"}），結果未知${detail}`,
        pendingPermission: null,
        resultUnknown: true,
        child: undefined,
        updatedAt: this.#now().toISOString(),
        lastEventSeq: current.lastEventSeq + 1,
      };
      live.record = updated;
      await writeRecord(this.#storage, updated);
      this.#emit(updated);
    } else if (current.child) {
      // 狀態已經是終態或正在停止；只把紀錄上的 child 欄位清掉就好，
      // 不要再發一次狀態事件給客戶端。
      const updated: ExternalAgentSessionRecord = {
        ...current,
        child: undefined,
        updatedAt: this.#now().toISOString(),
      };
      live.record = updated;
      await writeRecord(this.#storage, updated);
    }
    if (isTerminalAgentStatus(live.record.status)) {
      this.#live.delete(agentSessionId);
    }
    await removeScratch(this.#storage, agentSessionId);
  }

  /**
   * 完成／失敗事件的收尾。
   *
   * 真的 ACP 代理一輪結束之後不會自己退出，所以這裡一定要把行程終止：
   * 先送 cancel／interrupt，再關 stdin，然後 SIGTERM，最後 SIGKILL。
   * 暫存要在終態寫出之前清乾淨，客戶端看到 completed 的時候，
   * `tmp/agents` 就已經是空的了。
   */
  async #finishSession(live: LiveSession, event: NormalizedAgentEvent): Promise<void> {
    if (live.termination) return live.termination;
    if (live.stopping) return;
    live.stopping = true;
    const agentSessionId = live.record.agentSessionId;
    const task = (async () => {
      await this.#withdrawPending(agentSessionId, live.record, "代理已結束");
      await this.#terminateChild(live);
      // #terminateChild 已經等過（且有上限）；這裡再等是為了 child 一開始就是
      // null 的邊際情況。用同一個有上限的 helper，避免無界卡住收尾。
      await this.#awaitExitTask(live);
      await removeScratch(this.#storage, agentSessionId);
      // 行程已經結束，安全地套用完成／失敗事件。
      const current = live.record;
      if (isTerminalAgentStatus(current.status)) return;
      const reduced = applyAgentEvent(current, event, nextEventSeq(current), this.#now());
      if (!reduced.applied) return;
      live.record = reduced.record;
      await writeRecord(this.#storage, reduced.record);
      this.#emit(reduced.record);
    })();
    live.termination = task;
    try {
      await task;
    } finally {
      live.termination = null;
    }
  }

  /**
   * 終止還活著的 child：趁 stdin 還開著先送 cancel／interrupt，
   * 再關 stdin（讓配合的代理自己退出），然後 SIGTERM，最後 SIGKILL。
   */
  async #terminateChild(live: LiveSession): Promise<void> {
    const child = live.child;
    if (!child) return;

    // cancel／interrupt 必須趁 stdin 還開著先送；等資料沖進管線後才關 stdin，
    // 代理才會先讀到 cancel 才看到 EOF。配合的代理收到就自己結束；
    // 不配合的（例如 complete-stubborn）被動等到下面的信號。
    let cancel: string | null = null;
    if (live.record.agentKind === "opencode" && live.acpSessionId) {
      cancel = encodeAcpCancel(live.acpSessionId);
    } else if (live.record.agentKind === "claude-code") {
      cancel = encodeClaudeInterrupt(`interrupt-${Date.now()}`);
    }
    await child.writeThenCloseInput(cancel);
    if (await this.#waitForExit(child, this.#cancelGraceMs)) {
      await this.#awaitExitTask(live);
      return;
    }

    child.signal("SIGTERM");
    if (await this.#waitForExit(child, this.#termGraceMs)) {
      await this.#awaitExitTask(live);
      return;
    }

    child.signal("SIGKILL");
    if (!(await this.#waitForExit(child, this.#killGraceMs))) {
      this.#deps.logger?.warn(
        `代理 ${live.record.agentSessionId} 的行程 ${child.pid} SIGKILL 後仍未結束`,
      );
    }
    await this.#awaitExitTask(live);
  }

  /**
   * 等 `#onExit` 的收尾完成，但有上限。
   *
   * `live.exitTask` 是 `child.exited.then(#onExit)`；行程若真的殺不掉，
   * `child.exited` 永遠不 resolve，這裡就會無限期卡住 stop/shutdown。
   * 逾時時記診斷後放棄等待，讓收尾繼續往下走。
   */
  async #awaitExitTask(live: LiveSession): Promise<void> {
    const task = live.exitTask;
    if (!task) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.#exitTaskTimeoutMs);
      timer.unref?.();
    });
    try {
      const result = await Promise.race([
        task.then(
          () => "done" as const,
          (error: unknown) => {
            this.#deps.logger?.warn(
              `等待代理行程結束時發生錯誤：${error instanceof Error ? error.message : String(error)}`,
            );
            return "error" as const;
          },
        ),
        timeout,
      ]);
      if (result === "timeout") {
        this.#deps.logger?.warn(
          `等待代理 ${live.record.agentSessionId} 的行程結束超過 ${this.#exitTaskTimeoutMs}ms，繼續收尾`,
        );
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      // 不再等待這個 promise；就算它還沒完成，也不該讓後面的收尾卡住。
      live.exitTask = null;
    }
  }

  /** 等 `child` 結束；時間到還沒結束就回 `false`。 */
  #waitForExit(child: ManagedChild, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (!child.running) {
        resolve(true);
        return;
      }
      let settled = false;
      const finish = (done: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(done);
      };
      const timer = setTimeout(() => finish(false), ms);
      timer.unref?.();
      child.exited.then(() => finish(true));
    });
  }

  /**
   * 終止上次強制結束留下的行程。
   *
   * 先比對 PID、行程群組和啟動時間；任一個對不上就是 PID 重用或已經不存在，
   * 這時視為已結束（身分對不上就不該再動它）。
   *
   * @returns true 表示行程已確認結束（或身分已不存在），呼叫端可以清 child 身分；
   *          false 表示送了訊號但沒能確認結束，應保留 child 身分讓下次再認。
   */
  async #terminateRecordedChild(
    child: ExternalAgentChildProcess,
    budgetMs = this.#startupCleanupBudgetMs,
  ): Promise<boolean> {
    if ((await this.#recordedChildState(child)) !== "same") return true;

    const deadline = Date.now() + budgetMs;
    const remaining = () => Math.max(0, deadline - Date.now());
    // SIGTERM 最多用一半預算（且不超過 termGrace），留時間給 SIGKILL。
    // 不理 SIGTERM 的孤兒不能把全部預算吃掉，導致 SIGKILL 沒機會送。
    const termWait = Math.min(remaining(), this.#termGraceMs, Math.floor(budgetMs / 2));

    this.#signalGroup(child.processGroupId, "SIGTERM");
    if (await this.#waitForRecordedChild(child, termWait)) return true;

    // 總預算已經用完：不要再送 SIGKILL 空等，保留身分讓下次啟動再試。
    if (remaining() <= 0) {
      this.#deps.logger?.warn(`無法結束舊行程 ${child.pid}：清理預算用盡`);
      return false;
    }

    this.#signalGroup(child.processGroupId, "SIGKILL");
    if (await this.#waitForRecordedChild(child, remaining())) return true;

    this.#deps.logger?.warn(`無法結束舊行程 ${child.pid}`);
    return false;
  }

  async #waitForRecordedChild(child: ExternalAgentChildProcess, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const state = await this.#recordedChildState(child);
      if (state !== "same") return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    return (await this.#recordedChildState(child)) !== "same";
  }

  /**
   * 分辨「同一個行程」「已經不存在」「讀不出來」。
   * 讀不出身分時一律當成同一個行程處理，呼叫端才能決定要不要殺。
   */
  async #recordedChildState(child: ExternalAgentChildProcess): Promise<"gone" | "same"> {
    try {
      process.kill(child.pid, 0);
    } catch (error) {
      // ESRCH = PID 不在了；EPERM = 不屬於我們的行程，可以當成別人的。
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ESRCH" || code === "EPERM" ? "gone" : "same";
    }
    const current = await describeProcess(child.pid);
    if (current === null) return "same";
    return current.processGroupId === child.processGroupId && current.startedAt === child.startedAt
      ? "same"
      : "gone";
  }

  #signalGroup(processGroupId: number, signal: NodeJS.Signals): void {
    try {
      process.kill(-processGroupId, signal);
      return;
    } catch {
      // 沒有群組時退回單一 pid。
    }
    try {
      process.kill(Math.abs(processGroupId), signal);
    } catch {
      // 已經結束。
    }
  }

  async #withdrawPending(
    agentSessionId: string,
    record: ExternalAgentSessionRecord,
    reason: string,
  ): Promise<void> {
    if (record.startApprovalId) {
      await this.#approvals.withdraw(record.startApprovalId, reason);
    }
    if (record.pendingPermission?.approvalId) {
      await this.#approvals.withdraw(record.pendingPermission.approvalId, reason);
    }
    const live = this.#live.get(agentSessionId);
    if (live) {
      for (const tracked of live.permissions.values()) {
        await this.#approvals.withdraw(tracked.approvalId, reason);
        tracked.resolved = true;
      }
      live.permissions.clear();
    }
  }

  // ---- 小工具 -----------------------------------------------------------

  /** Claude Code 的例外只在它自己的種類上放行；其餘代理拿不到。 */
  #extraWritableDirs(kind: ExternalAgentKind, agentSessionId: string): readonly string[] {
    const scratch = scratchDir(this.#storage, agentSessionId);
    if (kind === "opencode") return [scratch];
    // spike 實測確認：Claude Code 即使設了 CLAUDE_CONFIG_DIR 也無法使用既有登入，
    // 因此 narrow 放行這幾個固定寫入目錄，其他路徑仍被 sandbox 拒絕。
    const home = this.#deps.homeDir;
    if (!home) return [scratch];
    return [
      scratch,
      join(home, ".claude", "projects"),
      join(home, ".claude", "backups"),
      join(home, ".claude", "plugins"),
      join(home, "Library", "Caches", "claude-cli-nodejs"),
    ];
  }

  #label(kind: ExternalAgentKind): string {
    return kind === "opencode" ? "OpenCode" : "Claude Code";
  }

  #emit(record: ExternalAgentSessionRecord): void {
    // 進入終態的 session 通常不必再留在 #live：耐久紀錄已寫入，list()、stop()
    // 都會讀磁碟。emit 是所有終態寫入的共同出口，在這裡清理不會漏掉任何路徑。
    //
    // 但行程可能還活著（SIGKILL 後沒結束、exitTask 逾時），這時必須保留 live，
    // 否則 stop()／pauseAll() 找不到 child 就補殺不了。只有 child 不存在或已
    // 確認結束才刪。卡住的行程會一直留在 #live——這是刻意的：放掉它就等於放棄
    // 追蹤一條還在跑的行程；下次開機 startupCleanup 會從磁碟重新認出並收拾它，
    // 所以單一進程生命週期內的累積上限就是「同時殺不掉的行程數」。
    const live = this.#live.get(record.agentSessionId);
    if (
      isTerminalAgentStatus(record.status) &&
      live &&
      live.record.status === record.status &&
      (!live.child || !live.child.running)
    ) {
      this.#live.delete(record.agentSessionId);
    }
    const pendingPermission = projectPendingPermission(record);
    this.#deps.emitState({
      agentSessionId: record.agentSessionId,
      agentKind: record.agentKind,
      status: record.status,
      ...(record.progress ? { progress: record.progress } : {}),
      ...(record.message ? { message: record.message } : {}),
      ...(record.resultUnknown ? { resultUnknown: true } : {}),
      ...(pendingPermission ? { pendingPermission } : {}),
    });
  }

  #now(): Date {
    return this.#deps.now ? this.#deps.now() : new Date();
  }
}
