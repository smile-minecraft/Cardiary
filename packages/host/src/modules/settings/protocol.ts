import type { ProtocolRequestContext, ProtocolEventEmitter } from "@cardiary/module-api";
import type { JSONObject, JSONValue, SettingItem } from "@cardiary/protocol";

import { ProtocolHandlerError } from "../contract.js";
import { ModelSettingsError, type ModelRuntime } from "../../models/index.js";
import { MODEL_SETTING_KEYS } from "../../models/types.js";
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
}

export function registerSettingsProtocol(options: SettingsProtocolOptions): void {
  const { runtime, settings, protocol } = options;
  protocol.registerNamespace("system.models", async (request) => {
    switch (request.type) {
      case "system.models.get":
        return runtime.state as unknown as JSONValue;
      case "system.models.set":
        return setModels(request, runtime);
      default:
        throw new ProtocolHandlerError("not_found", `主機不支援 ${request.type}。`);
    }
  });
  protocol.registerNamespace("system.settings", async (request) => {
    switch (request.type) {
      case "system.settings.get":
        return { settings: settings.list() } as unknown as JSONValue;
      case "system.settings.set":
        return setSettings(request, settings, protocol, options.now);
      default:
        throw new ProtocolHandlerError("not_found", `主機不支援 ${request.type}。`);
    }
  });
}

async function setModels(
  request: ProtocolRequestContext,
  runtime: ModelRuntime,
): Promise<JSONValue> {
  const payload = requireObject(request.payload);
  requireClientRequestId(payload);
  if (payload.providers === undefined && payload.roles === undefined) {
    throw new ProtocolHandlerError("invalid_message", "至少要帶 providers 或 roles。", {
      field: "providers",
    });
  }
  try {
    const state = await runtime.apply(
      {
        ...(payload.providers === undefined ? {} : { providers: payload.providers }),
        ...(payload.roles === undefined ? {} : { roles: payload.roles }),
      },
      `user:${request.clientId}`,
    );
    return state as unknown as JSONValue;
  } catch (error) {
    if (error instanceof ModelSettingsError) {
      throw new ProtocolHandlerError("invalid_message", error.message, { field: error.field });
    }
    throw error;
  }
}

function setSettings(
  request: ProtocolRequestContext,
  settings: SettingsService,
  protocol: ProtocolEventEmitter,
  now: () => Date,
): JSONValue {
  const payload = requireObject(request.payload);
  requireClientRequestId(payload);
  const changes = payload.changes;
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new ProtocolHandlerError("invalid_message", "changes 必須是非空陣列。", {
      field: "changes",
    });
  }
  const actor = `user:${request.clientId}`;
  const applied: SettingItem[] = [];
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
    applied.push(
      settings.set({
        key,
        value: entry.value as JSONValue,
        actor,
      }).item,
    );
  }
  const changedAt = now().toISOString();
  protocol.emit({
    kind: "settings-changed",
    payload: {
      changes: applied,
      changedBy: actor,
      changedAt,
    } as unknown as JSONValue,
  });
  return { applied, requiresApproval: false } as unknown as JSONValue;
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
