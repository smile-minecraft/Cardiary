// 協定 schema 的作者用建構器。
/* global URL, console */
//
// 正式格式是 JSON Schema 2020-12：`protocol.schema.json` 會進版控，型別產生器只讀
// 這份 JSON。這個檔案只用來避免重複的物件與訊息外殼，讓 schema 比較好維護。
//
// 執行：pnpm --filter @cardiary/protocol schema:build

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const outputPath = fileURLToPath(new URL("./protocol.schema.json", import.meta.url));

/** @type {Record<string, any>} */
const defs = {};

function add(name, schema) {
  if (defs[name]) {
    throw new Error(`重複的 schema 定義：${name}`);
  }
  defs[name] = { title: name, ...schema };
  return schema;
}

const str = (description, extra = {}) => ({
  type: "string",
  ...(description ? { description } : {}),
  ...extra,
});

const int = (description, extra = {}) => ({
  type: "integer",
  ...(description ? { description } : {}),
  ...extra,
});

const bool = (description) => ({
  type: "boolean",
  ...(description ? { description } : {}),
});

const literal = (value) => ({ const: value });

const ref = (name) => ({ $ref: `#/$defs/${name}` });

const arrayOf = (items, description, extra = {}) => ({
  type: "array",
  items,
  ...(description ? { description } : {}),
  ...extra,
});

const objectOf = (name, required, properties, description) => ({
  type: "object",
  title: name,
  additionalProperties: false,
  required,
  properties,
  ...(description ? { description } : {}),
});

const stringEnum = (values, description) => ({
  type: "string",
  enum: values,
  ...(description ? { description } : {}),
});

const jsonObject = () => ({
  type: "object",
  additionalProperties: ref("JSONValue"),
});

// ---------------------------------------------------------------------------
// 基礎型別
// ---------------------------------------------------------------------------

add("JSONValue", {
  description: "任意 JSON 值。只用於工具輸出、模組資料與錯誤細節，協定欄位不使用。",
  oneOf: [
    { type: "null" },
    { type: "boolean" },
    { type: "number" },
    { type: "string" },
    { type: "array", items: ref("JSONValue") },
    { type: "object", additionalProperties: ref("JSONValue") },
  ],
});

add("JSONObject", {
  description: "字串鍵的 JSON 物件。",
  ...jsonObject(),
});

add("EmptyPayload", objectOf("EmptyPayload", [], {}, "沒有內容的請求或回應。"));

add(
  "ErrorCode",
  stringEnum(
    [
      "auth_invalid",
      "auth_expired",
      "not_authenticated",
      "incompatible_version",
      "invalid_message",
      "payload_too_large",
      "not_found",
      "conflict",
      "busy",
      "permission_denied",
      "rate_limited",
      "unavailable",
      "internal",
      "cancelled",
      "unsupported",
    ],
    "協定層級的錯誤碼。",
  ),
);

add(
  "ErrorFrame",
  objectOf(
    "ErrorFrame",
    ["v", "kind", "code", "message", "retryable"],
    {
      v: literal(1),
      kind: literal("error"),
      replyTo: str("對應的請求 id；連線層級的錯誤沒有這個欄位。"),
      code: ref("ErrorCode"),
      message: str("給人看的錯誤說明，不含敏感資料。"),
      details: ref("JSONObject"),
      retryable: bool("客戶端是否可以原樣重試。"),
    },
    "錯誤信封。HTTP 端點使用同一個結構作為錯誤回應內容。",
  ),
);

// ---------------------------------------------------------------------------
// 系統類別
// ---------------------------------------------------------------------------

add(
  "HelloAuth",
  objectOf(
    "HelloAuth",
    ["token"],
    {
      token: str("驗證 Token。連線成功後不得再出現在任何訊息或日誌。", {
        writeOnly: true,
      }),
    },
    "WebSocket 第一則訊息攜帶的驗證資料。原生客戶端也可以改用 Authorization 標頭。",
  ),
);

add(
  "ProtocolRange",
  objectOf("ProtocolRange", ["min", "max"], {
    min: int("客戶端支援的最低協定主版本。", { minimum: 1 }),
    max: int("客戶端支援的最高協定主版本。", { minimum: 1 }),
  }),
);

add("ClientPlatform", stringEnum(["macos", "ios", "ipados", "web", "other"], "客戶端平台。"));

add(
  "ClientInfo",
  objectOf("ClientInfo", ["name", "version", "platform", "instanceId"], {
    name: str("客戶端名稱，例如 Cardiary macOS。"),
    version: str("客戶端版本。"),
    platform: ref("ClientPlatform"),
    instanceId: str("同一次安裝穩定的隨機識別碼；只用於區分客戶端，不含個人資料。"),
  }),
);

add(
  "HelloResume",
  objectOf("HelloResume", [], {
    systemSeq: int("客戶端最後收到的系統串流序號。", { minimum: 0 }),
  }),
);

