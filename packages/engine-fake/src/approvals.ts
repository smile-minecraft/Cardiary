import { createHash } from "node:crypto";
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
  Clock,
  DecideApprovalInput,
  DecideApprovalResult,
  Unsubscribe,
} from "@cardiary/engine-adapter";
import type { JsonValue } from "@cardiary/engine-adapter";

import { prefixed } from "./ids.js";

/** 正規化 JSON：鍵排序、不含空白，用來算審批去重鍵。 */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export interface ApprovalKeyParts {
  readonly scope: "tool" | "task";
  readonly conversationId?: string;
  readonly turnId?: string;
  readonly toolName?: string;
  readonly input?: JsonValue;
  readonly taskKind?: string;
  readonly subjectId?: string;
  readonly payload?: JsonValue;
}

/** 審批去重鍵；規則見 storage 第 3.6 節。 */
export function computeApprovalKey(parts: ApprovalKeyParts): string {
  const payload = [
    "cardiary.approval.v1",
    parts.scope,
    parts.conversationId ?? "",
    parts.turnId ?? "",
    parts.toolName ?? "",
    parts.input === undefined ? "" : canonicalJson(parts.input),
    parts.taskKind ?? "",
    parts.subjectId ?? "",
    parts.payload === undefined ? "" : canonicalJson(parts.payload),
  ].join("\u0000");
  return createHash("sha256").update(payload).digest("hex");
}

interface KeyIndexEntry {
  readonly key: string;
  readonly requestId: string;
}

interface Waiter {
  resolve: (resolution: ApprovalResolution) => void;
  timer: ReturnType<typeof setTimeout> | null;
  onAbort: (() => void) | null;
}

export interface ApprovalServiceOptions {
  readonly ledger: ApprovalLedger;
  readonly clock: Clock;
  /** 給 `rootConversationId` 篩選用：判斷某場對話是否屬於這個主線。 */
  readonly isInRoot?: (conversationId: string, rootConversationId: string) => boolean;
  /** 預設逾時；`null` 表示不逾時。 */
  readonly defaultTimeoutMs?: number | null;
}

/**
 * 假引擎的審批服務：先落地再等待、先寫入的決定勝出、重跑時用
 * `approval_key` 找回同一筆。
 *
 * 真實產品由儲存層的 `approvals` 表當權威；這裡用同一套順序在記憶體模擬，
 * 另外把每一筆變更寫進注入的 `ApprovalLedger`，讓主機可以驗證落地順序。
 */
