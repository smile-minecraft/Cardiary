import type { ProtocolRequestContext, ProtocolEventEmitter } from "@cardiary/module-api";
import type { JSONObject, JSONValue, SettingChangeRecord, SettingItem } from "@cardiary/protocol";

import { decideSettingAction, type SettingTier } from "@cardiary/domain";

import { ProtocolHandlerError } from "../contract.js";
import {
  ModelSettingsError,
  normalizeSetInput,
  readProviders,
  readRoles,
  type ModelRuntime,
} from "../../models/index.js";
import { MODEL_SETTING_KEYS } from "../../models/types.js";
import type {
  SettingsGovernance,
  GovernanceActor,
  RecordBatchInput,
} from "../../settings/index.js";
import { SettingsGovernanceError } from "../../settings/index.js";
import type { SettingsService } from "../../settings/index.js";

/**
 * `system.models.*` 與 `system.settings.*` 的協定處理器。
 *
 * 模型設定只有一個寫入權威（`system.models.set`）；一般設定不能拿
 * `system.settings.set` 改模型供應商或角色，避免兩條路徑給出不同的驗證。
 */

export interface SettingsProtocolOptions {
  readonly runtime: ModelRuntime;
  readonly settings: SettingsService;
  readonly protocol: ProtocolEventEmitter;
  readonly now: () => Date;
  /** 分級治理；沒有提供時只註冊舊的 `system.*` 路徑。 */
  readonly governance?: SettingsGovernance;
}

export function registerSettingsProtocol(options: SettingsProtocolOptions): void {
  const { runtime, settings, protocol } = options;
  protocol.registerNamespace("system.models", async (request) => {
    switch (request.type) {
      case "system.models.get":
        return runtime.state as unknown as JSONValue;
      case "system.models.set":
        return setModels(request, runtime, settings, options.governance);
      default:
        throw new ProtocolHandlerError("not_found", `主機不支援 ${request.type}。`);
    }
  });
  protocol.registerNamespace("system.settings", async (request) => {
    switch (request.type) {
      case "system.settings.get":
        return {
          settings:
            options.governance === undefined
              ? settings.list()
              : legacyItems(options.governance.listFor(actorOf(request).kind)),
        } as unknown as JSONValue;
      case "system.settings.set":
        return setSettings(request, settings, protocol, options.now, options.governance);
      default:
        throw new ProtocolHandlerError("not_found", `主機不支援 ${request.type}。`);
    }
  });
  if (options.governance !== undefined) {
    registerTieredSettings(options.governance, runtime, settings, protocol, options.now);
  }
}

function registerTieredSettings(
  governance: SettingsGovernance,
  runtime: ModelRuntime,
  settings: SettingsService,
  protocol: ProtocolEventEmitter,
  now: () => Date,
): void {
  protocol.registerNamespace("settings", async (request) => {
    const actor = actorOf(request);
    switch (request.type) {
      case "settings.list":
        return { settings: governance.listFor(actor.kind) } as unknown as JSONValue;
      case "settings.propose_change":
        return proposeChange(request, governance, protocol, actor, now);
      case "settings.changes.list":
        return { changes: governance.changesFor(actor.kind) } as unknown as JSONValue;
      case "settings.change.decide":
        return decideChange(request, governance, settings, runtime, protocol, actor, now);
      default:
        throw new ProtocolHandlerError("not_found", `主機不支援 ${request.type}。`);
    }
  });
}

function proposeChange(
  request: ProtocolRequestContext,
  governance: SettingsGovernance,
  protocol: ProtocolEventEmitter,
  actor: GovernanceActor,
  now: () => Date,
): JSONValue {
  const payload = requireObject(request.payload);
  if (typeof payload.key !== "string" || payload.key.trim().length === 0) {
    throw new ProtocolHandlerError("invalid_message", "key 必須是非空字串。", {
      field: "key",
    });
  }
  if (!Object.hasOwn(payload, "value")) {
    throw new ProtocolHandlerError("invalid_message", "缺少 value。", { field: "value" });
  }
  try {
    const result = governance.change({
      key: payload.key,
      value: payload.value as JSONValue,
      actor,
      ...(typeof payload.clientRequestId === "string"
        ? { clientRequestId: payload.clientRequestId }
        : {}),
    });
    if (result.applied) {
      const item = governance.itemFor(payload.key);
      if (item !== undefined) {
        protocol.emit({
          kind: "settings-changed",
          payload: {
            changes: [item],
            changedBy: actorText(actor),
            changedAt: result.change.decidedAt ?? now().toISOString(),
          } as unknown as JSONValue,
        });
      }
    }
    return { change: result.change } as unknown as JSONValue;
  } catch (error) {
    throw asProtocolError(error);
  }
}