add(
  "SystemHelloRequestPayload",
  objectOf(
    "SystemHelloRequestPayload",
    ["protocol", "client"],
    {
      auth: ref("HelloAuth"),
      protocol: ref("ProtocolRange"),
      client: ref("ClientInfo"),
      resume: ref("HelloResume"),
    },
    "連線後的第一則請求。伺服器在驗證與版本協商完成前不接受其他請求。",
  ),
);

add(
  "ProtocolInfo",
  objectOf("ProtocolInfo", ["version", "min", "max"], {
    version: int("這次連線使用的協定主版本。", { minimum: 1 }),
    min: int("伺服器支援的最低主版本。", { minimum: 1 }),
    max: int("伺服器支援的最高主版本。", { minimum: 1 }),
  }),
);

add(
  "ServerInfo",
  objectOf("ServerInfo", ["name", "version"], {
    name: str("主機服務名稱。"),
    version: str("主機服務版本。"),
  }),
);

add(
  "ServerLimits",
  objectOf("ServerLimits", ["maxFrameBytes", "replayWindow", "heartbeatSeconds"], {
    maxFrameBytes: int("單一 WebSocket 訊息的最大位元組數。", { minimum: 1 }),
    replayWindow: int("每個串流保留的可補送事件數量。", { minimum: 0 }),
    heartbeatSeconds: int("WebSocket ping 的間隔秒數。", { minimum: 1 }),
  }),
);

add(
  "ServerCapabilities",
  objectOf("ServerCapabilities", ["modules", "files"], {
    modules: bool("是否接受模組命名空間的請求與事件。"),
    files: bool("是否提供 HTTP 大型檔案端點。"),
  }),
);

add(
  "SystemHelloResponsePayload",
  objectOf(
    "SystemHelloResponsePayload",
    ["protocol", "server", "connectionId", "limits", "capabilities", "epoch"],
    {
      protocol: ref("ProtocolInfo"),
      server: ref("ServerInfo"),
      connectionId: str("這次連線的識別碼；重連後會改變。"),
      limits: ref("ServerLimits"),
      capabilities: ref("ServerCapabilities"),
      epoch: str(
        "目前的事件 epoch。客戶端重連時先比對它；不同就代表上次的事件歷史已經斷了，訂閱時不要帶 lastSeq。",
      ),
    },
    "版本協商與驗證的結果。",
  ),
);

add(
  "SystemSubscribeRequestPayload",
  objectOf("SystemSubscribeRequestPayload", [], {
    lastSeq: int("客戶端最後收到的系統串流序號；省略代表要一份完整快照。", {
      minimum: 0,
    }),
    epoch: str("客戶端上次收到的事件 epoch。省略或與主機不同時，lastSeq 一律視為不可用。"),
  }),
);

add("FolderState", stringEnum(["ready", "not_selected", "unavailable"], "資料夾狀態。"));

add(
  "FolderStatus",
  objectOf("FolderStatus", ["state", "displayName", "writable"], {
    state: ref("FolderState"),
    displayName: str("給使用者看的資料夾名稱，不含完整路徑。"),
    writable: bool("資料夾目前是否可寫。"),
    reason: str("狀態不是 ready 時的原因。"),
  }),
);

add("ServiceState", stringEnum(["running", "paused", "degraded"], "主機服務狀態。"));

add(
  "ServiceStatus",
  objectOf("ServiceStatus", ["state", "version", "uptimeSeconds", "activeTasks"], {
    state: ref("ServiceState"),
    version: str("主機服務版本。"),
    uptimeSeconds: int("服務已執行的秒數。", { minimum: 0 }),
    activeTasks: int("目前進行中的任務數。", { minimum: 0 }),
  }),
);

add(
  "SystemStatus",
  objectOf("SystemStatus", ["folder", "service"], {
    folder: ref("FolderStatus"),
    service: ref("ServiceStatus"),
  }),
);

add(
  "SystemSubscribeResponsePayload",
  objectOf("SystemSubscribeResponsePayload", ["stream", "seq", "epoch", "resyncRequired"], {
    stream: str("串流識別碼，系統串流固定是 system。"),
    seq: int("訂閱當下的最新序號。", { minimum: 0 }),
    epoch: str("這個序號所屬的事件 epoch。與請求的 epoch 不同時，resyncRequired 一定是 true。"),
    resyncRequired: bool("是否附上完整快照；false 表示接下來只會補送 seq 之後的耐久事件。"),
    snapshot: ref("SystemStatus"),
  }),
);

add(
  "SystemUnsubscribeResponsePayload",
  objectOf("SystemUnsubscribeResponsePayload", ["stream"], {
    stream: str("已取消訂閱的串流識別碼。"),
  }),
);

// ---------------------------------------------------------------------------
// 會話類別
// ---------------------------------------------------------------------------

