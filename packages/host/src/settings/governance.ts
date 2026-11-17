import { appendFileSync } from "node:fs";

import {
  decideSettingAction,
  isSettingVisible,
  type SettingActorKind,
  type SettingTier,
} from "@cardiary/domain";
import type {
  JSONValue,
  SettingChangeRecord,
  SettingChangeStatus,
  SettingItem,
  SettingTierItem,
} from "@cardiary/protocol";
import {
  assertNotSymbolicLink,
  readFileNoFollow,
  writeFileAtomic,
  type FolderLayout,
} from "@cardiary/storage";

import { settingLevel } from "./catalog.js";
import type { SettingsService } from "./service.js";

/**
 * 設定分級的執行層。
 *
 * 值仍然是 state 資料庫正本；這裡管理「誰可以改」、待決提議與稽核軌跡。
 * 稽核是 append-only JSONL，只記動作、分級與結果，不記設定值；金鑰也不要
 * 出現在代理看的任何輸出裡。
 */

export interface GovernanceActor {
  readonly kind: SettingActorKind;
  /** 人與代理的識別；系統動作省略。 */
  readonly id?: string;
}

export interface ChangeInput {
  readonly key: string;
  readonly value: JSONValue;
  readonly actor: GovernanceActor;
  readonly clientRequestId?: string;
}

export interface ChangeResult {
  readonly change: SettingChangeRecord;
  readonly applied: boolean;
}

export interface RecordBatchInput {
  readonly key: string;
  readonly value: JSONValue;
  readonly actor: GovernanceActor;
  readonly clientRequestId?: string;
}

export interface RecordBatchResult {
  readonly applied: SettingChangeRecord[];
  readonly pending: SettingChangeRecord[];
}

export type GovernanceErrorCode =
  "permission_denied" | "not_found" | "conflict" | "invalid_message";

export class SettingsGovernanceError extends Error {
  readonly code: GovernanceErrorCode;

  constructor(code: GovernanceErrorCode, message: string) {
    super(message);
    this.name = "SettingsGovernanceError";
    this.code = code;
  }
}

export interface SettingsGovernanceOptions {
  readonly settings: SettingsService;
  readonly layout: FolderLayout;
  readonly now?: () => Date;
}

const CHANGES_PATH = "state/settings-changes.json";
const AUDIT_PATH = "state/settings-audit.jsonl";
const MAX_CHANGES = 2_000;

export class SettingsGovernance {
  readonly #settings: SettingsService;
  readonly #layout: FolderLayout;
  readonly #now: () => Date;
  readonly #changesPath: string;
  readonly #auditPath: string;
  #changes: SettingChangeRecord[];
  readonly #idempotency = new Map<string, SettingChangeRecord>();

  constructor(options: SettingsGovernanceOptions) {
    this.#settings = options.settings;
    this.#layout = options.layout;
    this.#now = options.now ?? (() => new Date());
    this.#changesPath = this.#layout.absolute(CHANGES_PATH);
    this.#auditPath = this.#layout.absolute(AUDIT_PATH);
    this.#changes = readChanges(this.#layout, this.#changesPath);
  }

  /** 人看到全部，代理看不到 human-only。 */
  listFor(actor: SettingActorKind): SettingTierItem[] {
    return this.#settings
      .list()
      .filter((item) => isSettingVisible(item.level, actor))
      .map(toTierItem);
  }

  /** 代理讀 human-only 回 undefined，不回鍵名。 */
  readFor(key: string, actor: SettingActorKind): SettingTierItem | undefined {
    const item = this.#settings.list().find((entry) => entry.key === key);
    if (item === undefined || !isSettingVisible(item.level, actor)) return undefined;
    return toTierItem(item);
  }

  /** 完整項目；只給已通過分級檢查的內部流程使用。 */
  itemFor(key: string): SettingTierItem | undefined {
    const item = this.#settings.list().find((entry) => entry.key === key);
    return item === undefined ? undefined : toTierItem(item);
  }

  /** 代理看不到 human-only 的變更紀錄。 */
  changesFor(actor: SettingActorKind): SettingChangeRecord[] {
    return this.#changes.filter((change) => isSettingVisible(change.tier, actor));
  }