async function decideChange(
  request: ProtocolRequestContext,
  governance: SettingsGovernance,
  settings: SettingsService,
  runtime: ModelRuntime,
  protocol: ProtocolEventEmitter,
  actor: GovernanceActor,
  now: () => Date,
): Promise<JSONValue> {
  const payload = requireObject(request.payload);
  if (typeof payload.changeId !== "string" || payload.changeId.length === 0) {
    throw new ProtocolHandlerError("invalid_message", "changeId 必須是非空字串。", {
      field: "changeId",
    });
  }
  if (payload.decision !== "approve" && payload.decision !== "reject") {
    throw new ProtocolHandlerError("invalid_message", "decision 必須是 approve 或 reject。", {
      field: "decision",
    });
  }
  const isModelKey = (key: string): boolean =>
    key === MODEL_SETTING_KEYS.providers || key === MODEL_SETTING_KEYS.roles;
  let pending: SettingChangeRecord | undefined;
  if (payload.decision === "approve") {
    // 核准模型設定前先檢查形狀；不合法就不寫入任何東西。
    pending = governance
      .changesFor(actor.kind)
      .find((entry) => entry.changeId === payload.changeId && entry.status === "pending");
    if (pending !== undefined && isModelKey(pending.key)) {
      try {
        normalizeSetInput(
          {
            ...(pending.key === MODEL_SETTING_KEYS.providers
              ? { providers: pending.value }
              : { providers: undefined }),
            ...(pending.key === MODEL_SETTING_KEYS.roles
              ? { roles: pending.value }
              : { roles: undefined }),
            currentProviders: readProviders(settings.get(MODEL_SETTING_KEYS.providers)),
            currentRoles: readRoles(settings.get(MODEL_SETTING_KEYS.roles)),
          },
          // 聚合平台的模型清單要等引擎重新設定時才抓得到，這裡只驗形狀。
          { validateReferences: false },
        );
      } catch (error) {
        if (error instanceof ModelSettingsError) {
          throw new ProtocolHandlerError("invalid_message", error.message, {
            field: error.field,
          });
        }
        throw error;
      }
    }
  }
  // 代理不能核准生效的變更，模型也永遠不套用（交給治理層拒絕並留稽核）。
  const applyModel =
    payload.decision === "approve" &&
    pending !== undefined &&
    isModelKey(pending.key) &&
    actor.kind !== "agent";
  // 核准模型設定時先讓引擎與儲存區採用新值；失敗時待決提議維持 pending，
  // 變更紀錄不會無中生有，儲存區也不需要再退回（寫入失敗即整批不生效）。
  const previous = applyModel
    ? {
        providers: settings.get(MODEL_SETTING_KEYS.providers),
        roles: settings.get(MODEL_SETTING_KEYS.roles),
      }
    : undefined;
  if (applyModel && pending !== undefined) {
    try {
      await runtime.apply(
        pending.key === MODEL_SETTING_KEYS.providers
          ? { providers: pending.value }
          : { roles: pending.value },
        actorText(actor),
      );
    } catch (error) {
      if (error instanceof ModelSettingsError) {
        throw new ProtocolHandlerError("invalid_message", error.message, {
          field: error.field,
        });
      }
      throw error;
    }
  }
  // 模型鍵核准時，儲存區裡已經是套用正規化後的值（`runtime.apply` 寫入）；
  // `decide` 只把待決提議標成已套用，紀錄以儲存區裡的正規化值為準，不覆蓋回去。
  const appliedModelValue =
    applyModel && pending !== undefined && isModelKey(pending.key)
      ? settings.get(pending.key)
      : undefined;
  let result: SettingChangeRecord;
  try {
    result = governance.decide(
      payload.changeId,
      payload.decision,
      actor,
      appliedModelValue === undefined ? {} : { appliedValue: appliedModelValue },
    );
  } catch (error) {
    // 模型已套用、治理紀錄卻沒寫出去：依紀錄實際狀態決定要不要退回模型。
    if (previous === undefined) {
      throw asProtocolError(error);
    }
    const recorded = governance
      .changesFor(actor.kind)
      .find((entry) => entry.changeId === payload.changeId);
    if (recorded?.status === "applied") {
      // 變更紀錄已落盤（例如稽核寫入失敗）：模型與紀錄一致，保留套用。
      throw new ProtocolHandlerError(
        "conflict",
        "設定已套用並寫入變更紀錄，但核准流程發生錯誤；稽核紀錄可能不完整。",
      );
    }
    const rollbackInput: { providers?: JSONValue; roles?: JSONValue } = {};
    if (previous.providers !== undefined) rollbackInput.providers = previous.providers;
    if (previous.roles !== undefined) rollbackInput.roles = previous.roles;
    if (previous.providers === undefined || previous.roles === undefined) {
      // 缺核准前的完整快照，等於退不回去；不能只退回一半。
      throw new ProtocolHandlerError(
        "conflict",
        "治理紀錄寫入失敗，且退回原值也失敗了；請以 system.models.set 重新設定模型。",
      );
    }
    try {
      await runtime.apply(rollbackInput, "system:rollback");
    } catch {
      throw new ProtocolHandlerError(
        "conflict",
        "治理紀錄寫入失敗，且退回原值也失敗了；請以 system.models.set 重新設定模型。",
      );
    }
    throw new ProtocolHandlerError(
      "conflict",
      "治理紀錄寫入失敗，模型設定已退回原設定；請再試一次。",
    );
  }
  if (result.status === "applied") {
    const item = governance.itemFor(result.key);
    if (item !== undefined) {
      protocol.emit({
        kind: "settings-changed",
        payload: {
          changes: [item],
          changedBy: actorText(actor),
          changedAt: result.decidedAt ?? now().toISOString(),
        } as unknown as JSONValue,
      });
    }
  }
  return { change: result } as unknown as JSONValue;
}

