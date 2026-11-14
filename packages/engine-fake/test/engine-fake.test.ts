import type {
  ApprovalDecision,
  ApprovalLedger,
  ApprovalListFilter,
  ApprovalRequest,
  Clock,
  EngineEvent,
  EngineLogger,
  ToolDefinition,
} from "@cardiary/engine-adapter";
import { describe, expect, it } from "vitest";

import { FakeEngine, canonicalJson, computeApprovalKey, turnIdFor } from "../src/index.js";
import type { FakeModelStep } from "../src/index.js";

const clock: Clock = { now: () => new Date() };
const logger: EngineLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

class LocalLedger implements ApprovalLedger {
  readonly records = new Map<string, ApprovalRequest>();
  readonly decisions = new Map<string, ApprovalDecision>();
  commits = 0;

  async record(request: ApprovalRequest): Promise<void> {
    this.records.set(request.id, request);
  }

  async update(request: ApprovalRequest): Promise<void> {
    this.records.set(request.id, request);
  }

  async get(requestId: string): Promise<ApprovalRequest | null> {
    return this.records.get(requestId) ?? null;
  }

  async listPending(filter?: ApprovalListFilter): Promise<readonly ApprovalRequest[]> {
    return [...this.records.values()].filter((request) => {
      if (request.status !== "pending") return false;
      if (filter?.conversationId) return request.draft.conversationId === filter.conversationId;
      return true;
    });
  }

  async commitDecision(decision: ApprovalDecision): Promise<"committed" | "already-decided"> {
    const request = this.records.get(decision.requestId);
    if (!request) return "already-decided";
    if (request.status === "approved" || request.status === "denied") return "already-decided";
    this.commits += 1;
    this.decisions.set(decision.requestId, decision);
    this.records.set(request.id, {
      ...request,
      status: decision.verdict === "approve" ? "approved" : "denied",
    });
    return "committed";
  }
}

interface HarnessOptions {
  readonly eventBufferSize?: number;
  readonly gate?: "ask" | "allow";
  readonly gateTimeoutMs?: number;
  readonly tools?: readonly ToolDefinition[];
  readonly executed?: string[];
}

interface Harness {
  readonly engine: FakeEngine;
  readonly ledger: LocalLedger;
  readonly executed: string[];
}

function defaultTools(executed: string[]): ToolDefinition[] {
  return [
    {
      name: "demo.echo",
      description: "回傳文字",
      parameters: { type: "object" },
      replay: "safe",
      async execute(input) {
        executed.push("demo.echo");
        const text =
          typeof input === "object" && input !== null && "text" in input
            ? String((input as { text?: unknown }).text ?? "")
            : "";
        return { ok: true, content: [{ type: "text", text }] };
      },
    },
    {
      name: "demo.wait",
      description: "等待一下再完成；重跑安全",
      parameters: { type: "object" },
      replay: "safe",
      async execute(input, context) {
        executed.push("demo.wait");
        const ms =
          typeof input === "object" && input !== null && "ms" in input
            ? Number((input as { ms?: unknown }).ms)
            : 20;
        await new Promise((resolve) => setTimeout(resolve, ms));
        void context;
        return { ok: true, content: [{ type: "text", text: "等待完成" }] };
      },
    },
    {
      name: "demo.wait-unsafe",
      description: "等待一下再完成；重跑不安全",
      parameters: { type: "object" },
      replay: "unsafe",
      async execute(input) {
        executed.push("demo.wait-unsafe");
        const ms =
          typeof input === "object" && input !== null && "ms" in input
            ? Number((input as { ms?: unknown }).ms)
            : 20;
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { ok: true, content: [{ type: "text", text: "不安全完成" }] };
      },
    },
  ];
}

function createHarness(options: HarnessOptions = {}): Harness {
  const ledger = new LocalLedger();
  const executed = options.executed ?? [];
  const engine = new FakeEngine({
    environment: {
      stateDir: "/tmp/cardiary-test/state",
      tempDir: "/tmp/cardiary-test/tmp",
      defaultWorkingDir: "/tmp/cardiary-test",
    },
    approvals: ledger,
    permissionGate: {
      async evaluate(request) {
        if (options.gate === "allow") return { kind: "allow" };
        return {
          kind: "ask-human",
          action: {
            kind: "tool-execution",
            summary: `執行 ${request.toolName}`,
            toolName: request.toolName,
            toolInput: request.input,
          },
          risk: "unknown",
          ...(options.gateTimeoutMs === undefined ? {} : { timeoutMs: options.gateTimeoutMs }),
        };
      },
    },
    credentials: {
      async resolve() {
        return { provider: "fake", kind: "none", secret: "" };
      },
    },
    logger,
    clock,
    eventBufferSize: options.eventBufferSize ?? 64,
  });
  void engine.tools.register({
    bundleId: "demo",
    label: "示範",
    generation: 1,
    tools: options.tools ?? defaultTools(executed),
  });
  return { engine, ledger, executed };
}