export class FakeApprovalService implements ApprovalService {
  readonly #ledger: ApprovalLedger;
  readonly #clock: Clock;
  readonly #isInRoot: (conversationId: string, rootConversationId: string) => boolean;
  readonly #defaultTimeoutMs: number | null;
  readonly #requests = new Map<string, ApprovalRequest>();
  readonly #keyOrder: KeyIndexEntry[] = [];
  readonly #waiters = new Map<string, Waiter[]>();
  readonly #listeners = new Set<{
    listener: (update: ApprovalUpdate) => void;
    filter?: ApprovalListFilter;
  }>();
  readonly #decisions = new Map<string, ApprovalDecision>();
  #serial: Promise<unknown> = Promise.resolve();

  constructor(options: ApprovalServiceOptions) {
    this.#ledger = options.ledger;
    this.#clock = options.clock;
    this.#isInRoot = options.isInRoot ?? ((conversationId, root) => conversationId === root);
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 300_000;
  }

  /** 從 ledger 接回尚未結束的請求；模擬重啟後的恢復。 */
  async restore(): Promise<void> {
    const pending = await this.#ledger.listPending();
    for (const request of pending) {
      this.#requests.set(request.id, request);
      this.#rememberKey(request);
      this.#scheduleExpiry(request);
    }
  }

  #serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#serial.then(work, work);
    this.#serial = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  #now(): Date {
    return this.#clock.now();
  }

  #rememberKey(request: ApprovalRequest): void {
    const key = approvalKeyOf(request);
    this.#keyOrder.push({ key, requestId: request.id });
    this.#keyIndex.set(request.id, key);
  }

  readonly #keyIndex = new Map<string, string>();

  #latestFor(key: string): ApprovalRequest | null {
    for (let index = this.#keyOrder.length - 1; index >= 0; index -= 1) {
      const entry = this.#keyOrder[index];
      if (entry && entry.key === key) {
        return this.#requests.get(entry.requestId) ?? null;
      }
    }
    return null;
  }

  async request(draft: ApprovalRequestDraft): Promise<ApprovalRequest> {
    return this.#serialize(async () => {
      const key = keyOfDraft(draft);
      const latest = this.#latestFor(key);
      if (latest) {
        if (latest.status === "approved" || latest.status === "denied") {
          return latest;
        }
        if (latest.status === "pending" && !this.#isExpired(latest)) {
          return latest;
        }
        if (latest.status === "pending") {
          await this.#expire(latest);
        }
      }
      const timeoutMs = draft.timeoutMs === undefined ? this.#defaultTimeoutMs : draft.timeoutMs;
      const requestedAt = this.#now();
      const request: ApprovalRequest = {
        id: prefixed("appr"),
        status: "pending",
        requestedAt: requestedAt.toISOString(),
        expiresAt:
          timeoutMs === null ? null : new Date(requestedAt.getTime() + timeoutMs).toISOString(),
        draft,
      };
      this.#requests.set(request.id, request);
      this.#keyIndex.set(request.id, key);
      this.#keyOrder.push({ key, requestId: request.id });
      await this.#ledger.record(request);
      this.#scheduleExpiry(request);
      this.#notify({ kind: "requested", request });
      return request;
    });
  }

  #isExpired(request: ApprovalRequest): boolean {
    if (request.expiresAt === null) return false;
    return Date.parse(request.expiresAt) <= this.#now().getTime();
  }

  async #expire(request: ApprovalRequest): Promise<void> {
    if (request.status !== "pending") return;
    const expired: ApprovalRequest = { ...request, status: "expired" };
    this.#requests.set(expired.id, expired);
    await this.#ledger.update(expired);
    this.#resolveWaiters(expired, "expired", null);
    this.#notify({
      kind: "resolved",
      resolution: { request: expired, outcome: "expired", decision: null },
    });
  }

  #scheduleExpiry(request: ApprovalRequest): void {
    if (request.expiresAt === null) return;
    const delay = Math.max(0, Date.parse(request.expiresAt) - this.#now().getTime());
    const timer = setTimeout(() => {
      void this.#serialize(async () => {
        const current = this.#requests.get(request.id);
        if (current && current.status === "pending" && this.#isExpired(current)) {
          await this.#expire(current);
        }
      });
    }, delay);
    timer.unref?.();
  }

  async get(requestId: string): Promise<ApprovalRequest | null> {
    const local = this.#requests.get(requestId);
    if (local) return local;
    const stored = await this.#ledger.get(requestId);
    if (stored) {
      this.#requests.set(stored.id, stored);
      const key = approvalKeyOf(stored);
      if (!this.#keyIndex.has(stored.id)) {
        this.#keyIndex.set(stored.id, key);
        this.#keyOrder.push({ key, requestId: stored.id });
      }
    }
    return stored;
  }

  async listPending(filter?: ApprovalListFilter): Promise<readonly ApprovalRequest[]> {
    const pending = [...this.#requests.values()].filter(
      (request) => request.status === "pending" && !this.#isExpired(request),
    );
    return pending.filter((request) => this.#matches(request, filter));
  }

  #matches(request: ApprovalRequest, filter?: ApprovalListFilter): boolean {
    if (!filter) return true;
    const conversationId = request.draft.conversationId;
    if (filter.conversationId !== undefined) {
      return conversationId === filter.conversationId;
    }
    if (filter.rootConversationId !== undefined) {
      if (conversationId === undefined) return false;
      return this.#isInRoot(conversationId, filter.rootConversationId);
    }
    return true;
  }

  waitForDecision(requestId: string, options?: ApprovalWaitOptions): Promise<ApprovalResolution> {
    const existing = this.#requests.get(requestId);
    if (existing) {
      const immediate = resolutionOf(existing, this.#decisions);
      if (immediate) return Promise.resolve(immediate);
    }
    return new Promise<ApprovalResolution>((resolveWait) => {
      const signal = options?.signal;
      const waiter: Waiter = { resolve: () => undefined, timer: null, onAbort: null };
      waiter.resolve = (resolution: ApprovalResolution): void => {
        if (waiter.timer) clearTimeout(waiter.timer);
        if (signal && waiter.onAbort) signal.removeEventListener("abort", waiter.onAbort);
        resolveWait(resolution);
      };
      if (existing && existing.expiresAt !== null) {
        const delay = Math.max(0, Date.parse(existing.expiresAt) - this.#now().getTime());
        const timer = setTimeout(() => {
          void this.#serialize(async () => {
            const current = this.#requests.get(requestId);
            if (current && current.status === "pending") await this.#expire(current);
          });
        }, delay);
        timer.unref?.();
        waiter.timer = timer;
      }
      if (signal) {
        const onAbort = (): void => {
          void this.#serialize(async () => {
            const current = this.#requests.get(requestId);
            if (current && current.status === "pending") {
              await this.#withdrawLocked(current, "等待已取消");
            } else if (current) {
              const resolution = resolutionOf(current, this.#decisions);
              if (resolution) waiter.resolve(resolution);
            }
          });
        };
        waiter.onAbort = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }
      const list = this.#waiters.get(requestId) ?? [];
      list.push(waiter);
      this.#waiters.set(requestId, list);
    });
  }

  #resolveWaiters(
    request: ApprovalRequest,
    outcome: ApprovalResolution["outcome"],
    decision: ApprovalDecision | null,
  ): void {
    const list = this.#waiters.get(request.id);
    if (!list) return;
    this.#waiters.delete(request.id);
    for (const waiter of list) {
      waiter.resolve({ request, outcome, decision });
    }
  }

  decide(input: DecideApprovalInput): Promise<DecideApprovalResult> {
    return this.#serialize(async () => {
      const request = await this.get(input.requestId);
      if (!request) return { outcome: "not-found" };
      if (request.status === "approved" || request.status === "denied") {
        return { outcome: "already-decided", decision: this.#decisionFor(request) };
      }
      if (request.status === "expired") return { outcome: "expired", request };
      if (request.status === "withdrawn") return { outcome: "withdrawn", request };
      if (this.#isExpired(request)) {
        await this.#expire(request);
        const expired = this.#requests.get(request.id) ?? request;
        return { outcome: "expired", request: expired };
      }
      const decision: ApprovalDecision = {
        requestId: request.id,
        verdict: input.verdict,
        decidedAt: this.#now().toISOString(),
        decidedBy: input.decidedBy,
        ...(input.note === undefined ? {} : { note: input.note }),
      };
      const committed = await this.#ledger.commitDecision(decision);
      if (committed === "already-decided") {
        const stored = (await this.#ledger.get(request.id)) ?? request;
        this.#requests.set(stored.id, stored);
        return { outcome: "already-decided", decision: this.#decisionFor(stored) };
      }
      const decided: ApprovalRequest = {
        ...request,
        status: input.verdict === "approve" ? "approved" : "denied",
      };
      this.#requests.set(decided.id, decided);
      this.#decisions.set(decided.id, decision);
      await this.#ledger.update(decided);
      const outcome = input.verdict === "approve" ? "approved" : "denied";
      this.#resolveWaiters(decided, outcome, decision);
      this.#notify({
        kind: "resolved",
        resolution: { request: decided, outcome, decision },
      });
      return { outcome: "accepted", decision };
    });
  }

  #decisionFor(request: ApprovalRequest): ApprovalDecision {
    const known = this.#decisions.get(request.id);
    if (known) return known;
    const decidedAt = this.#now().toISOString();
    return {
      requestId: request.id,
      verdict: request.status === "approved" ? "approve" : "deny",
      decidedAt,
      decidedBy: { kind: "human", clientId: "restored" },
    };
  }

  withdraw(requestId: string, reason: string): Promise<ApprovalResolution> {
    return this.#serialize(async () => {
      const request = await this.get(requestId);
      if (!request) {
        return {
          request: {
            id: requestId,
            status: "withdrawn",
            requestedAt: this.#now().toISOString(),
            expiresAt: null,
            draft: {
              action: { kind: "unknown", summary: "" },
              risk: "unknown",
              requestedBy: { kind: "host", component: "fake" },
            },
          },
          outcome: "withdrawn",
          decision: null,
        };
      }
      const resolution = resolutionOf(request, this.#decisions);
      if (resolution) return resolution;
      return this.#withdrawLocked(request, reason);
    });
  }

  async #withdrawLocked(request: ApprovalRequest, reason: string): Promise<ApprovalResolution> {
    void reason;
    const withdrawn: ApprovalRequest = { ...request, status: "withdrawn" };
    this.#requests.set(withdrawn.id, withdrawn);
    await this.#ledger.update(withdrawn);
    this.#resolveWaiters(withdrawn, "withdrawn", null);
    this.#notify({
      kind: "resolved",
      resolution: { request: withdrawn, outcome: "withdrawn", decision: null },
    });
    return { request: withdrawn, outcome: "withdrawn", decision: null };
  }

  subscribe(listener: (update: ApprovalUpdate) => void, filter?: ApprovalListFilter): Unsubscribe {
    const entry: { listener: (update: ApprovalUpdate) => void; filter?: ApprovalListFilter } = {
      listener,
      ...(filter === undefined ? {} : { filter }),
    };
    this.#listeners.add(entry);
    return () => {
      this.#listeners.delete(entry);
    };
  }

  #notify(update: ApprovalUpdate): void {
    const request = update.kind === "requested" ? update.request : update.resolution.request;
    for (const entry of this.#listeners) {
      if (!this.#matches(request, entry.filter)) continue;
      entry.listener(update);
    }
  }
}

function keyOfDraft(draft: ApprovalRequestDraft): string {
  return computeApprovalKey({
    scope: "tool",
    ...(draft.conversationId === undefined ? {} : { conversationId: draft.conversationId }),
    ...(draft.turnId === undefined ? {} : { turnId: draft.turnId }),
    ...(draft.action.toolName === undefined ? {} : { toolName: draft.action.toolName }),
    ...(draft.action.toolInput === undefined ? {} : { input: draft.action.toolInput }),
  });
}

function approvalKeyOf(request: ApprovalRequest): string {
  return keyOfDraft(request.draft);
}

function resolutionOf(
  request: ApprovalRequest,
  decisions: Map<string, ApprovalDecision>,
): ApprovalResolution | null {
  if (request.status === "approved" || request.status === "denied") {
    return {
      request,
      outcome: request.status,
      decision: decisions.get(request.id) ?? null,
    };
  }
  if (request.status === "expired") {
    return { request, outcome: "expired", decision: null };
  }
  if (request.status === "withdrawn") {
    return { request, outcome: "withdrawn", decision: null };
  }
  return null;
}
