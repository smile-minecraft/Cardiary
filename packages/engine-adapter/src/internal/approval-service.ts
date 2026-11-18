import { randomUUID } from "node:crypto";

import type {
  ApprovalDecision,
  ApprovalLedger,
  ApprovalListFilter,
  ApprovalRequest,
  ApprovalRequestDraft,
  ApprovalResolution,
  ApprovalService,
  ApprovalUpdate,
  ApprovalWaitOptions,
  DecideApprovalInput,
  DecideApprovalResult,
  HumanActor,
} from "../approval.js";
import type { ApprovalRequestId } from "../ids.js";
import type { Clock, Unsubscribe } from "../runtime.js";
import {
  computeApprovalKey,
  computeExternalAgentApprovalKey,
  computeHostApprovalKey,
} from "./canonical.js";
import { engineError } from "./errors.js";

interface Waiter {
  readonly resolve: (resolution: ApprovalResolution) => void;
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/** 把 draft 的輸入正規化成 `approval_key` 的第五段。 */
function draftPayload(draft: ApprovalRequestDraft): unknown {
  if (draft.action.toolInput !== undefined) {
    return draft.action.toolInput;
  }
  return {
    kind: draft.action.kind,
    summary: draft.action.summary,
    details: draft.action.details ?? [],
  };
}

/**
 * 審批服務的實作。
 *
 * 權威是 `ApprovalLedger`（`state/cardiary.sqlite` 的 `approvals` 表）；
 * 這個類別只快取目前行程的請求與等待者，並對同一個 `approvalKey` 做
 * single-flight，讓同一個行程的兩個等待者共用同一個請求。
 * 跨重啟時的決定由 ledger 讀回，不依賴這裡的記憶體。
 */
export class ApprovalServiceImpl implements ApprovalService {
  readonly #ledger: ApprovalLedger;
  readonly #clock: Clock;
  readonly #requests = new Map<ApprovalRequestId, ApprovalRequest>();
  readonly #waiters = new Map<ApprovalRequestId, Set<Waiter>>();
  readonly #byKey = new Map<string, Promise<ApprovalRequest>>();
  /** 每個請求最多一個到期計時器；到期、決定或撤回後清掉。 */
  readonly #expiryTimers = new Map<ApprovalRequestId, NodeJS.Timeout>();
  /** 正在寫入 expired 的請求；多個計時器同時到期時只處理一次。 */
  readonly #expiring = new Set<ApprovalRequestId>();
  readonly #listeners = new Set<{
    readonly listener: (update: ApprovalUpdate) => void;
    readonly filter: ApprovalListFilter | undefined;
  }>();

  constructor(options: { readonly ledger: ApprovalLedger; readonly clock: Clock }) {
    this.#ledger = options.ledger;
    this.#clock = options.clock;
  }

  async request(draft: ApprovalRequestDraft): Promise<ApprovalRequest> {
    const { approvalKey, toolName } = this.#approvalSource(draft);
    const inFlight = this.#byKey.get(approvalKey);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const created = this.#record(draft, approvalKey, toolName);
    this.#byKey.set(approvalKey, created);
    try {
      return await created;
    } finally {
      this.#byKey.delete(approvalKey);
    }
  }

