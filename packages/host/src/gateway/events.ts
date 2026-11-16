import type { JsonValue } from "@cardiary/engine-adapter";
import type { ProtocolEventIntent } from "@cardiary/module-api";
import type { JSONObject } from "@cardiary/protocol";

/**
 * 模組事件意圖 → 正式事件。
 *
 * 模組只能描述「發生什麼事」；型別、串流、序號與落地都由閘道決定。
 * payload 在用 schema 的規則驗過之後才寫進 `event_log`；驗不過就記診斷
 * 並丟棄，壞事件不進事件日誌。
 */

export interface MappedEvent {
  readonly stream: string;
  readonly type: string;
  readonly payload: JSONObject;
}

export type EventMapping = { readonly events: readonly MappedEvent[] } | { readonly error: string };

/** 把意圖轉成要落地的正式事件；不支援的意圖回錯誤字串。 */
export function mapEventIntent(intent: ProtocolEventIntent): EventMapping {
  switch (intent.kind) {
    case "board-changed": {
      const payload = asObject(intent.payload);
      if (payload === null) return { error: "board.changed 的 payload 必須是物件" };
      if (payload.boardId !== intent.boardId) {
        return { error: "board.changed 的 payload 與宣告的 boardId 不一致" };
      }
      return one("system", "board.changed", payload);
    }
    case "card-changed":
      return one("system", "card.changed", {
        cardId: intent.cardId,
        change: intent.change,
        ...(intent.revision === undefined ? {} : { revision: intent.revision }),
        ...(intent.freshness === undefined ? {} : { freshness: intent.freshness }),
      });
    case "context-changed": {
      const context = asObject(intent.context);
      if (context === null) {
        return { error: "context.changed 的 context 必須是物件" };
      }
      const contextSession = context.sessionId;
      if (typeof contextSession === "string" && contextSession !== intent.conversationId) {
        return { error: "context.changed 的會話與內容不一致" };
      }
      return one(`session:${intent.conversationId}`, "context.changed", {
        sessionId: intent.conversationId,
        context,
      });
    }
    case "context-compacted": {
      const payload = asObject(intent.payload);
      if (payload === null) {
        return { error: "context.compacted 的 payload 必須是物件" };
      }
      const mismatch = sessionMismatch(payload, intent.conversationId);
      if (mismatch !== null) return { error: mismatch };
      return one(`session:${intent.conversationId}`, "context.compacted", payload);
    }
    case "session-lifecycle": {
      const payload = asObject(intent.payload);
      if (payload === null) {
        return { error: "會話生命週期事件的 payload 必須是物件" };
      }
      const mismatch = sessionMismatch(payload, intent.conversationId);
      if (mismatch !== null) return { error: mismatch };
      const type = `session.${intent.event}`;
      return {
        events: [
          { stream: "system", type, payload },
          { stream: `session:${intent.conversationId}`, type, payload },
        ],
      };
    }
    case "notification-changed": {
      const notification = asObject(intent.notification);
      if (notification === null) {
        return { error: "notification.changed 的 notification 必須是物件" };
      }
      const invalid = notificationWire(notification, "notification");
      if (invalid !== null) {
        return { error: invalid };
      }
      return one("system", "notification.changed", { notification });
    }
    case "settings-changed": {
      const payload = asObject(intent.payload);
      if (payload === null) return { error: "settings.changed 的 payload 必須是物件" };
      return one("system", "system.settings.changed", payload);
    }
    case "models-changed": {
      const payload = asObject(intent.payload);
      if (payload === null) return { error: "models.changed 的 payload 必須是物件" };
      return one("system", "system.models.changed", payload);
    }
    case "module-changed": {
      const payload = asObject(intent.payload);
      if (payload === null) return { error: "module.changed 的 payload 必須是物件" };
      return one("system", "system.modules.changed", payload);
    }
    case "mcp-servers-changed": {
      const payload = asObject(intent.payload);
      if (payload === null) return { error: "mcp.servers_changed 的 payload 必須是物件" };
      return one("system", "mcp.servers_changed", payload);
    }
    case "module-event":
      if (!isModuleEventType(intent.type)) {
        return { error: `模組事件型別不合法：${intent.type}` };
      }
      return one("system", intent.type, { data: intent.payload });
    default:
      return { error: `M1 沒有這個事件意圖：${intent.kind}` };
  }
}

/** 這一版只支援 `module.<ns>.<name>`；其他型別不落地。 */
export function isModuleEventType(type: string): boolean {
  return /^module\.[a-z0-9-]+\.[a-z0-9.-]+$/.test(type);
}

