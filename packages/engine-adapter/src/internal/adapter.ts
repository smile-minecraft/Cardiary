import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { LiveDoc, defineDocFamily, defineExtension, defineTool } from "@earendil-works/pi-durable";
import type {
  Conversation,
  EntryRecord,
  SettledSubmissionRecord,
  Submission,
  SubmissionRecord,
  Tx,
} from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

import type { ApprovalRequest, ApprovalService, ApprovalResolution } from "../approval.js";
import type {
  CancelTurnRequest,
  CompletedTurnStatus,
  ContentBlock,
  ConversationHistoryPage,
  ConversationMessage,
  ConversationSummary,
  ConversationUpdate,
  CreateConversationRequest,
  DeleteConversationOptions,
  ForkConversationRequest,
  MessageReceipt,
  ReadConversationHistoryRequest,
  RestoreConversationResult,
  SendMessageRequest,
  TurnRecovery,
} from "../conversation.js";
import type {
  DeletionIntent,
  EmergencyPause,
  EngineAdapter,
  EngineAdapterOptions,
  EngineDescriptor,
  EngineState,
  EngineStatus,
} from "../engine.js";
import type { EngineSubscription, SubscribeOptions } from "../events.js";
import type { EngineErrorInfo } from "../errors.js";
import type { ConversationId, ToolBundleId, ToolCallId, ToolName, TurnId } from "../ids.js";
import type { JsonValue } from "../json.js";
import type { ModelSettings } from "../model.js";
import type { ToolPermissionVerdict } from "../permission.js";
import type { Clock, Unsubscribe } from "../runtime.js";
import type {
  NextTurnInjectionReceipt,
  NextTurnInjectionRequest,
  SpawnSubagentRequest,
  SubagentHandle,
  SubagentLimits,
  SubagentOutcome,
  SubagentResultCard,
} from "../subagent.js";
import type {
  ReplaySafety,
  ToolBundle,
  ToolBundleState,
  ToolDiagnostic,
  ToolOutcome,
  ToolProgress,
  ToolRegistry,
} from "../tools.js";
import { ApprovalServiceImpl } from "./approval-service.js";
import { BundleIndex, type RegisteredBundle } from "./bundle-index.js";
import type { ActiveTurn, CatalogSnapshot, ConversationMeta } from "./catalog.js";
import { CatalogDoc, emptyCatalog } from "./catalog.js";
import { compactAfterDelete, deleteEngineSubtree, listConversationSubtree } from "./delete.js";
import { EngineAdapterFailure, engineError } from "./errors.js";
import { EventBus } from "./event-bus.js";
import { convertModelContent, convertToolContent } from "./media/content.js";
import { classifyModelFailure, modelFailureInfo } from "./model/failure.js";
import { EngineSession, createEngineRegistry } from "./session.js";
import { ProcessSupervisor } from "./spawn.js";

/** 每個 `clientRequestId` 的正向索引；key 是請求識別碼，值是對話識別碼。 */
const ClientRequestIndex = defineDocFamily<{ conversationId: string }, string>({
  family: true,
  scope: "session",
  kind: "cardiary.clientRequest",
  version: 1,
  initial: (seed) => ({ conversationId: seed }),
  checkpointWhen: () => false,
});

/** 預設的子代理上限；產品固定值。 */
const DEFAULT_SUBAGENT_LIMITS: SubagentLimits = {
  maxConcurrentPerParent: 4,
  maxDepth: 1,
  resultTokenBudget: 800,
};

const DEFAULT_EVENT_BUFFER = 256;

/** 工具結果交給引擎的內容區塊；形狀與 pi-ai 的 ToolResultMessage 一致。 */
type ToolOutputBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

/** 轉接層的實作；對外只透過 `EngineAdapter` 介面。 */
export class PiEngineAdapter implements EngineAdapter {
  readonly tools: ToolRegistry;
  readonly approvals: ApprovalService;

  readonly #options: EngineAdapterOptions;
  readonly #clock: Clock;
  readonly #limits: SubagentLimits;
  readonly #bus: EventBus;
  readonly #bundles = new BundleIndex();
  readonly #approvals: ApprovalServiceImpl;
  readonly #supervisor: ProcessSupervisor;
  readonly #session: EngineSession;
  readonly #engineRegistry: ReturnType<typeof createEngineRegistry>;
  readonly #registry = new Map<string, ReturnType<typeof defineExtension>>();
  #state: EngineState = "starting";
  #pause: EmergencyPause | null = null;
  #descriptor: EngineDescriptor | null = null;
  #modelsHandle: unknown = null;
  #modelSettings: ModelSettings | null = null;
  readonly #activeTurns = new Map<ConversationId, ActiveTurn>();
  readonly #subagentStatuses = new Map<ConversationId, SubagentHandle["status"]>();
  readonly #announcedApprovals = new Set<string>();
  /** 工具呼叫的執行結果；`tool.finished` 的 `ok` 從這裡來。 */
  readonly #toolOutcomes = new Map<ToolCallId, boolean>();
  /**
   * 被中斷的回合。
   *
   * 引擎的 submission 在 abort 之後仍可能以 `done` 結束；不記下來的話
   * `turn.completed` 會把中斷的回合說成完成。這一組只在行程內有效，
   * 重啟後的恢復走 `restoreConversation` 的回報。
   */
  readonly #interruptedTurns = new Set<TurnId>();
  /**
   * 工具結果的內容與給介面用的資料。
   *
   * 引擎只持久化模型看得到的文字；`metadata` 不進引擎的紀錄，但 `tool.finished`
   * 事件要把它交給主機產生介面資料，所以執行時先留在記憶體（上限同 outcomes）。
   */
  readonly #toolResults = new Map<
    ToolCallId,
    { readonly text: string; readonly metadata?: JsonValue }
  >();
  readonly #statusListeners = new Set<(status: EngineStatus) => void>();

