/**
 * 外部代理橋接服務：啟動、審批、進度、停止、重啟接手與用量統計。
 *
 * 這是 Cardiary 與 OpenCode／Claude Code 之間唯一的橋：代理自己跑在獨立行程，
 * Cardiary 攔不到它自己的工具呼叫，只能在對方主動問的時候把問題送進原生審批
 * 佇列。所有子行程都經 `SpawnRegistry` + `sandbox-exec` 啟動；沙盒不可用時
 * 一律拒絕啟動（fail closed）。
 */
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
  type ExternalAgentKind,
  type ExternalAgentSessionRecord,
  type ExternalAgentStatus,
  type NormalizedAgentEvent,
} from "@cardiary/domain";
import type { JsonValue } from "@cardiary/engine-adapter";
import type { CardiaryPaths } from "@cardiary/module-api";

import { prefixed } from "../../ids.js";
import { createCommandSandbox } from "../../permissions/sandbox.js";
import type { ManagedChild, SpawnRegistry } from "../../spawn/wrapper.js";
import type { AgentApprovalsService } from "../contract.js";
import {
  agentStoragePaths,
  clearScratch,
  computeUsage,
  ensureSessionDirs,
  homeDir,
  isProtectedWorkingDirectory,
  listNonTerminal,
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

/** `module.external-agents.state` 事件的 `data`。 */
export interface ExternalAgentStateData {
  readonly agentSessionId: string;
  readonly agentKind: ExternalAgentKind;
  readonly status: ExternalAgentStatus;
  readonly progress?: ExternalAgentSessionRecord["progress"];
  readonly message?: string;
  readonly resultUnknown?: boolean;
  readonly pendingPermission?: {
    readonly approvalId: string;
    readonly toolName: string;
    readonly description?: string;
  };
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
  readonly pendingPermission?: { approvalId: string; toolName: string; description?: string };
}

export interface StartAgentInput {
  readonly agentKind: ExternalAgentKind;
  readonly workingDirectory: string;
  readonly prompt?: string;
  readonly clientRequestId?: string;
}

export interface StartAgentResult {
  readonly agentSessionId: string;
  readonly approvalId: string;
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
}

interface TrackedPermission {
  readonly approvalId: string;
  readonly replyToken: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  resolved: boolean;
}

interface LiveSession {
  record: ExternalAgentSessionRecord;
  child: ManagedChild | null;
  acpSessionId: string | null;
  permissionPromptSent: boolean;
  stopping: boolean;
  readonly abort: AbortController;
  readonly permissions: Map<string, TrackedPermission>;
  readonly stderrTail: string[];
}

/** 預設用不帶登入的免費模型；環境變數可覆寫。 */
const DEFAULT_OPENCODE_MODEL = "opencode/iceman-free";

export class ExternalAgentsService {
  readonly #deps: ExternalAgentsDeps;
  readonly #storage: AgentStoragePaths;
  readonly #approvals: AgentApprovalsService;
  readonly #live = new Map<string, LiveSession>();

  constructor(deps: ExternalAgentsDeps) {
    this.#deps = deps;
    this.#storage = agentStoragePaths(deps.paths);
    this.#approvals = deps.approvals;
  }

  /** 服務啟動時：清暫存、把懸空 session 標結果未知、清 30 天快取。 */
  async startupCleanup(): Promise<{ orphaned: number; purged: number }> {
    await clearScratch(this.#storage);
    const orphans = await listNonTerminal(this.#storage);
    for (const record of orphans) {
      if (record.startApprovalId) {
        await this.#approvals.withdraw(record.startApprovalId, "主機重新啟動");
      }
      if (record.pendingPermission?.approvalId) {
        await this.#approvals.withdraw(record.pendingPermission.approvalId, "代理已不存在");
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
        return {
          agentSessionId: existing.agentSessionId,
          approvalId: existing.startApprovalId ?? "",
        };
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
      acpSessionId: null,
      permissionPromptSent: false,
      stopping: false,
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
    if (isTerminalAgentStatus(current.status)) {
      return { agentSessionId, stopped: false };
    }
    if (live) live.stopping = true;
    await this.#withdrawPending(agentSessionId, current, "代理已停止");
    live?.abort.abort();
    const child = live?.child ?? null;
    if (child && child.running) {
      if (current.agentKind === "opencode" && live?.acpSessionId) {
        child.write(encodeAcpCancel(live.acpSessionId));
      } else if (current.agentKind === "claude-code") {
        child.write(encodeClaudeInterrupt(`interrupt-${Date.now()}`));
      }
      child.signal("SIGTERM");
      const killer = setTimeout(() => {
        if (child.running) child.signal("SIGKILL");
      }, 3_000);
      killer.unref?.();
    }
    const updated = markStopped(current, "使用者停止", this.#now());
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
      .map((record) => ({
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
        ...(record.pendingPermission && record.pendingPermission.approvalId !== ""
          ? {
              pendingPermission: {
                approvalId: record.pendingPermission.approvalId,
                toolName: record.pendingPermission.toolName,
                ...(record.pendingPermission.description === undefined
                  ? {}
                  : { description: record.pendingPermission.description }),
              },
            }
          : {}),
      }));
  }

  /** `module.external-agents.usage` 的資料來源；含資料夾外的 Claude 固定目錄。 */
  async usage(): Promise<Awaited<ReturnType<typeof computeUsage>>> {
    return computeUsage(this.#storage);
  }

  /** 緊急全部暫停：撤回等待中的審批並中止代理，避免核准後才冒出新行程。 */
  async pauseAll(reason: string): Promise<void> {
    for (const [agentSessionId, live] of this.#live) {
      if (isTerminalAgentStatus(live.record.status)) continue;
      // 先記下「還沒生出行程」，撤回審批時等待中的啟動流程可能同步改寫紀錄。
      const waitedOnly = live.record.status === "waiting-approval" && live.child === null;
      live.stopping = true;
      live.abort.abort();
      await this.#withdrawPending(agentSessionId, live.record, reason);
      if (live.child?.running) {
        live.child.signal("SIGTERM");
        const killer = setTimeout(() => {
          if (live.child?.running) live.child.signal("SIGKILL");
        }, 3_000);
        killer.unref?.();
      }
      const updated = waitedOnly
        ? markStopped(live.record, `緊急暫停：代理沒有啟動（${reason}）`, this.#now())
        : markUnknownAfterRestart(live.record, this.#now());
      live.record = updated;
      await writeRecord(this.#storage, updated);
      this.#emit(updated);
    }
    await clearScratch(this.#storage);
  }

  /** 主機關閉：中斷還活著的行程、撤回審批、把結果標成未知。 */
  async shutdown(): Promise<void> {
    for (const [agentSessionId, live] of this.#live) {
      if (isTerminalAgentStatus(live.record.status)) continue;
      live.stopping = true;
      live.abort.abort();
      await this.#withdrawPending(agentSessionId, live.record, "主機關閉");
      if (live.child?.running) live.child.signal("SIGTERM");
      const updated = markUnknownAfterRestart(live.record, this.#now());
      live.record = updated;
      await writeRecord(this.#storage, updated);
      this.#emit(updated);
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
    if (child.stdout) this.#consumeLines(child.stdout, (line) => void this.#onLine(live, line));
    if (child.stderr) {
      this.#consumeLines(child.stderr, (line) => {
        live.stderrTail.push(line.slice(-500));
        if (live.stderrTail.length > 20) live.stderrTail.shift();
      });
    }
    void child.exited.then((exit) => void this.#onExit(live, exit));

    if (record.agentKind === "opencode") {
      child.write(encodeAcpInitialize());
    } else {
      child.write(encodeClaudeInitialize());
      if (record.prompt) child.write(encodeClaudeUser(record.prompt));
    }
    const updated: ExternalAgentSessionRecord = {
      ...record,
      status: "running",
      message: undefined,
      startApprovalId: undefined,
      updatedAt: this.#now().toISOString(),
      lastEventSeq: record.lastEventSeq + 1,
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

  // ---- 訊息與事件 -------------------------------------------------------

  async #onLine(live: LiveSession, line: string): Promise<void> {
    const kind = live.record.agentKind;
    let events: readonly NormalizedAgentEvent[] = [];
    if (kind === "opencode") {
      const frame = classifyAcpLine(line);
      if (frame.kind === "response") {
        this.#onAcpResponse(live, frame.frame.id, frame.frame.result ?? {}, line);
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

  #onAcpResponse(
    live: LiveSession,
    id: number | string,
    result: Record<string, unknown>,
    raw: string,
  ): void {
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
      if (model.length > 0) child.write(encodeAcpSetModel(model));
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
          void this.#applyEvent(live, { kind: "failed", message: "代理取消了這次任務" });
        }
        return;
      }
      void this.#applyEvent(live, {
        kind: "completed",
        message:
          stopReason === "end_turn" ? "代理完成任務" : `代理結束（${stopReason ?? "unknown"}）`,
      });
      return;
    }
    // session/set_config_option 的回應（包括失敗）不需要動作；模型選不到也能繼續跑。
  }

  async #applyEvent(live: LiveSession, event: NormalizedAgentEvent): Promise<void> {
    if (isTerminalAgentStatus(live.record.status)) return;
    const now = this.#now();
    const reduced = applyAgentEvent(live.record, event, nextEventSeq(live.record), now);
    if (!reduced.applied) return;
    let updated = reduced.record;
    if (event.kind === "permission") {
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
      updated = attachPermissionApproval(updated, approval.approvalId);
      live.permissions.set(event.requestKey, {
        approvalId: approval.approvalId,
        replyToken: event.replyToken,
        toolName: event.toolName,
        input: event.input,
        resolved: false,
      });
      void this.#awaitPermissionApproval(live, event.requestKey);
    }
    live.record = updated;
    await writeRecord(this.#storage, updated);
    this.#emit(updated);
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
          ? encodeAcpPermissionReply(tracked.replyToken, allow)
          : encodeClaudePermissionReply(tracked.replyToken, allow ? "allow" : "deny", {
              ...(allow ? { updatedInput: tracked.input as JsonValue } : { message }),
            });
      child.write(reply);
    }
    live.permissions.delete(requestKey);
  }

  #onExit(live: LiveSession, exit: { code: number | null; signal: NodeJS.Signals | null }): void {
    void (async () => {
      await this.#withdrawPending(live.record.agentSessionId, live.record, "代理行程已結束");
      live.abort.abort();
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
          updatedAt: this.#now().toISOString(),
          lastEventSeq: current.lastEventSeq + 1,
        };
        live.record = updated;
        await writeRecord(this.#storage, updated);
        this.#emit(updated);
      }
      await removeScratch(this.#storage, live.record.agentSessionId);
    })();
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
    this.#deps.emitState({
      agentSessionId: record.agentSessionId,
      agentKind: record.agentKind,
      status: record.status,
      ...(record.progress ? { progress: record.progress } : {}),
      ...(record.message ? { message: record.message } : {}),
      ...(record.resultUnknown ? { resultUnknown: true } : {}),
      ...(record.pendingPermission
        ? {
            pendingPermission: {
              approvalId: record.pendingPermission.approvalId,
              toolName: record.pendingPermission.toolName,
              ...(record.pendingPermission.description
                ? { description: record.pendingPermission.description }
                : {}),
            },
          }
        : {}),
    });
  }

  #now(): Date {
    return this.#deps.now ? this.#deps.now() : new Date();
  }
}
