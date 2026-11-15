import type { JsonValue } from "@cardiary/engine-adapter";
import type { ProtocolEventEmitter, ProtocolRequestContext } from "@cardiary/module-api";
import type {
  JSONObject,
  SessionArchiveResponsePayload,
  SessionDeleteResponsePayload,
  SessionDeletionPreviewResponsePayload,
  SessionUnarchiveResponsePayload,
} from "@cardiary/protocol";
import type { DedupeRecord, RequestDedupeStore } from "@cardiary/storage";

import { ProtocolHandlerError } from "../contract.js";
import {
  SessionLifecycleError,
  type DeletionResult,
  type SessionLifecycleService,
} from "../../sessions/service.js";

/**
 * `session.archive`、`session.unarchive`、`session.deletion_preview` 與
 * `session.delete` 的協定處理器。
 *
 * 核心的 `session.create`、`session.list` 等由閘道自己的 switch 先處理；
 * 這裡只補生命週期訊息。輸入檢查與線路形狀留在這一層，狀態都在
 * `SessionLifecycleService`。
 */

/**
 * `session.delete` 的耐久冪等鍵。`request_dedupe` 的 `kind` 目前只有
 * `session-create` 與 `send-message` 兩種（schema 的 CHECK），所以借記
 * `send-message`：它只是分類標籤，去重與回應都靠 `key`；通用恢復流程解析
 * 不出 `session-delete:` 這種鍵，不會把刪除誤判成已完成。放寬 `kind` 要
 * 動共用 schema 的遷移，留給那一輪協調工作。
 */
const DELETE_KEY_PREFIX = "session-delete:";
/** `pending` 超過這個時間還判斷不了，就回「結果未知」；與閘道的恢復一致。 */
const PENDING_TIMEOUT_MS = 60_000;

export interface LifecycleProtocolOptions {
  readonly service: SessionLifecycleService;
  readonly protocol: ProtocolEventEmitter;
  /** `state/cardiary.sqlite` 的 `request_dedupe`；重啟後仍讀得到。 */
  readonly dedupe: RequestDedupeStore;
  readonly now: () => Date;
}

const LIFECYCLE_TYPES = [
  "session.archive",
  "session.unarchive",
  "session.deletion_preview",
  "session.delete",
] as const;

export function registerLifecycleProtocol(options: LifecycleProtocolOptions): void {
  const { service, protocol, dedupe, now } = options;

  const handle = async (request: ProtocolRequestContext): Promise<JsonValue> => {
    try {
      switch (request.type) {
        case "session.archive":
          return asJson(await archive(service, request.payload));
        case "session.unarchive":
          return asJson(await unarchive(service, request.payload));
        case "session.deletion_preview":
          return asJson(await preview(service, request.payload));
        case "session.delete":
          return asJson(await deleteSession(service, request.payload, dedupe, now));
        default:
          throw new ProtocolHandlerError("not_found", `沒有這個會話訊息：${request.type}`);
      }
    } catch (error) {
      throw asProtocolError(error);
    }
  };
  // 核心型別保留 `session.create` 等；生命週期訊息逐一以精確型別登記，
  // 不能登記整個 `session` 命名空間。
  for (const type of LIFECYCLE_TYPES) {
    protocol.registerNamespace(type, handle);
  }
}

async function archive(
  service: SessionLifecycleService,
  payload: JsonValue,
): Promise<SessionArchiveResponsePayload> {
  const input = objectOf(payload);
  const sessionId = requiredString(input, "sessionId");
  const purgeAfterDays = optionalPositiveInt(input, "purgeAfterDays");
  const result = await service.archive(sessionId, purgeAfterDays);
  return { sessionId, archive: result };
}

async function unarchive(
  service: SessionLifecycleService,
  payload: JsonValue,
): Promise<SessionUnarchiveResponsePayload> {
  const input = objectOf(payload);
  const sessionId = requiredString(input, "sessionId");
  return service.unarchive(sessionId);
}

async function preview(
  service: SessionLifecycleService,
  payload: JsonValue,
): Promise<SessionDeletionPreviewResponsePayload> {
  const input = objectOf(payload);
  const sessionId = requiredString(input, "sessionId");
  const preview = await service.preview(sessionId);
  return {
    sessionId,
    subtreeSessionIds: [...preview.subtreeSessionIds],
    exclusiveCards: preview.exclusiveCards,
    sharedCards: preview.sharedCards,
    assets: preview.assets,
  };
}