add("SessionStatus", stringEnum(["idle", "running", "waiting_approval", "archived"], "會話狀態。"));

add(
  "SessionSummary",
  objectOf("SessionSummary", ["id", "title", "status", "createdAt", "updatedAt", "messageCount"], {
    id: str("會話識別碼。"),
    title: str("會話標題。"),
    status: ref("SessionStatus"),
    createdAt: str("建立時間，RFC 3339。", { format: "date-time" }),
    updatedAt: str("最後更新時間，RFC 3339。", { format: "date-time" }),
    messageCount: int("可見訊息數量。", { minimum: 0 }),
  }),
);

add(
  "SessionCreateRequestPayload",
  objectOf("SessionCreateRequestPayload", [], {
    title: str("初始標題；省略時由主機產生。"),
    clientRequestId: str("客戶端產生的冪等鍵；同一個鍵重送只會建立一場會話。"),
  }),
);

add(
  "SessionCreateResponsePayload",
  objectOf("SessionCreateResponsePayload", ["session"], {
    session: ref("SessionSummary"),
  }),
);

add(
  "SessionListRequestPayload",
  objectOf("SessionListRequestPayload", [], {
    cursor: str("上一頁回傳的游標。"),
    limit: int("最多回傳幾筆。", { minimum: 1, maximum: 200 }),
  }),
);

add(
  "SessionListResponsePayload",
  objectOf("SessionListResponsePayload", ["sessions"], {
    sessions: arrayOf(ref("SessionSummary")),
    nextCursor: str("下一頁游標；沒有更多資料時省略。"),
  }),
);

add(
  "DeliveryMode",
  stringEnum(
    ["queue", "interrupt"],
    "送出訊息時的行為。queue 在下一個模型請求生效，不中止目前串流；interrupt 先中止目前生成再送出。",
  ),
);

add(
  "SendMessageDisposition",
  stringEnum(["started", "queued", "interrupted_then_started"], "主機實際採用的送出方式。"),
);

add(
  "SessionSendMessageRequestPayload",
  objectOf("SessionSendMessageRequestPayload", ["sessionId", "text", "delivery"], {
    sessionId: str("目標會話。"),
    text: str("使用者訊息文字。"),
    delivery: ref("DeliveryMode"),
    clientMessageId: str("客戶端產生的訊息冪等鍵；重送時主機回傳同一則訊息。"),
  }),
);

add(
  "SessionSendMessageResponsePayload",
  objectOf(
    "SessionSendMessageResponsePayload",
    ["sessionId", "userMessageId", "turnId", "disposition"],
    {
      sessionId: str("目標會話。"),
      userMessageId: str("已接受的訊息識別碼。"),
      turnId: str("訊息對應的回應回合。"),
      disposition: ref("SendMessageDisposition"),
      queuedBehindTurnId: str("排隊時，前面尚未結束的回合識別碼。"),
    },
  ),
);

add(
  "SessionInterruptRequestPayload",
  objectOf("SessionInterruptRequestPayload", ["sessionId"], {
    sessionId: str("要中止的會話。"),
    reason: str("中止原因，會寫入日誌與回合狀態。"),
  }),
);

add(
  "SessionInterruptResponsePayload",
  objectOf("SessionInterruptResponsePayload", ["sessionId", "interrupted"], {
    sessionId: str("目標會話。"),
    interrupted: bool("這次請求是否真的中止了進行中的生成。"),
  }),
);

add("MessageStatus", stringEnum(["streaming", "complete", "interrupted", "failed"], "訊息狀態。"));

add(
  "ToolDiagnostic",
  objectOf("ToolDiagnostic", ["code"], {
    code: str(
      "診斷碼。目前使用 interrupted、truncated、full_output、timeout、denied；這是開放字串，新增代碼不需要改協定版本。",
    ),
    message: str("補充說明。"),
  }),
);

add(
  "ToolOutput",
  objectOf("ToolOutput", [], {
    text: str("給人或模型看的文字輸出。"),
    data: ref("JSONValue"),
    truncated: bool("輸出是否被截斷。"),
  }),
);

add("ToolResultStatus", stringEnum(["ok", "error"], "工具結果狀態。"));

add(
  "UserTranscriptEntry",
  objectOf("UserTranscriptEntry", ["id", "role", "turnId", "createdAt", "text"], {
    id: str("訊息識別碼。"),
    role: literal("user"),
    turnId: str("所屬回合。"),
    createdAt: str("建立時間，RFC 3339。", { format: "date-time" }),
    text: str("訊息文字。"),
  }),
);

add(
  "AssistantTranscriptEntry",
  objectOf("AssistantTranscriptEntry", ["id", "role", "turnId", "createdAt", "text", "status"], {
    id: str("訊息識別碼。"),
    role: literal("assistant"),
    turnId: str("所屬回合。"),
    createdAt: str("建立時間，RFC 3339。", { format: "date-time" }),
    text: str("目前的完整文字。串流中的訊息會持續變長。"),
    status: ref("MessageStatus"),
  }),
);