async function waitFor<T>(check: () => T | null | undefined, ms = 3000): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = check();
    if (value !== null && value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("等待逾時");
}

async function waitForAsync<T>(check: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== null && value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("等待逾時");
}

function watch(engine: FakeEngine, conversationId: string): EngineEvent[] {
  const events: EngineEvent[] = [];
  const subscription = engine.subscribe({ conversationId, afterSeq: 0 });
  void (async () => {
    for await (const event of subscription.events) events.push(event);
  })();
  return events;
}

async function createConversation(engine: FakeEngine, clientRequestId?: string): Promise<string> {
  const summary = await engine.createConversation({
    model: { provider: "fake", model: "fake-main" },
    systemContext: "測試用",
    toolBundles: [{ bundleId: "demo", generation: 1 }],
    ...(clientRequestId === undefined ? {} : { clientRequestId }),
  });
  return summary.id;
}

const textStep = (text: string): FakeModelStep => ({ kind: "text", text, chunkSize: 3 });

async function openWithConversation(options?: HarnessOptions): Promise<{
  harness: Harness;
  conversationId: string;
}> {
  const harness = createHarness(options);
  await harness.engine.open();
  const conversationId = await createConversation(harness.engine);
  return { harness, conversationId };
}

describe("假引擎", () => {
  it("逐筆簽發事件序號，並在超出緩衝時回報 gap", async () => {
    const { harness, conversationId } = await openWithConversation({ eventBufferSize: 2 });
    const events = watch(harness.engine, conversationId);
    harness.engine.enqueueScript([textStep("你好")]);
    await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "哈囉" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    await waitFor(() => events.find((event) => event.kind === "turn.completed"));
    const seqs = events.map((event) => event.seq);
    expect(seqs[0]).toBe(1);
    expect([...seqs].sort((left, right) => left - right)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);

    const stale = harness.engine.subscribe({ conversationId, afterSeq: 0 });
    stale.close();
    expect(stale.replay.gap).toBe(true);
    const recent = harness.engine.subscribe({
      conversationId,
      afterSeq: seqs[seqs.length - 1] ?? 0,
    });
    recent.close();
    expect(recent.replay.gap).toBe(false);
  });

  it("忙碌時 queue 排隊、steer 插話、reject 回 conversation-busy", async () => {
    const { harness, conversationId } = await openWithConversation({ gate: "allow" });
    harness.engine.enqueueScript([{ kind: "text", text: "六個字", chunkSize: 1, delayMs: 15 }]);
    harness.engine.enqueueScript([textStep("第二輪")]);
    await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "一" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    const queued = await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "二" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    const steered = await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "三" }],
      delivery: "steer",
      sender: { kind: "human", clientId: "t" },
    });
    expect(queued.delivery).toBe("queued");
    expect(steered.delivery).toBe("steered");
    await expect(
      harness.engine.sendMessage({
        conversationId,
        content: [{ type: "text", text: "四" }],
        delivery: "reject",
        sender: { kind: "human", clientId: "t" },
      }),
    ).rejects.toMatchObject({ code: "conversation-busy" });
    await waitFor(() =>
      harness.engine.messageTexts(conversationId).filter((text) => text === "第二輪").length > 0
        ? true
        : null,
    );
  });

  it("審批先落地、先寫入的決定勝出，兩個等待者拿到同一個決定", async () => {
    const { harness, conversationId } = await openWithConversation({
      gate: "ask",
      gateTimeoutMs: 5000,
    });
    const events = watch(harness.engine, conversationId);
    harness.engine.enqueueScript([
      { kind: "tool", toolName: "demo.echo", input: { text: "工具" } },
      textStep("完成"),
    ]);
    const receipt = await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "用工具" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    const requested = await waitFor(() =>
      events.find((event) => event.kind === "approval.requested"),
    );
    if (requested.kind !== "approval.requested") throw new Error("沒有審批");
    expect(harness.ledger.records.size).toBe(1);
    const approvalId = requested.request.id;
    const turns = [
      harness.engine.approvals.waitForDecision(approvalId),
      harness.engine.approvals.waitForDecision(approvalId),
    ];
    const results = await Promise.all([
      harness.engine.approvals.decide({
        requestId: approvalId,
        verdict: "approve",
        decidedBy: { kind: "human", clientId: "a" },
      }),
      harness.engine.approvals.decide({
        requestId: approvalId,
        verdict: "deny",
        decidedBy: { kind: "human", clientId: "b" },
      }),
    ]);
    expect(new Set(results.map((result) => result.outcome))).toEqual(
      new Set(["accepted", "already-decided"]),
    );
    expect(harness.ledger.commits).toBe(1);
    const resolutions = await Promise.all(turns);
    expect(resolutions[0]?.outcome).toBe(resolutions[1]?.outcome);
    await waitFor(() => events.find((event) => event.kind === "turn.completed"));
    expect(receipt.turnId).toBe(turnIdFor(receipt.messageId));
    expect(harness.engine.messageTexts(conversationId)).toContain("完成");
  });

  it("同一個 approval_key 重跑時不再詢問；已核准直接沿用", async () => {
    const { harness, conversationId } = await openWithConversation({ gate: "ask" });
    const receipt = await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "建立回合" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    const turnId = turnIdFor(receipt.messageId);
    const draft = {
      conversationId,
      turnId,
      action: {
        kind: "tool-execution" as const,
        summary: "執行 demo.echo",
        toolName: "demo.echo",
        toolInput: { text: "工具" },
      },
      risk: "unknown" as const,
      requestedBy: { kind: "tool" as const, toolName: "demo.echo" },
    };
    const first = await harness.engine.approvals.request(draft);
    const second = await harness.engine.approvals.request(draft);
    expect(second.id).toBe(first.id);
    expect(await harness.engine.approvals.listPending({ conversationId })).toHaveLength(1);
    await harness.engine.approvals.decide({
      requestId: first.id,
      verdict: "approve",
      decidedBy: { kind: "human", clientId: "a" },
    });
    const third = await harness.engine.approvals.request(draft);
    expect(third.id).toBe(first.id);
    expect(third.status).toBe("approved");
    expect(await harness.engine.approvals.listPending({ conversationId })).toHaveLength(0);
  });

  it("approval_key 依照 storage 3.6 的格式：0x1F、欄位順序與 canonical JSON", () => {
    const key = computeApprovalKey({
      scope: "tool",
      conversationId: "conv_1",
      turnId: "turn_msg_1",
      toolName: "demo.echo",
      input: { text: "hi" },
    });
    // 固定向量：cardiary.approval.v1\x1ftool\x1fconv_1\x1fturn_msg_1\x1fdemo.echo\x1f{"text":"hi"}
    expect(key).toBe("04625f62bb456e55271c8a7eccf632a7c02dc595ae85e3c33bb15fe8047ab499");
    const reordered = computeApprovalKey({
      scope: "tool",
      conversationId: "conv_1",
      turnId: "turn_msg_1",
      toolName: "demo.echo",
      input: { text: "hi" },
    });
    expect(reordered).toBe(key);
    expect(
      computeApprovalKey({
        scope: "tool",
        conversationId: "conv_1",
        turnId: "turn_msg_1",
        toolName: "demo.echo",
        input: { text: "hi", extra: true },
      }),
    ).not.toBe(key);
    expect(
      computeApprovalKey({
        scope: "task",
        taskKind: "settings-change",
        subjectId: "s1",
        payload: { a: 1 },
      }),
    ).toHaveLength(64);
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ é: 1, z: 2 })).toBe('{"z":2,"é":1}');
    expect(() => canonicalJson(Number.POSITIVE_INFINITY as never)).toThrow();
  });

  it("兩個並行的 requestApproval 只留一筆 pending，兩個等待者拿到同一個決定", async () => {
    const { harness, conversationId } = await openWithConversation({ gate: "ask" });
    const draft = {
      conversationId,
      turnId: "turn_parallel",
      action: {
        kind: "tool-execution" as const,
        summary: "執行 demo.echo",
        toolName: "demo.echo",
        toolInput: { text: "並行" },
      },
      risk: "unknown" as const,
      requestedBy: { kind: "tool" as const, toolName: "demo.echo" },
      timeoutMs: 5000,
    };
    const [first, second] = await Promise.all([
      harness.engine.approvals.request(draft),
      harness.engine.approvals.request(draft),
    ]);
    expect(second.id).toBe(first.id);
    expect(await harness.engine.approvals.listPending({ conversationId })).toHaveLength(1);
    const waiting = [
      harness.engine.approvals.waitForDecision(first.id),
      harness.engine.approvals.waitForDecision(second.id),
    ];
    await harness.engine.approvals.decide({
      requestId: first.id,
      verdict: "approve",
      decidedBy: { kind: "human", clientId: "a" },
    });
    const resolutions = await Promise.all(waiting);
    expect(resolutions[0]?.outcome).toBe("approved");
    expect(resolutions[1]?.decision?.decidedAt).toBe(resolutions[0]?.decision?.decidedAt);
  });

  it("逾時的 pending 會標成 expired 並允許新的請求", async () => {
    const { harness, conversationId } = await openWithConversation({
      gate: "ask",
      gateTimeoutMs: 10,
    });
    const draft = {
      conversationId,
      turnId: "turn_x",
      action: {
        kind: "tool-execution" as const,
        summary: "執行 demo.echo",
        toolName: "demo.echo",
        toolInput: { text: "1" },
      },
      risk: "unknown" as const,
      requestedBy: { kind: "tool" as const, toolName: "demo.echo" },
      timeoutMs: 10,
    };
    const first = await harness.engine.approvals.request(draft);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const resolution = await harness.engine.approvals.waitForDecision(first.id);
    expect(resolution.outcome).toBe("expired");
    const second = await harness.engine.approvals.request(draft);
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("pending");
  });

  it("刪除主線連同支線；刪除支線不影響主線；刪除是冪等的", async () => {
    const { harness, conversationId } = await openWithConversation({ gate: "allow" });
    harness.engine.enqueueScript([textStep("先有一則訊息")]);
    await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "嗨" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    await waitFor(() => (harness.engine.messageTexts(conversationId).length >= 2 ? true : null));
    const fresh = await harness.engine.getConversation(conversationId);
    const branch = await harness.engine.spawnSubagent({
      parentConversationId: conversationId,
      at: fresh?.latestCursor ?? "cur_0",
      depth: 1,
      waiting: "blocking",
      instruction: "查一下",
    });
    await harness.engine.deleteConversation(branch.subagentConversationId);
    expect(await harness.engine.getConversation(conversationId)).not.toBeNull();
    await harness.engine.deleteConversation(conversationId);
    await harness.engine.deleteConversation(conversationId);
    expect(await harness.engine.getConversation(conversationId)).toBeNull();
    await expect(harness.engine.readConversationHistory({ conversationId })).rejects.toMatchObject({
      code: "conversation-not-found",
    });
  });

  it("分岔只複製分岔點之前的訊息，並有獨立序號", async () => {
    const { harness, conversationId } = await openWithConversation({ gate: "allow" });
    harness.engine.enqueueScript([textStep("第一則")]);
    await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "使用者一" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    await waitFor(() => (harness.engine.messageTexts(conversationId).length >= 2 ? true : null));
    const summary = await harness.engine.getConversation(conversationId);
    const forked = await harness.engine.forkConversation({
      conversationId,
      at: summary?.latestCursor ?? "cur_2",
    });
    expect(forked.visibility).toBe("listed");
    expect(forked.depth).toBe(0);
    expect(forked.origin?.kind).toBe("user-fork");
    expect(harness.engine.messageTexts(forked.id)).toEqual(
      harness.engine.messageTexts(conversationId),
    );
    const events = watch(harness.engine, forked.id);
    harness.engine.enqueueScript([textStep("分支回覆")]);
    await harness.engine.sendMessage({
      conversationId: forked.id,
      content: [{ type: "text", text: "分支訊息" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    await waitFor(() => events.find((event) => event.kind === "turn.completed"));
    expect(events[0]?.seq).toBe(1);
  });

  it("工具組釘選：停用後呼叫回 tool-unavailable，重新註冊同版本恢復", async () => {
    const { harness, conversationId } = await openWithConversation({ gate: "allow" });
    const events = watch(harness.engine, conversationId);
    await harness.engine.tools.retire("demo", 1);
    harness.engine.enqueueScript([
      { kind: "tool", toolName: "demo.echo", input: { text: "x" } },
      textStep("結束"),
    ]);
    await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "呼叫" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    await waitFor(() => events.find((event) => event.kind === "turn.completed"));
    const finished = events.find((event) => event.kind === "tool.finished");
    expect(finished?.kind === "tool.finished" && finished.outcome.ok).toBe(false);
    expect(
      finished?.kind === "tool.finished" &&
        finished.outcome.diagnostics?.some((diagnostic) => diagnostic.code === "tool-unavailable"),
    ).toBe(true);
    await harness.engine.tools.register({
      bundleId: "demo",
      label: "示範",
      generation: 1,
      tools: defaultTools([]),
    });
    const states = await harness.engine.tools.list();
    expect(
      states.find((state) => state.bundleId === "demo" && state.generation === 1),
    ).toBeDefined();
  });

  it("pauseAll 保留待審批：不撤回、不再廣播，恢復後仍可決定並再送訊息", async () => {
    const { harness, conversationId } = await openWithConversation({
      gate: "ask",
      gateTimeoutMs: 5000,
    });
    const events = watch(harness.engine, conversationId);
    harness.engine.enqueueScript([
      { kind: "tool", toolName: "demo.echo", input: { text: "保留" } },
      textStep("完成"),
    ]);
    await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "開始" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    const requested = await waitFor(() =>
      events.find((event) => event.kind === "approval.requested"),
    );
    if (requested.kind !== "approval.requested") throw new Error("沒有審批");
    const pause = await harness.engine.pauseAll("緊急");
    expect(pause.pausedTurns).toHaveLength(1);
    // 沒有 withdrawn／resolved：待審批保留。
    expect(events.some((event) => event.kind === "approval.resolved")).toBe(false);
    const pending = await harness.engine.approvals.listPending({ conversationId });
    expect(pending.map((request) => request.id)).toEqual([requested.request.id]);
    expect(harness.engine.getStatus().pendingApprovals).toBe(1);
    const decided = await harness.engine.approvals.decide({
      requestId: requested.request.id,
      verdict: "approve",
      decidedBy: { kind: "human", clientId: "a" },
    });
    expect(decided.outcome).toBe("accepted");
    await harness.engine.resumeAll();
    harness.engine.enqueueScript([textStep("恢復後")]);
    await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "再送" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    await waitFor(() =>
      harness.engine.messageTexts(conversationId).includes("恢復後") ? true : null,
    );
  });

  it("suspend 會把已串流的文字留在對話裡（中斷訊息）", async () => {
    const { harness, conversationId } = await openWithConversation({ gate: "allow" });
    const events = watch(harness.engine, conversationId);
    harness.engine.enqueueScript([
      { kind: "text", text: "x".repeat(30), chunkSize: 1, delayMs: 15 },
    ]);
    await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "開始" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    await waitFor(() =>
      events.filter((event) => event.kind === "assistant.text.delta").length >= 3 ? true : null,
    );
    await harness.engine.suspend();
    const partial = harness.engine.messageTexts(conversationId);
    expect(partial.some((text) => text.length > 0 && text !== "開始")).toBe(true);
    const appended = events.find(
      (event) => event.kind === "message.appended" && event.message.role === "assistant",
    );
    expect(
      appended?.kind === "message.appended" ? appended.message.content[0] : null,
    ).not.toBeNull();
    const completed = await waitFor(() => events.find((event) => event.kind === "turn.completed"));
    expect(completed.kind === "turn.completed" ? completed.status : null).toBe("interrupted");
    // 解除暫停後可以再送。
    await harness.engine.resume();
    harness.engine.enqueueScript([textStep("再來")]);
    await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "再送" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    await waitFor(() =>
      harness.engine.messageTexts(conversationId).includes("再來") ? true : null,
    );
  });

  it("子代理的審批可用 rootConversationId 篩選", async () => {
    const { harness, conversationId } = await openWithConversation({ gate: "ask" });
    harness.engine.enqueueScript([
      { kind: "tool", toolName: "demo.echo", input: { text: "子代理工具" } },
      textStep("完成"),
    ]);
    const handle = await harness.engine.spawnSubagent({
      parentConversationId: conversationId,
      at: "cur_0",
      depth: 1,
      waiting: "background",
      instruction: "子代理",
    });
    const pending = await waitForAsync(async () => {
      const list = await harness.engine.approvals.listPending({
        rootConversationId: conversationId,
      });
      return list.length > 0 ? list : null;
    });
    expect(
      pending.some((request) => request.draft.conversationId === handle.subagentConversationId),
    ).toBe(true);
  });

  it("緊急暫停中止回合並拒絕新工作；恢復後可再送", async () => {
    const { harness, conversationId } = await openWithConversation({ gate: "allow" });
    const events = watch(harness.engine, conversationId);
    harness.engine.enqueueScript([{ kind: "text", text: "很久很久", chunkSize: 1, delayMs: 20 }]);
    await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "開始" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    await waitFor(() => events.find((event) => event.kind === "assistant.text.delta"));
    const pause = await harness.engine.pauseAll("測試");
    expect(pause.pausedTurns.length).toBeGreaterThanOrEqual(1);
    await expect(
      harness.engine.sendMessage({
        conversationId,
        content: [{ type: "text", text: "再送" }],
        delivery: "queue",
        sender: { kind: "human", clientId: "t" },
      }),
    ).rejects.toMatchObject({ code: "engine-paused" });
    await harness.engine.resumeAll();
    harness.engine.enqueueScript([textStep("恢復後")]);
    await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "恢復" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    await waitFor(() =>
      harness.engine.messageTexts(conversationId).includes("恢復後") ? true : null,
    );
  });

  it("壓縮時套用預告的工具組與固定前綴", async () => {
    const { harness, conversationId } = await openWithConversation();
    const events = watch(harness.engine, conversationId);
    await harness.engine.stageConversationUpdate(conversationId, {
      reason: "module-reload",
      systemContext: "新的前綴",
    });
    await harness.engine.compact(conversationId);
    await harness.engine.compact(conversationId);
    const compactions = events.filter((event) => event.kind === "conversation.compacted");
    expect(compactions).toHaveLength(2);
    expect(compactions[0]?.kind === "conversation.compacted" && compactions[0].appliedUpdate).toBe(
      true,
    );
    expect(compactions[1]?.kind === "conversation.compacted" && compactions[1].appliedUpdate).toBe(
      false,
    );
  });

  it("子代理：上限 4、深度 1、blocking 與 background、列表不含支線", async () => {
    const { harness, conversationId } = await openWithConversation({ gate: "allow" });
    const blocking = await harness.engine.spawnSubagent({
      parentConversationId: conversationId,
      at: "cur_0",
      depth: 1,
      waiting: "blocking",
      instruction: "同步",
    });
    expect(blocking.status).toBe("completed");
    expect(blocking.resultCard?.cardKind).toBe("subagent-summary");
    const background = await harness.engine.spawnSubagent({
      parentConversationId: conversationId,
      at: "cur_0",
      depth: 1,
      waiting: "background",
      instruction: "背景",
    });
    const outcome = await harness.engine.waitForSubagent(background.subagentConversationId);
    expect(outcome.status).toBe("completed");
    const handles = await harness.engine.listSubagents(conversationId);
    expect(handles.length).toBeGreaterThanOrEqual(2);
    const listed = await harness.engine.listConversations();
    expect(listed.some((summary) => summary.visibility === "branch")).toBe(true);
    expect(listed.some((summary) => summary.visibility === "listed")).toBe(true);
    await expect(
      harness.engine.spawnSubagent({
        parentConversationId: conversationId,
        at: "cur_0",
        depth: 0,
        waiting: "blocking",
        instruction: "深度錯",
      }),
    ).rejects.toMatchObject({ code: "subagent-depth-exceeded" });
    // 同時最多 4 個：用會等待的工具讓前 4 個保持 running。
    for (let index = 0; index < 4; index += 1) {
      harness.engine.enqueueScript([
        { kind: "tool", toolName: "demo.wait", input: { ms: 150 } },
        textStep("完成"),
      ]);
    }
    harness.engine.enqueueScript([textStep("不該用到")]);
    for (let index = 0; index < 4; index += 1) {
      await harness.engine.spawnSubagent({
        parentConversationId: conversationId,
        at: "cur_0",
        depth: 1,
        waiting: "background",
        instruction: `並行 ${index}`,
      });
    }
    await expect(
      harness.engine.spawnSubagent({
        parentConversationId: conversationId,
        at: "cur_0",
        depth: 1,
        waiting: "background",
        instruction: "超過上限",
      }),
    ).rejects.toMatchObject({ code: "subagent-limit-reached" });
  });

  it("冪等回查：同一個 clientMessageId 與 clientRequestId 不會建立第二份", async () => {
    const { harness, conversationId } = await openWithConversation({ gate: "allow" });
    const again = await harness.engine.createConversation({
      model: { provider: "fake", model: "fake-main" },
      systemContext: "x",
      toolBundles: [],
      clientRequestId: undefined,
    });
    expect(again.id).not.toBe(conversationId);
    const withRequest = await harness.engine.createConversation({
      model: { provider: "fake", model: "fake-main" },
      systemContext: "x",
      toolBundles: [],
      clientRequestId: "cr-9",
    });
    const duplicate = await harness.engine.createConversation({
      model: { provider: "fake", model: "fake-main" },
      systemContext: "x",
      toolBundles: [],
      clientRequestId: "cr-9",
    });
    expect(duplicate.id).toBe(withRequest.id);
    harness.engine.enqueueScript([textStep("回應")]);
    const first = await harness.engine.sendMessageWithClientId({
      conversationId,
      content: [{ type: "text", text: "一" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
      clientMessageId: "cm-9",
    });
    const second = await harness.engine.sendMessageWithClientId({
      conversationId,
      content: [{ type: "text", text: "一" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
      clientMessageId: "cm-9",
    });
    expect(second.messageId).toBe(first.messageId);
    expect(await harness.engine.findMessageByClientId(conversationId, "cm-9")).not.toBeNull();
    expect(await harness.engine.findMessageByClientId(conversationId, "cm-x")).toBeNull();
  });

  it("恢復：重跑安全工具重跑一次，非重跑安全回 interrupted", async () => {
    const executed: string[] = [];
    const { harness, conversationId } = await openWithConversation({
      gate: "allow",
      executed,
    });
    const events = watch(harness.engine, conversationId);
    harness.engine.enqueueScript([
      { kind: "tool", toolName: "demo.wait", input: { ms: 200 } },
      textStep("完成"),
    ]);
    const receipt = await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "開始" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    await waitFor(() => events.find((event) => event.kind === "tool.started"));
    harness.engine.simulateRestart();
    const restored = await harness.engine.restoreConversation(conversationId);
    expect(restored.recoveredTurns[0]?.turnId).toBe(turnIdFor(receipt.messageId));
    expect(restored.recoveredTurns[0]?.outcome).toBe("resumed");
    await waitFor(() =>
      executed.filter((name) => name === "demo.wait").length >= 2 ? true : null,
    );

    const unsafeEvents = watch(harness.engine, conversationId);
    await harness.engine.resume();
    harness.engine.enqueueScript([
      { kind: "tool", toolName: "demo.wait-unsafe", input: { ms: 200 } },
      textStep("結束"),
    ]);
    await harness.engine.sendMessage({
      conversationId,
      content: [{ type: "text", text: "再開始" }],
      delivery: "queue",
      sender: { kind: "human", clientId: "t" },
    });
    await waitFor(() => unsafeEvents.find((event) => event.kind === "tool.started"));
    harness.engine.simulateRestart();
    const restoredUnsafe = await harness.engine.restoreConversation(conversationId);
    expect(restoredUnsafe.recoveredTurns[0]?.outcome).toBe("interrupted");
    expect(restoredUnsafe.recoveredTurns[0]?.diagnostics[0]?.code).toBe("interrupted");
    expect(executed.filter((name) => name === "demo.wait-unsafe")).toHaveLength(1);
  });

  it("模型設定與暫存目錄", async () => {
    const { harness, conversationId } = await openWithConversation({ gate: "allow" });
    await harness.engine.configureModels({
      providers: [],
      roles: {
        main: { provider: "fake", model: "main-2" },
        small: { provider: "fake", model: "small" },
        writing: { provider: "fake", model: "writing" },
        "system-one": { provider: "fake", model: "one" },
      },
    });
    const settings = await harness.engine.getModelSettings();
    expect(settings.roles.main.model).toBe("main-2");
    const summary = await harness.engine.createConversation({
      model: settings.roles.main,
      systemContext: "x",
      toolBundles: [],
    });
    expect(summary.model.model).toBe("main-2");
    expect(harness.engine.getStatus().environment.tempDir).toBe("/tmp/cardiary-test/tmp");
    void conversationId;
    const receipt = await harness.engine.queueNextTurnInjection({
      conversationId: summary.id,
      source: "subagent-result-card",
      text: "卡片",
      cardIds: [],
    });
    expect(receipt.outcome).toBe("unsupported");
  });
});
