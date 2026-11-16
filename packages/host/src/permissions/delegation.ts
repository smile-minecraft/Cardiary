/**
 * 委派的最後一層判斷：接在主機的權限回呼上，每次重新讀人的設定。
 *
 * 順序固定：
 *
 * 1. 硬規則的 `deny` 在別的地方就回掉了，不會進這裡；`allow` 也不需要委派。
 * 2. 限時的全部允許先確認：工具命中、路徑或網域命中、沒有過期，才放行。
 * 3. 其餘動作走 System One：先看是不是可委派類別、人有沒有開、路徑在不在
 *    授權範圍、這場對話的 20 次用完沒有，最後才問模型。
 *
 * 引擎的 `permissionMode` 維持有建立對話時的釘選語意，這裡不讀它：人開關
 * 類別要立刻生效，不需要重建對話。
 */

import {
  createModelInvoker,
  delegationCandidate,
  evaluateShellCommand,
  isHumanSettingsPath,
  isWithin,
  matchesAllowedDomain,
  parseDomainRules,
  resolvePath,
  reviewProbability,
  type DelegatedCategory,
  type DomainRule,
  type PathRoots,
  type PermissionAction,
  type ShellContext,
} from "@cardiary/domain";
import type {
  ApprovalDetail,
  JsonValue,
  ToolPermissionGate,
  ToolPermissionRequest,
  ToolPermissionVerdict,
} from "@cardiary/engine-adapter";
import type { ModelInvoker } from "@cardiary/module-api";

import { localToolAction } from "./actions.js";
import type { AgentAudit } from "./agent-audit.js";
import type { AgentPermissions, AllowAllGrant } from "./agent-permissions.js";

/** 可退回人工的判定；只有這種判定才會交給委派層。 */
export type AskHumanVerdict = Extract<ToolPermissionVerdict, { kind: "ask-human" }>;

export interface DelegationQuestion {
  readonly toolName: string;
  readonly category: DelegatedCategory;
  readonly path: string | undefined;
  readonly action: PermissionAction;
  readonly input: JsonValue;
}

export interface DelegationReview {
  /** 沒有答案（格式錯誤、逾時、呼叫失敗）就是 `undefined`。 */
  readonly probability: number | undefined;
  readonly modelId: string | null;
}

export type DelegationReviewer = (question: DelegationQuestion) => Promise<DelegationReview>;

/** 模型服務中委派判斷用得到的部分。 */
export interface DelegationModels {
  role?(role: "system-one"):
    | {
        readonly selection: unknown | null;
        readonly ref?: { readonly modelId?: string };
      }
    | undefined;
}

const QUESTION_KEY = "delegate";
const DEFAULT_REVIEW_TIMEOUT_MS = 8_000;

/**
 * 用設定的 `system-one` 角色建立是非題判斷。
 *
 * 模型不可用時回「沒有答案」，由呼叫端退回人工；這裡不猜機率，也不為
 * 了讓放行發生而放寬閾值。稽核用的模型 id 從角色解析結果取得。
 */
export function createModelReviewer(options: {
  readonly models: () => DelegationModels | undefined;
  readonly invoker: ModelInvoker;
  readonly timeoutMs?: number;
}): DelegationReviewer {
  return async (question) => {
    const unavailable: DelegationReview = { probability: undefined, modelId: null };
    let models: DelegationModels | undefined;
    let resolved: ReturnType<NonNullable<DelegationModels["role"]>>;
    try {
      models = options.models();
      resolved = models?.role?.("system-one");
    } catch {
      return unavailable;
    }
    if (resolved === undefined || resolved.selection === null || resolved.selection === undefined) {
      return unavailable;
    }
    const modelId = typeof resolved.ref?.modelId === "string" ? resolved.ref.modelId : null;
    const invoker = createModelInvoker({
      timeoutMs: options.timeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS,
      call: async ({ prompt, signal }) => {
        const result = await options.invoker.invoke(
          { role: "system-one", purpose: "system-one", prompt, maxOutputTokens: 32 },
          { signal },
        );
        return { text: result.text };
      },
    });
    try {
      const judged = await invoker.judge({
        state: {},
        questions: [
          {
            kind: "yes-no",
            key: QUESTION_KEY,
            statement: buildStatement(question),
            criteriaTrue:
              "動作就是這個類別允許的唯讀或建立動作，參數完全在授權範圍內，而且沒有刪除、對外送出、憑證或權限變更的意思。",
            criteriaFalse:
              "動作超出這個類別或授權範圍，包含刪除、對外送出、憑證或權限變更，或你無法從參數確定。",
          },
        ],
      });
      const answer = judged.answers.find((item) => item.key === QUESTION_KEY);
      return {
        probability:
          answer !== undefined && answer.kind === "yes-no" ? answer.probability : undefined,
        modelId,
      };
    } catch {
      // 逾時、模型呼叫失敗：一律當沒有答案。
      return { probability: undefined, modelId };
    }
  };
}