function actorOf(request: ProtocolRequestContext): GovernanceActor {
  if (request.clientId.startsWith("agent:")) {
    return { kind: "agent", id: request.clientId.slice(6) };
  }
  return { kind: "human", id: request.clientId };
}

function actorText(actor: GovernanceActor): string {
  if (actor.kind === "system") return "system";
  return `${actor.kind === "human" ? "user" : "agent"}:${actor.id ?? "unknown"}`;
}

function asProtocolError(error: unknown): unknown {
  if (error instanceof SettingsGovernanceError) {
    return new ProtocolHandlerError(error.code, error.message);
  }
  return error;
}

/**
 * `recordBatch` 前的變更紀錄識別快照。
 *
 * 失敗後不能用「同一個鍵已有 applied 紀錄」判斷本次是否落盤：同一個鍵
 * 以前成功寫過，舊紀錄會被誤當成本次的新紀錄，於是保留新值卻沒有對應的
 * 變更紀錄。只有呼叫後才出現的 changeId 才算這次寫入的紀錄。
 */
function changeIds(governance: SettingsGovernance, actor: GovernanceActor): Set<string> {
  return new Set(governance.changesFor(actor.kind).map((record) => record.changeId));
}

/** 呼叫 `recordBatch` 後才出現的紀錄；先前就有的紀錄不算本次落盤。 */
function recordsAddedSince(
  governance: SettingsGovernance,
  actor: GovernanceActor,
  before: ReadonlySet<string>,
): SettingChangeRecord[] {
  return governance.changesFor(actor.kind).filter((record) => !before.has(record.changeId));
}