/**
 * 用協定 schema 的規則驗事件 payload；回 `null` 表示通過。
 *
 * 檢查必填欄位、型別、列舉、整數範圍、RFC 3339 時間與
 * `additionalProperties: false`。巢狀的 `ContextView` 與模型狀態也驗到
 * 葉節點，模組送錯形狀不會進事件日誌。
 */
export function validateEventPayload(type: string, payload: unknown): string | null {
  if (isModuleEventType(type)) {
    return checkObject(
      payload,
      "payload",
      new Map([
        ["data", objectJson],
        ["schemaVersion", optional(string)],
      ]),
      ["data"],
    );
  }
  switch (type) {
    case "board.changed":
      return checkObject(
        payload,
        "payload",
        new Map([
          ["boardId", string],
          ["change", enumeration("created", "updated", "deleted")],
          ["board", optional(boardDocument)],
          ["cardIds", optional(arrayOf(string))],
        ]),
        ["boardId", "change"],
      );
    case "card.changed":
      return checkObject(
        payload,
        "payload",
        new Map([
          ["cardId", string],
          ["change", enumeration("created", "updated", "deleted", "refreshed", "reindexed")],
          ["revision", optional(string)],
          ["freshness", optional(integer(0, 100))],
        ]),
        ["cardId", "change"],
      );
    case "context.changed":
      return checkObject(
        payload,
        "payload",
        new Map([
          ["sessionId", string],
          ["context", contextView],
        ]),
        ["sessionId", "context"],
      );
    case "context.compacted":
      return checkObject(
        payload,
        "payload",
        new Map([
          ["sessionId", string],
          ["summaryCardId", string],
          ["beforeTokens", integer(0)],
          ["afterTokens", integer(0)],
          ["compactedAt", dateTime],
        ]),
        ["sessionId", "summaryCardId", "beforeTokens", "afterTokens", "compactedAt"],
      );
    case "session.archived":
      return checkObject(
        payload,
        "payload",
        new Map([
          ["sessionId", string],
          ["archive", sessionArchive],
        ]),
        ["sessionId", "archive"],
      );
    case "session.unarchived":
      return checkObject(payload, "payload", new Map([["sessionId", string]]), ["sessionId"]);
    case "session.deleted":
      return checkObject(
        payload,
        "payload",
        new Map([
          ["sessionId", string],
          ["deletedSessionIds", arrayOf(string)],
          ["deletedCards", integer(0)],
          ["deletedAssets", integer(0)],
        ]),
        ["sessionId", "deletedSessionIds", "deletedCards", "deletedAssets"],
      );
    case "system.settings.changed":
      return checkObject(
        payload,
        "payload",
        new Map([
          ["changes", arrayOf(settingItem)],
          ["changedBy", string],
          ["changedAt", dateTime],
        ]),
        ["changes", "changedBy", "changedAt"],
      );
    case "system.models.changed":
      return checkObject(
        payload,
        "payload",
        new Map([
          ["providers", arrayOf(modelProvider)],
          ["roles", arrayOf(modelRoleSelection)],
          ["resolved", arrayOf(resolvedModelRole)],
        ]),
        ["providers", "roles", "resolved"],
      );
    case "system.modules.changed":
      return checkObject(payload, "payload", new Map([["module", moduleInfo]]), ["module"]);
    case "mcp.servers_changed":
      return mcpServersChanged(payload, "payload");
    case "notification.changed":
      return checkObject(payload, "payload", new Map([["notification", notificationWire]]), [
        "notification",
      ]);
    default:
      return `M1 沒有這個事件型別：${type}`;
  }
}

// ---- 檢查器 -------------------------------------------------------------

type Checker = (value: unknown, path: string) => string | null;

const string: Checker = (value, path) => (typeof value === "string" ? null : `${path} 必須是字串`);

const boolean: Checker = (value, path) =>
  typeof value === "boolean" ? null : `${path} 必須是布林`;

const objectJson: Checker = (value, path) => (isRecord(value) ? null : `${path} 必須是 JSON 物件`);

const anyJson: Checker = () => null;

const number: Checker = (value, path) =>
  typeof value === "number" && Number.isFinite(value) ? null : `${path} 必須是數字`;

function optional(check: Checker): Checker {
  return (value, path) => (value === undefined ? null : check(value, path));
}

function enumeration(...values: readonly string[]): Checker {
  return (value, path) =>
    typeof value === "string" && values.includes(value)
      ? null
      : `${path} 必須是 ${values.join("、")} 其中之一`;
}