add(
  "ToolTranscriptEntry",
  objectOf(
    "ToolTranscriptEntry",
    ["id", "role", "turnId", "createdAt", "toolCallId", "name", "input", "status", "diagnostics"],
    {
      id: str("訊息識別碼。"),
      role: literal("tool"),
      turnId: str("所屬回合。"),
      createdAt: str("建立時間，RFC 3339。", { format: "date-time" }),
      toolCallId: str("工具呼叫識別碼。"),
      name: str("工具名稱。"),
      input: ref("JSONObject"),
      output: ref("ToolOutput"),
      status: ref("MessageStatus"),
      diagnostics: arrayOf(ref("ToolDiagnostic"), "工具結果的診斷碼。"),
    },
  ),
);

add("TranscriptEntry", {
  description: "會話歷史中的一則訊息，依 role 區分。",
  oneOf: [ref("UserTranscriptEntry"), ref("AssistantTranscriptEntry"), ref("ToolTranscriptEntry")],
});

add(
  "TurnError",
  objectOf("TurnError", ["code", "message", "retryable"], {
    code: str("錯誤碼。"),
    message: str("錯誤說明。"),
    retryable: bool("這回合是否可以重試。"),
  }),
);

add(
  "TurnPhase",
  stringEnum(
    ["queued", "running", "waiting_approval", "completed", "failed", "interrupted"],
    "回合狀態。",
  ),
);

add(
  "TurnState",
  objectOf("TurnState", ["turnId", "state", "startedAt"], {
    turnId: str("回合識別碼。"),
    state: ref("TurnPhase"),
    startedAt: str("開始時間，RFC 3339。", { format: "date-time" }),
    endedAt: str("結束時間，RFC 3339。", { format: "date-time" }),
    error: ref("TurnError"),
  }),
);

add(
  "TokenUsage",
  objectOf("TokenUsage", [], {
    inputTokens: int("輸入 token 數。", { minimum: 0 }),
    outputTokens: int("輸出 token 數。", { minimum: 0 }),
  }),
);

add(
  "StreamingMessage",
  objectOf(
    "StreamingMessage",
    ["messageId", "text", "startedAt"],
    {
      messageId: str("正在生長的助理訊息識別碼。"),
      turnId: str("所屬回合。"),
      text: str("到快照邊界為止已生成的文字。客戶端用它取代本地顯示中的文字，不是附加。"),
      startedAt: str("開始生成時間，RFC 3339。", { format: "date-time" }),
      truncated: bool("文字是否因緩衝上限被截斷；省略代表沒有。最終訊息完成事件仍帶完整文字。"),
    },
    "訂閱快照中進行中的助理訊息。只在該會話有進行中的回合時出現；不落地，重啟後消失。",
  ),
);

add(
  "SessionSnapshot",
  objectOf("SessionSnapshot", ["session", "entries"], {
    session: ref("SessionSummary"),
    entries: arrayOf(ref("TranscriptEntry"), "最新一段已完成的歷史，依時間由舊到新。"),
    activeTurn: ref("TurnState"),
    pendingApproval: ref("ApprovalRequest"),
    streaming: ref("StreamingMessage"),
  }),
);

add(
  "SessionSubscribeRequestPayload",
  objectOf("SessionSubscribeRequestPayload", ["sessionId"], {
    sessionId: str("要訂閱的會話。"),
    lastSeq: int("客戶端最後收到的會話串流序號；省略代表要一份完整快照。", {
      minimum: 0,
    }),
    epoch: str("客戶端上次收到的事件 epoch。省略或與主機不同時，lastSeq 一律視為不可用。"),
    historyLimit: int("快照最多帶幾則歷史訊息。", { minimum: 1, maximum: 500 }),
  }),
);

add(
  "SessionSubscribeResponsePayload",
  objectOf(
    "SessionSubscribeResponsePayload",
    ["sessionId", "stream", "seq", "epoch", "resyncRequired"],
    {
      sessionId: str("會話識別碼。"),
      stream: str("串流識別碼，格式是 session:<sessionId>。"),
      seq: int("訂閱當下的最新序號。", { minimum: 0 }),
      epoch: str("這個序號所屬的事件 epoch。與請求的 epoch 不同時，resyncRequired 一定是 true。"),
      resyncRequired: bool("是否附上完整快照；false 表示接下來只會補送 seq 之後的耐久事件。"),
      snapshot: ref("SessionSnapshot"),
    },
  ),
);

add(
  "SessionUnsubscribeRequestPayload",
  objectOf("SessionUnsubscribeRequestPayload", ["sessionId"], {
    sessionId: str("要取消訂閱的會話。"),
  }),
);

add(
  "SessionUnsubscribeResponsePayload",
  objectOf("SessionUnsubscribeResponsePayload", ["sessionId", "unsubscribed"], {
    sessionId: str("會話識別碼。"),
    unsubscribed: bool("是否已取消訂閱。"),
  }),
);