  constructor(options: EngineAdapterOptions) {
    this.#options = options;
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#limits = options.subagentLimits ?? DEFAULT_SUBAGENT_LIMITS;
    this.#bus = new EventBus({ bufferSize: options.eventBufferSize ?? DEFAULT_EVENT_BUFFER });
    this.#approvals = new ApprovalServiceImpl({
      ledger: options.approvals,
      clock: this.#clock,
    });
    this.approvals = this.#approvals;
    this.#supervisor = new ProcessSupervisor({
      tempDir: options.environment.tempDir,
      ...(options.environment.homeDir === undefined
        ? {}
        : { homeDir: options.environment.homeDir }),
    });
    this.#engineRegistry = createEngineRegistry();
    this.#session = new EngineSession({
      environment: options.environment,
      registry: this.#engineRegistry,
      models: () => this.#currentModels(),
    });
    this.tools = this.#createToolRegistry();
  }

  // ── 生命週期 ───────────────────────────────────────────────────────────

  async open(): Promise<EngineDescriptor> {
    if (this.#descriptor !== null && this.#session.isOpen) {
      return this.#descriptor;
    }
    this.#state = "starting";
    await mkdir(resolve(this.#options.environment.tempDir), { recursive: true });
    await mkdir(resolve(this.#options.environment.defaultWorkingDir), { recursive: true });
    // 建立 Harness 之前先完成未結束的刪除意圖；那條路徑只開引擎的連線。
    await this.#recoverDeletionIntents();
    await this.#openHarness(false);
    this.#descriptor = {
      name: "pi-durable",
      version: "1.5.2",
      storageBackend: "sqlite",
      capabilities: { nextTurnContextInjection: "pending" },
    };
    this.#state = "running";
    this.#emitStatus();
    return this.#descriptor;
  }

  async suspend(): Promise<void> {
    if (!this.#session.isOpen) {
      return;
    }
    this.#state = "paused";
    this.#emitStatus();
    await this.#supervisor.terminateAll();
    await this.#session.close();
  }

  async resume(): Promise<void> {
    if (this.#session.isOpen) {
      this.#state = "running";
      this.#emitStatus();
      return;
    }
    this.#state = "starting";
    await this.#openHarness(true);
    this.#state = this.#pause === null ? "running" : "paused";
    this.#emitStatus();
  }

  async close(): Promise<void> {
    this.#state = "stopped";
    this.#emitStatus();
    await this.#supervisor.terminateAll();
    await this.#session.close();
    if (this.#modelsHandle !== null && this.#options.models !== undefined) {
      await this.#options.models.close(this.#modelsHandle);
      this.#modelsHandle = null;
    }
  }

  getStatus(): EngineStatus {
    const catalog = this.#catalogCache;
    return {
      state: this.#state,
      pause: this.#pause,
      activeConversations: catalog === null ? 0 : Object.keys(catalog.conversations).length,
      activeSubagents: this.#subagentStatuses.size,
      pendingApprovals: 0,
      environment: {
        stateDir: resolve(this.#options.environment.stateDir),
        tempDir: resolve(this.#options.environment.tempDir),
      },
    };
  }

  onStatusChange(listener: (status: EngineStatus) => void): Unsubscribe {
    this.#statusListeners.add(listener);
    return () => {
      this.#statusListeners.delete(listener);
    };
  }

  /**
   * 開儲存與 Harness。
   *
   * `open()` 只載入狀態、不啟動排程：宿主必須先註冊對話釘選的工具組版本並
   * 設定模型，`restoreConversation()` 或 `resume()` 才呼叫引擎的 `resume()`。
   * 否則中斷的工具會在擴充還沒安裝時重跑，直接得到 `tool-unavailable`。
   */
  async #openHarness(resume: boolean): Promise<void> {
    await this.#session.open();
    // 重新註冊所有工具組 generation；registry 是新的，擴充要以名稱重新安裝。
    for (const bundle of this.#bundles.list()) {
      const registered = this.#bundles.get(bundle.bundleId, bundle.generation);
      if (registered !== undefined) {
        this.#installExtension(registered);
      }
    }
    if (resume) {
      this.#session.harness.resume();
    }
  }

  #emitStatus(): void {
    const status = this.getStatus();
    for (const listener of [...this.#statusListeners]) {
      try {
        listener(status);
      } catch {
        // 監聽者的錯誤不影響引擎。
      }
    }
  }

  // ── 模型 ───────────────────────────────────────────────────────────────

  #currentModels(): unknown {
    if (this.#modelsHandle === null && this.#options.models !== undefined) {
      // 尚未呼叫 configureModels 時用空設定開一次，讓 Harness 有模型集合。
      void this.#ensureModels();
    }
    return this.#modelsHandle;
  }

  async #ensureModels(): Promise<unknown> {
    if (this.#modelsHandle !== null) {
      return this.#modelsHandle;
    }
    if (this.#options.models === undefined) {
      return null;
    }
    this.#modelsHandle = await this.#options.models.open(
      this.#modelSettings ?? { providers: [], roles: emptyRoles() },
    );
    return this.#modelsHandle;
  }

  async configureModels(settings: ModelSettings): Promise<void> {
    this.#modelSettings = settings;
    if (this.#options.models === undefined) {
      throw engineError("model-unavailable", "宿主沒有提供模型來源");
    }
    const previous = this.#modelsHandle;
    this.#modelsHandle = await this.#options.models.open(settings);
    if (previous !== null) {
      await this.#options.models.close(previous);
    }
  }

  async getModelSettings(): Promise<ModelSettings> {
    return this.#modelSettings ?? { providers: [], roles: emptyRoles() };
  }

  /**
   * 對話主模型宣告的輸入能力。
   *
   * 以對話建立時固定的模型為準；查不到設定時回空陣列，媒體區塊一律退回
   * 文字替身，不猜測模型能不能收。
   */
  async #modelInputFor(
    conversationId: ConversationId,
  ): Promise<readonly ("text" | "image" | "audio")[]> {
    const meta = (await this.#catalog()).conversations[conversationId];
    const settings = this.#modelSettings;
    if (meta === undefined || settings === null) {
      return [];
    }
    const provider = settings.providers.find((entry) => entry.provider === meta.model.provider);
    const model = provider?.models.find((entry) => entry.id === meta.model.model);
    return model?.input ?? [];
  }

  // ── 工具組 ─────────────────────────────────────────────────────────────

  #createToolRegistry(): ToolRegistry {
    return {
      register: async (bundle: ToolBundle): Promise<void> => {
        this.#bundles.register({
          retired: false,
          bundleId: bundle.bundleId,
          generation: bundle.generation,
          label: bundle.label,
          tools: bundle.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            replay: tool.replay,
            execute: tool.execute,
          })),
        });
        const registered = this.#bundles.get(bundle.bundleId, bundle.generation);
        if (registered !== undefined) {
          this.#installExtension(registered);
        }
      },
      retire: async (bundleId: ToolBundleId, generation: number): Promise<void> => {
        this.#bundles.retire(bundleId, generation);
      },
      list: async (): Promise<readonly ToolBundleState[]> => this.#bundles.list(),
    };
  }

  /** 取消退役；重新啟用同一個版本時由模組主機呼叫。 */
  async reviveBundle(bundleId: ToolBundleId, generation: number): Promise<void> {
    this.#bundles.revive(bundleId, generation);
  }

  #extensionObjects(
    pins: readonly { readonly bundleId: ToolBundleId; readonly generation: number }[],
  ): ReturnType<typeof defineExtension>[] {
    return pins.map((pin) => {
      const extension = this.#registry.get(this.#extensionName(pin.bundleId, pin.generation));
      if (extension === undefined) {
        throw engineError(
          "tool-not-registered",
          `工具組 ${pin.bundleId}@${pin.generation} 尚未註冊`,
        );
      }
      return extension;
    });
  }

  #extensionName(bundleId: ToolBundleId, generation: number): string {
    return `cardiary.${bundleId}#${generation}`;
  }

  #installExtension(bundle: RegisteredBundle): void {
    const name = this.#extensionName(bundle.bundleId, bundle.generation);
    const existing = this.#registry.get(name);
    const registry = this.#session.registry;
    if (existing !== undefined) {
      registry.uninstall(existing);
      this.#registry.delete(name);
    }
    const tools = bundle.tools.map((definition) =>
      defineTool({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters as object,
        replay: definition.replay,
        execute: async (args, api, context) =>
          (await this.#runToolAndRecord({
            conversationId: String(api.conversationId),
            callId: api.callId,
            toolName: definition.name,
            input: args as JsonValue,
            replay: definition.replay,
            context,
            reportProgress: (progress) => {
              if (progress.message !== undefined) {
                api.output(progress.message);
              }
              this.#bus.publish({
                kind: "tool.progress",
                at: this.#clock.now().toISOString(),
                conversationId: String(api.conversationId),
                turnId:
                  this.#activeTurns.get(String(api.conversationId))?.turnId ?? `turn_${api.callId}`,
                callId: api.callId,
                toolName: definition.name,
                progress,
              });
            },
          })) as never,
      }),
    );
    const extension = defineExtension({ name, tools });
    registry.install(extension);
    this.#registry.set(name, extension);
  }

  async #runToolAndRecord(input: {
    readonly conversationId: ConversationId;
    readonly callId: ToolCallId;
    readonly toolName: ToolName;
    readonly input: JsonValue;
    readonly replay: ReplaySafety;
    readonly context: Context;
    readonly reportProgress?: (progress: ToolProgress) => void;
  }): Promise<{
    output: ToolOutputBlock[];
    isError?: boolean;
    diagnostics?: readonly { code: string; message?: string }[];
    details?: JsonValue;
  }> {
    const result = await this.#executeTool(input);
    this.#recordToolOutcome(input.callId, result.isError !== true, {
      text: result.output
        .map((block) => (block.type === "text" ? block.text : `[image ${block.mimeType}]`))
        .join("\n"),
      ...(result.details === undefined ? {} : { metadata: result.details }),
    });
    return result;
  }

  #recordToolOutcome(
    callId: ToolCallId,
    ok: boolean,
    result: { readonly text: string; readonly metadata?: JsonValue },
  ): void {
    this.#toolOutcomes.set(callId, ok);
    this.#toolResults.set(callId, result);
    if (this.#toolOutcomes.size > 1000) {
      const oldest = this.#toolOutcomes.keys().next().value;
      if (oldest !== undefined) {
        this.#toolOutcomes.delete(oldest);
        this.#toolResults.delete(oldest);
      }
    }
  }

  async #executeTool(input: {
    readonly conversationId: ConversationId;
    readonly callId: ToolCallId;
    readonly toolName: ToolName;
    readonly input: JsonValue;
    readonly replay: ReplaySafety;
    readonly context: Context;
    readonly reportProgress?: (progress: ToolProgress) => void;
  }): Promise<{
    output: ToolOutputBlock[];
    isError?: boolean;
    diagnostics?: readonly { code: string; message?: string }[];
    details?: JsonValue;
  }> {
    const catalog = await this.#catalog();
    const meta = catalog.conversations[input.conversationId];
    if (meta === undefined) {
      return toolError("工具不可用：找不到對話", "tool-unavailable");
    }
    const turnId = await this.#turnIdForTool(input.conversationId, input.callId);
    const bundle = this.#bundles.resolve(input.toolName, meta.toolBundles);
    if (bundle === null) {
      return toolError(`工具 ${input.toolName} 目前不可用`, "tool-unavailable");
    }
    const definition = bundle.tools.find((tool) => tool.name === input.toolName);
    if (definition === undefined) {
      return toolError(`工具 ${input.toolName} 目前不可用`, "tool-unavailable");
    }

    let verdict: ToolPermissionVerdict;
    try {
      verdict = await this.#options.permissionGate.evaluate({
        conversationId: input.conversationId,
        turnId,
        toolCallId: input.callId,
        toolName: input.toolName,
        input: input.input,
        replay: input.replay,
        permissionMode: meta.permissionMode,
      });
    } catch (error) {
      return toolError(errorMessage(error), "permission-denied");
    }
    if (verdict.kind === "deny") {
      return toolError(verdict.reason, "permission-denied");
    }
    let approvalKey: string | null = null;
    if (verdict.kind === "ask-human") {
      let request: ApprovalRequest;
      try {
        request = await this.#approvals.request({
          conversationId: input.conversationId,
          turnId,
          toolCallId: input.callId,
          action: { ...verdict.action, toolName: input.toolName, toolInput: input.input },
          risk: verdict.risk,
          requestedBy: { kind: "tool", toolName: input.toolName },
          ...(meta.origin?.kind === "subagent"
            ? {
                subagent: {
                  parentConversationId: meta.origin.parentConversationId,
                  rootConversationId: meta.origin.rootConversationId,
                  depth: meta.origin.depth,
                  forkedAt: meta.origin.at,
                },
              }
            : {}),
          ...(verdict.timeoutMs === undefined ? {} : { timeoutMs: verdict.timeoutMs }),
        });
        approvalKey = request.approvalKey;
        if (request.status === "pending" && !this.#announcedApprovals.has(request.id)) {
          this.#announcedApprovals.add(request.id);
          this.#bus.publish({
            kind: "approval.requested",
            at: this.#clock.now().toISOString(),
            conversationId: input.conversationId,
            request,
          });
        }
      } catch (error) {
        return toolError(errorMessage(error), "approval-expired");
      }
      const resolution = await this.#approvals.waitForDecision(request.id, {
        ...(input.context.abortSignal === undefined ? {} : { signal: input.context.abortSignal }),
      });
      this.#bus.publish({
        kind: "approval.resolved",
        at: this.#clock.now().toISOString(),
        conversationId: input.conversationId,
        resolution,
      });
      if (resolution.outcome !== "approved") {
        return toolError(
          resolution.outcome === "expired" ? "審批逾時" : "使用者拒絕這個動作",
          resolution.outcome === "expired" ? "approval-expired" : "approval-denied",
        );
      }
    }

    const callTempDir = join(resolve(this.#options.environment.tempDir), `tool-${input.callId}`);
    await mkdir(callTempDir, { recursive: true });
    const workingDir = resolve(this.#options.environment.defaultWorkingDir);
    await mkdir(workingDir, { recursive: true });
    const execute = definition.execute as (
      value: JsonValue,
      context: {
        conversationId: ConversationId;
        turnId: TurnId;
        callId: ToolCallId;
        toolName: ToolName;
        signal: AbortSignal;
        tempDir: string;
        workingDir: string;
        spawn: (spec: {
          command: string;
          args?: readonly string[];
          cwd?: string;
          env?: Readonly<Record<string, string>>;
          stdio?: "pipe" | "ignore";
        }) => import("./spawn.js").ManagedChild;
        requestApproval: (draft: never) => Promise<ApprovalResolution>;
        reportProgress?: (progress: ToolProgress) => void;
      },
    ) => Promise<ToolOutcome>;

    let outcome: ToolOutcome;
    try {
      outcome = await execute(input.input, {
        conversationId: input.conversationId,
        turnId,
        callId: input.callId,
        toolName: input.toolName,
        signal: input.context.abortSignal ?? new AbortController().signal,
        tempDir: callTempDir,
        workingDir,
        spawn: (spec: {
          command: string;
          args?: readonly string[];
          cwd?: string;
          env?: Readonly<Record<string, string>>;
          stdio?: "pipe" | "ignore";
        }) =>
          this.#supervisor.spawn({
            command: spec.command,
            args: spec.args ?? [],
            cwd: spec.cwd ?? resolve(this.#options.environment.defaultWorkingDir),
            stdio: spec.stdio ?? "pipe",
            ...(spec.env === undefined ? {} : { env: spec.env }),
          }),
        requestApproval: ((draft: never) =>
          this.#approvals
            .request({
              ...(draft as object),
              conversationId: input.conversationId,
              turnId,
              toolCallId: input.callId,
            } as never)
            .then((request) => this.#approvals.waitForDecision(request.id))) as never,
        ...(input.reportProgress === undefined ? {} : { reportProgress: input.reportProgress }),
      });
    } catch (error) {
      return toolError(errorMessage(error), "interrupted");
    }

    void approvalKey;
    if (!outcome.ok) {
      return {
        output: [{ type: "text" as const, text: outcome.message }],
        isError: true,
        ...(outcome.diagnostics === undefined ? {} : { diagnostics: outcome.diagnostics }),
        ...(outcome.metadata === undefined ? {} : { details: outcome.metadata as never }),
      };
    }
    const converted = await convertToolContent(outcome.content, {
      modelInput: await this.#modelInputFor(input.conversationId),
      ...(this.#options.media === undefined ? {} : { reader: this.#options.media }),
    });
    return {
      output: converted.content,
      isError: false,
      ...(outcome.diagnostics === undefined ? {} : { diagnostics: outcome.diagnostics }),
      ...(outcome.metadata === undefined ? {} : { details: outcome.metadata as never }),
    };
  }

  /**
   * 工具執行所屬的回合。
   *
   * 優先序：目前進行中的回合、對話目錄裡仍在跑的回合、最後才用工具呼叫 ID
   * 組一個備援值。重啟後工具重跑時，前兩者讓 `turnId` 和原本的回合一致，
   * `approval_key` 才不會變。
   */
  async #turnIdForTool(conversationId: ConversationId, callId: ToolCallId): Promise<TurnId> {
    const active = this.#activeTurns.get(conversationId);
    if (active !== undefined) {
      return active.turnId;
    }
    const catalog = await this.#catalog();
    const running = Object.values(catalog.turns).filter(
      (turn) => turn.status === "running" && turn.conversationId === conversationId,
    );
    return running.at(-1)?.turnId ?? `turn_${callId}`;
  }

  // ── 對話 ───────────────────────────────────────────────────────────────

  async getConversation(conversationId: ConversationId): Promise<ConversationSummary | null> {
    const catalog = await this.#catalog();
    const meta = catalog.conversations[conversationId];
    if (meta === undefined) {
      return null;
    }
    const conversation = await this.#session.harness.conversation(
      engineConversationId(conversationId),
      BACKGROUND_CONTEXT,
    );
    if (conversation === undefined) {
      return null;
    }
    return this.#summary(meta, conversation);
  }

  async createConversation(request: CreateConversationRequest): Promise<ConversationSummary> {
    this.#assertAcceptingWork();
    const clientRequestId = request.clientRequestId ?? null;
    if (clientRequestId !== null) {
      const existing = await this.findConversationByClientRequestId(clientRequestId);
      if (existing !== null) {
        return existing;
      }
    }
    this.#ensureBundlesRegistered(request.toolBundles);
    const harness = this.#session.harness;
    const createdAt = this.#clock.now().toISOString();
    const purpose = request.purpose ?? "conversation";
    const depth = 0 as const;
    const conversation = await harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: { provider: request.model.provider, modelId: request.model.model },
          extensions: this.#extensionObjects(request.toolBundles),
          instructions: request.systemContext,
        },
        init: async (tx, conversationId) => {
          const meta: ConversationMeta = {
            conversationId: String(conversationId),
            title: request.title ?? "新對話",
            purpose,
            permissionMode: request.permissionMode ?? "hard-rules",
            toolBundles: [...request.toolBundles],
            clientRequestId,
            origin: null,
            model: request.model,
            rootConversationId: String(conversationId),
            depth,
            visibility: "listed",
            createdAt,
            systemContext: request.systemContext,
            stagedUpdate: null,
            subagent: null,
          };
          await writeMeta(tx, meta);
          if (clientRequestId !== null) {
            const index = await tx.doc(ClientRequestIndex, clientRequestId, String(conversationId));
            index.conversationId = String(conversationId);
          }
        },
      },
      BACKGROUND_CONTEXT,
    );
    const catalog = await this.#catalog();
    const meta = catalog.conversations[String(conversation.id)];
    if (meta === undefined) {
      throw engineError("internal", "對話建立後找不到中繼資料");
    }
    for (const pin of meta.toolBundles) {
      this.#bundles.pin(pin.bundleId, pin.generation);
    }
    this.#emitStatus();
    return this.#summary(meta, conversation);
  }

  async findConversationByClientRequestId(
    clientRequestId: string,
  ): Promise<ConversationSummary | null> {
    const index = await this.#session.harness.snapshot(
      ClientRequestIndex,
      clientRequestId,
      BACKGROUND_CONTEXT,
    );
    if (index === undefined) {
      return null;
    }
    return this.getConversation(index.conversationId);
  }

  async restoreConversation(conversationId: ConversationId): Promise<RestoreConversationResult> {
    const summary = await this.getConversation(conversationId);
    if (summary === null) {
      throw engineError("conversation-not-found", `找不到對話 ${conversationId}`);
    }
    const conversation = await this.#session.harness.conversation(
      engineConversationId(conversationId),
      BACKGROUND_CONTEXT,
    );
    if (conversation === undefined) {
      throw engineError("conversation-not-found", `找不到對話 ${conversationId}`);
    }
    const live = await this.#session.harness.snapshot(
      LiveDoc,
      engineConversationId(conversationId),
      BACKGROUND_CONTEXT,
    );
    const recovered = await this.#recoverTurns(conversationId, conversation, live);
    // 先把重跑中的回合放回記憶體，工具重跑時才拿得到同一個 turnId；
    // 宿主已註冊釘選的工具組、設定好模型之後才啟動排程。
    const first = recovered[0];
    if (first !== undefined && first.outcome !== "completed") {
      this.#activeTurns.set(conversationId, {
        turnId: first.turnId,
        conversationId,
        triggerMessageId: first.triggerMessageId,
        status: "running",
      });
      void this.#watchRecoveredTurn(conversationId, first.turnId);
    }
    await this.#session.harness.resume();
    const pending = await this.#approvals.listPending({ conversationId });
    return { conversation: summary, recoveredTurns: recovered, pendingApprovals: pending };
  }

  async #recoverTurns(
    conversationId: ConversationId,
    conversation: Conversation,
    live: { run?: { inputs?: readonly number[]; first?: number } } | undefined,
  ): Promise<readonly TurnRecovery[]> {
    const run = live?.run;
    if (run === undefined) {
      return [];
    }
    const trigger = await this.#triggerMessageId(conversationId, conversation, run);
    if (trigger === null) {
      return [];
    }
    const turnId = turnIdFor(trigger);
    const diagnostics = await this.#interruptedDiagnostics(conversation);
    return [
      {
        turnId,
        triggerMessageId: String(trigger),
        outcome: diagnostics.length > 0 ? "interrupted" : "resumed",
        diagnostics,
      },
    ];
  }

  async #triggerMessageId(
    conversationId: ConversationId,
    conversation: Conversation,
    run: { inputs?: readonly number[]; first?: number },
  ): Promise<number | null> {
    if (run.first !== undefined) {
      return Number(run.first);
    }
    void conversation;
    const input = run.inputs?.[0];
    if (input === undefined) {
      return null;
    }
    const record = await this.#session.harness.submission(input as never, BACKGROUND_CONTEXT);
    if (record === undefined) {
      return null;
    }
    const status = await record.status(BACKGROUND_CONTEXT);
    if (status.type === "input" && status.entry !== undefined) {
      return Number(status.entry);
    }
    void conversationId;
    return null;
  }

  async #interruptedDiagnostics(conversation: Conversation): Promise<readonly ToolDiagnostic[]> {
    const page = await conversation.entries(
      { order: "descending" },
      30,
      undefined,
      BACKGROUND_CONTEXT,
    );
    const diagnostics: ToolDiagnostic[] = [];
    for (const entry of page.items) {
      if (!entry.kind.startsWith("pi.tool")) {
        continue;
      }
      const data = entry.data as
        { diagnostics?: readonly { code?: string; message?: string }[] } | undefined;
      for (const diagnostic of data?.diagnostics ?? []) {
        if (diagnostic.code === "interrupted") {
          diagnostics.push({
            code: "interrupted",
            ...(diagnostic.message === undefined ? {} : { message: diagnostic.message }),
          });
        }
      }
    }
    return diagnostics;
  }

  async deleteConversation(
    conversationId: ConversationId,
    options?: DeleteConversationOptions,
  ): Promise<void> {
    if (options?.includeBranches === false) {
      throw engineError("invalid-request", "刪除一定連同所有支線；不能只刪主線");
    }
    const summary = await this.getConversation(conversationId);
    if (summary === null) {
      // 刪除是冪等的：找不到列也要清掉殘留的索引與 record_ids。
      await this.#sweepOrphanIndexes(conversationId);
      return;
    }

    this.#state = "paused";
    this.#emitStatus();
    const wasOpen = this.#session.isOpen;
    const catalog = await this.#catalog();
    const subtreeIds: string[] = [];
    const pending: string[] = [conversationId];
    while (pending.length > 0) {
      const id = pending.pop() as ConversationId;
      if (subtreeIds.includes(id)) {
        continue;
      }
      subtreeIds.push(id);
      for (const meta of Object.values(catalog.conversations)) {
        if (meta.origin?.parentConversationId === id) {
          pending.push(meta.conversationId);
        }
      }
    }
    const clientRequestIds = subtreeIds
      .map((id) => catalog.conversations[id]?.clientRequestId ?? null)
      .filter((value): value is string => value !== null);

    // 先在同一個 commit 清掉目錄與 clientRequestId 的正反向索引，再關 Harness
    // 刪引擎的列；重送回同一個 clientRequestId 才不會指到已刪的資源。
    await this.#session.harness.commit(async (tx) => {
      const draft = await tx.doc(CatalogDoc);
      for (const id of subtreeIds) {
        const meta = draft.conversations[id];
        if (meta?.clientRequestId != null) {
          delete draft.clientRequests[meta.clientRequestId];
          await tx.retireDoc(ClientRequestIndex, meta.clientRequestId);
        }
        delete draft.conversations[id];
        for (const [turnId, turn] of Object.entries(draft.turns)) {
          if (turn.conversationId === id) {
            delete draft.turns[turnId];
          }
        }
      }
    }, BACKGROUND_CONTEXT);

    await this.#supervisor.terminateAll();
    if (wasOpen) {
      await this.#session.close();
    }

    const intent: DeletionIntent = {
      rootConversationId: conversationId,
      conversationIds: subtreeIds,
      clientRequestIds,
      phase: "rows",
    };
    const purger = this.#options.purger;
    if (purger !== undefined) {
      await purger.putIntent(intent);
      await purger.purge(intent);
    }

    const numericIds = subtreeIds.map((id) => Number(id));
    await this.#session.withRawDatabase(async (database) => {
      const existing = await listConversationSubtree(database, Number(conversationId));
      const all = [...new Set([...numericIds, ...existing])];
      await deleteEngineSubtree(database, all);
      await compactAfterDelete(database);
    });
    if (purger !== undefined) {
      await purger.setIntentPhase(conversationId, "vacuum");
      await purger.removeIntent(conversationId);
    }

    // 暫存區是全域的；刪除期間整個引擎沒有工具在跑，直接清空。
    await rm(resolve(this.#options.environment.tempDir), { recursive: true, force: true });
    await mkdir(resolve(this.#options.environment.tempDir), { recursive: true });

    for (const id of subtreeIds) {
      this.#activeTurns.delete(id);
      this.#subagentStatuses.delete(id);
      this.#bus.publish({
        kind: "conversation.deleted",
        at: this.#clock.now().toISOString(),
        conversationId: id,
      });
    }

    if (wasOpen) {
      await this.#openHarness(true);
      this.#state = "running";
      this.#emitStatus();
    }
  }

  async #sweepOrphanIndexes(conversationId: ConversationId): Promise<void> {
    const catalog = await this.#catalog();
    const orphanKeys = Object.entries(catalog.clientRequests).filter(
      ([, value]) => value === conversationId,
    );
    if (orphanKeys.length === 0) {
      return;
    }
    await this.#session.harness.commit(async (tx) => {
      const draft = await tx.doc(CatalogDoc);
      for (const [key] of orphanKeys) {
        delete draft.clientRequests[key];
        await tx.retireDoc(ClientRequestIndex, key);
      }
    }, BACKGROUND_CONTEXT);
  }

  readConversationHistory(
    request: ReadConversationHistoryRequest,
  ): Promise<ConversationHistoryPage> {
    return this.#readHistory(request);
  }

  async #readHistory(request: ReadConversationHistoryRequest): Promise<ConversationHistoryPage> {
    const conversation = await this.#session.harness.conversation(
      engineConversationId(request.conversationId),
      BACKGROUND_CONTEXT,
    );
    if (conversation === undefined) {
      throw engineError("conversation-not-found", `找不到對話 ${request.conversationId}`);
    }
    const limit = Math.min(request.limit ?? 50, 200);
    const before = request.before === undefined ? undefined : Number(request.before);
    const page = await conversation.entries(
      {
        order: "descending",
        ...(before === undefined ? {} : { maxEntryId: engineEntryId(before - 1) }),
      },
      limit,
      undefined,
      BACKGROUND_CONTEXT,
    );
    const messages = page.items
      .map((entry) => entryToMessage(entry, this.#clock.now().toISOString()))
      .filter((message): message is ConversationMessage => message !== null)
      .reverse();
    const oldest = page.items.at(-1)?.id;
    return {
      messages,
      nextBefore: page.next === undefined || oldest === undefined ? null : String(oldest - 1),
    };
  }

  async forkConversation(request: ForkConversationRequest): Promise<ConversationSummary> {
    this.#assertAcceptingWork();
    const parent = await this.getConversation(request.conversationId);
    if (parent === null) {
      throw engineError("conversation-not-found", `找不到對話 ${request.conversationId}`);
    }
    const conversation = await this.#session.harness.conversation(
      engineConversationId(request.conversationId),
      BACKGROUND_CONTEXT,
    );
    if (conversation === undefined) {
      throw engineError("conversation-not-found", `找不到對話 ${request.conversationId}`);
    }
    this.#ensureBundlesRegistered(parent.toolBundles);
    const createdAt = this.#clock.now().toISOString();
    const at = Number(request.at);
    const fork = await conversation.fork(
      engineEntryId(at),
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: {
            provider: (request.model ?? parent.model).provider,
            modelId: (request.model ?? parent.model).model,
          },
          extensions: this.#extensionObjects(parent.toolBundles),
        },
        init: async (tx, conversationId) => {
          const meta: ConversationMeta = {
            conversationId: String(conversationId),
            title: request.title ?? `${parent.title}（分岔）`,
            purpose: parent.purpose,
            permissionMode: parent.permissionMode,
            toolBundles: [...parent.toolBundles],
            clientRequestId: null,
            origin: {
              kind: "user-fork",
              parentConversationId: parent.id,
              rootConversationId: String(conversationId),
              at: request.at,
              depth: 0,
            },
            model: request.model ?? parent.model,
            rootConversationId: String(conversationId),
            depth: 0,
            visibility: "listed",
            createdAt,
            systemContext: "",
            stagedUpdate: null,
            subagent: null,
          };
          await writeMeta(tx, meta);
        },
      },
      BACKGROUND_CONTEXT,
    );
    const catalog = await this.#catalog();
    const meta = catalog.conversations[String(fork.id)];
    if (meta === undefined) {
      throw engineError("internal", "分岔後找不到中繼資料");
    }
    for (const pin of meta.toolBundles) {
      this.#bundles.pin(pin.bundleId, pin.generation);
    }
    this.#bus.publish({
      kind: "conversation.branch-created",
      at: createdAt,
      conversationId: parent.id,
      branch: await this.#summary(meta, fork),
    });
    return this.#summary(meta, fork);
  }

  async stageConversationUpdate(
    conversationId: ConversationId,
    update: ConversationUpdate,
  ): Promise<void> {
    await this.#session.harness.commit(async (tx) => {
      const draft = await tx.doc(CatalogDoc);
      const meta = draft.conversations[conversationId];
      if (meta === undefined) {
        throw engineError("conversation-not-found", `找不到對話 ${conversationId}`);
      }
      meta.stagedUpdate = {
        reason: update.reason,
        systemContext: update.systemContext ?? null,
        toolBundles: update.toolBundles === undefined ? null : ([...update.toolBundles] as never),
      };
    }, BACKGROUND_CONTEXT);
    // 進行中的對話沒有回合在跑也要換版：等下一次壓縮出現時套用。
    void this.#watchForCompaction(conversationId);
  }

  /** 等這場對話出現下一個壓縮 entry，套用預告的變更。 */
  async #watchForCompaction(conversationId: ConversationId): Promise<void> {
    const deadline = Date.now() + 10 * 60 * 1000;
    let baseline: number;
    try {
      const conversation = await this.#session.harness.conversation(
        engineConversationId(conversationId),
        BACKGROUND_CONTEXT,
      );
      const page = await conversation?.entries(
        { order: "descending" },
        1,
        undefined,
        BACKGROUND_CONTEXT,
      );
      baseline = page?.items[0]?.id === undefined ? 0 : Number(page.items[0].id);
    } catch {
      return;
    }
    while (Date.now() < deadline) {
      if (!this.#session.isOpen) {
        return;
      }
      try {
        const catalog = await this.#catalog();
        if (catalog.conversations[conversationId]?.stagedUpdate == null) {
          return;
        }
        const conversation = await this.#session.harness.conversation(
          engineConversationId(conversationId),
          BACKGROUND_CONTEXT,
        );
        if (conversation === undefined) {
          return;
        }
        const page = await conversation.entries(
          { order: "ascending", minEntryId: engineEntryId(baseline + 1) },
          50,
          undefined,
          BACKGROUND_CONTEXT,
        );
        if (page.items.some((entry) => entry.kind === "pi.compaction")) {
          await this.#applyStagedUpdate(conversationId);
          return;
        }
        for (const entry of page.items) {
          baseline = Math.max(baseline, Number(entry.id));
        }
      } catch {
        return;
      }
      await new Promise<void>((resolveTick) => {
        const timer = setTimeout(resolveTick, 100);
        timer.unref?.();
      });
    }
  }

  /**
   * 測試用：直接寫一筆 `pi.compaction` entry。
   *
   * 引擎的手動壓縮在對話量很小時不會產生摘要；測試要驗的是「壓縮時換版」
   * 的轉接層行為，所以用一筆真正的壓縮 entry 觸發。
   */
  async debugAppendCompaction(conversationId: ConversationId): Promise<void> {
    const conversation = await this.#session.harness.conversation(
      engineConversationId(conversationId),
      BACKGROUND_CONTEXT,
    );
    if (conversation === undefined) {
      throw engineError("conversation-not-found", `找不到對話 ${conversationId}`);
    }
    await conversation.commit(async (tx) => {
      const page = await tx.scanEntries(
        { conversationId: engineConversationId(conversationId) },
        1,
        undefined,
      );
      const first = page.items[0];
      await tx.appendEntry(engineConversationId(conversationId), {
        kind: "pi.compaction",
        data: { reason: "manual" },
        ...(first === undefined ? {} : { head: first.id }),
        model: [{ role: "user", content: "這是壓縮摘要" } as never],
      });
    }, BACKGROUND_CONTEXT);
  }

  // ── 訊息與回合 ─────────────────────────────────────────────────────────

  async sendMessage(request: SendMessageRequest): Promise<MessageReceipt> {
    this.#assertAcceptingWork();
    const conversation = await this.#session.harness.conversation(
      engineConversationId(request.conversationId),
      BACKGROUND_CONTEXT,
    );
    if (conversation === undefined) {
      throw engineError("conversation-not-found", `找不到對話 ${request.conversationId}`);
    }
    const converted = await convertModelContent(request.content, {
      modelInput: await this.#modelInputFor(request.conversationId),
      ...(this.#options.media === undefined ? {} : { reader: this.#options.media }),
    });
    const whenBusy =
      request.delivery === "steer"
        ? "steer"
        : request.delivery === "reject"
          ? "reject"
          : "followUp";
    let submission: Submission;
    try {
      submission = await conversation.submit(
        {
          type: "input",
          content: converted.content,
          whenBusy,
          ...(request.clientMessageId === undefined ? {} : { requestId: request.clientMessageId }),
        },
        BACKGROUND_CONTEXT,
      );
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("Busy") || message.includes("busy")) {
        throw engineError("conversation-busy", message);
      }
      throw engineError("internal", message);
    }
    const record = await submission.status(BACKGROUND_CONTEXT);
    const entry = record.type === "input" && record.status !== "queued" ? record.entry : undefined;
    const messageId = entry === undefined ? `msg_${submission.id}` : String(entry);
    const turnId = entry === undefined ? null : turnIdFor(entry);

    if (entry !== undefined) {
      await this.#beginTurn(request.conversationId, turnId as string, entry);
      this.#bus.publish({
        kind: "turn.started",
        at: this.#clock.now().toISOString(),
        conversationId: request.conversationId,
        turnId: turnId as string,
        trigger: "user-message",
      });
      this.#bus.publish({
        kind: "message.appended",
        at: this.#clock.now().toISOString(),
        conversationId: request.conversationId,
        turnId,
        message: {
          id: String(entry),
          role: "user",
          content: request.content,
          createdAt: this.#clock.now().toISOString(),
          cursor: String(entry),
        },
      });
      void this.#followSubmission(request.conversationId, submission, turnId as string, entry);
    }

    return {
      messageId,
      turnId,
      delivery:
        request.delivery === "steer" ? "steered" : entry === undefined ? "queued" : "started",
    };
  }

  async findMessageByClientId(
    conversationId: ConversationId,
    clientMessageId: string,
  ): Promise<MessageReceipt | null> {
    const record = await this.#session.harness.commit(
      (tx) => tx.submissionByRequest(engineConversationId(conversationId), clientMessageId),
      BACKGROUND_CONTEXT,
    );
    if (record === undefined) {
      return null;
    }
    const status = submissionRecordToStatus(record);
    const entry = status.entry;
    if (entry === undefined) {
      return null;
    }
    return {
      messageId: String(entry),
      turnId: turnIdFor(entry),
      delivery: "started",
    };
  }

  async #beginTurn(conversationId: ConversationId, turnId: TurnId, entry: number): Promise<void> {
    this.#activeTurns.set(conversationId, {
      turnId,
      conversationId,
      triggerMessageId: String(entry),
      status: "running",
    });
    await this.#session.harness.commit(async (tx) => {
      const draft = await tx.doc(CatalogDoc);
      draft.turns[turnId] = {
        turnId,
        conversationId,
        triggerMessageId: String(entry),
        status: "running",
      };
    }, BACKGROUND_CONTEXT);
  }

  /** 重啟後接回的回合：等引擎的 `pi.live.run` 消失，才標成完成。 */
  async #watchRecoveredTurn(conversationId: ConversationId, turnId: TurnId): Promise<void> {
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      if (!this.#session.isOpen) {
        return;
      }
      try {
        const live = await this.#session.harness.snapshot(
          LiveDoc,
          engineConversationId(conversationId),
          BACKGROUND_CONTEXT,
        );
        if (live?.run === undefined) {
          await this.#finishTurn(conversationId, turnId, "completed");
          this.#bus.publish({
            kind: "turn.completed",
            at: this.#clock.now().toISOString(),
            conversationId,
            turnId,
            status: "completed",
            failure: null,
          });
          return;
        }
      } catch {
        return;
      }
      await new Promise<void>((resolveTick) => {
        const timer = setTimeout(resolveTick, 30);
        timer.unref?.();
      });
    }
  }

  async #finishTurn(
    conversationId: ConversationId,
    turnId: TurnId,
    status: CompletedTurnStatus,
  ): Promise<void> {
    const active = this.#activeTurns.get(conversationId);
    if (active?.turnId === turnId) {
      this.#activeTurns.delete(conversationId);
    }
    try {
      await this.#session.harness.commit(async (tx) => {
        const draft = await tx.doc(CatalogDoc);
        const turn = draft.turns[turnId];
        if (turn !== undefined) {
          turn.status = status;
        }
      }, BACKGROUND_CONTEXT);
    } catch {
      // 引擎已關閉時不需要更新目錄。
    }
  }

  /** 追蹤一輪的進度：把新 entry 轉成訊息事件，結束時送 `turn.completed`。 */
  async #followSubmission(
    conversationId: ConversationId,
    submission: Submission,
    turnId: TurnId,
    firstEntry: number,
  ): Promise<void> {
    let lastSeen = firstEntry;
    let lastText = "";
    let lastModelError: string | null = null;
    let settled: CompletedTurnStatus | null = null;
    let settlement: SettledSubmissionRecord | null = null;
    const settledPromise = submission
      .wait(BACKGROUND_CONTEXT)
      .then((record) => {
        settlement = record;
        settled =
          record.status === "done"
            ? "completed"
            : record.status === "unanswered"
              ? "failed"
              : "completed";
      })
      .catch(() => {
        settled = "failed";
      });

    while (true) {
      try {
        const conversation = await this.#session.harness.conversation(
          engineConversationId(conversationId),
          BACKGROUND_CONTEXT,
        );
        if (conversation === undefined) {
          break;
        }
        const page = await conversation.entries(
          { order: "ascending", minEntryId: engineEntryId(lastSeen + 1) },
          50,
          undefined,
          BACKGROUND_CONTEXT,
        );
        for (const entry of page.items) {
          lastSeen = Math.max(lastSeen, entry.id);
          const message = entryToMessage(entry, this.#clock.now().toISOString());
          if (message !== null) {
            this.#bus.publish({
              kind: "message.appended",
              at: this.#clock.now().toISOString(),
              conversationId,
              turnId,
              message,
            });
          }
          if (entry.kind === "pi.assistant") {
            // 非串流供應商沒有即時訊息；用最終訊息補一次文字增量。
            lastText = this.#publishTextDelta(
              conversationId,
              turnId,
              lastText,
              assistantTextOfEntry(entry),
            );
            const modelMessage = entry.model?.[0] as
              { stopReason?: string; errorMessage?: string } | undefined;
            if (modelMessage?.stopReason === "error") {
              lastModelError = modelMessage.errorMessage ?? null;
            }
            this.#publishToolStarted(conversationId, turnId, entry);
          }
          if (entry.kind.startsWith("pi.tool")) {
            this.#publishToolFinished(conversationId, turnId, entry);
          }
          if (entry.kind === "pi.compaction") {
            await this.#applyStagedUpdate(conversationId);
          }
        }
      } catch {
        // 引擎關閉或對話刪除；結束追蹤。
      }
      try {
        const live = await this.#session.harness.snapshot(
          LiveDoc,
          engineConversationId(conversationId),
          BACKGROUND_CONTEXT,
        );
        const partial = live?.generation?.message as
          { content?: readonly { type?: string; text?: string }[] } | undefined;
        const text = (partial?.content ?? [])
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join("");
        lastText = this.#publishTextDelta(conversationId, turnId, lastText, text);
      } catch {
        // 引擎關閉或對話刪除。
      }
      if (settled !== null) {
        break;
      }
      await new Promise<void>((resolveTick) => {
        const timer = setTimeout(resolveTick, 20);
        timer.unref?.();
      });
    }
    await settledPromise;
    const interrupted = this.#interruptedTurns.delete(turnId);
    const finalStatus = (
      interrupted ? "interrupted" : (settled ?? "completed")
    ) as CompletedTurnStatus;
    const failure = finalStatus === "failed" ? modelFailureFor(settlement, lastModelError) : null;
    await this.#finishTurn(conversationId, turnId, finalStatus);
    this.#bus.publish({
      kind: "turn.completed",
      at: this.#clock.now().toISOString(),
      conversationId,
      turnId,
      status: finalStatus,
      failure,
    });
  }

  /** 從模型回應中的工具呼叫發布 `tool.started`。 */
  #publishToolStarted(conversationId: ConversationId, turnId: TurnId, entry: EntryRecord): void {
    const message = entry.model?.[0] as
      | {
          content?: readonly { type?: string; id?: string; name?: string; arguments?: JsonValue }[];
        }
      | undefined;
    for (const block of message?.content ?? []) {
      if (block.type !== "toolCall" || block.id === undefined || block.name === undefined) {
        continue;
      }
      this.#bus.publish({
        kind: "tool.started",
        at: this.#clock.now().toISOString(),
        conversationId,
        turnId,
        callId: block.id,
        toolName: block.name,
        input: block.arguments ?? {},
      });
    }
  }

  /** 從引擎的即時訊息發布文字增量；messageId 在同一輪內固定。 */
  #publishTextDelta(
    conversationId: ConversationId,
    turnId: TurnId,
    previous: string,
    next: string,
  ): string {
    if (next.length <= previous.length || !next.startsWith(previous)) {
      return previous;
    }
    const delta = next.slice(previous.length);
    if (delta.length === 0) {
      return previous;
    }
    this.#bus.publish({
      kind: "assistant.text.delta",
      at: this.#clock.now().toISOString(),
      conversationId,
      turnId,
      messageId: `msg_${turnId}`,
      text: delta,
    });
    return next;
  }

  #publishToolFinished(conversationId: ConversationId, turnId: TurnId, entry: EntryRecord): void {
    const data = entry.data as
      | {
          diagnostics?: readonly { code?: string; message?: string }[];
          callId?: string;
          name?: string;
        }
      | undefined;
    const diagnostics = (data?.diagnostics ?? []).map((diagnostic) => ({
      // 引擎自己的診斷碼（例如 `aborted`）不在協定的列舉裡；對外一律回
      // `interrupted`，客戶端才不會收到沒有 `code` 的診斷。
      code: normalizeToolDiagnosticCode(diagnostic.code),
      ...(diagnostic.message === undefined ? {} : { message: diagnostic.message }),
    }));
    const callId = data?.callId ?? `call_${entry.id}`;
    const recorded = this.#toolResults.get(callId);
    const message = entry.model?.[0] as
      | {
          isError?: boolean;
          content?: readonly { type?: string; text?: string }[];
          details?: JsonValue;
        }
      | undefined;
    const text =
      recorded?.text ??
      (message?.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("\n");
    this.#bus.publish({
      kind: "tool.finished",
      at: this.#clock.now().toISOString(),
      conversationId,
      turnId,
      callId,
      toolName: data?.name ?? "unknown",
      outcome: {
        ok:
          message?.isError === false
            ? true
            : message === undefined
              ? (this.#toolOutcomes.get(callId) ?? false)
              : false,
        content: [{ type: "text", text }],
        diagnostics,
        ...((recorded?.metadata ?? message?.details) === undefined
          ? {}
          : { metadata: (recorded?.metadata ?? message?.details) as JsonValue }),
      } as ToolOutcome,
    });
  }

  async #applyStagedUpdate(conversationId: ConversationId): Promise<void> {
    const catalog = await this.#catalog();
    const meta = catalog.conversations[conversationId];
    if (meta?.stagedUpdate == null) {
      return;
    }
    const update = meta.stagedUpdate;
    const conversation = await this.#session.harness.conversation(
      engineConversationId(conversationId),
      BACKGROUND_CONTEXT,
    );
    if (conversation === undefined) {
      return;
    }
    if (update.toolBundles !== null) {
      this.#ensureBundlesRegistered(update.toolBundles);
    }
    await conversation.configure(
      {
        ...(update.systemContext === null ? {} : { instructions: update.systemContext }),
        ...(update.toolBundles === null
          ? {}
          : {
              extensions: this.#extensionObjects(update.toolBundles),
            }),
      },
      BACKGROUND_CONTEXT,
    );
    await this.#session.harness.commit(async (tx) => {
      const draft = await tx.doc(CatalogDoc);
      const current = draft.conversations[conversationId];
      if (current === undefined) {
        return;
      }
      current.stagedUpdate = null;
      if (update.toolBundles !== null) {
        current.toolBundles = update.toolBundles as never;
      }
    }, BACKGROUND_CONTEXT);
    this.#bus.publish({
      kind: "conversation.compacted",
      at: this.#clock.now().toISOString(),
      conversationId,
      turnId: null,
      appliedUpdate: true,
      beforeTokens: null,
      afterTokens: null,
    });
  }

  async cancelTurn(request: CancelTurnRequest): Promise<void> {
    const conversation = await this.#session.harness.conversation(
      engineConversationId(request.conversationId),
      BACKGROUND_CONTEXT,
    );
    if (conversation === undefined) {
      throw engineError("conversation-not-found", `找不到對話 ${request.conversationId}`);
    }
    const turnId = request.turnId ?? this.#activeTurns.get(request.conversationId)?.turnId;
    if (turnId !== undefined) {
      this.#interruptedTurns.add(turnId);
      if (this.#interruptedTurns.size > 500) {
        const oldest = this.#interruptedTurns.values().next().value;
        if (oldest !== undefined) this.#interruptedTurns.delete(oldest);
      }
    }
    await conversation.abort(BACKGROUND_CONTEXT);
    if (turnId !== undefined) {
      await this.#finishTurn(request.conversationId, turnId, "cancelled");
    }
  }

  // ── 事件 ───────────────────────────────────────────────────────────────

  subscribe(options: SubscribeOptions): EngineSubscription {
    return this.#bus.subscribe(options);
  }

  // ── 子代理 ─────────────────────────────────────────────────────────────

  async spawnSubagent(request: SpawnSubagentRequest): Promise<SubagentHandle> {
    this.#assertAcceptingWork();
    const parent = await this.getConversation(request.parentConversationId);
    if (parent === null) {
      throw engineError("conversation-not-found", `找不到對話 ${request.parentConversationId}`);
    }
    if (request.depth !== 1) {
      throw engineError("subagent-depth-exceeded", "子代理的深度必須是 1");
    }
    if (parent.depth + 1 > this.#limits.maxDepth) {
      throw engineError("subagent-depth-exceeded", "子代理不能再開子代理");
    }
    const running = [...this.#subagentStatuses.entries()].filter(
      ([, status]) => status === "running",
    ).length;
    if (running >= this.#limits.maxConcurrentPerParent) {
      throw engineError("subagent-limit-reached", "同一個主對話最多 4 個子代理同時進行");
    }

    const conversation = await this.#session.harness.conversation(
      engineConversationId(request.parentConversationId),
      BACKGROUND_CONTEXT,
    );
    if (conversation === undefined) {
      throw engineError("conversation-not-found", `找不到對話 ${request.parentConversationId}`);
    }
    this.#ensureBundlesRegistered(parent.toolBundles);
    const createdAt = this.#clock.now().toISOString();
    const title = request.title ?? "子代理";
    const fork = await conversation.fork(
      engineEntryId(request.at),
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: {
            provider: (request.model ?? parent.model).provider,
            modelId: (request.model ?? parent.model).model,
          },
          extensions: this.#extensionObjects(parent.toolBundles),
        },
        init: async (tx, conversationId) => {
          const meta: ConversationMeta = {
            conversationId: String(conversationId),
            title,
            purpose: "subagent",
            permissionMode: parent.permissionMode,
            toolBundles: [...parent.toolBundles],
            clientRequestId: null,
            origin: {
              kind: "subagent",
              parentConversationId: parent.id,
              rootConversationId: parent.rootConversationId,
              at: request.at,
              depth: 1,
            },
            model: request.model ?? parent.model,
            rootConversationId: parent.rootConversationId,
            depth: 1,
            visibility: "branch",
            createdAt,
            systemContext: "",
            stagedUpdate: null,
            subagent: { title, status: "running", waiting: request.waiting, startedAt: createdAt },
          };
          await writeMeta(tx, meta);
        },
      },
      BACKGROUND_CONTEXT,
    );
    const subagentId = String(fork.id);
    for (const pin of parent.toolBundles) {
      this.#bundles.pin(pin.bundleId, pin.generation);
    }
    this.#subagentStatuses.set(subagentId, "running");
    const handle: SubagentHandle = {
      subagentConversationId: subagentId,
      parentConversationId: parent.id,
      rootConversationId: parent.rootConversationId,
      depth: 1,
      title,
      status: "running",
      startedAt: createdAt,
      resultCard: null,
    };
    this.#bus.publish({
      kind: "subagent.started",
      at: createdAt,
      conversationId: parent.id,
      handle,
    });

    const send = await this.sendMessage({
      conversationId: subagentId,
      content: [{ type: "text", text: request.instruction }],
      delivery: "queue",
      sender: { kind: "system", component: "subagent" },
      clientMessageId: `subagent:${subagentId}`,
    });
    const completion = this.#completeSubagent(subagentId, parent.id, title, createdAt, send.turnId);
    if (request.waiting === "background") {
      void completion.catch(() => {});
      return handle;
    }
    const outcome = await completion;
    return {
      ...handle,
      status: outcome.status,
      resultCard: outcome.resultCard,
    };
  }

  async #completeSubagent(
    subagentId: ConversationId,
    parentId: ConversationId,
    title: string,
    startedAt: string,
    turnId: TurnId | null,
  ): Promise<SubagentOutcome> {
    if (!this.#session.isOpen) {
      const status = "interrupted" as const;
      this.#subagentStatuses.set(subagentId, status);
      return {
        handle: {
          subagentConversationId: subagentId,
          parentConversationId: parentId,
          rootConversationId: parentId,
          depth: 1,
          title,
          status,
          startedAt,
          resultCard: null,
        },
        status,
        resultCard: null,
        failure: { code: "engine-closed", message: "引擎已關閉" },
      };
    }
    const conversation = await this.#session.harness.conversation(
      engineConversationId(subagentId),
      BACKGROUND_CONTEXT,
    );
    let status: SubagentOutcome["status"] = "completed";
    if (conversation !== undefined) {
      try {
        await conversation.waitForIdle(BACKGROUND_CONTEXT);
      } catch {
        status = "failed";
      }
    }
    const history =
      conversation === undefined
        ? { messages: [] as readonly ConversationMessage[], nextBefore: null }
        : await this.#readHistory({ conversationId: subagentId, limit: 100 }).catch(() => ({
            messages: [] as readonly ConversationMessage[],
            nextBefore: null,
          }));
    const assistant = [...history.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    const conclusion = assistant === undefined ? "" : contentText(assistant.content);
    const last = history.messages.at(-1);
    const resultCard: SubagentResultCard = {
      cardKind: "subagent-summary",
      cardId: null,
      scope: "conversation",
      title,
      conclusion,
      evidence: [],
      references:
        last === undefined
          ? []
          : [
              {
                kind: "branch-entry",
                label: "支線最後一則訊息",
                conversationId: subagentId,
                cursor: last.cursor,
              },
            ],
      unresolved: [],
      tokenEstimate: Math.ceil(conclusion.length / 4),
      branchConversationId: subagentId,
      createdAt: this.#clock.now().toISOString(),
    };
    this.#subagentStatuses.set(subagentId, status);
    await this.#updateSubagentMeta(subagentId, status);
    const outcome: SubagentOutcome = {
      handle: {
        subagentConversationId: subagentId,
        parentConversationId: parentId,
        rootConversationId: parentId,
        depth: 1,
        title,
        status,
        startedAt,
        resultCard,
      },
      status,
      resultCard,
      failure: null,
    };
    this.#bus.publish({
      kind: "subagent.completed",
      at: this.#clock.now().toISOString(),
      conversationId: parentId,
      outcome,
    });
    void turnId;
    return outcome;
  }

  async #updateSubagentMeta(
    subagentId: ConversationId,
    status: SubagentOutcome["status"],
  ): Promise<void> {
    try {
      await this.#session.harness.commit(async (tx) => {
        const draft = await tx.doc(CatalogDoc);
        const meta = draft.conversations[subagentId];
        if (meta?.subagent != null) {
          meta.subagent.status = status as never;
        }
      }, BACKGROUND_CONTEXT);
    } catch {
      // 引擎關閉時目錄可能無法寫入。
    }
  }

  async waitForSubagent(
    subagentConversationId: ConversationId,
    options?: { readonly signal?: AbortSignal },
  ): Promise<SubagentOutcome> {
    void options;
    const conversation = await this.#session.harness.conversation(
      engineConversationId(subagentConversationId),
      BACKGROUND_CONTEXT,
    );
    if (conversation === undefined) {
      throw engineError("subagent-not-found", `找不到子代理 ${subagentConversationId}`);
    }
    const catalog = await this.#catalog();
    const meta = catalog.conversations[subagentConversationId];
    const parentId = meta?.origin?.parentConversationId ?? subagentConversationId;
    return this.#completeSubagent(
      subagentConversationId,
      parentId,
      meta?.title ?? "子代理",
      meta?.createdAt ?? this.#clock.now().toISOString(),
      null,
    );
  }

  async cancelSubagent(subagentConversationId: ConversationId, reason: string): Promise<void> {
    const conversation = await this.#session.harness.conversation(
      engineConversationId(subagentConversationId),
      BACKGROUND_CONTEXT,
    );
    if (conversation === undefined) {
      throw engineError("subagent-not-found", `找不到子代理 ${subagentConversationId}`);
    }
    await conversation.abort(BACKGROUND_CONTEXT);
    this.#subagentStatuses.set(subagentConversationId, "cancelled");
    await this.#updateSubagentMeta(subagentConversationId, "cancelled");
    void reason;
  }

  async listSubagents(parentConversationId: ConversationId): Promise<readonly SubagentHandle[]> {
    const catalog = await this.#catalog();
    return Object.values(catalog.conversations)
      .filter((meta) => meta.origin?.parentConversationId === parentConversationId)
      .map((meta) => ({
        subagentConversationId: meta.conversationId,
        parentConversationId,
        rootConversationId: meta.rootConversationId,
        depth: 1 as const,
        title: meta.title,
        status: this.#subagentStatuses.get(meta.conversationId) ?? "running",
        startedAt: meta.createdAt,
        resultCard: null,
      }));
  }

  async queueNextTurnInjection(
    request: NextTurnInjectionRequest,
  ): Promise<NextTurnInjectionReceipt> {
    void request;
    return {
      injectionId: `inj_${this.#clock.now().getTime()}`,
      outcome: "unsupported",
    };
  }

  // ── 緊急暫停 ───────────────────────────────────────────────────────────

  async pauseAll(reason: string): Promise<EmergencyPause> {
    const pausedTurns: { conversationId: ConversationId; turnId: TurnId }[] = [];
    for (const [conversationId, active] of this.#activeTurns) {
      pausedTurns.push({ conversationId, turnId: active.turnId });
      this.#interruptedTurns.add(active.turnId);
    }
    // 先殺工具子行程再 abort：abort 會等工具任務收尾，順序顛倒的話
    // 緊急暫停要等工具自己跑完才回得去。
    await this.#supervisor.terminateAll();
    for (const { conversationId } of pausedTurns) {
      const conversation = await this.#session.harness.conversation(
        engineConversationId(conversationId),
        BACKGROUND_CONTEXT,
      );
      await conversation?.abort(BACKGROUND_CONTEXT);
    }
    this.#pause = {
      pauseId: `pause_${this.#clock.now().getTime()}`,
      reason,
      startedAt: this.#clock.now().toISOString(),
      pausedTurns,
    };
    this.#state = "paused";
    this.#emitStatus();
    return this.#pause;
  }

  async resumeAll(): Promise<void> {
    this.#pause = null;
    this.#state = this.#session.isOpen ? "running" : "paused";
    this.#emitStatus();
  }

  // ── 內部工具 ───────────────────────────────────────────────────────────

  #assertAcceptingWork(): void {
    if (this.#pause !== null) {
      throw engineError("engine-paused", "引擎處於緊急暫停");
    }
    if (this.#state === "paused") {
      // 緊急暫停、suspend 與刪除期間都走這條；呼叫端可以重試。
      throw engineError("engine-paused", "引擎暫停中，暫時不受理新工作");
    }
    if (this.#state !== "running" && this.#state !== "starting") {
      throw engineError("engine-closed", "引擎尚未開啟或已關閉");
    }
  }

  #ensureBundlesRegistered(pins: readonly { bundleId: string; generation: number }[]): void {
    for (const pin of pins) {
      const bundle = this.#bundles.get(pin.bundleId, pin.generation);
      if (bundle === undefined) {
        throw engineError(
          "tool-not-registered",
          `對話釘選的工具組 ${pin.bundleId}@${pin.generation} 尚未註冊`,
        );
      }
    }
  }

  #catalogCache: CatalogSnapshot | null = null;

  async #catalog(): Promise<CatalogSnapshot> {
    const value = await this.#session.harness.snapshot(CatalogDoc, BACKGROUND_CONTEXT);
    const catalog =
      value === undefined ? emptyCatalog() : (JSON.parse(JSON.stringify(value)) as CatalogSnapshot);
    this.#catalogCache = catalog;
    return catalog;
  }

  async #summary(meta: ConversationMeta, conversation: Conversation): Promise<ConversationSummary> {
    const page = await conversation.entries(
      { order: "descending" },
      1,
      undefined,
      BACKGROUND_CONTEXT,
    );
    const latest = page.items[0];
    const active = this.#activeTurns.get(meta.conversationId);
    return {
      id: meta.conversationId,
      title: meta.title,
      purpose: meta.purpose,
      rootConversationId: meta.rootConversationId,
      depth: meta.depth,
      visibility: meta.visibility,
      permissionMode: meta.permissionMode,
      model: meta.model,
      state: active === undefined ? "idle" : "running",
      origin: meta.origin,
      toolBundles: meta.toolBundles,
      createdAt: meta.createdAt,
      updatedAt: this.#clock.now().toISOString(),
      latestCursor: latest === undefined ? null : String(latest.id),
    };
  }

  async #recoverDeletionIntents(): Promise<void> {
    const purger = this.#options.purger;
    if (purger === undefined) {
      return;
    }
    const intents = await purger.listIntents();
    for (const intent of intents) {
      const numericIds = intent.conversationIds.map((id) => Number(id));
      await this.#session.withRawDatabase(async (database) => {
        await deleteEngineSubtree(database, numericIds);
        await compactAfterDelete(database);
      });
      if (intent.phase === "rows") {
        await purger.purge(intent);
        await purger.setIntentPhase(intent.rootConversationId, "vacuum");
      }
      await purger.removeIntent(intent.rootConversationId);
    }
  }

  /** 測試用：讀目前連線的 PRAGMA 值（例如 `secure_delete`）。 */
  async debugPragma(name: string): Promise<number> {
    const row = await this.#session.database.get<Record<string, number>>(`PRAGMA ${name}`);
    return Number(Object.values(row ?? {})[0] ?? 0);
  }

  /** 讀取目前的對話目錄；測試與主機的診斷用。 */
  async describeCatalog(): Promise<CatalogSnapshot> {
    return this.#catalog();
  }
}