  /** 依來源決定去重鍵；宿主、外部代理、一般對話三條路互不相通。 */
  #approvalSource(draft: ApprovalRequestDraft): {
    readonly approvalKey: string;
    readonly toolName?: string;
  } {
    if (draft.hostApproval !== undefined) {
      return this.#hostSource(draft, draft.hostApproval);
    }
    const toolName =
      draft.action.toolName ??
      (draft.requestedBy.kind === "tool" ? draft.requestedBy.toolName : undefined);
    if (toolName === undefined || toolName.length === 0) {
      throw engineError("invalid-request", "工具審批必須帶工具名稱");
    }
    const external = draft.externalAgent;
    if (external !== undefined) {
      if (
        !external.sessionId ||
        !external.requestId ||
        draft.requestedBy.kind !== "agent" ||
        draft.requestedBy.agentId !== external.sessionId ||
        draft.conversationId !== undefined ||
        draft.turnId !== undefined
      ) {
        throw engineError("invalid-request", "外部代理審批必須帶一致的工作階段與請求識別碼");
      }
      return {
        toolName,
        approvalKey: computeExternalAgentApprovalKey({
          sessionId: external.sessionId,
          requestId: external.requestId,
          toolName,
          payload: draftPayload(draft) as never,
        }),
      };
    }
    if (draft.conversationId === undefined || draft.turnId === undefined) {
      throw engineError("invalid-request", "對話審批必須帶 conversationId 與 turnId");
    }
    return {
      toolName,
      approvalKey: computeApprovalKey({
        scope: "tool",
        conversationId: draft.conversationId,
        turnId: draft.turnId,
        toolName,
        payload: draftPayload(draft) as never,
      }),
    };
  }

  /** 宿主審批不要求工具名稱；綁定元件、請求識別碼與正規化輸入。 */
  #hostSource(
    draft: ApprovalRequestDraft,
    host: { readonly component: string; readonly requestId: string },
  ): { readonly approvalKey: string } {
    if (
      host.component.length === 0 ||
      host.requestId.length === 0 ||
      draft.requestedBy.kind !== "host" ||
      draft.requestedBy.component !== host.component ||
      draft.conversationId !== undefined ||
      draft.turnId !== undefined ||
      draft.externalAgent !== undefined
    ) {
      throw engineError(
        "invalid-request",
        "宿主審批必須由一致的宿主元件提出，且不帶對話、回合或外部代理識別碼",
      );
    }
    return {
      approvalKey: computeHostApprovalKey({
        component: host.component,
        requestId: host.requestId,
        actionKind: draft.action.kind,
        payload: draftPayload(draft) as never,
      }),
    };
  }

  async #record(
    draft: ApprovalRequestDraft,
    approvalKey: string,
    toolName?: string,
  ): Promise<ApprovalRequest> {
    const now = this.#clock.now();
    const timeoutMs = draft.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : draft.timeoutMs;
    const expiresAt = timeoutMs === null ? null : new Date(now.getTime() + timeoutMs).toISOString();
    const candidate: ApprovalRequest = {
      id: `apr_${randomUUID()}`,
      status: "pending",
      requestedAt: now.toISOString(),
      expiresAt,
      draft: {
        ...draft,
        action: toolName === undefined ? draft.action : { ...draft.action, toolName },
      },
      approvalKey,
    };

    const outcome = await this.#ledger.record(candidate);
    const request = outcome.request;
    this.#requests.set(request.id, request);
    if (outcome.kind === "created") {
      this.#publish({ kind: "requested", request });
      if (request.expiresAt !== null) {
        this.#scheduleExpiry(request.id, request.expiresAt);
      }
    }
    return request;
  }

  async get(requestId: ApprovalRequestId): Promise<ApprovalRequest | null> {
    const cached = this.#requests.get(requestId);
    if (cached !== undefined) {
      return cached;
    }
    const stored = await this.#ledger.get(requestId);
    if (stored !== null) {
      this.#requests.set(stored.id, stored);
    }
    return stored;
  }

  listPending(filter?: ApprovalListFilter): Promise<readonly ApprovalRequest[]> {
    return this.#ledger.listPending(filter);
  }

  async waitForDecision(
    requestId: ApprovalRequestId,
    options?: ApprovalWaitOptions,
  ): Promise<ApprovalResolution> {
    const request = await this.get(requestId);
    if (request === null) {
      throw engineError("approval-not-found", `找不到審批請求 ${requestId}`);
    }
    if (request.status === "approved" || request.status === "denied") {
      return {
        request,
        outcome: request.status,
        decision: request.decision ?? null,
      };
    }
    if (request.status === "expired" || request.status === "withdrawn") {
      return { request, outcome: request.status, decision: null };
    }

    if (options?.signal?.aborted === true) {
      throw engineError("invalid-request", "等待審批已被取消");
    }

    return new Promise<ApprovalResolution>((resolve) => {
      const waiter: Waiter = { resolve };
      const waiters = this.#waiters.get(requestId) ?? new Set<Waiter>();
      waiters.add(waiter);
      this.#waiters.set(requestId, waiters);

      const signal = options?.signal;
      if (signal !== undefined) {
        signal.addEventListener(
          "abort",
          () => {
            this.#removeWaiter(requestId, waiter);
            resolve({ request, outcome: "withdrawn", decision: null });
          },
          { once: true },
        );
      }

      // 重啟後從 ledger 讀回的請求沒有在這個行程排過到期，等待時補上。
      if (request.expiresAt !== null) {
        this.#scheduleExpiry(requestId, request.expiresAt);
      }
    });
  }

  async decide(input: DecideApprovalInput): Promise<DecideApprovalResult> {
    assertHuman(input.decidedBy);
    const request = await this.get(input.requestId);
    if (request === null) {
      return { outcome: "not-found" };
    }
    if (request.status === "expired") {
      return { outcome: "expired", request };
    }
    if (request.status === "withdrawn") {
      return { outcome: "withdrawn", request };
    }
    const decision: ApprovalDecision = {
      requestId: request.id,
      verdict: input.verdict,
      decidedAt: this.#clock.now().toISOString(),
      decidedBy: input.decidedBy,
      ...(input.note === undefined ? {} : { note: input.note }),
    };
    const result = await this.#ledger.commitDecision(decision);
    const latest = (await this.#ledger.get(request.id)) ?? request;
    this.#requests.set(latest.id, latest);
    if (result === "already-decided") {
      const previous = latest.decision ?? decision;
      return { outcome: "already-decided", decision: previous };
    }
    const resolution: ApprovalResolution = {
      request: latest,
      outcome: input.verdict === "approve" ? "approved" : "denied",
      decision,
    };
    this.#publish({ kind: "resolved", resolution });
    this.#settle(request.id, resolution);
    return { outcome: "accepted", decision };
  }

  async withdraw(requestId: ApprovalRequestId, reason: string): Promise<ApprovalResolution> {
    const request = await this.get(requestId);
    if (request === null) {
      throw engineError("approval-not-found", `找不到審批請求 ${requestId}`);
    }
    if (request.status !== "pending") {
      return {
        request,
        outcome:
          request.status === "expired"
            ? "expired"
            : request.status === "withdrawn"
              ? "withdrawn"
              : request.status === "approved"
                ? "approved"
                : "denied",
        decision: request.decision ?? null,
      };
    }
    const withdrawn: ApprovalRequest = { ...request, status: "withdrawn" };
    await this.#ledger.update(withdrawn);
    this.#requests.set(requestId, withdrawn);
    const resolution: ApprovalResolution = {
      request: withdrawn,
      outcome: "withdrawn",
      decision: null,
    };
    this.#publish({ kind: "resolved", resolution });
    this.#settle(requestId, resolution);
    void reason;
    return resolution;
  }

  subscribe(listener: (update: ApprovalUpdate) => void, filter?: ApprovalListFilter): Unsubscribe {
    const entry = { listener, filter };
    this.#listeners.add(entry);
    return () => {
      this.#listeners.delete(entry);
    };
  }

  /** 記錄一次已存在的決定，供重跑時直接續跑。 */
  remember(request: ApprovalRequest): void {
    this.#requests.set(request.id, request);
  }

  #publish(update: ApprovalUpdate): void {
    for (const { listener, filter } of [...this.#listeners]) {
      if (!matchesFilter(update, filter)) {
        continue;
      }
      try {
        listener(update);
      } catch {
        // 監聽者的錯誤不影響審批流程。
      }
    }
  }

  #settle(requestId: ApprovalRequestId, resolution: ApprovalResolution): void {
    const timer = this.#expiryTimers.get(requestId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.#expiryTimers.delete(requestId);
    }
    const waiters = this.#waiters.get(requestId);
    if (waiters === undefined) {
      return;
    }
    this.#waiters.delete(requestId);
    for (const waiter of waiters) {
      waiter.resolve(resolution);
    }
  }

  #removeWaiter(requestId: ApprovalRequestId, waiter: Waiter): void {
    const waiters = this.#waiters.get(requestId);
    waiters?.delete(waiter);
    if (waiters !== undefined && waiters.size === 0) {
      this.#waiters.delete(requestId);
    }
  }

  /** 依時鐘排一個到期計時器；同一請求已有計時器就不重排。 */
  #scheduleExpiry(requestId: ApprovalRequestId, expiresAt: string): void {
    if (this.#expiryTimers.has(requestId)) {
      return;
    }
    const delay = Math.max(0, Date.parse(expiresAt) - this.#clock.now().getTime());
    const timer = setTimeout(() => {
      this.#expiryTimers.delete(requestId);
      void this.#expire(requestId);
    }, delay);
    timer.unref?.();
    this.#expiryTimers.set(requestId, timer);
  }

  async #expire(requestId: ApprovalRequestId): Promise<void> {
    const request = this.#requests.get(requestId);
    if (request === undefined || request.status !== "pending" || this.#expiring.has(requestId)) {
      return;
    }
    // 計時器可能比時鐘早一點觸發（Node 計時器約早 1 ms，或注入的時鐘落後）；
    // 還沒到期就依剩餘時間重排，不能就此放棄，否則請求永遠停在 pending。
    if (request.expiresAt !== null && Date.parse(request.expiresAt) > this.#clock.now().getTime()) {
      this.#scheduleExpiry(requestId, request.expiresAt);
      return;
    }
    this.#expiring.add(requestId);
    try {
      const expired: ApprovalRequest = { ...request, status: "expired" };
      await this.#ledger.update(expired);
      this.#requests.set(requestId, expired);
      const resolution: ApprovalResolution = {
        request: expired,
        outcome: "expired",
        decision: null,
      };
      this.#publish({ kind: "resolved", resolution });
      this.#settle(requestId, resolution);
    } finally {
      this.#expiring.delete(requestId);
    }
  }
}

function assertHuman(actor: HumanActor): void {
  if (actor.kind !== "human") {
    throw engineError("invalid-request", "只有人類可以核准或拒絕審批");
  }
}

function matchesFilter(update: ApprovalUpdate, filter: ApprovalListFilter | undefined): boolean {
  if (filter === undefined) {
    return true;
  }
  const draft =
    update.kind === "requested" ? update.request.draft : update.resolution.request.draft;
  const { conversationId } = draft;
  if (filter.conversationId !== undefined && conversationId !== filter.conversationId) {
    return false;
  }
  if (filter.rootConversationId !== undefined) {
    const root = draft.subagent?.rootConversationId ?? conversationId;
    if (root !== filter.rootConversationId) {
      return false;
    }
  }
  return true;
}