add(
  "SessionGetHistoryRequestPayload",
  objectOf("SessionGetHistoryRequestPayload", ["sessionId"], {
    sessionId: str("會話識別碼。"),
    cursor: str("上一頁回傳的游標。"),
    limit: int("最多回傳幾則。", { minimum: 1, maximum: 200 }),
  }),
);

add(
  "SessionGetHistoryResponsePayload",
  objectOf("SessionGetHistoryResponsePayload", ["entries"], {
    entries: arrayOf(ref("TranscriptEntry"), "依時間由舊到新。"),
    nextCursor: str("下一頁游標；沒有更多資料時省略。"),
  }),
);

// ---------------------------------------------------------------------------
// 串流類別
// ---------------------------------------------------------------------------

add(
  "StreamTurnStartedEventPayload",
  objectOf(
    "StreamTurnStartedEventPayload",
    ["sessionId", "turnId", "triggerMessageId", "startedAt"],
    {
      sessionId: str("會話識別碼。"),
      turnId: str("回合識別碼。"),
      triggerMessageId: str("觸發這回合的使用者訊息。"),
      startedAt: str("開始時間，RFC 3339。", { format: "date-time" }),
    },
  ),
);

add(
  "StreamTextDeltaEventPayload",
  objectOf("StreamTextDeltaEventPayload", ["sessionId", "turnId", "messageId", "delta"], {
    sessionId: str("會話識別碼。"),
    turnId: str("回合識別碼。"),
    messageId: str("正在增長的助理訊息。"),
    delta: str("這次追加的文字。"),
  }),
);

add(
  "StreamMessageCompletedEventPayload",
  objectOf("StreamMessageCompletedEventPayload", ["sessionId", "turnId", "entry"], {
    sessionId: str("會話識別碼。"),
    turnId: str("回合識別碼。"),
    entry: ref("AssistantTranscriptEntry"),
    usage: ref("TokenUsage"),
  }),
);

add(
  "StreamToolCallEventPayload",
  objectOf("StreamToolCallEventPayload", ["sessionId", "turnId", "toolCallId", "name", "input"], {
    sessionId: str("會話識別碼。"),
    turnId: str("回合識別碼。"),
    toolCallId: str("工具呼叫識別碼。"),
    name: str("工具名稱。"),
    title: str("給人看的工具動作標題。"),
    input: ref("JSONObject"),
  }),
);

add(
  "StreamToolResultEventPayload",
  objectOf(
    "StreamToolResultEventPayload",
    ["sessionId", "turnId", "toolCallId", "status", "output", "diagnostics"],
    {
      sessionId: str("會話識別碼。"),
      turnId: str("回合識別碼。"),
      toolCallId: str("工具呼叫識別碼。"),
      status: ref("ToolResultStatus"),
      output: ref("ToolOutput"),
      diagnostics: arrayOf(ref("ToolDiagnostic"), "工具結果的診斷碼。"),
    },
  ),
);

add(
  "StreamUiEventPayload",
  objectOf("StreamUiEventPayload", ["sessionId", "turnId", "renderer", "data"], {
    sessionId: str("會話識別碼。"),
    turnId: str("回合識別碼。"),
    toolCallId: str("相關的工具呼叫。"),
    renderer: str("介面渲染器名稱，使用模組命名空間，例如 module.cards.grid。"),
    data: ref("JSONValue"),
  }),
);

// ---------------------------------------------------------------------------
// 審批類別
// ---------------------------------------------------------------------------

add(
  "ApprovalScopeKind",
  stringEnum(["tool_call", "settings_change", "schedule"], "審批範圍的種類。"),
);

add(
  "ApprovalScope",
  objectOf("ApprovalScope", ["kind", "target"], {
    kind: ref("ApprovalScopeKind"),
    target: str("審批對象，例如工具名稱或設定鍵。"),
    detail: ref("JSONValue"),
  }),
);

add("ApprovalEffect", stringEnum(["approve", "reject", "approve_always"], "審批決定的效果。"));

add(
  "ApprovalOption",
  objectOf("ApprovalOption", ["id", "label", "effect"], {
    id: str("選項識別碼。"),
    label: str("給使用者看的按鈕文字。"),
    effect: ref("ApprovalEffect"),
  }),
);

add(
  "ApprovalRequest",
  objectOf(
    "ApprovalRequest",
    ["approvalId", "sessionId", "turnId", "title", "scope", "options", "requestedAt"],
    {
      approvalId: str("審批識別碼。"),
      sessionId: str("所屬會話。"),
      turnId: str("所屬回合。"),
      toolCallId: str("相關的工具呼叫。"),
      title: str("給人看的審批標題。"),
      summary: str("補充說明，例如要執行的指令。"),
      scope: ref("ApprovalScope"),
      options: arrayOf(ref("ApprovalOption"), "可選的決定；至少一個。", {
        minItems: 1,
      }),
      requestedAt: str("請求時間，RFC 3339。", { format: "date-time" }),
      expiresAt: str("逾時時間，RFC 3339；省略代表不會自動逾時。", {
        format: "date-time",
      }),
    },
  ),
);

