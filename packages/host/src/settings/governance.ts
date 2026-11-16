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