async function setModels(
  request: ProtocolRequestContext,
  runtime: ModelRuntime,
  settings: SettingsService,
  governance: SettingsGovernance | undefined,
): Promise<JSONValue> {
  const payload = requireObject(request.payload);
  requireClientRequestId(payload);
  if (payload.providers === undefined && payload.roles === undefined) {
    throw new ProtocolHandlerError("invalid_message", "至少要帶 providers 或 roles。", {
      field: "providers",
    });
  }
  const actor = actorOf(request);
  if (actor.kind === "agent") {
    // 模型設定在核准前對引擎生效太重，approval 等級必須經人類核准。
    if (governance !== undefined) {
      governance.auditDenied(actor, "change", "approval");
    }
    throw new ProtocolHandlerError(
      "permission_denied",
      "代理不能直接套用模型設定；請先以 settings.propose_change 提出，由人類核准。",
    );
  }
  const previous = {
    providers: settings.get(MODEL_SETTING_KEYS.providers),
    roles: settings.get(MODEL_SETTING_KEYS.roles),
  };
  let state: Awaited<ReturnType<ModelRuntime["apply"]>>;
  try {
    state = await runtime.apply(
      {
        ...(payload.providers === undefined ? {} : { providers: payload.providers }),
        ...(payload.roles === undefined ? {} : { roles: payload.roles }),
      },
      actorText(actor),
    );
  } catch (error) {
    if (error instanceof ModelSettingsError) {
      throw new ProtocolHandlerError("invalid_message", error.message, {
        field: error.field,
      });
    }
    throw error;
  }
  if (governance !== undefined) {
    // approval 等級也要留下治理紀錄；值以寫入後的設定為準。
    const batch: RecordBatchInput[] = [];
    for (const key of [MODEL_SETTING_KEYS.providers, MODEL_SETTING_KEYS.roles] as const) {
      const included =
        key === MODEL_SETTING_KEYS.providers
          ? payload.providers !== undefined
          : payload.roles !== undefined;
      if (!included) continue;
      const value = settings.get(key);
      if (value === undefined) continue;
      batch.push({
        key,
        value,
        actor,
        clientRequestId: `${String(payload.clientRequestId)}:${
          key === MODEL_SETTING_KEYS.providers ? "providers" : "roles"
        }`,
      });
    }
    if (batch.length > 0) {
      const before = changeIds(governance, actor);
      try {
        governance.recordBatch(batch);
      } catch {
        // 治理紀錄沒落盤：只有這次才出現的紀錄才算本次落盤；同一個鍵
        // 先前的 applied 紀錄屬於更早的變更，不能拿來證明這次寫成功。
        const landed = new Set(
          recordsAddedSince(governance, actor, before)
            .filter((record) => record.status === "applied")
            .map((record) => record.key),
        );
        const missing = batch.map((entry) => entry.key).filter((key) => !landed.has(key));
        if (missing.length === 0) {
          // 本次紀錄已落盤（例如稽核寫入失敗）：模型與紀錄一致，保留套用。
          throw new ProtocolHandlerError(
            "conflict",
            "模型設定已套用且本次變更紀錄已落盤，但稽核紀錄不完整；請檢查磁碟後再設定一次。",
          );
        }
        // 只退回本次沒有紀錄的鍵，已落盤的 applied 不會被退回成假紀錄。
        const rollbackInput: { providers?: JSONValue; roles?: JSONValue } = {};
        if (missing.includes(MODEL_SETTING_KEYS.providers) && previous.providers !== undefined) {
          rollbackInput.providers = previous.providers;
        }
        if (missing.includes(MODEL_SETTING_KEYS.roles) && previous.roles !== undefined) {
          rollbackInput.roles = previous.roles;
        }
        if (Object.keys(rollbackInput).length !== missing.length) {
          throw new ProtocolHandlerError(
            "conflict",
            "治理紀錄寫入失敗，且退回原值也失敗了；請以 system.models.set 重新設定模型。",
          );
        }
        try {
          await runtime.apply(rollbackInput, "system:rollback");
        } catch {
          throw new ProtocolHandlerError(
            "conflict",
            "治理紀錄寫入失敗，且退回原值也失敗了；請以 system.models.set 重新設定模型。",
          );
        }
        throw new ProtocolHandlerError(
          "conflict",
          `治理紀錄寫入失敗；${missing.join("、")} 已退回原設定；請再試一次。`,
        );
      }
    }
  }
  return state as unknown as JSONValue;
}