  /** 整批寫入的對外介面；測試用來驗證正本檔與代理不可見的紀錄。 */
  importChanges(changes: readonly SettingChangeRecord[]): void {
    this.#persist([...changes, ...this.#changes]);
  }

  tierOf(key: string): SettingTier {
    return settingLevel(key, this.#settings.record(key)?.level ?? "human-only");
  }

  /**
   * `free` 直接生效；`approval` 建立待決提議；`human-only` 拒絕。
   *
   * 拒絕訊息不帶設定鍵：代理不能靠猜鍵名探知 human-only 設定是否存在。
   */
  change(input: ChangeInput): ChangeResult {
    const tier = this.tierOf(input.key);
    const decision = decideSettingAction(tier, input.actor.kind, "change");
    const visible = visibleKey(tier, input.actor.kind, input.key);
    if (!decision.allowed) {
      this.#audit({
        actor: actorText(input.actor),
        action: "change",
        tier,
        outcome: "denied",
        ...(visible === undefined ? {} : { key: visible }),
      });
      throw new SettingsGovernanceError(
        "permission_denied",
        input.actor.kind === "agent"
          ? "設定不存在，或代理沒有權限變更。"
          : "這個設定不能透過這條路徑變更。",
      );
    }
    const idempotencyKey =
      input.clientRequestId === undefined
        ? undefined
        : `${actorText(input.actor)}:${input.clientRequestId}`;
    if (idempotencyKey !== undefined) {
      const previous = this.#idempotency.get(idempotencyKey);
      if (previous !== undefined)
        return { change: previous, applied: previous.status === "applied" };
    }