add(
  "ApprovalDecideRequestPayload",
  objectOf("ApprovalDecideRequestPayload", ["approvalId", "optionId"], {
    approvalId: str("要決定的審批。"),
    optionId: str("ApprovalRequest.options 裡的選項。"),
    note: str("使用者留下的備註。"),
  }),
);

add(
  "ApprovalDecideResponsePayload",
  objectOf("ApprovalDecideResponsePayload", ["approvalId", "effect", "decidedAt", "persisted"], {
    approvalId: str("審批識別碼。"),
    effect: ref("ApprovalEffect"),
    decidedAt: str("決定時間，RFC 3339。", { format: "date-time" }),
    persisted: bool("決定是否已寫入耐久儲存；true 代表主機重啟後仍會續跑。"),
  }),
);

add("DeciderKind", stringEnum(["client", "system"], "做出決定的來源。"));

add(
  "DecidedBy",
  objectOf("DecidedBy", ["kind"], {
    kind: ref("DeciderKind"),
    clientId: str("決定者的客戶端 instanceId。"),
  }),
);

add(
  "ApprovalDecidedEventPayload",
  objectOf(
    "ApprovalDecidedEventPayload",
    ["approvalId", "sessionId", "effect", "decidedAt", "decidedBy"],
    {
      approvalId: str("審批識別碼。"),
      sessionId: str("所屬會話。"),
      effect: ref("ApprovalEffect"),
      decidedAt: str("決定時間，RFC 3339。", { format: "date-time" }),
      decidedBy: ref("DecidedBy"),
    },
  ),
);

add(
  "ApprovalPauseAllRequestPayload",
  objectOf("ApprovalPauseAllRequestPayload", [], {
    reason: str("暫停原因。"),
  }),
);

add(
  "ApprovalPauseAllResponsePayload",
  objectOf("ApprovalPauseAllResponsePayload", ["pausedAt", "interruptedSessionIds"], {
    pausedAt: str("暫停時間，RFC 3339。", { format: "date-time" }),
    interruptedSessionIds: arrayOf(str("被中止的會話識別碼。")),
  }),
);

// ---------------------------------------------------------------------------
// 模組擴充
// ---------------------------------------------------------------------------

const moduleTypePattern = "^module\\.[a-z][a-z0-9-]*\\.[a-z][a-z0-9.-]*$";

add(
  "ModuleRequestPayload",
  objectOf("ModuleRequestPayload", ["data"], {
    data: ref("JSONObject"),
  }),
);

add(
  "ModuleResponsePayload",
  objectOf("ModuleResponsePayload", ["data"], {
    data: ref("JSONObject"),
  }),
);

add(
  "ModuleEventPayload",
  objectOf("ModuleEventPayload", ["data"], {
    data: ref("JSONObject"),
    schemaVersion: str("模組事件的 payload schema 版本。"),
  }),
);

// ---------------------------------------------------------------------------
// 訊息外殼
// ---------------------------------------------------------------------------

function requestFrame(name, type, payloadName, description) {
  add(
    name,
    objectOf(
      name,
      ["v", "kind", "id", "type", "payload"],
      {
        v: literal(1),
        kind: literal("request"),
        id: str("客戶端產生的請求識別碼；同一條連線內用來重送與去重。"),
        type: literal(type),
        payload: ref(payloadName),
      },
      description,
    ),
  );
}

function responseFrame(name, type, payloadName, description) {
  add(
    name,
    objectOf(
      name,
      ["v", "kind", "replyTo", "type", "payload"],
      {
        v: literal(1),
        kind: literal("response"),
        replyTo: str("對應的請求 id。"),
        type: literal(type),
        payload: ref(payloadName),
      },
      description,
    ),
  );
}

function eventFrame(name, type, payloadName, description) {
  add(
    name,
    objectOf(
      name,
      ["v", "kind", "type", "stream", "seq", "emittedAt", "payload"],
      {
        v: literal(1),
        kind: literal("event"),
        type: literal(type),
        stream: str("串流識別碼，system 或 session:<sessionId>。"),
        seq: int(
          "耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。",
          { minimum: 1 },
        ),
        emittedAt: str("主機送出時間，RFC 3339。", { format: "date-time" }),
        payload: ref(payloadName),
      },
      description,
    ),
  );
}