function setSettings(
  request: ProtocolRequestContext,
  settings: SettingsService,
  protocol: ProtocolEventEmitter,
  now: () => Date,
  governance?: SettingsGovernance,
): JSONValue {
  const payload = requireObject(request.payload);
  requireClientRequestId(payload);
  const changes = payload.changes;
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new ProtocolHandlerError("invalid_message", "changes 必須是非空陣列。", {
      field: "changes",
    });
  }
  const actor = actorOf(request);
  // 第一階段：驗證整批，不寫任何東西；任何一筆不過，整批不生效。
  const validated: Array<{
    key: string;
    value: JSONValue;
    index: number;
    tier?: SettingTier;
    effect?: "apply" | "propose";
  }> = [];
  for (const [index, change] of changes.entries()) {
    if (typeof change !== "object" || change === null || Array.isArray(change)) {
      throw new ProtocolHandlerError("invalid_message", `changes[${index}] 必須是物件。`, {
        field: `changes[${index}]`,
      });
    }
    const entry = change as Record<string, unknown>;
    if (typeof entry.key !== "string" || entry.key.trim().length === 0) {
      throw new ProtocolHandlerError("invalid_message", `changes[${index}].key 必須是非空字串。`, {
        field: `changes[${index}].key`,
      });
    }
    const key = entry.key;
    if (key === MODEL_SETTING_KEYS.providers || key === MODEL_SETTING_KEYS.roles) {
      throw new ProtocolHandlerError("invalid_message", `${key} 只能經 system.models.set 修改。`, {
        field: `changes[${index}].key`,
      });
    }
    if (entry.value === undefined) {
      throw new ProtocolHandlerError("invalid_message", `${key} 缺少 value。`, {
        field: `changes[${index}].value`,
      });
    }
    validateValue(key, entry.value, `changes[${index}].value`);
    if (governance !== undefined) {
      // 分級在寫入前先擋掉整批；代理沒有權限的鍵直接拒絕。
      const tier = governance.tierOf(key);
      const decision = decideSettingAction(tier, actor.kind, "change");
      if (!decision.allowed) {
        governance.auditDenied(actor, "change", tier, key);
        throw new ProtocolHandlerError(
          "permission_denied",
          actor.kind === "agent"
            ? "設定不存在，或代理沒有權限變更。"
            : "這個設定不能透過這條路徑變更。",
        );
      }
      validated.push({
        key,
        value: entry.value as JSONValue,
        index,
        tier,
        effect: decision.effect === "propose" ? "propose" : "apply",
      });
      continue;
    }
    validated.push({ key, value: entry.value as JSONValue, index });
  }
  // 第二階段：套用項以同一個交易寫入儲存區（全有全無）；
  // 完整紀錄再一次落盤（單一正本檔寫入）。中間失敗會退回整批設定，
  // 不會留下沒有紀錄的已套用變更。
  const applied: SettingItem[] = [];
  let requiresApproval = false;
  let approvalId: string | undefined;
  const writerActor = actorText(actor);
  if (governance === undefined) {
    const results = settings.setMany(
      validated.map((change) => ({ key: change.key, value: change.value, actor: writerActor })),
    );
    for (const result of results) applied.push(result.item);
  } else {
    const applyItems = validated.filter((change) => change.effect !== "propose");
    const proposeItems = validated.filter((change) => change.effect === "propose");
    // 先捕捉整批原值，變更紀錄寫不出去時用來退回。
    const previousByKey = new Map<string, JSONValue | undefined>(
      applyItems.map((change) => [change.key, settings.get(change.key)] as const),
    );
    // 步驟一：套用項以同一個交易寫入；儲存區交易失敗時一筆都不生效，
    // 變更紀錄也還沒動。
    if (applyItems.length > 0) {
      const results = settings.setMany(
        applyItems.map((change) => ({
          key: change.key,
          value: change.value,
          actor: writerActor,
        })),
      );
      for (const result of results) applied.push(result.item);
    }
    // 步驟二：整批紀錄一次落盤；提議項成為待決紀錄，不寫儲存區。
    const requestId = String(payload.clientRequestId);
    const batch: RecordBatchInput[] = [...applyItems, ...proposeItems].map((change) => ({
      key: change.key,
      value: change.value,
      actor,
      clientRequestId: `${requestId}:${change.index}`,
    }));
    const before = changeIds(governance, actor);
    try {
      const { pending } = governance.recordBatch(batch);
      if (pending.length > 0) {
        requiresApproval = true;
        approvalId = pending[0]?.changeId;
      }
    } catch {
      // 紀錄沒落盤：只有這次才出現的紀錄才算本次落盤；先前同鍵的
      // applied 紀錄不能證明這次寫成功，否則會保留新值卻沒有紀錄。
      const fresh = recordsAddedSince(governance, actor, before);
      const landedApplied = new Set(
        fresh.filter((record) => record.status === "applied").map((record) => record.key),
      );
      const landedPending = new Set(
        fresh.filter((record) => record.status === "pending").map((record) => record.key),
      );
      const missingAppliedKeys = applyItems
        .filter((change) => !landedApplied.has(change.key))
        .map((change) => change.key)
        .filter((key, at, keys) => keys.indexOf(key) === at);
      const missingPending = proposeItems.filter((change) => !landedPending.has(change.key));
      if (missingAppliedKeys.length === 0 && missingPending.length === 0) {
        // 本次紀錄已全部落盤（例如稽核寫入失敗）：儲存區與紀錄一致，保留套用。
        throw new ProtocolHandlerError(
          "conflict",
          "設定已套用且本次變更紀錄已落盤，但稽核紀錄不完整；請檢查磁碟後再試一次。",
        );
      }
      // 只退回沒有紀錄的鍵，已落盤的 applied 不會被退回成假紀錄。
      const restore = missingAppliedKeys
        .map((key) => ({ key, value: previousByKey.get(key) }))
        .filter((entry): entry is { key: string; value: JSONValue } => entry.value !== undefined);
      if (restore.length !== missingAppliedKeys.length) {
        throw new ProtocolHandlerError(
          "conflict",
          "變更紀錄寫入失敗，且部分設定沒有可還原的原值；請檢查設定後重試。",
        );
      }
      if (restore.length > 0) {
        try {
          settings.setMany(
            restore.map((entry) => ({
              key: entry.key,
              value: entry.value,
              actor: "system:rollback",
            })),
          );
        } catch {
          throw new ProtocolHandlerError(
            "conflict",
            "變更紀錄寫入失敗，且退回原值也失敗了；請重新設定這些項目。",
          );
        }
      }
      throw new ProtocolHandlerError(
        "conflict",
        missingAppliedKeys.length > 0
          ? `變更紀錄寫入失敗；${missingAppliedKeys.join("、")} 已退回原設定。`
          : "變更紀錄寫入失敗；待決提議沒有建立，設定沒有變更。",
      );
    }
  }
  const changedAt = now().toISOString();
  if (applied.length > 0) {
    protocol.emit({
      kind: "settings-changed",
      payload: {
        changes: applied,
        changedBy: actorText(actor),
        changedAt,
      } as unknown as JSONValue,
    });
  }
  return {
    applied,
    requiresApproval,
    ...(approvalId === undefined ? {} : { approvalId }),
  } as unknown as JSONValue;
}

function legacyItems(
  items: readonly import("@cardiary/protocol").SettingTierItem[],
): SettingItem[] {
  return items.map((item) => ({
    key: item.key,
    value: item.value,
    level: item.tier,
    ...(item.title === undefined ? {} : { title: item.title }),
    ...(item.description === undefined ? {} : { description: item.description }),
    updatedAt: item.updatedAt,
  }));
}

function validateValue(key: string, value: unknown, field: string): void {
  if (key !== MODEL_SETTING_KEYS.summaryMaxOutputTokens) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ProtocolHandlerError("invalid_message", `${key} 必須是正整數。`, { field });
  }
}

function requireObject(value: unknown): JSONObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolHandlerError("invalid_message", "payload 必須是物件。", {
      field: "payload",
    });
  }
  return value as JSONObject;
}

function requireClientRequestId(payload: JSONObject): void {
  if (typeof payload.clientRequestId !== "string" || payload.clientRequestId.length === 0) {
    throw new ProtocolHandlerError("invalid_message", "缺少 clientRequestId。", {
      field: "clientRequestId",
    });
  }
}
