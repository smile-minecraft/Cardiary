import type {
  ApprovalRequestDraft,
  ApprovalResolution,
  ApprovalService,
  ApprovalUpdate,
  CancelTurnRequest,
  CompletedTurnStatus,
  ConversationCursor,
  ConversationHistoryPage,
  ConversationMessage,
  ConversationPurpose,
  ConversationState,
  ConversationSummary,
  ConversationUpdate,
  CreateConversationRequest,
  DeleteConversationOptions,
  EmergencyPause,
  EngineAdapter,
  EngineAdapterOptions,
  EngineDescriptor,
  EngineEvent,
  EngineState,
  EngineStatus,
  EngineSubscription,
  ForkConversationRequest,
  MessageReceipt,
  MessageDelivery,
  ModelSelection,
  ModelSettings,
  PausedTurn,
  ReadConversationHistoryRequest,
  RestoreConversationResult,
  SendMessageRequest,
  SpawnSubagentRequest,
  SubagentHandle,
  SubagentLimits,
  SubagentOutcome,
  SubagentResultCard,
  SubscribeOptions,
  ToolBundlePin,
  ToolContent,
  ToolDefinition,
  ToolDiagnostic,
  ToolOutcome,
  TurnRecovery,
  TurnTrigger,
  ToolProcess,
  ToolProcessSpec,
  Unsubscribe,
} from "@cardiary/engine-adapter";
import type { ActorRef, HumanActor } from "@cardiary/engine-adapter";
import type {
  ConversationId,
  EventSeq,
  MessageId,
  ToolCallId,
  ToolName,
  TurnId,
} from "@cardiary/engine-adapter";
import type { JsonValue } from "@cardiary/engine-adapter";

import { FakeApprovalService } from "./approvals.js";
import { EventChannel } from "./channel.js";
import { EngineFailure } from "./errors.js";
import { prefixed } from "./ids.js";
import { FakeToolSpawner } from "./spawn.js";
import { FakeToolRegistry } from "./tools.js";

/** 腳本化模型的一步。 */
export type FakeModelStep =
  | {
      readonly kind: "text";
      readonly text: string;
      /** 每個增量事件的字元數；省略時一次送完。 */
      readonly chunkSize?: number;
      /** 每個增量之間的等待毫秒數；測試串流中的插話與快照用。 */
      readonly delayMs?: number;
    }
  | { readonly kind: "tool"; readonly toolName: ToolName; readonly input?: JsonValue }
  | {
      readonly kind: "fail";
      readonly code: "internal" | "model-unavailable";
      readonly message: string;
    };

export interface FakeMessageClientIdRequest extends SendMessageRequest {
  readonly clientMessageId?: string;
}

interface StoredMessage {
  readonly message: ConversationMessage;
  readonly turnId: TurnId | null;
  readonly status: "complete" | "interrupted" | "failed";
  readonly clientMessageId?: string;
}

interface ToolCallRecord {
  readonly callId: ToolCallId;
  readonly toolName: ToolName;
  readonly input: JsonValue;
  readonly turnId: TurnId;
  readonly createdAt: string;
  readonly messageId: string;
  outcome: ToolOutcome | null;
}

interface QueuedMessage {
  readonly messageId: MessageId;
  readonly text: string;
  readonly sender: ActorRef;
  readonly clientMessageId?: string;
  readonly steered: boolean;
}

interface TurnRuntime {
  readonly turnId: TurnId;
  readonly triggerMessageId: MessageId;
  readonly abort: AbortController;
  status: "running" | "cancelled" | "paused" | "failed" | "interrupted" | "restarted";
  steers: QueuedMessage[];
  assistantMessageId: MessageId;
  text: string;
  readonly toolCalls: ToolCallRecord[];
}

interface RecoveredTurn {
  readonly turnId: TurnId;
  readonly triggerMessageId: MessageId;
  outcome: "completed" | "resumed" | "interrupted" | "failed";
  readonly diagnostics: readonly ToolDiagnostic[];
}

interface ConversationRecord {
  id: ConversationId;
  title: string;
  purpose: ConversationPurpose;
  rootConversationId: ConversationId;
  depth: 0 | 1;
  visibility: "listed" | "branch";
  permissionMode: "hard-rules" | "system-one-review" | "allow-all";
  model: ModelSelection;
  state: ConversationState;
  origin: ConversationSummary["origin"];
  toolBundles: readonly ToolBundlePin[];
  createdAt: string;
  updatedAt: string;
  systemContext: string;
  staged: ConversationUpdate | null;
  messages: StoredMessage[];
  channel: EventChannel;
  activeTurn: TurnRuntime | null;
  queue: QueuedMessage[];
  clientRequestId: string | null;
  toolCalls: Map<ToolCallId, ToolCallRecord>;
  turnIndex: Map<MessageId, TurnId>;
  recovery: RecoveredTurn[];
  deleted: boolean;
}

export interface FakeEngineOptions extends EngineAdapterOptions {
  /** 子代理篩選：判斷某場對話是否屬於這個主線。 */
  readonly isInRoot?: (conversationId: string, rootConversationId: string) => boolean;
  /** 預設腳本；佇列用完時使用。 */
  readonly defaultScript?: readonly FakeModelStep[];
}

const DEFAULT_SCRIPT: readonly FakeModelStep[] = [{ kind: "text", text: "收到。" }];

const DEFAULT_SUBAGENT_LIMITS: SubagentLimits = {
  maxConcurrentPerParent: 4,
  maxDepth: 1,
  resultTokenBudget: 800,
};

/**
 * 假引擎：不連網、不用金鑰，用腳本決定每一輪的回應。
 *
 * 它實作 `EngineAdapter`，另外提供主機需要的擴充方法（`suspend`／`resume`、
 * 兩個冪等回查、帶 `clientMessageId` 的送訊息）與測試用的控制點
 * （`enqueueScript`、`compact`、`simulateRestart`）。
 */
