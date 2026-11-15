import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalService,
  DecideApprovalResult,
  HumanActor,
} from "@cardiary/engine-adapter";

import { ALLOWLIST_DETAIL_LABELS } from "./gate.js";
import type { AllowlistEntry, ApprovalAllowlistStore } from "./allowlist.js";

/** 從審批的 `request_json` 讀回的「一律允許」分類。 */
export interface AlwaysAllowTarget {
  readonly toolName: string;
  readonly actionKind: string;
  readonly scopeKey: string;
}

/** 審批決定的三種效果；`approve_always` 同時寫入白名單。 */
export type PermissionDecisionEffect = "approve" | "reject" | "approve_always";

export interface PermissionDecisionInput {
  readonly requestId: string;
  readonly effect: PermissionDecisionEffect;
  readonly decidedBy: HumanActor;
  readonly note?: string;
}

export type PermissionDecisionOutcome =
  | {
      readonly outcome: "accepted" | "already-decided";
      readonly decision: ApprovalDecision;
      /** 這次真的寫入（或更新）的白名單；沒有就是 `null`。 */
      readonly allowlist: AllowlistEntry | null;
    }
  | { readonly outcome: "expired" | "withdrawn"; readonly request: ApprovalRequest }
  | { readonly outcome: "not-found" }
  | { readonly outcome: "cannot-always-allow"; readonly reason: string };

/**
 * 白名單的寫入點。
 *
 * 只有人類的審批決定會走到這裡；代理、模組與工具都沒有這個介面。
 * 審批決定由引擎的 `ApprovalService` 落地，白名單在決定成功之後才寫，
 * 所以「決定已拒絕卻留下放行」不可能發生；反過來，白名單寫入失敗只會
 * 讓下一次再問一次，不會多放行。
 */
export class PermissionDecisionService {
  readonly #approvals: Pick<ApprovalService, "get" | "decide">;
  readonly #allowlist: ApprovalAllowlistStore;
  readonly #now: () => Date;

  constructor(options: {
    readonly approvals: Pick<ApprovalService, "get" | "decide">;
    readonly allowlist: ApprovalAllowlistStore;
    readonly now?: () => Date;
  }) {
    this.#approvals = options.approvals;
    this.#allowlist = options.allowlist;
    this.#now = options.now ?? (() => new Date());
  }

  /** 這個審批能不能提供「一律允許」；閘道用它決定要不要給這個選項。 */
  async canAlwaysAllow(requestId: string): Promise<boolean> {
    const request = await this.#approvals.get(requestId);
    return request === null ? false : alwaysAllowTarget(request) !== null;
  }

  async decide(input: PermissionDecisionInput): Promise<PermissionDecisionOutcome> {
    const request = await this.#approvals.get(input.requestId);
    if (request === null) {
      return { outcome: "not-found" };
    }
    const target = input.effect === "approve_always" ? alwaysAllowTarget(request) : null;
    if (input.effect === "approve_always" && target === null) {
      return {
        outcome: "cannot-always-allow",
        reason: "這個審批沒有可放行的工具、動作種類與範圍",
      };
    }

    const result: DecideApprovalResult = await this.#approvals.decide({
      requestId: input.requestId,
      verdict: input.effect === "reject" ? "deny" : "approve",
      decidedBy: input.decidedBy,
      ...(input.note === undefined ? {} : { note: input.note }),
    });

    if (result.outcome === "not-found") {
      return { outcome: "not-found" };
    }
    if (result.outcome === "expired" || result.outcome === "withdrawn") {
      return { outcome: result.outcome, request: request };
    }
    if (target === null || result.outcome !== "accepted" || result.decision.verdict !== "approve") {
      // already-decided 代表引擎裡已有別人作的決定，本次沒有落地，
      // 所以不得寫白名單——不管先前的 verdict 是什麼。
      return { outcome: result.outcome, decision: result.decision, allowlist: null };
    }
    const entry = this.#allowlist.grant({
      toolName: target.toolName,
      scopeKey: target.scopeKey,
      actionKind: target.actionKind,
      createdBy: input.decidedBy.clientId,
      now: this.#now(),
    });
    return { outcome: result.outcome, decision: result.decision, allowlist: entry };
  }
}

/** 從審批的 `details` 讀出白名單的三個欄位；格式不對回 `null`。 */
export function alwaysAllowTarget(request: ApprovalRequest): AlwaysAllowTarget | null {
  const details = request.draft.action.details ?? [];
  const value = (label: string): string | null => {
    const found = details.find((detail) => detail.label === label);
    return found === undefined || found.value.length === 0 ? null : found.value;
  };
  const actionKind = value(ALLOWLIST_DETAIL_LABELS.actionKind);
  const scopeKey = value(ALLOWLIST_DETAIL_LABELS.scopeKey);
  const toolName =
    request.draft.action.toolName ?? value(ALLOWLIST_DETAIL_LABELS.toolName) ?? undefined;
  if (actionKind === null || scopeKey === null || toolName === undefined) {
    return null;
  }
  if (
    !actionKind.startsWith("fs.") &&
    !actionKind.startsWith("shell.") &&
    !isNonPathActionKind(actionKind)
  ) {
    return null;
  }
  if (scopeKey !== "*" && !scopeKey.startsWith("/")) {
    return null;
  }
  return { toolName, actionKind, scopeKey };
}

function isNonPathActionKind(actionKind: string): boolean {
  return (
    actionKind.startsWith("cards.") ||
    actionKind === "network" ||
    actionKind === "mcp.call" ||
    actionKind === "external-agent.dispatch" ||
    actionKind === "settings.change"
  );
}