// 系統
requestFrame(
  "SystemHelloRequest",
  "system.hello",
  "SystemHelloRequestPayload",
  "連線後的第一則請求：驗證、版本協商與客戶端資訊。",
);
responseFrame(
  "SystemHelloResponse",
  "system.hello",
  "SystemHelloResponsePayload",
  "驗證與版本協商的結果。",
);
requestFrame(
  "SystemSubscribeRequest",
  "system.subscribe",
  "SystemSubscribeRequestPayload",
  "訂閱系統狀態串流。",
);
responseFrame(
  "SystemSubscribeResponse",
  "system.subscribe",
  "SystemSubscribeResponsePayload",
  "系統狀態串流的訂閱結果。",
);
requestFrame(
  "SystemUnsubscribeRequest",
  "system.unsubscribe",
  "EmptyPayload",
  "取消系統狀態串流。",
);
responseFrame(
  "SystemUnsubscribeResponse",
  "system.unsubscribe",
  "SystemUnsubscribeResponsePayload",
  "系統狀態串流的取消結果。",
);
eventFrame("SystemStatusEvent", "system.status", "SystemStatus", "資料夾或服務狀態改變。");

// 會話
requestFrame(
  "SessionCreateRequest",
  "session.create",
  "SessionCreateRequestPayload",
  "建立一場會話。",
);
responseFrame(
  "SessionCreateResponse",
  "session.create",
  "SessionCreateResponsePayload",
  "建立會話的結果。",
);
requestFrame("SessionListRequest", "session.list", "SessionListRequestPayload", "列出會話。");
responseFrame("SessionListResponse", "session.list", "SessionListResponsePayload", "會話列表。");
requestFrame(
  "SessionSendMessageRequest",
  "session.send_message",
  "SessionSendMessageRequestPayload",
  "送出使用者訊息；可排隊插話或中止後重送。",
);
responseFrame(
  "SessionSendMessageResponse",
  "session.send_message",
  "SessionSendMessageResponsePayload",
  "訊息已接受，回傳實際採用的送出方式。",
);
requestFrame(
  "SessionInterruptRequest",
  "session.interrupt",
  "SessionInterruptRequestPayload",
  "中止目前生成，不送出新的訊息。",
);
responseFrame(
  "SessionInterruptResponse",
  "session.interrupt",
  "SessionInterruptResponsePayload",
  "中止的結果。",
);
requestFrame(
  "SessionSubscribeRequest",
  "session.subscribe",
  "SessionSubscribeRequestPayload",
  "訂閱一場會話的歷史與事件。",
);
responseFrame(
  "SessionSubscribeResponse",
  "session.subscribe",
  "SessionSubscribeResponsePayload",
  "會話串流的訂閱結果。",
);
requestFrame(
  "SessionUnsubscribeRequest",
  "session.unsubscribe",
  "SessionUnsubscribeRequestPayload",
  "取消訂閱一場會話。",
);
responseFrame(
  "SessionUnsubscribeResponse",
  "session.unsubscribe",
  "SessionUnsubscribeResponsePayload",
  "取消訂閱的結果。",
);
requestFrame(
  "SessionGetHistoryRequest",
  "session.get_history",
  "SessionGetHistoryRequestPayload",
  "往回捲動時分頁取得較早的訊息。",
);
responseFrame(
  "SessionGetHistoryResponse",
  "session.get_history",
  "SessionGetHistoryResponsePayload",
  "較早的訊息分頁。",
);

// 串流
eventFrame(
  "StreamTurnStartedEvent",
  "stream.turn_started",
  "StreamTurnStartedEventPayload",
  "一個回應回合開始。",
);
eventFrame(
  "StreamTextDeltaEvent",
  "stream.text_delta",
  "StreamTextDeltaEventPayload",
  "助理文字增量；不落地、不佔序號，只沿著目前的連線送出。",
);
eventFrame(
  "StreamMessageCompletedEvent",
  "stream.message_completed",
  "StreamMessageCompletedEventPayload",
  "助理訊息完成。",
);
eventFrame(
  "StreamToolCallEvent",
  "stream.tool_call",
  "StreamToolCallEventPayload",
  "模型要求呼叫工具。",
);
eventFrame(
  "StreamToolResultEvent",
  "stream.tool_result",
  "StreamToolResultEventPayload",
  "工具結果，含診斷碼。",
);
eventFrame("StreamTurnStateEvent", "stream.turn_state", "TurnState", "回合狀態改變。");
eventFrame(
  "StreamUiEvent",
  "stream.ui",
  "StreamUiEventPayload",
  "工具專屬的介面資料；由客戶端依 renderer 渲染。",
);