// ── 輔助函式 ─────────────────────────────────────────────────────────────

function emptyRoles(): ModelSettings["roles"] {
  const selection = { provider: "unconfigured", model: "unconfigured" };
  return {
    main: selection,
    small: selection,
    writing: selection,
    "system-one": selection,
  };
}

/** 轉接層對外是字串識別碼，引擎內部是數字；型別轉換只留在這裡。 */
function engineConversationId(id: ConversationId): never {
  return Number(id) as never;
}

function engineEntryId(id: string | number): never {
  return Number(id) as never;
}

function turnIdFor(messageId: number | string): TurnId {
  return `turn_${messageId}`;
}

async function writeMeta(tx: Tx, meta: ConversationMeta): Promise<void> {
  const draft = await tx.doc(CatalogDoc);
  draft.conversations[meta.conversationId] = meta;
  if (meta.clientRequestId !== null) {
    draft.clientRequests[meta.clientRequestId] = meta.conversationId;
    const index = await tx.doc(ClientRequestIndex, meta.clientRequestId, meta.conversationId);
    index.conversationId = meta.conversationId;
  }
}

function contentText(content: readonly ContentBlock[]): string {
  return content
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

/**
 * 把引擎的 entry 轉成協定的訊息。
 *
 * `createdAt` 取訊息自己的 `timestamp`（pi-ai 的訊息都帶毫秒時間）；
 * entry 的 `id` 是單調遞增的流水號，不是時間，不能拿來當時間戳。
 * 沒有時間的訊息用呼叫端提供的當下時間。
 */
function entryToMessage(entry: EntryRecord, fallbackAt: string): ConversationMessage | null {
  if (!entry.kind.startsWith("pi.")) {
    return null;
  }
  const model = entry.model ?? [];
  if (model.length === 0) {
    return null;
  }
  const message = model[0] as { role?: string; content?: unknown; timestamp?: unknown };
  if (message === undefined || message.role === "system") {
    return null;
  }
  const role =
    entry.kind === "pi.user" ? "user" : entry.kind === "pi.tool-result" ? "tool" : "assistant";
  const timestamp = message.timestamp;
  const createdAt =
    typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0
      ? new Date(timestamp).toISOString()
      : fallbackAt;
  return {
    id: String(entry.id),
    role,
    content: [{ type: "text", text: textOfModel(message.content) }],
    createdAt,
    cursor: String(entry.id),
  };
}

function assistantTextOfEntry(entry: EntryRecord): string {
  const message = entry.model?.[0] as { content?: unknown } | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" && block !== null && (block as { type?: string }).type === "text",
    )
    .map((block) => block.text)
    .join("");
}