function integer(minimum: number, maximum?: number): Checker {
  return (value, path) => {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return `${path} 必須是整數`;
    }
    if (value < minimum) return `${path} 不能小於 ${minimum}`;
    if (maximum !== undefined && value > maximum) return `${path} 不能大於 ${maximum}`;
    return null;
  };
}

function arrayOf(check: Checker): Checker {
  return (value, path) => {
    if (!Array.isArray(value)) return `${path} 必須是陣列`;
    for (const [index, entry] of value.entries()) {
      const issue = check(entry, `${path}[${index}]`);
      if (issue !== null) return issue;
    }
    return null;
  };
}

const dateTime: Checker = (value, path) =>
  typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? null
    : `${path} 必須是 RFC 3339 時間`;

/** 物件檢查：拒絕未知欄位、漏掉的必填欄位。 */
function checkObject(
  value: unknown,
  path: string,
  fields: ReadonlyMap<string, Checker>,
  required: readonly string[],
): string | null {
  if (!isRecord(value)) {
    return `${path} 必須是物件`;
  }
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) {
      return `${path}.${key} 不是這個事件允許的欄位`;
    }
  }
  for (const key of required) {
    if (value[key] === undefined) {
      return `${path}.${key} 是必填欄位`;
    }
  }
  for (const [key, check] of fields) {
    const entry = value[key];
    if (entry === undefined) continue;
    const issue = check(entry, `${path}.${key}`);
    if (issue !== null) return issue;
  }
  return null;
}

/** 白板座標與尺寸是非負安全整數；協定與檔案格式用同一條規則。 */
const canvasInteger: Checker = (value, path) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? null
    : `${path} 必須是非負安全整數`;

const boardPoint: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["x", canvasInteger],
      ["y", canvasInteger],
    ]),
    ["x", "y"],
  );

const boardSize: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["width", canvasInteger],
      ["height", canvasInteger],
    ]),
    ["width", "height"],
  );

const boardItem: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["id", string],
      ["cardId", string],
      ["position", boardPoint],
      ["size", boardSize],
      ["pinned", boolean],
      ["origin", enumeration("canvas", "inbox")],
      ["projectedBy", optional(enumeration("user", "agent"))],
      ["groupId", optional(string)],
    ]),
    ["id", "cardId", "position", "size", "pinned", "origin"],
  );

const boardEdge: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["id", string],
      ["from", string],
      ["to", string],
      ["label", optional(string)],
    ]),
    ["id", "from", "to"],
  );

const boardGroup: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["id", string],
      ["label", string],
      ["parentId", optional(string)],
    ]),
    ["id", "label"],
  );

/**
 * 整份白板文件的形狀；`board.changed` 帶 board 時逐欄檢查。
 *
 * 這裡只驗形狀與欄位，不重算領域規則（例如連線端點存在、分組不成環）；
 * 那種檢查由白板模組在寫入前做，事件層不重複一份會走樣的規則。
 */
const boardDocument: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["schema", (entry, entryPath) => (entry === 1 ? null : `${entryPath} 必須是 1`)],
      ["id", string],
      ["title", string],
      ["createdAt", dateTime],
      ["updatedAt", dateTime],
      ["items", arrayOf(boardItem)],
      ["inbox", arrayOf(boardItem)],
      ["edges", arrayOf(boardEdge)],
      ["groups", arrayOf(boardGroup)],
    ]),
    ["schema", "id", "title", "createdAt", "updatedAt", "items", "inbox", "edges", "groups"],
  );

const notificationWire: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["notificationId", string],
      ["kind", enumeration("schedule", "heartbeat", "distillation")],
      ["title", string],
      ["body", string],
      ["createdAt", dateTime],
      ["readAt", optional(dateTime)],
      ["sourceScheduleId", optional(string)],
      ["sourceConversationId", optional(string)],
      ["payload", objectJson],
    ]),
    ["notificationId", "kind", "title", "body", "createdAt", "payload"],
  );

const sessionArchive: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["archivedAt", dateTime],
      ["purgeAt", dateTime],
    ]),
    ["archivedAt", "purgeAt"],
  );

const contextEntry: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["entryId", string],
      ["layer", enumeration(...CONTEXT_LAYERS)],
      ["cardId", optional(string)],
      ["title", string],
      ["tokenEstimate", integer(0)],
      ["state", enumeration("active", "pending-removal")],
      ["position", integer(0)],
      ["dealProbability", optional(number)],
      ["dealSource", optional(enumeration("system-one", "retrieval", "manual"))],
    ]),
    ["entryId", "layer", "title", "tokenEstimate", "state", "position"],
  );