export class FakeEngine implements EngineAdapter {
  readonly #options: FakeEngineOptions;
  readonly #clock: { now(): Date };
  readonly #conversations = new Map<ConversationId, ConversationRecord>();
  readonly #tools: FakeToolRegistry;
  readonly #approvals: FakeApprovalService;
  readonly #spawner: FakeToolSpawner;
  readonly #listeners = new Set<(status: EngineStatus) => void>();
  readonly #approvalSubscription: Unsubscribe;
  readonly #scripts: FakeModelStep[][] = [];
  readonly #subagentWaiters = new Map<ConversationId, Array<(outcome: SubagentOutcome) => void>>();
  readonly #limits: SubagentLimits;
  #state: EngineState = "starting";
  #pause: EmergencyPause | null = null;
  #pendingApprovals = 0;
  #modelSettings: ModelSettings | null = null;
  #opened = false;

  constructor(options: FakeEngineOptions) {
    this.#options = options;
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#limits = options.subagentLimits ?? DEFAULT_SUBAGENT_LIMITS;
    this.#tools = new FakeToolRegistry((bundleId, generation) => {
      let count = 0;
      for (const conversation of this.#conversations.values()) {
        if (conversation.deleted) continue;
        if (
          conversation.toolBundles.some(
            (pin) => pin.bundleId === bundleId && pin.generation === generation,
          )
        ) {
          count += 1;
        }
      }
      return count;
    });
    this.#spawner = new FakeToolSpawner({
      tempDir: options.environment.tempDir,
      defaultWorkingDir: options.environment.defaultWorkingDir,
    });
    this.#approvals = new FakeApprovalService({
      ledger: options.approvals,
      clock: this.#clock,
      isInRoot:
        options.isInRoot ??
        ((conversationId, root) =>
          this.#conversations.get(conversationId)?.rootConversationId === root),
    });
    this.#approvalSubscription = this.#approvals.subscribe((update) => {
      this.#onApprovalUpdate(update);
    });
  }

  get approvalsService(): ApprovalService {
    return this.#approvals;
  }

  get toolRegistry(): FakeToolRegistry {
    return this.#tools;
  }

  get tools(): FakeToolRegistry {
    return this.#tools;
  }

  get approvals(): ApprovalService {
    return this.#approvals;
  }

  #now(): string {
    return this.#clock.now().toISOString();
  }

  #emit(conversation: ConversationRecord, make: (seq: EventSeq) => EngineEvent): EngineEvent {
    return conversation.channel.publish(make);
  }

  #descriptor(): EngineDescriptor {
    return {
      name: "cardiary-fake-engine",
      version: "0.0.0",
      storageBackend: "memory",
      capabilities: { nextTurnContextInjection: "pending" },
    };
  }

  async open(): Promise<EngineDescriptor> {
    if (this.#opened) return this.#descriptor();
    this.#opened = true;
    await this.#approvals.restore();
    this.#pendingApprovals = (await this.#approvals.listPending()).length;
    this.#setState("running");
    return this.#descriptor();
  }

  async suspend(): Promise<void> {
    if (this.#state === "paused" || this.#state === "stopped") return;
    for (const conversation of this.#conversations.values()) {
      const turn = conversation.activeTurn;
      if (turn && turn.status === "running") {
        turn.status = "interrupted";
        turn.abort.abort();
        this.#finishTurn(conversation, turn, "interrupted", false);
      }
      conversation.state = "idle";
    }
    await this.#spawner.terminateAll();
    this.#setState("paused");
  }

  async resume(): Promise<void> {
    if (!this.#opened) throw new EngineFailure("engine-closed", "引擎尚未開啟");
    // 恢復也解除緊急暫停：M0 的協定沒有獨立的 resume_all 訊息，
    // control.resume 是唯一會回到 running 的路徑。
    this.#pause = null;
    this.#setState("running");
  }

  async close(): Promise<void> {
    for (const conversation of this.#conversations.values()) {
      const turn = conversation.activeTurn;
      if (turn) {
        turn.status = "restarted";
        turn.abort.abort();
        conversation.activeTurn = null;
        conversation.state = "idle";
      }
      conversation.channel.close();
    }
    await this.#spawner.terminateAll();
    this.#approvalSubscription();
    this.#setState("stopped");
  }

  getStatus(): EngineStatus {
    const values = [...this.#conversations.values()].filter((c) => !c.deleted);
    return {
      state: this.#state,
      pause: this.#pause,
      activeConversations: values.filter((c) => c.state === "running").length,
      activeSubagents: values.filter((c) => c.depth === 1 && c.state === "running").length,
      pendingApprovals: this.#pendingApprovals,
      environment: {
        stateDir: this.#options.environment.stateDir,
        tempDir: this.#options.environment.tempDir,
      },
    };
  }

  onStatusChange(listener: (status: EngineStatus) => void): Unsubscribe {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #setState(state: EngineState): void {
    this.#state = state;
    const status = this.getStatus();
    for (const listener of this.#listeners) listener(status);
  }

  #assertReady(): void {
    if (this.#state === "stopped") {
      throw new EngineFailure("engine-closed", "引擎已關閉");
    }
    if (this.#state === "paused" && this.#pause !== null) {
      throw new EngineFailure("engine-paused", "引擎已緊急暫停");
    }
  }

  #conversation(id: ConversationId): ConversationRecord {
    const conversation = this.#conversations.get(id);
    if (!conversation || conversation.deleted) {
      throw new EngineFailure("conversation-not-found", `找不到對話 ${id}`);
    }
    return conversation;
  }

  #summary(conversation: ConversationRecord): ConversationSummary {
    return {
      id: conversation.id,
      title: conversation.title,
      purpose: conversation.purpose,
      rootConversationId: conversation.rootConversationId,
      depth: conversation.depth,
      visibility: conversation.visibility,
      permissionMode: conversation.permissionMode,
      model: conversation.model,
      state: conversation.state,
      origin: conversation.origin,
      toolBundles: conversation.toolBundles,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      latestCursor: conversation.messages.length ? cursorAt(conversation.messages.length) : null,
    };
  }

  async getConversation(id: ConversationId): Promise<ConversationSummary | null> {
    const conversation = this.#conversations.get(id);
    if (!conversation || conversation.deleted) return null;
    return this.#summary(conversation);
  }

  async findConversationByClientRequestId(
    clientRequestId: string,
  ): Promise<ConversationSummary | null> {
    for (const conversation of this.#conversations.values()) {
      if (conversation.deleted) continue;
      if (conversation.clientRequestId === clientRequestId) return this.#summary(conversation);
    }
    return null;
  }

  async createConversation(request: CreateConversationRequest): Promise<ConversationSummary> {
    this.#assertReady();
    if (request.clientRequestId) {
      const existing = await this.findConversationByClientRequestId(request.clientRequestId);
      if (existing) return existing;
    }
    const id = prefixed("conv");
    const now = this.#now();
    const conversation: ConversationRecord = {
      id,
      title: request.title?.trim() ? request.title : "新對話",
      purpose: request.purpose ?? "conversation",
      rootConversationId: id,
      depth: 0,
      visibility: "listed",
      permissionMode: request.permissionMode ?? "hard-rules",
      model: request.model,
      state: "idle",
      origin: null,
      toolBundles: request.toolBundles,
      createdAt: now,
      updatedAt: now,
      systemContext: request.systemContext,
      staged: null,
      messages: [],
      channel: new EventChannel(this.#options.eventBufferSize ?? 512),
      activeTurn: null,
      queue: [],
      clientRequestId: request.clientRequestId ?? null,
      toolCalls: new Map(),
      turnIndex: new Map(),
      recovery: [],
      deleted: false,
    };
    this.#conversations.set(id, conversation);
    return this.#summary(conversation);
  }

  async restoreConversation(id: ConversationId): Promise<RestoreConversationResult> {
    const conversation = this.#conversation(id);
    const recovered: TurnRecovery[] = [];
    for (const entry of conversation.recovery.splice(0)) {
      recovered.push({
        turnId: entry.turnId,
        triggerMessageId: entry.triggerMessageId,
        outcome: entry.outcome,
        diagnostics: entry.diagnostics,
      });
      if (entry.outcome === "resumed") {
        await this.#rerunInterruptedTools(conversation, entry);
      }
    }
    conversation.state = "idle";
    return {
      conversation: this.#summary(conversation),
      recoveredTurns: recovered,
      pendingApprovals: await this.#approvals.listPending({ conversationId: id }),
    };
  }

  async #rerunInterruptedTools(
    conversation: ConversationRecord,
    entry: RecoveredTurn,
  ): Promise<void> {
    void entry;
    // 重跑安全工具一次：只重送結果事件，不重問已回答的審批。
    const interrupted = [...conversation.toolCalls.values()].filter(
      (call) => call.outcome === null,
    );
    for (const call of interrupted) {
      const definition = this.#tools.resolve(conversation.toolBundles, call.toolName);
      if (!definition || definition.replay !== "safe") continue;
      const outcome = await this.#executeTool(conversation, definition, call.input, call.turnId, {
        callId: call.callId,
        skipPermission: false,
      });
      call.outcome = outcome;
      this.#emit(conversation, (seq) => ({
        kind: "tool.finished",
        seq,
        at: this.#now(),
        conversationId: conversation.id,
        turnId: call.turnId,
        callId: call.callId,
        toolName: call.toolName,
        outcome,
      }));
    }
  }

  async deleteConversation(id: ConversationId, options?: DeleteConversationOptions): Promise<void> {
    const conversation = this.#conversations.get(id);
    if (!conversation || conversation.deleted) return;
    const includeBranches = options?.includeBranches ?? true;
    const targets = new Set<ConversationId>([id]);
    if (includeBranches) {
      for (const candidate of this.#conversations.values()) {
        if (candidate.deleted) continue;
        if (candidate.rootConversationId === id) targets.add(candidate.id);
      }
    }
    for (const targetId of targets) {
      const target = this.#conversations.get(targetId);
      if (!target || target.deleted) continue;
      target.deleted = true;
      target.state = "idle";
      target.activeTurn?.abort.abort();
      target.activeTurn = null;
      target.channel.close();
      this.#emitDeletion(target);
      this.#conversations.delete(targetId);
    }
  }

  #emitDeletion(conversation: ConversationRecord): void {
    // 刪除事件在通道關閉前已沒有意義；保留這個方法讓呼叫端不需要分支。
    void conversation;
  }

  async readConversationHistory(
    request: ReadConversationHistoryRequest,
  ): Promise<ConversationHistoryPage> {
    const conversation = this.#conversation(request.conversationId);
    const limit = request.limit ?? 50;
    const all = conversation.messages;
    let end = all.length;
    if (request.before) {
      const index = parseCursor(request.before);
      if (index === null) throw new EngineFailure("invalid-cursor", "游標不合法");
      end = Math.min(end, index);
    }
    const start = Math.max(0, end - limit);
    const slice = all.slice(start, end);
    return {
      messages: slice.map((entry) => entry.message),
      nextBefore: start > 0 ? cursorAt(start) : null,
    };
  }

  async forkConversation(request: ForkConversationRequest): Promise<ConversationSummary> {
    const source = this.#conversation(request.conversationId);
    const at = parseCursor(request.at);
    if (at === null) throw new EngineFailure("invalid-cursor", "游標不合法");
    const id = prefixed("conv");
    const now = this.#now();
    const origin: ConversationSummary["origin"] = {
      kind: "user-fork",
      parentConversationId: source.id,
      rootConversationId: source.rootConversationId,
      at: request.at,
      depth: 0,
    };
    const conversation: ConversationRecord = {
      id,
      title: request.title?.trim() ? request.title : `${source.title}（分岔）`,
      purpose: "conversation",
      rootConversationId: id,
      depth: 0,
      visibility: "listed",
      permissionMode: source.permissionMode,
      model: request.model ?? source.model,
      state: "idle",
      origin,
      toolBundles: source.toolBundles,
      createdAt: now,
      updatedAt: now,
      systemContext: source.systemContext,
      staged: null,
      messages: source.messages.slice(0, at).map((entry) => ({ ...entry })),
      channel: new EventChannel(this.#options.eventBufferSize ?? 512),
      activeTurn: null,
      queue: [],
      clientRequestId: null,
      toolCalls: new Map(),
      turnIndex: new Map(),
      recovery: [],
      deleted: false,
    };
    this.#conversations.set(id, conversation);
    return this.#summary(conversation);
  }

  async stageConversationUpdate(id: ConversationId, update: ConversationUpdate): Promise<void> {
    const conversation = this.#conversation(id);
    conversation.staged = update;
  }

  /** 手動觸發壓縮；套用預告的變更。 */
  async compact(id: ConversationId): Promise<void> {
    const conversation = this.#conversation(id);
    const applied = conversation.staged !== null;
    if (conversation.staged) {
      if (conversation.staged.systemContext !== undefined) {
        conversation.systemContext = conversation.staged.systemContext;
      }
      if (conversation.staged.toolBundles !== undefined) {
        conversation.toolBundles = conversation.staged.toolBundles;
      }
      conversation.staged = null;
    }
    this.#emit(conversation, (seq) => ({
      kind: "conversation.compacted",
      seq,
      at: this.#now(),
      conversationId: id,
      turnId: null,
      appliedUpdate: applied,
      beforeTokens: null,
      afterTokens: null,
    }));
  }

  async sendMessage(request: SendMessageRequest): Promise<MessageReceipt> {
    return this.#sendMessage(request, undefined);
  }

  async sendMessageWithClientId(request: FakeMessageClientIdRequest): Promise<MessageReceipt> {
    return this.#sendMessage(request, request.clientMessageId);
  }

  async #sendMessage(
    request: SendMessageRequest,
    clientMessageId: string | undefined,
  ): Promise<MessageReceipt> {
    this.#assertReady();
    const conversation = this.#conversation(request.conversationId);
    if (clientMessageId) {
      const existing = this.#findMessage(conversation, clientMessageId);
      if (existing) return existing;
    }
    const text = request.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    if (text.length === 0) {
      throw new EngineFailure("invalid-request", "訊息沒有文字內容");
    }
    const messageId = prefixed("msg");
    const turnId = turnIdFor(messageId);
    const running = conversation.activeTurn;
    const delivery: MessageDelivery = request.delivery;
    if (running && delivery === "reject") {
      throw new EngineFailure("conversation-busy", "對話正在處理另一個回合");
    }
    const queued: QueuedMessage = {
      messageId,
      text,
      sender: request.sender,
      ...(clientMessageId === undefined ? {} : { clientMessageId }),
      steered: running !== null && delivery === "steer",
    };
    this.#appendMessage(conversation, {
      message: {
        id: messageId,
        role: "user",
        content: [{ type: "text", text }],
        createdAt: this.#now(),
        cursor: cursorAt(conversation.messages.length + 1),
      },
      turnId,
      status: "complete",
      ...(clientMessageId === undefined ? {} : { clientMessageId }),
    });
    this.#emit(conversation, (seq) => ({
      kind: "message.appended",
      seq,
      at: this.#now(),
      conversationId: conversation.id,
      turnId,
      message: {
        id: messageId,
        role: "user",
        content: [{ type: "text", text }],
        createdAt: this.#now(),
        cursor: cursorAt(conversation.messages.length),
      },
    }));
    if (running) {
      if (delivery === "steer") {
        running.steers.push(queued);
        return { messageId, turnId, delivery: "steered" };
      }
      conversation.queue.push(queued);
      return { messageId, turnId, delivery: "queued" };
    }
    void this.#startTurn(conversation, queued);
    return { messageId, turnId, delivery: "started" };
  }

  async findMessageByClientId(
    sessionId: ConversationId,
    clientMessageId: string,
  ): Promise<MessageReceipt | null> {
    const conversation = this.#conversations.get(sessionId);
    if (!conversation || conversation.deleted) return null;
    return this.#findMessage(conversation, clientMessageId);
  }

  #findMessage(conversation: ConversationRecord, clientMessageId: string): MessageReceipt | null {
    for (const entry of conversation.messages) {
      if (entry.clientMessageId === clientMessageId) {
        return {
          messageId: entry.message.id,
          turnId: entry.turnId,
          delivery: "started",
        };
      }
    }
    return null;
  }

  #appendMessage(conversation: ConversationRecord, entry: StoredMessage): void {
    conversation.messages.push(entry);
    conversation.updatedAt = this.#now();
  }

  async cancelTurn(request: CancelTurnRequest): Promise<void> {
    const conversation = this.#conversation(request.conversationId);
    const turn = conversation.activeTurn;
    if (!turn) throw new EngineFailure("turn-not-found", "沒有進行中的回合");
    if (request.turnId && request.turnId !== turn.turnId) {
      throw new EngineFailure("turn-not-found", "找不到指定的回合");
    }
    turn.status = "cancelled";
    turn.abort.abort();
    this.#finishTurn(conversation, turn, "cancelled", false);
  }

  subscribe(options: SubscribeOptions): EngineSubscription {
    const conversation = this.#conversation(options.conversationId);
    const subscription = conversation.channel.subscribe(options.afterSeq);
    return {
      conversationId: options.conversationId,
      replay: subscription.replay,
      events: subscription.events,
      close: () => subscription.close(),
    };
  }

  async configureModels(settings: ModelSettings): Promise<void> {
    this.#modelSettings = settings;
  }

  async getModelSettings(): Promise<ModelSettings> {
    if (this.#modelSettings) return this.#modelSettings;
    return {
      providers: [],
      roles: {
        main: { provider: "fake", model: "fake-main" },
        small: { provider: "fake", model: "fake-small" },
        writing: { provider: "fake", model: "fake-writing" },
        "system-one": { provider: "fake", model: "fake-system-one" },
      },
    };
  }

  async pauseAll(reason: string): Promise<EmergencyPause> {
    const pausedTurns: PausedTurn[] = [];
    for (const conversation of this.#conversations.values()) {
      const turn = conversation.activeTurn;
      if (turn && turn.status === "running") {
        pausedTurns.push({ conversationId: conversation.id, turnId: turn.turnId });
        turn.status = "paused";
        turn.abort.abort();
        this.#finishTurn(conversation, turn, "paused", false);
      }
    }
    this.#pause = {
      pauseId: prefixed("pause"),
      reason,
      startedAt: this.#now(),
      pausedTurns,
    };
    this.#setState("paused");
    return this.#pause;
  }

  async resumeAll(): Promise<void> {
    this.#pause = null;
    this.#setState("running");
  }

  async spawnSubagent(request: SpawnSubagentRequest): Promise<SubagentHandle> {
    this.#assertReady();
    const parent = this.#conversation(request.parentConversationId);
    const expectedDepth = parent.depth + 1;
    if (request.depth !== expectedDepth || request.depth > this.#limits.maxDepth) {
      throw new EngineFailure("subagent-depth-exceeded", "子代理深度超過上限");
    }
    const running = [...this.#conversations.values()].filter(
      (candidate) =>
        !candidate.deleted &&
        candidate.origin?.kind === "subagent" &&
        candidate.origin.parentConversationId === parent.id &&
        candidate.state === "running",
    );
    if (running.length >= this.#limits.maxConcurrentPerParent) {
      throw new EngineFailure("subagent-limit-reached", "同一個主對話的子代理已達上限");
    }
    const id = prefixed("conv");
    const now = this.#now();
    const branch: ConversationRecord = {
      id,
      title: request.title?.trim() ? request.title : "子代理",
      purpose: "subagent",
      rootConversationId: parent.rootConversationId,
      depth: 1,
      visibility: "branch",
      permissionMode: parent.permissionMode,
      model: request.model ?? parent.model,
      state: "idle",
      origin: {
        kind: "subagent",
        parentConversationId: parent.id,
        rootConversationId: parent.rootConversationId,
        at: request.at,
        depth: 1,
      },
      toolBundles: parent.toolBundles,
      createdAt: now,
      updatedAt: now,
      systemContext: parent.systemContext,
      staged: null,
      messages: [],
      channel: new EventChannel(this.#options.eventBufferSize ?? 512),
      activeTurn: null,
      queue: [],
      clientRequestId: null,
      toolCalls: new Map(),
      turnIndex: new Map(),
      recovery: [],
      deleted: false,
    };
    this.#conversations.set(id, branch);
    const handle: SubagentHandle = {
      subagentConversationId: id,
      parentConversationId: parent.id,
      rootConversationId: parent.rootConversationId,
      depth: 1,
      title: branch.title,
      status: "running",
      startedAt: now,
      resultCard: null,
    };
    this.#emit(parent, (seq) => ({
      kind: "conversation.branch-created",
      seq,
      at: this.#now(),
      conversationId: parent.id,
      branch: this.#summary(branch),
    }));
    this.#emit(parent, (seq) => ({
      kind: "subagent.started",
      seq,
      at: this.#now(),
      conversationId: parent.id,
      handle,
    }));
    const completion = this.#runSubagent(parent, branch, request, handle);
    if (request.waiting === "blocking") {
      const outcome = await completion;
      return { ...handle, status: outcome.status, resultCard: outcome.resultCard };
    }
    void completion;
    return handle;
  }

  async #runSubagent(
    parent: ConversationRecord,
    branch: ConversationRecord,
    request: SpawnSubagentRequest,
    handle: SubagentHandle,
  ): Promise<SubagentOutcome> {
    const messageId = prefixed("msg");
    this.#appendMessage(branch, {
      message: {
        id: messageId,
        role: "user",
        content: [{ type: "text", text: request.instruction }],
        createdAt: this.#now(),
        cursor: cursorAt(1),
      },
      turnId: turnIdFor(messageId),
      status: "complete",
    });
    this.#scripts.push([{ kind: "text", text: `子代理結論：${request.instruction}` }]);
    await this.#startTurn(branch, {
      messageId,
      text: request.instruction,
      sender: { kind: "system", component: "subagent" },
      steered: false,
    });
    const card = this.#resultCard(branch, request.instruction);
    const outcome: SubagentOutcome = {
      handle: { ...handle, status: "completed", resultCard: card },
      status: "completed",
      resultCard: card,
      failure: null,
    };
    this.#emit(parent, (seq) => ({
      kind: "subagent.completed",
      seq,
      at: this.#now(),
      conversationId: parent.id,
      outcome,
    }));
    for (const waiter of this.#subagentWaiters.get(branch.id)?.splice(0) ?? []) {
      waiter(outcome);
    }
    return outcome;
  }

  #resultCard(branch: ConversationRecord, instruction: string): SubagentResultCard {
    const conclusion = `完成：${instruction}`;
    return {
      cardKind: "subagent-summary",
      cardId: null,
      scope: "conversation",
      title: branch.title,
      conclusion,
      evidence: [{ statement: conclusion, support: `支線 ${branch.id}` }],
      references: [{ kind: "branch-entry", label: branch.title, conversationId: branch.id }],
      unresolved: [],
      tokenEstimate: Math.min(Math.ceil(conclusion.length / 4), this.#limits.resultTokenBudget),
      branchConversationId: branch.id,
      createdAt: this.#now(),
    };
  }

  async waitForSubagent(
    subagentConversationId: ConversationId,
    options?: { readonly signal?: AbortSignal },
  ): Promise<SubagentOutcome> {
    const branch = this.#conversations.get(subagentConversationId);
    if (!branch || branch.deleted) {
      throw new EngineFailure("subagent-not-found", "找不到子代理");
    }
    if (branch.state !== "running") {
      return {
        handle: {
          subagentConversationId,
          parentConversationId: branch.origin?.parentConversationId ?? branch.id,
          rootConversationId: branch.rootConversationId,
          depth: 1,
          title: branch.title,
          status: "completed",
          startedAt: branch.createdAt,
          resultCard: this.#resultCard(branch, branch.title),
        },
        status: "completed",
        resultCard: this.#resultCard(branch, branch.title),
        failure: null,
      };
    }
    return new Promise<SubagentOutcome>((resolve, reject) => {
      const waiters = this.#subagentWaiters.get(subagentConversationId) ?? [];
      const onAbort = (): void => {
        reject(new EngineFailure("internal", "等待子代理已取消"));
      };
      options?.signal?.addEventListener("abort", onAbort, { once: true });
      waiters.push((outcome) => {
        options?.signal?.removeEventListener("abort", onAbort);
        resolve(outcome);
      });
      this.#subagentWaiters.set(subagentConversationId, waiters);
    });
  }

  async cancelSubagent(subagentConversationId: ConversationId, reason: string): Promise<void> {
    const branch = this.#conversations.get(subagentConversationId);
    if (!branch || branch.deleted || branch.depth !== 1) {
      throw new EngineFailure("subagent-not-found", "找不到子代理");
    }
    const turn = branch.activeTurn;
    if (turn) {
      turn.status = "cancelled";
      turn.abort.abort();
      this.#finishTurn(branch, turn, "cancelled", false);
    }
    void reason;
  }

  async listSubagents(parentConversationId: ConversationId): Promise<readonly SubagentHandle[]> {
    const handles: SubagentHandle[] = [];
    for (const candidate of this.#conversations.values()) {
      if (candidate.deleted) continue;
      if (candidate.origin?.kind !== "subagent") continue;
      if (candidate.origin.parentConversationId !== parentConversationId) continue;
      handles.push({
        subagentConversationId: candidate.id,
        parentConversationId,
        rootConversationId: candidate.rootConversationId,
        depth: 1,
        title: candidate.title,
        status: candidate.state === "running" ? "running" : "completed",
        startedAt: candidate.createdAt,
        resultCard:
          candidate.state === "running" ? null : this.#resultCard(candidate, candidate.title),
      });
    }
    return handles;
  }

  async queueNextTurnInjection(): Promise<{
    readonly injectionId: string;
    readonly outcome: "queued" | "unsupported";
  }> {
    return { injectionId: prefixed("inj"), outcome: "unsupported" };
  }

  // ---- 測試控制點 -------------------------------------------------------

  /** 排入下一個回合的腳本。 */
  enqueueScript(steps: readonly FakeModelStep[]): void {
    this.#scripts.push([...steps]);
  }

  /** 模擬行程重啟：序號重來、進行中的回合留下恢復紀錄。 */
  simulateRestart(): void {
    for (const conversation of this.#conversations.values()) {
      const turn = conversation.activeTurn;
      if (turn) {
        const inFlight = [...conversation.toolCalls.values()].filter(
          (call) => call.outcome === null,
        );
        const diagnostics: ToolDiagnostic[] = inFlight.map((call) => {
          const definition = this.#tools.resolve(conversation.toolBundles, call.toolName);
          if (definition && definition.replay === "safe") {
            return { code: "interrupted", message: "重跑安全工具會重跑一次" };
          }
          return { code: "interrupted", message: "非重跑安全的工具不會重跑" };
        });
        const safeInFlight = inFlight.filter((call) => {
          const definition = this.#tools.resolve(conversation.toolBundles, call.toolName);
          return definition?.replay === "safe";
        });
        conversation.recovery.push({
          turnId: turn.turnId,
          triggerMessageId: turn.triggerMessageId,
          outcome:
            inFlight.length === 0
              ? "completed"
              : safeInFlight.length > 0
                ? "resumed"
                : "interrupted",
          diagnostics,
        });
        turn.status = "restarted";
        turn.abort.abort();
        conversation.activeTurn = null;
        conversation.state = "idle";
      }
      conversation.channel.reset();
    }
    this.#state = "paused";
  }

  // ---- 回合執行 ---------------------------------------------------------

  #takeScript(): readonly FakeModelStep[] {
    return this.#scripts.shift() ?? this.#options.defaultScript ?? DEFAULT_SCRIPT;
  }

  async #startTurn(conversation: ConversationRecord, queued: QueuedMessage): Promise<void> {
    if (conversation.activeTurn || conversation.deleted) {
      conversation.queue.push(queued);
      return;
    }
    const turn: TurnRuntime = {
      turnId: turnIdFor(queued.messageId),
      triggerMessageId: queued.messageId,
      abort: new AbortController(),
      status: "running",
      steers: [],
      assistantMessageId: prefixed("msg"),
      text: "",
      toolCalls: [],
    };
    conversation.activeTurn = turn;
    conversation.state = "running";
    conversation.turnIndex.set(queued.messageId, turn.turnId);
    this.#emit(conversation, (seq) => ({
      kind: "turn.started",
      seq,
      at: this.#now(),
      conversationId: conversation.id,
      turnId: turn.turnId,
      trigger: "user-message" satisfies TurnTrigger,
    }));
    try {
      const steps = this.#takeScript();
      for (const step of steps) {
        if (turn.status !== "running") break;
        await this.#applySteers(conversation, turn);
        if (step.kind === "text") {
          await this.#emitText(
            conversation,
            turn,
            step.text,
            step.chunkSize ?? step.text.length,
            step.delayMs ?? 0,
          );
        } else if (step.kind === "tool") {
          await this.#runToolStep(conversation, turn, step.toolName, step.input ?? {});
        } else {
          throw new EngineFailure(step.code, step.message);
        }
      }
      if (turn.status === "running") {
        this.#finishTurn(conversation, turn, "completed", false);
      }
    } catch (error) {
      if (turn.status === "running") {
        turn.status = "failed";
        const failure =
          error instanceof EngineFailure
            ? { code: error.code, message: error.message }
            : { code: "internal" as const, message: "假引擎發生未預期的錯誤" };
        this.#flushAssistant(conversation, turn, "failed");
        this.#emit(conversation, (seq) => ({
          kind: "turn.completed",
          seq,
          at: this.#now(),
          conversationId: conversation.id,
          turnId: turn.turnId,
          status: "failed" satisfies CompletedTurnStatus,
          failure,
        }));
      }
    } finally {
      if (conversation.activeTurn === turn) {
        conversation.activeTurn = null;
        conversation.state = "idle";
        conversation.updatedAt = this.#now();
        this.#drainQueue(conversation);
      }
    }
  }

  async #applySteers(conversation: ConversationRecord, turn: TurnRuntime): Promise<void> {
    while (turn.steers.length > 0) {
      const steer = turn.steers.shift();
      if (!steer) break;
      this.#emit(conversation, (seq) => ({
        kind: "message.appended",
        seq,
        at: this.#now(),
        conversationId: conversation.id,
        turnId: turn.turnId,
        message: {
          id: steer.messageId,
          role: "user",
          content: [{ type: "text", text: steer.text }],
          createdAt: this.#now(),
          cursor: cursorAt(conversation.messages.length),
        },
      }));
    }
  }

  async #emitText(
    conversation: ConversationRecord,
    turn: TurnRuntime,
    text: string,
    chunkSize: number,
    delayMs: number,
  ): Promise<void> {
    const size = Math.max(1, chunkSize);
    for (let offset = 0; offset < text.length; offset += size) {
      if (turn.status !== "running") return;
      if (offset > 0 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (turn.status !== "running") return;
      }
      const delta = text.slice(offset, offset + size);
      turn.text += delta;
      this.#emit(conversation, (seq) => ({
        kind: "assistant.text.delta",
        seq,
        at: this.#now(),
        conversationId: conversation.id,
        turnId: turn.turnId,
        messageId: turn.assistantMessageId,
        text: delta,
      }));
    }
    this.#flushAssistant(conversation, turn, "complete");
  }

  #flushAssistant(
    conversation: ConversationRecord,
    turn: TurnRuntime,
    status: StoredMessage["status"],
  ): void {
    if (turn.text.length === 0) return;
    const message: ConversationMessage = {
      id: turn.assistantMessageId,
      role: "assistant",
      content: [{ type: "text", text: turn.text }],
      createdAt: this.#now(),
      cursor: cursorAt(conversation.messages.length + 1),
    };
    this.#appendMessage(conversation, { message, turnId: turn.turnId, status });
    this.#emit(conversation, (seq) => ({
      kind: "message.appended",
      seq,
      at: this.#now(),
      conversationId: conversation.id,
      turnId: turn.turnId,
      message,
    }));
    turn.text = "";
  }

  #finishTurn(
    conversation: ConversationRecord,
    turn: TurnRuntime,
    status: CompletedTurnStatus,
    skipFlush: boolean,
  ): void {
    if (!skipFlush && status !== "completed") {
      this.#flushAssistant(
        conversation,
        turn,
        status === "cancelled" || status === "paused" || status === "interrupted"
          ? "interrupted"
          : "failed",
      );
    }
    this.#emit(conversation, (seq) => ({
      kind: "turn.completed",
      seq,
      at: this.#now(),
      conversationId: conversation.id,
      turnId: turn.turnId,
      status,
      failure: null,
    }));
  }

  #drainQueue(conversation: ConversationRecord): void {
    const next = conversation.queue.shift();
    if (!next) return;
    void this.#startTurn(conversation, next);
  }

  async #runToolStep(
    conversation: ConversationRecord,
    turn: TurnRuntime,
    toolName: ToolName,
    input: JsonValue,
  ): Promise<void> {
    const callId = prefixed("call");
    const record: ToolCallRecord = {
      callId,
      toolName,
      input,
      turnId: turn.turnId,
      createdAt: this.#now(),
      messageId: prefixed("msg"),
      outcome: null,
    };
    turn.toolCalls.push(record);
    conversation.toolCalls.set(callId, record);
    this.#emit(conversation, (seq) => ({
      kind: "tool.started",
      seq,
      at: this.#now(),
      conversationId: conversation.id,
      turnId: turn.turnId,
      callId,
      toolName,
      input,
    }));
    const definition = this.#tools.resolve(conversation.toolBundles, toolName);
    let outcome: ToolOutcome;
    if (!definition) {
      outcome = {
        ok: false,
        message: `工具 ${toolName} 未註冊或已停用`,
        diagnostics: [{ code: "tool-unavailable" }],
      };
    } else {
      outcome = await this.#executeTool(conversation, definition, input, turn.turnId, {
        callId,
        skipPermission: false,
      });
    }
    record.outcome = outcome;
    if (turn.status !== "running") return;
    this.#emit(conversation, (seq) => ({
      kind: "tool.finished",
      seq,
      at: this.#now(),
      conversationId: conversation.id,
      turnId: turn.turnId,
      callId,
      toolName,
      outcome,
    }));
  }

  async #executeTool(
    conversation: ConversationRecord,
    definition: ToolDefinition,
    input: JsonValue,
    turnId: TurnId,
    options: { readonly callId: ToolCallId; readonly skipPermission: boolean },
  ): Promise<ToolOutcome> {
    const turn = conversation.activeTurn;
    const signal = turn?.abort.signal ?? new AbortController().signal;
    if (!options.skipPermission) {
      const verdict = await this.#options.permissionGate.evaluate({
        conversationId: conversation.id,
        turnId,
        toolCallId: options.callId,
        toolName: definition.name,
        input,
        replay: definition.replay,
        permissionMode: conversation.permissionMode,
      });
      if (verdict.kind === "deny") {
        return {
          ok: false,
          message: `權限規則拒絕：${verdict.reason}`,
          diagnostics: [{ code: "permission-denied" }],
        };
      }
      if (verdict.kind === "ask-human") {
        const draft: ApprovalRequestDraft = {
          conversationId: conversation.id,
          turnId,
          toolCallId: options.callId,
          action: verdict.action,
          risk: verdict.risk,
          requestedBy: { kind: "tool", toolName: definition.name },
          ...(verdict.timeoutMs === undefined ? {} : { timeoutMs: verdict.timeoutMs }),
        };
        const request = await this.#approvals.request(draft);
        const resolution = await this.#awaitApproval(turn, request.id);
        if (resolution === "paused" || resolution === "cancelled") {
          return {
            ok: false,
            message: resolution === "paused" ? "回合已暫停，審批保留" : "回合已取消，審批撤回",
            diagnostics: [resolution === "paused" ? { code: "paused" } : { code: "cancelled" }],
          };
        }
        if (resolution.outcome !== "approved") {
          return {
            ok: false,
            message: resolution.outcome === "denied" ? "使用者拒絕了這個工具" : "審批未核准",
            diagnostics: [
              {
                code:
                  resolution.outcome === "denied"
                    ? "approval-denied"
                    : resolution.outcome === "expired"
                      ? "approval-expired"
                      : "cancelled",
              },
            ],
          };
        }
      }
    }
    return definition.execute(input, {
      conversationId: conversation.id,
      turnId,
      callId: options.callId,
      toolName: definition.name,
      signal,
      tempDir: this.#options.environment.tempDir,
      workingDir: this.#options.environment.defaultWorkingDir,
      spawn: (spec: ToolProcessSpec): ToolProcess => this.#spawner.spawn(spec),
      requestApproval: async (draft: ApprovalRequestDraft): Promise<ApprovalResolution> => {
        const merged: ApprovalRequestDraft = {
          ...draft,
          conversationId: draft.conversationId ?? conversation.id,
          turnId: draft.turnId ?? turnId,
          toolCallId: draft.toolCallId ?? options.callId,
        };
        const request = await this.#approvals.request(merged);
        const resolution = await this.#awaitApproval(turn, request.id);
        if (resolution === "paused" || resolution === "cancelled") {
          return { request, outcome: "withdrawn", decision: null };
        }
        return resolution;
      },
    });
  }

  /**
   * 等審批決定，但把「回合被中止」與「人類還沒決定」分開。
   *
   * 暫停（paused／interrupted／restarted）保留 pending，不撤回；只有使用者
   * 主動取消回合才撤回，避免緊急暫停把待審批清掉。
   */
  async #awaitApproval(
    turn: TurnRuntime | null,
    requestId: string,
  ): Promise<ApprovalResolution | "paused" | "cancelled"> {
    if (!turn) return this.#approvals.waitForDecision(requestId);
    const signal = turn.abort.signal;
    const aborted = new Promise<null>((resolve) => {
      if (signal.aborted) {
        resolve(null);
        return;
      }
      signal.addEventListener("abort", () => resolve(null), { once: true });
    });
    const decision = await Promise.race([this.#approvals.waitForDecision(requestId), aborted]);
    if (decision !== null) return decision;
    if (turn.status === "cancelled") {
      await this.#approvals.withdraw(requestId, "回合已取消");
      return "cancelled";
    }
    return "paused";
  }

  #onApprovalUpdate(update: ApprovalUpdate): void {
    const request = update.kind === "requested" ? update.request : update.resolution.request;
    const conversationId = request.draft.conversationId;
    if (!conversationId) return;
    const conversation = this.#conversations.get(conversationId);
    if (!conversation || conversation.deleted) return;
    if (update.kind === "requested") {
      this.#pendingApprovals += 1;
      this.#emit(conversation, (seq) => ({
        kind: "approval.requested",
        seq,
        at: this.#now(),
        conversationId,
        request: update.request,
      }));
    } else {
      this.#pendingApprovals = Math.max(0, this.#pendingApprovals - 1);
      this.#emit(conversation, (seq) => ({
        kind: "approval.resolved",
        seq,
        at: this.#now(),
        conversationId,
        resolution: update.resolution,
      }));
    }
  }

  // ---- 給主機／測試的輔助 ------------------------------------------------

  /** 目前所有未刪除的對話；測試用來確認刪除與血緣。 */
  async listConversations(): Promise<readonly ConversationSummary[]> {
    return [...this.#conversations.values()]
      .filter((conversation) => !conversation.deleted)
      .map((conversation) => this.#summary(conversation));
  }

  /** 同步快照；測試用。 */
  conversations(): readonly ConversationSummary[] {
    return [...this.#conversations.values()]
      .filter((conversation) => !conversation.deleted)
      .map((conversation) => this.#summary(conversation));
  }

  /** 直接取得對話的訊息文字；測試檢查歷史用。 */
  messageTexts(conversationId: ConversationId): readonly string[] {
    const conversation = this.#conversations.get(conversationId);
    if (!conversation) return [];
    return conversation.messages.map((entry) =>
      entry.message.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
    );
  }

  /** 決定的來源；測試模擬人類按下按鈕。 */
  static human(clientId = "test-client"): HumanActor {
    return { kind: "human", clientId };
  }
}

export function turnIdFor(messageId: MessageId): TurnId {
  return `turn_${messageId}`;
}

function cursorAt(index: number): ConversationCursor {
  return `cur_${index.toString(36)}`;
}

function parseCursor(cursor: ConversationCursor): number | null {
  if (!cursor.startsWith("cur_")) return null;
  const value = Number.parseInt(cursor.slice(4), 36);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export type { EventSeq, ToolContent };
export type { ToolCallId, JsonValue };