export interface DelegatedApprovalOptions {
  readonly permissions: AgentPermissions;
  readonly audit: AgentAudit;
  readonly reviewer: DelegationReviewer;
  readonly roots: PathRoots;
  readonly homeDir?: string;
  readonly appBundlePath?: string;
  readonly now: () => number;
}

export class DelegatedApproval {
  readonly #options: DelegatedApprovalOptions;

  constructor(options: DelegatedApprovalOptions) {
    this.#options = options;
  }

  /** 硬規則回 `ask-human` 之後才呼叫；永遠不會推翻 `deny`。 */
  async evaluate(
    request: ToolPermissionRequest,
    verdict: AskHumanVerdict,
  ): Promise<ToolPermissionVerdict> {
    const action = resolveDelegationAction(request.toolName, request.input);
    if (action === null) {
      return verdict;
    }

    const { permissions, audit, roots, now } = this.#options;
    const grant = permissions.allowAllFor(now());
    if (grant !== null && allowAllCovers(grant, action, request, permissions, this.#options)) {
      audit.append({
        conversationId: request.conversationId,
        tool: request.toolName,
        input: request.input,
        reason: "全部允許",
        probability: null,
        modelId: null,
      });
      return { kind: "allow" };
    }

    const candidate = delegationCandidate({
      action,
      roots,
      ...(this.#options.homeDir === undefined ? {} : { homeDir: this.#options.homeDir }),
      ...(this.#options.appBundlePath === undefined
        ? {}
        : { appBundlePath: this.#options.appBundlePath }),
    });
    if (candidate === null || !permissions.allowsCategory(candidate.category, candidate.path)) {
      return verdict;
    }
    if (permissions.remaining(request.conversationId) <= 0) {
      return withDetail(verdict, "自動放行", "這場對話的自動放行次數已用完，請人工審核。");
    }

    const review = await this.#options.reviewer({
      toolName: request.toolName,
      category: candidate.category,
      path: candidate.path,
      action,
      input: request.input,
    });
    const decision = reviewProbability(review.probability);
    if (decision.kind === "ask-human") {
      return withDetail(verdict, "System One", decision.reason);
    }
    // 門檻只接受完整且位於 0–1 的機率；到這裡不可能沒有值。
    if (review.probability === undefined) {
      return verdict;
    }
    if (!permissions.reserve(request.conversationId)) {
      return withDetail(verdict, "自動放行", "這場對話的自動放行次數已用完，請人工審核。");
    }
    audit.append({
      conversationId: request.conversationId,
      tool: request.toolName,
      input: request.input,
      reason: "System One 通過",
      probability: review.probability,
      modelId: review.modelId,
    });
    return { kind: "allow" };
  }
}

/**
 * 把硬規則閘道包一層委派判斷。
 *
 * `deny` 和硬規則本來就放行的 `allow` 都原樣通過；只有人要親自決定的
 * `ask-human` 才可能變成自動放行。
 */
export function createDelegatingGate(
  base: ToolPermissionGate,
  delegation: DelegatedApproval,
): ToolPermissionGate {
  return {
    async evaluate(request) {
      const verdict = await base.evaluate(request);
      return verdict.kind === "ask-human" ? delegation.evaluate(request, verdict) : verdict;
    },
  };
}

function resolveDelegationAction(toolName: string, input: JsonValue): PermissionAction | null {
  const local = localToolAction(toolName, input);
  if (local !== null) {
    return local;
  }
  if (toolName === "card_create") {
    const kind = (input as { kind?: unknown } | null)?.kind;
    return {
      kind: "cards.create",
      cardKind: kind === "image" || kind === "audio" ? kind : "note",
    };
  }
  return null;
}

/**
 * 限時授權是否涵蓋這個動作。
 *
 * 封閉清單：檔案工具要比對路徑，寫入與刪除另外排除「僅限人類」的狀態檔；
 * shell 的路徑範圍約束不了副作用，所以只接受純唯讀文法；設定、MCP、外部
 * 代理不論工具名是什麼都不放行。卡片建立／編修／刪除沒有路徑可查，只能
 * 靠工具名命中。
 */
function allowAllCovers(
  grant: AllowAllGrant,
  action: PermissionAction,
  request: ToolPermissionRequest,
  permissions: AgentPermissions,
  options: DelegatedApprovalOptions,
): boolean {
  if (!grant.tools.includes(request.toolName)) {
    return false;
  }
  switch (action.kind) {
    case "fs.read":
    case "fs.list":
    case "fs.write":
    case "fs.delete": {
      const resolved = resolvePath(action.path, options.roots);
      if (!resolved.ok || !grant.paths.some((root) => isWithin(root, resolved.path.resolved))) {
        return false;
      }
      if (action.kind === "fs.write" || action.kind === "fs.delete") {
        // 狀態資料庫、白名單與 MCP 伺服器設定是「僅限人類」的檔案。硬規則
        // 已經拒絕一次，這裡是第二道：授權路徑涵蓋整個資料夾也一樣不放行。
        return !isHumanSettingsPath(resolved.path.resolved, options.roots.folderRoot);
      }
      return true;
    }
    case "shell.exec": {
      if (grant.paths.length === 0) {
        return false;
      }
      const cwd = resolvePath(action.cwd, options.roots);
      if (!cwd.ok || !grant.paths.some((root) => isWithin(root, cwd.path.resolved))) {
        return false;
      }
      const context: ShellContext = {
        ...options.roots,
        workingDir: cwd.path.resolved,
        homeDir: options.homeDir ?? "",
        appBundlePath: options.appBundlePath ?? "",
      };
      return evaluateShellCommand(action.command, context).kind === "allow";
    }
    case "network.outbound": {
      if (action.scheme === "tcp") {
        return false;
      }
      const defaultPort = action.scheme === "https" ? 443 : 80;
      const authority = action.port === defaultPort ? action.host : `${action.host}:${action.port}`;
      let url: URL;
      try {
        url = new URL(`${action.scheme}://${authority}`);
      } catch {
        return false;
      }
      const human = safeRules(permissions.allowedDomains());
      const scoped = safeRules(grant.domains);
      if (human === null || scoped === null) {
        return false;
      }
      // 人的清單是上限，授權的網域是這一次的範圍，兩邊都要命中。
      return matchesAllowedDomain(human, url) && matchesAllowedDomain(scoped, url);
    }
    case "cards.create":
    case "cards.patch":
    case "cards.delete":
      return true;
    default:
      // 設定與白名單、MCP、外部代理：永不納入全部允許。
      return false;
  }
}

function safeRules(inputs: readonly string[]): DomainRule[] | null {
  try {
    return parseDomainRules(inputs);
  } catch {
    return null;
  }
}

function withDetail(verdict: AskHumanVerdict, label: string, value: string): AskHumanVerdict {
  const details: readonly ApprovalDetail[] = [...(verdict.action.details ?? []), { label, value }];
  return { ...verdict, action: { ...verdict.action, details } };
}

function buildStatement(question: DelegationQuestion): string {
  const scope = question.path === undefined ? "沒有路徑條件" : `授權路徑 ${question.path}`;
  const serialized = JSON.stringify(question.input);
  const input = serialized === undefined ? "空參數" : serialized.slice(0, 2_000);
  return [
    `工具 ${question.toolName} 這次呼叫屬於已開啟的委派類別「${question.category}」`,
    scope,
    "目前在人的授權範圍內，而且沒有刪除、對外送出訊息或發布、使用或修改憑證、變更權限或白名單。",
    `工具參數：${input}`,
  ].join("；");
}