const CONTEXT_LAYERS = [
  "bedrock",
  "persona",
  "core-memory",
  "opening-memory",
  "short-term-memory",
  "other-cards",
  "working-context",
  "volatile-state",
] as const;

const contextView: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["sessionId", string],
      ["version", integer(0)],
      ["entries", arrayOf(contextEntry)],
      ["usedTokens", integer(0)],
      ["budgetTokens", integer(0)],
      ["contextWindow", integer(1)],
      ["compactionThreshold", number],
      ["lastCompactedAt", optional(dateTime)],
    ]),
    [
      "sessionId",
      "version",
      "entries",
      "usedTokens",
      "budgetTokens",
      "contextWindow",
      "compactionThreshold",
    ],
  );

const settingItem: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["key", string],
      ["value", anyJson],
      ["level", enumeration("free", "approval", "human-only")],
      ["title", optional(string)],
      ["description", optional(string)],
      ["updatedAt", dateTime],
    ]),
    ["key", "value", "level", "updatedAt"],
  );

const modelInfo: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["modelId", string],
      ["displayName", optional(string)],
      ["contextWindow", integer(1)],
      ["maxOutputTokens", optional(integer(1))],
      ["input", arrayOf(enumeration("text", "image", "audio"))],
    ]),
    ["modelId", "contextWindow", "input"],
  );

const modelRef: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["providerId", string],
      ["modelId", string],
    ]),
    ["providerId", "modelId"],
  );

const modelProvider: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["providerId", string],
      ["kind", enumeration("api-key", "aggregator", "local")],
      ["displayName", string],
      ["baseUrl", optional(string)],
      ["credentialRef", optional(string)],
      ["models", arrayOf(modelInfo)],
    ]),
    ["providerId", "kind", "displayName", "models"],
  );

const modelRoleSelection: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["role", enumeration("main", "small", "writing", "system-one")],
      ["mode", enumeration("model", "unset", "none")],
      ["ref", optional(modelRef)],
    ]),
    ["role", "mode"],
  );

const resolvedModelRole: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["role", enumeration("main", "small", "writing", "system-one")],
      ["source", enumeration("configured", "fallback-main", "fallback-small", "none")],
      ["ref", optional(modelRef)],
    ]),
    ["role", "source"],
  );

const moduleSetting: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["key", string],
      ["title", string],
      [
        "kind",
        enumeration("string", "number", "integer", "boolean", "enum", "string-list", "path"),
      ],
      ["level", enumeration("free", "approval", "human-only")],
      ["description", optional(string)],
    ]),
    ["key", "title", "kind", "level"],
  );

const moduleInfo: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["moduleId", string],
      ["name", string],
      ["version", string],
      ["enabled", boolean],
      ["state", enumeration("loaded", "active", "inactive", "failed")],
      ["failure", optional(string)],
      ["protocolPrefixes", arrayOf(string)],
      ["settings", arrayOf(moduleSetting)],
    ]),
    ["moduleId", "name", "version", "enabled", "state", "protocolPrefixes", "settings"],
  );

/** MCP 伺服器資訊；與協定 `McpServerInfo` 的欄位一致。 */
const mcpServerInfo: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["serverId", string],
      ["name", string],
      ["transport", enumeration("stdio", "http")],
      ["command", optional(string)],
      ["args", optional(arrayOf(string))],
      ["url", optional(string)],
      ["allowedHosts", arrayOf(string)],
      ["enabled", boolean],
      ["state", enumeration("disabled", "ready", "failed")],
      ["failure", optional(string)],
      ["createdAt", dateTime],
      ["updatedAt", optional(dateTime)],
    ]),
    ["serverId", "name", "transport", "allowedHosts", "enabled", "state", "createdAt"],
  );

const mcpServersChanged: Checker = (value, path) =>
  checkObject(
    value,
    path,
    new Map([
      ["server", mcpServerInfo],
      ["removed", boolean],
    ]),
    ["server", "removed"],
  );

// ---- 輔助 ---------------------------------------------------------------

function one(stream: string, type: string, payload: JsonValue | JSONObject): EventMapping {
  const object = asObject(payload);
  if (object === null) return { error: `${type} 的 payload 必須是物件` };
  return { events: [{ stream, type, payload: object }] };
}

function asObject(value: unknown): JSONObject | null {
  return isRecord(value) ? (value as JSONObject) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sessionMismatch(payload: JSONObject, conversationId: string): string | null {
  const sessionId = payload.sessionId;
  if (typeof sessionId === "string" && sessionId !== conversationId) {
    return "事件的會話與 payload 的 sessionId 不一致";
  }
  return null;
}