// 審批
eventFrame(
  "ApprovalRequestedEvent",
  "approval.requested",
  "ApprovalRequest",
  "需要使用者決定時送出審批請求。",
);
requestFrame(
  "ApprovalDecideRequest",
  "approval.decide",
  "ApprovalDecideRequestPayload",
  "核准或拒絕一筆審批。",
);
responseFrame(
  "ApprovalDecideResponse",
  "approval.decide",
  "ApprovalDecideResponsePayload",
  "審批決定已持久化。",
);
eventFrame(
  "ApprovalDecidedEvent",
  "approval.decided",
  "ApprovalDecidedEventPayload",
  "任何客戶端做出決定後，通知其他客戶端。",
);
requestFrame(
  "ApprovalPauseAllRequest",
  "approval.pause_all",
  "ApprovalPauseAllRequestPayload",
  "緊急暫停所有進行中的任務。",
);
responseFrame(
  "ApprovalPauseAllResponse",
  "approval.pause_all",
  "ApprovalPauseAllResponsePayload",
  "緊急暫停的結果。",
);

// 模組擴充
add("ModuleRequest", {
  ...objectOf(
    "ModuleRequest",
    ["v", "kind", "id", "type", "payload"],
    {
      v: literal(1),
      kind: literal("request"),
      id: str("客戶端產生的請求識別碼。"),
      type: str("模組命名空間的請求型別，例如 module.cards.search。", {
        pattern: moduleTypePattern,
      }),
      payload: ref("ModuleRequestPayload"),
    },
    "模組貢獻的請求。主機依 type 的命名空間路由給對應模組。",
  ),
  "x-catch-all": true,
});

add("ModuleResponse", {
  ...objectOf(
    "ModuleResponse",
    ["v", "kind", "replyTo", "type", "payload"],
    {
      v: literal(1),
      kind: literal("response"),
      replyTo: str("對應的模組請求 id。"),
      type: str("模組命名空間的回應型別。", { pattern: moduleTypePattern }),
      payload: ref("ModuleResponsePayload"),
    },
    "模組貢獻的回應。",
  ),
  "x-catch-all": true,
});

add("ModuleEvent", {
  ...objectOf(
    "ModuleEvent",
    ["v", "kind", "type", "stream", "seq", "emittedAt", "payload"],
    {
      v: literal(1),
      kind: literal("event"),
      type: str("模組命名空間的事件型別，例如 module.cards.changed。", {
        pattern: moduleTypePattern,
      }),
      stream: str("串流識別碼，system 或 session:<sessionId>。"),
      seq: int("這個串流的單調遞增序號。", { minimum: 1 }),
      emittedAt: str("主機送出時間，RFC 3339。", { format: "date-time" }),
      payload: ref("ModuleEventPayload"),
    },
    "模組貢獻的事件。未安裝對應模組的客戶端可以忽略。",
  ),
  "x-catch-all": true,
});

// ---------------------------------------------------------------------------
// 影格聯集
// ---------------------------------------------------------------------------

add("ClientFrame", {
  description: "客戶端送給主機的所有訊息。",
  oneOf: [
    ref("SystemHelloRequest"),
    ref("SystemSubscribeRequest"),
    ref("SystemUnsubscribeRequest"),
    ref("SessionCreateRequest"),
    ref("SessionListRequest"),
    ref("SessionSendMessageRequest"),
    ref("SessionInterruptRequest"),
    ref("SessionSubscribeRequest"),
    ref("SessionUnsubscribeRequest"),
    ref("SessionGetHistoryRequest"),
    ref("ApprovalDecideRequest"),
    ref("ApprovalPauseAllRequest"),
    ref("ModuleRequest"),
  ],
});

add("ServerFrame", {
  description: "主機送給客戶端的所有訊息。",
  oneOf: [
    ref("SystemHelloResponse"),
    ref("SystemSubscribeResponse"),
    ref("SystemUnsubscribeResponse"),
    ref("SystemStatusEvent"),
    ref("SessionCreateResponse"),
    ref("SessionListResponse"),
    ref("SessionSendMessageResponse"),
    ref("SessionInterruptResponse"),
    ref("SessionSubscribeResponse"),
    ref("SessionUnsubscribeResponse"),
    ref("SessionGetHistoryResponse"),
    ref("StreamTurnStartedEvent"),
    ref("StreamTextDeltaEvent"),
    ref("StreamMessageCompletedEvent"),
    ref("StreamToolCallEvent"),
    ref("StreamToolResultEvent"),
    ref("StreamTurnStateEvent"),
    ref("StreamUiEvent"),
    ref("ApprovalRequestedEvent"),
    ref("ApprovalDecideResponse"),
    ref("ApprovalDecidedEvent"),
    ref("ApprovalPauseAllResponse"),
    ref("ErrorFrame"),
    ref("ModuleResponse"),
    ref("ModuleEvent"),
  ],
});

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://cardiary.app/protocol/v1/protocol.schema.json",
  title: "CardiaryProtocol",
  description: "Cardiary 主機服務與客戶端之間的 JSON 協定。持續狀態走 WebSocket，大型檔案走 HTTP。",
  oneOf: [ref("ClientFrame"), ref("ServerFrame")],
  $defs: defs,
};

writeFileSync(outputPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
console.log(`已寫入 ${outputPath}（${Object.keys(defs).length} 個定義）`);