function textOfModel(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (typeof block === "object" && block !== null && "text" in block) {
        return String((block as { text: unknown }).text);
      }
      return "";
    })
    .join("");
}

/** 把引擎的診斷碼收斂到協定的列舉；不認識的一律當成中斷。 */
function normalizeToolDiagnosticCode(code: string | undefined): ToolDiagnostic["code"] {
  const known: readonly ToolDiagnostic["code"][] = [
    "interrupted",
    "paused",
    "cancelled",
    "timed-out",
    "output-truncated",
    "permission-denied",
    "approval-denied",
    "approval-expired",
    "tool-unavailable",
  ];
  return known.find((candidate) => candidate === code) ?? "interrupted";
}

function toolError(
  message: string,
  code: ToolDiagnostic["code"],
): {
  output: { readonly type: "text"; readonly text: string }[];
  isError: true;
  diagnostics: readonly { code: string; message: string }[];
} {
  return {
    output: [{ type: "text", text: message }],
    isError: true,
    diagnostics: [{ code, message }],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof EngineAdapterFailure || error instanceof Error
    ? error.message
    : String(error);
}

/**
 * 回合失敗的原因。
 *
 * 引擎把模型錯誤結算成 `unanswered`：`reason` 是 `model_error` 或
 * `no_model`，`detail` 是供應商原文。只有這兩種會變成帶原因的回合錯誤；
 * 其他結算（例如背景任務沒有內容可答）維持沒有錯誤物件。
 */
function modelFailureFor(
  settlement: SettledSubmissionRecord | null,
  lastModelError: string | null,
): EngineErrorInfo | null {
  if (settlement === null || settlement.status !== "unanswered") {
    return null;
  }
  const detail =
    typeof settlement.detail === "string"
      ? settlement.detail
      : settlement.detail === undefined
        ? (lastModelError ?? "")
        : JSON.stringify(settlement.detail);
  if (settlement.reason === "model_error") {
    return modelFailureInfo(classifyModelFailure(detail || lastModelError));
  }
  if (settlement.reason === "no_model") {
    return modelFailureInfo(classifyModelFailure("model_not_configured"));
  }
  return null;
}

function submissionRecordToStatus(record: SubmissionRecord): {
  readonly entry?: number;
} {
  if (record.type === "input") {
    return record.status === "queued" ? {} : { entry: Number(record.entry) };
  }
  if (record.type === "write") {
    return record.status === "done" ? { entry: Number(record.entry) } : {};
  }
  return {};
}
