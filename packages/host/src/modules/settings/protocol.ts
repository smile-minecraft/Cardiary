import type { ProtocolRequestContext, ProtocolEventEmitter } from "@cardiary/module-api";
import type { JSONObject, JSONValue, SettingChangeRecord, SettingItem } from "@cardiary/protocol";

import { decideSettingAction } from "@cardiary/domain";

import { ProtocolHandlerError } from "../contract.js";
import {
  ModelSettingsError,
  normalizeSetInput,
  readProviders,
  readRoles,
  type ModelRuntime,
} from "../../models/index.js";
import { MODEL_SETTING_KEYS } from "../../models/types.js";
import type { SettingsGovernance, GovernanceActor } from "../../settings/index.js";
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
  const previous =
    pending !== undefined && isModelKey(pending.key) ? settings.get(pending.key) : undefined;
  try {
    const result = governance.decide(payload.changeId, payload.decision, actor);
    if (result.status === "applied" && payload.decision === "approve" && isModelKey(result.key)) {
      // 核准模型設定時把值同步進引擎；引擎不採用時退回核准前的值。
      try {
        await runtime.apply(
          result.key === MODEL_SETTING_KEYS.providers
            ? { providers: result.value }
            : { roles: result.value },
          actorText(actor),
        );
      } catch (error) {
        try {
          if (previous !== undefined) {
            settings.set({ key: result.key, value: previous, actor: "system:rollback" });
          }
        } catch {
          throw new ProtocolHandlerError(
            "conflict",
            "核准已寫入，但引擎不採用這份模型設定，且退回原值也失敗了；請以 system.models.set 重新設定模型。",
          );
        }
        if (error instanceof ModelSettingsError) {
          throw new ProtocolHandlerError("invalid_message", error.message, {
            field: error.field,
          });
        }
        throw error;
      }
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
  } catch (error) {
    throw asProtocolError(error);
  }
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
    throw new ProtocolHandlerError(
      "permission_denied",
      "代理不能直接套用模型設定；請先以 settings.propose_change 提出，由人類核准。",
    );
  }
  try {
    const state = await runtime.apply(
      {
        ...(payload.providers === undefined ? {} : { providers: payload.providers }),
        ...(payload.roles === undefined ? {} : { roles: payload.roles }),
      },
      actorText(actor),
    );
    if (governance !== undefined) {
      // approval 等級也要留下治理紀錄；值以寫入後的設定為準。
      for (const key of [MODEL_SETTING_KEYS.providers, MODEL_SETTING_KEYS.roles] as const) {
        const included =
          key === MODEL_SETTING_KEYS.providers
            ? payload.providers !== undefined
            : payload.roles !== undefined;
        if (!included) continue;
        const value = settings.get(key);
        if (value === undefined) continue;
        governance.change({
          key,
          value,
          actor,
          clientRequestId: `${String(payload.clientRequestId)}:${
            key === MODEL_SETTING_KEYS.providers ? "providers" : "roles"
          }`,
        });
      }
    }
    return state as unknown as JSONValue;
  } catch (error) {
    if (error instanceof ModelSettingsError) {
      throw new ProtocolHandlerError("invalid_message", error.message, { field: error.field });
    }
    throw asProtocolError(error);
  }
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
  const validated: Array<{ key: string; value: JSONValue }> = [];
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
      const decision = decideSettingAction(governance.tierOf(key), actor.kind, "change");
      if (!decision.allowed) {
        throw new ProtocolHandlerError(
          "permission_denied",
          actor.kind === "agent"
            ? "設定不存在，或代理沒有權限變更。"
            : "這個設定不能透過這條路徑變更。",
        );
      }
    }
    validated.push({ key, value: entry.value as JSONValue });
  }
  // 第二階段：整批套用；中途失敗可能留下部分變更（見 PR 說明的已知限制）。
  const applied: SettingItem[] = [];
  let requiresApproval = false;
  let approvalId: string | undefined;
  for (const [index, change] of validated.entries()) {
    if (governance === undefined) {
      applied.push(
        settings.set({ key: change.key, value: change.value, actor: actorText(actor) }).item,
      );
      continue;
    }
    try {
      const result = governance.change({
        key: change.key,
        value: change.value,
        actor,
        clientRequestId: `${String(payload.clientRequestId)}:${index}`,
      });
      if (result.applied) {
        const item = settings.list().find((candidate) => candidate.key === change.key);
        if (item !== undefined) applied.push(item);
      } else {
        requiresApproval = true;
        approvalId ??= result.change.changeId;
      }
    } catch (error) {
      throw asProtocolError(error);
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