    if (decision.effect === "propose") {
      const change: SettingChangeRecord = {
        changeId: newId("chg"),
        key: input.key,
        value: input.value,
        tier,
        status: "pending",
        proposedBy: actorText(input.actor),
        proposedAt: this.#now().toISOString(),
      };
      this.#persist([change, ...this.#changes]);
      this.#audit({
        actor: actorText(input.actor),
        action: "propose",
        tier,
        outcome: "pending",
        changeId: change.changeId,
        key: input.key,
      });
      if (idempotencyKey !== undefined) this.#idempotency.set(idempotencyKey, change);
      return { change, applied: false };
    }

    this.#settings.set({ key: input.key, value: input.value, actor: actorText(input.actor) });
    const record = this.#recordApplied({
      key: input.key,
      value: input.value,
      tier,
      proposedBy: actorText(input.actor),
      proposedAt: this.#now().toISOString(),
      actor: actorText(input.actor),
      action: "change",
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    return { change: record, applied: true };
  }

  /**
   * 批次把「呼叫方已經套用」的多筆變更一次落盤。
   *
   * 與 `change()` 不同：這裡不重寫設定值，呼叫方自行負責設定寫入
   * （例如引擎已套用模型設定，或批次已以同一個交易寫入儲存區）。
   * 多筆變更共用單一個正本檔寫入（先寫暫存檔再改名），要嘛全部落盤、
   * 要嘛一筆都不落盤。任一鍵不允許時整批拒絕並逐筆留稽核，不寫任何紀錄。
   * 寫入失敗時，呼叫方應依 `changesFor()` 判斷已落盤的鍵並決定要不要退回設定；
   * 若寫入成功但後續稽核失敗，紀錄已落盤，呼叫方應保留套用並回報稽核缺漏。
   */
  recordBatch(inputs: readonly RecordBatchInput[]): RecordBatchResult {
    if (inputs.length === 0) return { applied: [], pending: [] };
    // 第一步：分級整批檢查；任何一鍵不過，整批不落盤。
    const prepared = inputs.map((input) => {
      const tier = this.tierOf(input.key);
      const decision = decideSettingAction(tier, input.actor.kind, "change");
      return {
        input,
        tier,
        allowed: decision.allowed,
        effect: decision.effect === "propose" ? ("propose" as const) : ("apply" as const),
      };
    });
    for (const { input, tier, allowed } of prepared) {
      if (!allowed) {
        this.auditDenied(input.actor, "change", tier, input.key);
        throw new SettingsGovernanceError(
          "permission_denied",
          input.actor.kind === "agent"
            ? "設定不存在，或代理沒有權限變更。"
            : "這個設定不能透過這條路徑變更。",
        );
      }
    }
    // 第二步：逐鍵冪等；已命中的原樣回傳，不重複落盤。
    const fresh: Array<{
      input: RecordBatchInput;
      tier: SettingTier;
      effect: "apply" | "propose";
      idempotencyKey?: string;
    }> = [];
    const replayed: SettingChangeRecord[] = [];
    for (const { input, tier, effect } of prepared) {
      const idempotencyKey =
        input.clientRequestId === undefined
          ? undefined
          : `${actorText(input.actor)}:${input.clientRequestId}`;
      if (idempotencyKey !== undefined) {
        const previous = this.#idempotency.get(idempotencyKey);
        if (previous !== undefined) {
          replayed.push(previous);
          continue;
        }
      }
      fresh.push({
        input,
        tier,
        effect,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      });
    }
    // 第三步：所有新紀錄共用一次正本檔寫入；寫入失敗時正本檔維持原樣。
    const proposedAt = this.#now().toISOString();
    const built = fresh.map((entry) => ({
      entry,
      record: {
        changeId: newId("chg"),
        key: entry.input.key,
        value: entry.input.value,
        tier: entry.tier,
        status: entry.effect === "propose" ? ("pending" as const) : ("applied" as const),
        proposedBy: actorText(entry.input.actor),
        proposedAt,
      },
    }));
    if (built.length > 0) {
      this.#persist([...built.map(({ record }) => record), ...this.#changes]);
      for (const { entry, record } of built) {
        this.#audit({
          actor: actorText(entry.input.actor),
          action: "change",
          tier: record.tier,
          outcome: record.status === "applied" ? "applied" : "pending",
          changeId: record.changeId,
          key: record.key,
        });
        if (entry.idempotencyKey !== undefined) {
          this.#idempotency.set(entry.idempotencyKey, record);
        }
      }
    }
    const all = [...replayed, ...built.map(({ record }) => record)];
    return {
      applied: all.filter((record) => record.status === "applied"),
      pending: all.filter((record) => record.status === "pending"),
    };
  }

  /** 政策層直接拒絕時留下的稽核痕跡（不寫變更紀錄）。 */
  auditDenied(
    actor: GovernanceActor,
    action: "change" | "propose" | "decide",
    tier: SettingTier,
    key?: string,
  ): void {
    const visible = key === undefined ? undefined : visibleKey(tier, actor.kind, key);
    this.#audit({
      actor: actorText(actor),
      action,
      tier,
      outcome: "denied",
      ...(visible === undefined ? {} : { key: visible }),
    });
  }

  /** 只有人可以核准或拒絕待決提議；核准前後的值都不變。 */
  decide(
    changeId: string,
    decision: "approve" | "reject",
    actor: GovernanceActor,
  ): SettingChangeRecord {
    const canDecide = decideSettingAction("approval", actor.kind, "decide");
    if (!canDecide.allowed) {
      this.#audit({
        actor: actorText(actor),
        action: "decide",
        tier: "approval",
        outcome: "denied",
      });
      throw new SettingsGovernanceError("permission_denied", "代理不能核准設定變更。");
    }
    const index = this.#changes.findIndex((entry) => entry.changeId === changeId);
    if (index < 0) {
      throw new SettingsGovernanceError("not_found", "找不到這筆設定變更。");
    }
    const current = this.#changes[index];
    if (current === undefined || current.status !== "pending") {
      throw new SettingsGovernanceError("conflict", "這筆設定變更已經決定過了。");
    }
    const decidedAt = this.#now().toISOString();
    if (decision === "approve") {
      this.#settings.set({
        key: current.key,
        value: current.value,
        actor: actorText(actor),
      });
      return this.#recordApplied({
        key: current.key,
        value: current.value,
        tier: current.tier,
        proposedBy: current.proposedBy,
        proposedAt: current.proposedAt,
        actor: actorText(actor),
        action: "decide",
        decidedAt,
        changeId: current.changeId,
      });
    }
    const rejected: SettingChangeRecord = {
      ...current,
      status: "rejected",
      decidedAt,
    };
    this.#persist(this.#changes.map((entry, at) => (at === index ? rejected : entry)));
    this.#audit({
      actor: actorText(actor),
      action: "decide",
      tier: current.tier,
      outcome: "rejected",
      changeId: current.changeId,
      key: current.key,
    });
    return rejected;
  }

  #recordApplied(input: {
    readonly key: string;
    readonly value: JSONValue;
    readonly tier: SettingTier;
    readonly proposedBy: string;
    readonly proposedAt: string;
    readonly actor: string;
    readonly action: "change" | "decide";
    readonly decidedAt?: string;
    readonly changeId?: string;
    readonly idempotencyKey?: string;
  }): SettingChangeRecord {
    const record: SettingChangeRecord = {
      changeId: input.changeId ?? newId("chg"),
      key: input.key,
      value: input.value,
      tier: input.tier,
      status: "applied",
      proposedBy: input.proposedBy,
      proposedAt: input.proposedAt,
      ...(input.decidedAt === undefined ? {} : { decidedAt: input.decidedAt }),
    };
    this.#persist([record, ...this.#changes.filter((entry) => entry.changeId !== record.changeId)]);
    this.#audit({
      actor: input.actor,
      action: input.action,
      tier: input.tier,
      outcome: "applied",
      changeId: record.changeId,
      key: input.key,
    });
    if (input.idempotencyKey !== undefined) {
      this.#idempotency.set(input.idempotencyKey, record);
    }
    return record;
  }

  #persist(changes: readonly SettingChangeRecord[]): void {
    const trimmed = changes.slice(0, MAX_CHANGES);
    writeFileAtomic(this.#layout, this.#changesPath, `${JSON.stringify(trimmed, null, 2)}\n`);
    this.#changes = [...trimmed];
  }

  #audit(entry: {
    readonly actor: string;
    readonly action: "change" | "propose" | "decide";
    readonly tier: SettingTier;
    readonly outcome: "applied" | "pending" | "rejected" | "denied";
    readonly key?: string;
    readonly changeId?: string;
  }): void {
    assertNotSymbolicLink(this.#auditPath);
    const line = JSON.stringify({
      at: this.#now().toISOString(),
      actor: entry.actor,
      action: entry.action,
      tier: entry.tier,
      outcome: entry.outcome,
      ...(entry.key === undefined ? {} : { key: entry.key }),
      ...(entry.changeId === undefined ? {} : { changeId: entry.changeId }),
    });
    appendFileSync(this.#auditPath, `${line}\n`, { flag: "a", mode: 0o600 });
  }
}

function actorText(actor: GovernanceActor): string {
  if (actor.kind === "system") return "system";
  return `${actor.kind === "human" ? "user" : "agent"}:${actor.id ?? "unknown"}`;
}

function visibleKey(tier: SettingTier, actor: SettingActorKind, key: string): string | undefined {
  return actor === "agent" && tier === "human-only" ? undefined : key;
}

function toTierItem(item: SettingItem): SettingTierItem {
  const tier = item.level as SettingTier;
  return {
    key: item.key,
    value: item.value,
    tier,
    ...(item.title === undefined ? {} : { title: item.title }),
    ...(item.description === undefined ? {} : { description: item.description }),
    updatedAt: item.updatedAt,
  };
}

function readChanges(layout: FolderLayout, path: string): SettingChangeRecord[] {
  try {
    const raw = readFileNoFollow(layout, path).toString("utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isChangeRecord).slice(0, MAX_CHANGES);
  } catch {
    return [];
  }
}

function isChangeRecord(value: unknown): value is SettingChangeRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.changeId === "string" &&
    typeof record.key === "string" &&
    typeof record.proposedBy === "string" &&
    typeof record.proposedAt === "string" &&
    (record.status === "pending" || record.status === "applied" || record.status === "rejected") &&
    (record.tier === "free" || record.tier === "approval" || record.tier === "human-only")
  );
}

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export type { SettingChangeStatus };