async function deleteSession(
  service: SessionLifecycleService,
  payload: JsonValue,
  dedupe: RequestDedupeStore,
  now: () => Date,
): Promise<SessionDeleteResponsePayload> {
  const input = objectOf(payload);
  const sessionId = requiredString(input, "sessionId");
  const clientRequestId = requiredString(input, "clientRequestId");
  const key = `${DELETE_KEY_PREFIX}${clientRequestId}`;
  const claim = dedupe.claim(key, "send-message");
  if (!claim.claimed) {
    return replayDeletion(claim.record, now);
  }
  let result: DeletionResult;
  try {
    result = await service.delete(sessionId);
  } catch (error) {
    if (error instanceof SessionLifecycleError && error.code === "not_found") {
      // 什麼都沒動到；釋放宣告，修正後的同一個請求可以重試。
      dedupe.deleteKeys([key]);
    }
    // 其他錯誤可能已經刪了一半：保留 `pending`，不要假裝完成。
    throw error;
  }
  const response: SessionDeleteResponsePayload = {
    sessionId,
    deletedSessionIds: [...result.deletedSessionIds],
    deletedCards: result.deletedCards,
    deletedAssets: result.deletedAssets,
  };
  dedupe.complete(key, JSON.stringify(response));
  return response;
}

/** 重送同一個鍵：完成就回原本的回應；還在處理中則回 `conflict`，不重做。 */
function replayDeletion(record: DedupeRecord, now: () => Date): SessionDeleteResponsePayload {
  if (record.state === "completed") {
    const stored = storedDeletion(record.responseJson);
    if (stored === null) {
      throw new ProtocolHandlerError("internal", "刪除的回應紀錄無法解析，請重新開啟會話確認。");
    }
    return stored;
  }
  const age = now().getTime() - Date.parse(record.claimedAt);
  if (Number.isFinite(age) && age < PENDING_TIMEOUT_MS) {
    throw new ProtocolHandlerError("conflict", "這個刪除還在處理中，請稍後重試。", {
      reason: "pending",
    });
  }
  throw new ProtocolHandlerError("conflict", "無法判斷先前的刪除是否完成，請重新開啟會話確認。", {
    reason: "result_unknown",
  });
}

function storedDeletion(json: string | null): SessionDeleteResponsePayload | null {
  if (json === null) return null;
  let parsed: Partial<SessionDeleteResponsePayload>;
  try {
    parsed = JSON.parse(json) as Partial<SessionDeleteResponsePayload>;
  } catch {
    return null;
  }
  const ids = parsed.deletedSessionIds;
  if (
    typeof parsed.sessionId !== "string" ||
    !Array.isArray(ids) ||
    !ids.every((id): id is string => typeof id === "string") ||
    typeof parsed.deletedCards !== "number" ||
    typeof parsed.deletedAssets !== "number"
  ) {
    return null;
  }
  return {
    sessionId: parsed.sessionId,
    deletedSessionIds: ids,
    deletedCards: parsed.deletedCards,
    deletedAssets: parsed.deletedAssets,
  };
}

// ---- 輸入檢查 -----------------------------------------------------------

function objectOf(value: JsonValue | undefined): JSONObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProtocolHandlerError("invalid_message", "請求內容必須是物件。");
  }
  return value as JSONObject;
}

function requiredString(input: JSONObject, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolHandlerError("invalid_message", `缺少或型別不符的欄位：${key}`, {
      field: key,
    });
  }
  return value;
}

function optionalPositiveInt(input: JSONObject, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ProtocolHandlerError("invalid_message", `欄位 ${key} 必須是正整數。`, {
      field: key,
    });
  }
  return value;
}

function asProtocolError(error: unknown): unknown {
  if (error instanceof ProtocolHandlerError) return error;
  if (error instanceof SessionLifecycleError) {
    return new ProtocolHandlerError(error.code, error.message);
  }
  return error;
}

function asJson(payload: object): JsonValue {
  return payload as unknown as JsonValue;
}
