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
    maxBlobBytes: int("HTTP blob 單檔的上傳上限；省略代表沒有提供 blob 端點。", {
      minimum: 1,
    }),
  }),
);

add(
  "ServerCapabilities",
  objectOf("ServerCapabilities", ["modules", "files"], {
    modules: bool("是否接受模組命名空間的請求與事件。"),
    files: bool("是否提供 HTTP 大型檔案端點。"),
    cards: bool("是否提供卡片類訊息。"),
    context: bool("是否提供上下文類訊息。"),
    archive: bool("是否提供會話封存與刪除。"),
    media: bool("是否提供圖片與音訊的匯入。"),
    blobs: bool("是否提供 HTTP blob 上傳與下載。"),
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
    pendingApprovals: arrayOf(
      ref("ApprovalRequest"),
      "目前待決的宿主審批（沒有對話的審批）。主機重啟後客戶端靠它重新看到仍可決定的審批；只在附上快照時出現。",
    ),
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
    archive: ref("SessionArchive"),
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
    ["queue", "steer", "interrupt"],
    "送出訊息時的行為。queue 在目前回合結束後生效；steer 在下一個模型請求前送達，不中止目前串流；interrupt 先中止目前生成再送出。",
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
  "TurnErrorDetails",
  objectOf(
    "TurnErrorDetails",
    [],
    {
      reason: str(
        "機器可讀的原因碼，例如 credential_missing、credential_invalid、quota_exceeded、provider_timeout、connection_failed、model_not_configured。開放字串，閘道可以帶其他診斷碼。",
      ),
      retryAfterMs: int("建議的重試等待毫秒數；只在可以判斷時帶上。", { minimum: 0 }),
      field: str("出錯的設定或請求欄位，例如 roles。"),
    },
    "回合失敗的機器可讀補充資訊。不能放金鑰、Token 或個人資料；給人看的說明放在 message。",
  ),
);

add(
  "TurnError",
  objectOf("TurnError", ["code", "message", "retryable"], {
    code: str("錯誤碼。"),
    message: str("錯誤說明。"),
    retryable: bool("這回合是否可以重試。"),
    details: ref("TurnErrorDetails"),
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
    ["messageId", "turnId", "text", "startedAt"],
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
// M1：卡片
// ---------------------------------------------------------------------------

add(
  "CardKind",
  stringEnum(
    ["note", "image", "audio", "memory", "summary", "persona", "bedrock"],
    "卡片種類。memory、summary、persona、bedrock 只由系統或匯入建立。",
  ),
);

add("CardLifecycle", stringEnum(["live", "cold"], "卡片生命週期；cold 是蒸餾後的冷封存。"));
add("CardLifecycleFilter", stringEnum(["live", "cold", "all"], "列表與搜尋的生命週期篩選。"));

add(
  "CardChange",
  stringEnum(
    ["created", "updated", "deleted", "refreshed", "reindexed"],
    "卡片變更的種類。reindexed 表示只有索引或中繼資料變了。",
  ),
);

add(
  "CardAsset",
  objectOf("CardAsset", ["blobId", "mediaType", "sizeBytes"], {
    blobId: str("內容雜湊（SHA-256 小寫十六進位），也是 HTTP blob 的識別碼。"),
    mediaType: str("例如 image/png、audio/mp4。"),
    sizeBytes: int("原檔位元組數。", { minimum: 0 }),
  }),
);

add(
  "CardLinks",
  objectOf("CardLinks", ["outgoing", "backlinks"], {
    outgoing: arrayOf(str("目標卡片或標題。"), "內文 [[ ]] 的目標，依出現順序。"),
    backlinks: arrayOf(str("來源卡片識別碼。"), "連到這張卡的卡片。"),
  }),
);

add(
  "CardSummary",
  objectOf(
    "CardSummary",
    ["cardId", "kind", "title", "tags", "persona", "createdAt", "freshness", "lifecycle"],
    {
      cardId: str("卡片識別碼。"),
      kind: ref("CardKind"),
      title: str("標題。"),
      summary: str("一兩句話的摘要。"),
      tags: arrayOf(str("標籤。"), "標籤，保留原本順序。"),
      persona: str("人格分區，預設 default。"),
      createdAt: str("建立時間，RFC 3339。", { format: "date-time" }),
      updatedAt: str("最後更新時間，RFC 3339。", { format: "date-time" }),
      freshness: int("新鮮度 0 到 100；檢視欄與卡片庫用它褪色。", { minimum: 0, maximum: 100 }),
      lifecycle: ref("CardLifecycle"),
      supersededBy: str("取代這張卡的新卡；有值時不進預設搜尋與列表。"),
      asset: ref("CardAsset"),
      broken: bool("檔案格式不符，索引無法解析；true 時不提供內文。"),
      brokenReason: str("格式不符的原因，給人看。"),
    },
  ),
);

add(
  "Card",
  objectOf(
    "Card",
    [
      "cardId",
      "kind",
      "title",
      "body",
      "tags",
      "persona",
      "createdAt",
      "freshness",
      "lifecycle",
      "links",
      "revision",
      "sources",
    ],
    {
      cardId: str("卡片識別碼。"),
      kind: ref("CardKind"),
      title: str("標題。"),
      summary: str("摘要。"),
      body: str("內文（Markdown）；補丁編輯的對象。"),
      tags: arrayOf(str("標籤。"), "標籤。"),
      persona: str("人格分區。"),
      createdAt: str("建立時間，RFC 3339。", { format: "date-time" }),
      updatedAt: str("最後更新時間，RFC 3339。", { format: "date-time" }),
      freshness: int("新鮮度 0 到 100。", { minimum: 0, maximum: 100 }),
      lifecycle: ref("CardLifecycle"),
      supersededBy: str("取代這張卡的新卡。"),
      supersedes: str("被這張卡取代的舊卡。"),
      sources: arrayOf(str("來源卡片識別碼。"), "血緣：由哪些卡生成。"),
      asset: ref("CardAsset"),
      links: ref("CardLinks"),
      revision: str("正規化內容的 SHA-256；補丁的樂觀鎖。"),
    },
  ),
);

add(
  "CardListRequestPayload",
  objectOf("CardListRequestPayload", [], {
    kinds: arrayOf(ref("CardKind"), "只回這幾種。"),
    tags: arrayOf(str("標籤。"), "同時包含這些標籤。"),
    persona: str("人格分區。"),
    lifecycle: ref("CardLifecycleFilter"),
    query: str("簡易查詢；等同 card.search 的前綴比對。"),
    includeSuperseded: bool("是否包含被取代的卡；預設 false。"),
    cursor: str("上一頁的游標。"),
    limit: int("最多回傳幾筆。", { minimum: 1, maximum: 200 }),
  }),
);

add(
  "CardListResponsePayload",
  objectOf("CardListResponsePayload", ["cards"], {
    cards: arrayOf(ref("CardSummary"), "依建立時間由新到舊。"),
    nextCursor: str("下一頁游標；沒有更多資料時省略。"),
  }),
);

add(
  "CardGetRequestPayload",
  objectOf("CardGetRequestPayload", ["cardId"], {
    cardId: str("要讀取的卡片。"),
  }),
);

add(
  "CardGetResponsePayload",
  objectOf("CardGetResponsePayload", ["card"], {
    card: ref("Card"),
  }),
);

add(
  "CardCreateRequestPayload",
  objectOf("CardCreateRequestPayload", ["kind", "title", "body", "clientRequestId"], {
    kind: ref("CardKind"),
    title: str("標題。"),
    body: str("內文（Markdown）。"),
    summary: str("摘要。"),
    tags: arrayOf(str("標籤。"), "標籤。"),
    persona: str("人格分區。"),
    sources: arrayOf(str("來源卡片識別碼。"), "血緣。"),
    supersedes: str("被這張卡取代的舊卡。"),
    assetBlobId: str("已上傳原檔的 blobId；圖片與音訊卡必填。"),
    clientRequestId: str("客戶端產生的冪等鍵；同一個鍵重送只會建立一張卡。"),
  }),
);

add(
  "CardCreateResponsePayload",
  objectOf("CardCreateResponsePayload", ["card"], {
    card: ref("CardSummary"),
  }),
);

add("CardPatchFormat", stringEnum(["unified", "replace"], "補丁格式；代理只能用 unified。"));

add(
  "CardPatch",
  objectOf("CardPatch", ["format", "text"], {
    format: ref("CardPatchFormat"),
    text: str("統一 diff（unified）或整段內文（replace）。"),
  }),
);

add(
  "CardPatchRequestPayload",
  objectOf("CardPatchRequestPayload", ["cardId", "baseRevision", "patch"], {
    cardId: str("要編修的卡片。"),
    baseRevision: str("客戶端讀到的 revision；與目前檔案不符時回 conflict。"),
    patch: ref("CardPatch"),
    clientRequestId: str("冪等鍵；重送不會套用兩次。"),
  }),
);

add(
  "CardPatchResponsePayload",
  objectOf("CardPatchResponsePayload", ["card"], {
    card: ref("Card"),
  }),
);

add("PendingPatchStatus", stringEnum(["pending", "accepted", "rejected"], "待決補丁的狀態。"));

add(
  "PendingCardPatch",
  objectOf(
    "PendingCardPatch",
    ["patchId", "cardId", "baseRevision", "patch", "status", "createdAt"],
    {
      patchId: str("待決補丁識別碼。"),
      cardId: str("目標卡片。"),
      baseRevision: str("提出時讀到的 revision；接受時會重算比對。"),
      patch: ref("CardPatch"),
      status: ref("PendingPatchStatus"),
      summary: str("補丁摘要。"),
      sourceConversationId: str("來源對話。"),
      sourceTurnId: str("來源回合。"),
      createdAt: str("建立時間（ISO 8601）。"),
      decidedAt: str("決定時間（ISO 8601）；尚未決定時省略。"),
    },
  ),
);

add(
  "CardPatchesListRequestPayload",
  objectOf("CardPatchesListRequestPayload", ["cardId"], {
    cardId: str("要列出待決補丁的卡片。"),
    status: ref("PendingPatchStatus"),
  }),
);

add(
  "CardPatchesListResponsePayload",
  objectOf("CardPatchesListResponsePayload", ["patches"], {
    patches: arrayOf(ref("PendingCardPatch"), "依建立時間由舊到新。"),
  }),
);

add(
  "CardPatchAcceptRequestPayload",
  objectOf("CardPatchAcceptRequestPayload", ["patchId", "clientRequestId"], {
    patchId: str("要接受的待決補丁。"),
    clientRequestId: str("冪等鍵。"),
  }),
);

add(
  "CardPatchAcceptResponsePayload",
  objectOf("CardPatchAcceptResponsePayload", ["patch", "card"], {
    patch: ref("PendingCardPatch"),
    card: ref("Card"),
  }),
);

add(
  "CardPatchRejectRequestPayload",
  objectOf("CardPatchRejectRequestPayload", ["patchId", "clientRequestId"], {
    patchId: str("要拒絕的待決補丁。"),
    clientRequestId: str("冪等鍵。"),
  }),
);

add(
  "CardPatchRejectResponsePayload",
  objectOf("CardPatchRejectResponsePayload", ["patch"], {
    patch: ref("PendingCardPatch"),
  }),
);

add(
  "CardVersionKind",
  stringEnum(["create", "patch", "checkpoint", "restore", "merge"], "版本記錄的種類。"),
);

add(
  "CardVersion",
  objectOf(
    "CardVersion",
    ["versionId", "cardId", "seq", "kind", "revision", "bodyHash", "createdAt"],
    {
      versionId: str("版本識別碼。"),
      cardId: str("卡片識別碼。"),
      seq: int("遞增序號。", { minimum: 1 }),
      kind: ref("CardVersionKind"),
      revision: str("這一版的 revision。"),
      bodyHash: str("內文 SHA-256。"),
      baseRevision: str("補丁或還原所根據的 revision。"),
      patchFormat: str("補丁格式。"),
      patchText: str("補丁內容或整段內文。"),
      createdAt: str("建立時間（ISO 8601）。"),
      mergedCount: int("被合併的版本數。", { minimum: 0 }),
      mergedSeqRange: str("合併的序號範圍。"),
    },
  ),
);

add(
  "CardVersionsListRequestPayload",
  objectOf("CardVersionsListRequestPayload", ["cardId"], {
    cardId: str("要列出版本歷史的卡片。"),
  }),
);

add(
  "CardVersionsListResponsePayload",
  objectOf("CardVersionsListResponsePayload", ["versions"], {
    versions: arrayOf(ref("CardVersion"), "依序號由小到大。"),
  }),
);

add(
  "CardVersionGetRequestPayload",
  objectOf("CardVersionGetRequestPayload", ["cardId", "versionId"], {
    cardId: str("卡片識別碼。"),
    versionId: str("要讀取的版本。"),
  }),
);
add(
  "CardVersionGetResponsePayload",
  objectOf("CardVersionGetResponsePayload", ["body"], {
    body: str("重放後的版本內文。"),
  }),
);

add(
  "CardVersionRestoreRequestPayload",
  objectOf(
    "CardVersionRestoreRequestPayload",
    ["cardId", "versionId", "baseRevision", "clientRequestId"],
    {
      cardId: str("要還原的卡片。"),
      versionId: str("要還原到的版本。"),
      baseRevision: str("確認還原時看到的 revision。"),
      clientRequestId: str("冪等鍵。"),
    },
  ),
);

add(
  "CardVersionRestoreResponsePayload",
  objectOf("CardVersionRestoreResponsePayload", ["card", "version"], {
    card: ref("Card"),
    version: ref("CardVersion"),
  }),
);

add(
  "CardDeleteRequestPayload",
  objectOf("CardDeleteRequestPayload", ["cardId", "clientRequestId"], {
    cardId: str("要刪除的卡片。"),
    clientRequestId: str("冪等鍵。"),
  }),
);

add(
  "CardDeleteResponsePayload",
  objectOf("CardDeleteResponsePayload", ["cardId", "deletedAssets"], {
    cardId: str("已刪除的卡片。"),
    deletedAssets: int("連帶刪除的原檔數；還有其他卡引用時是 0。", { minimum: 0 }),
  }),
);

add(
  "CardSearchRequestPayload",
  objectOf("CardSearchRequestPayload", ["query"], {
    query: str("查詢字串；中文用子字串比對。"),
    kinds: arrayOf(ref("CardKind"), "只搜這幾種。"),
    tags: arrayOf(str("標籤。"), "同時包含這些標籤。"),
    includeSuperseded: bool("是否包含被取代的卡；預設 false。"),
    limit: int("最多回傳幾筆。", { minimum: 1, maximum: 100 }),
    cursor: str("上一頁的游標。"),
  }),
);

add(
  "CardSearchHit",
  objectOf("CardSearchHit", ["card", "score", "snippet"], {
    card: ref("CardSummary"),
    score: { type: "number", description: "相關度分數，越大越前面。" },
    snippet: str("命中片段；不含完整內文。"),
  }),
);

add(
  "CardSearchResponsePayload",
  objectOf("CardSearchResponsePayload", ["hits"], {
    hits: arrayOf(ref("CardSearchHit"), "依分數由高到低。"),
    nextCursor: str("下一頁游標。"),
  }),
);

add(
  "CardRefreshRequestPayload",
  objectOf("CardRefreshRequestPayload", ["cardId"], {
    cardId: str("要保鮮的卡片。"),
  }),
);

add(
  "CardRefreshResponsePayload",
  objectOf("CardRefreshResponsePayload", ["cardId", "freshness"], {
    cardId: str("卡片識別碼。"),
    freshness: int("保鮮後的新鮮度，固定 100。", { minimum: 0, maximum: 100 }),
  }),
);

add(
  "CardChangedEventPayload",
  objectOf("CardChangedEventPayload", ["cardId", "change"], {
    cardId: str("卡片識別碼。"),
    change: ref("CardChange"),
    revision: str("變更後的 revision；刪除時省略。"),
    freshness: int("變更後的新鮮度；只有保鮮與載入會帶。", { minimum: 0, maximum: 100 }),
  }),
);

// ---------------------------------------------------------------------------
// M1：多模態
// ---------------------------------------------------------------------------

add("MediaKind", stringEnum(["image", "audio"], "多模態的種類；只有圖片與音訊。"));

add(
  "MediaLocalTextSource",
  stringEnum(["local", "none"], "由本機能力產生的文字來源；none 表示沒有產生。"),
);

add(
  "MediaModelTextSource",
  stringEnum(["small-model", "none"], "由小模型產生的文字來源；none 表示沒有產生。"),
);

add(
  "MediaTextStandInSources",
  objectOf(
    "MediaTextStandInSources",
    ["ocr", "description", "transcript", "summary"],
    {
      ocr: ref("MediaLocalTextSource"),
      description: ref("MediaModelTextSource"),
      transcript: ref("MediaLocalTextSource"),
      summary: ref("MediaModelTextSource"),
    },
    "文字替身每一塊的來源；缺哪一塊要說清楚。",
  ),
);

add(
  "MediaTextStandIn",
  objectOf("MediaTextStandIn", ["sources", "missingParts"], {
    sources: ref("MediaTextStandInSources"),
    missingParts: arrayOf(
      str("給人看的缺少說明。"),
      "無法產生的部分；完整時是空陣列。卡片內文的「缺少的部分」與這裡一致。",
    ),
  }),
);

add(
  "MediaImportRequestPayload",
  objectOf("MediaImportRequestPayload", ["blobId"], {
    blobId: str("已上傳原檔的 SHA-256 小寫十六進位；先用 POST /v1/blobs 上傳。", {
      pattern: "^[0-9a-f]{64}$",
    }),
    locale: str("語音轉文字的語言，例如 zh-TW；只有音訊使用。"),
    ocrLocales: arrayOf(str("OCR 語言。"), "圖片的 OCR 語言，依優先順序。"),
    title: str("卡片標題；省略時由文字替身產生。"),
    tags: arrayOf(str("標籤。"), "標籤。"),
    persona: str("人格分區；省略時用 default。"),
  }),
);

add(
  "MediaImportResponsePayload",
  objectOf("MediaImportResponsePayload", ["cardId", "kind", "textStandIn", "deduped"], {
    cardId: str("建立的卡片；同一個 blobId 重送回同一張卡。"),
    kind: ref("MediaKind"),
    textStandIn: ref("MediaTextStandIn"),
    deduped: bool("這個 blobId 已經有卡片，這次接回既有的卡片。"),
  }),
);

// ---------------------------------------------------------------------------
// M1：上下文
// ---------------------------------------------------------------------------

add(
  "ContextLayer",
  stringEnum(
    [
      "bedrock",
      "persona",
      "core-memory",
      "opening-memory",
      "short-term-memory",
      "other-cards",
      "working-context",
      "volatile-state",
    ],
    "八層的識別碼，順序由前往後。",
  ),
);

add("ContextEntryState", stringEnum(["active", "pending-removal"], "項目在上下文中的狀態。"));

add(
  "ContextDealSource",
  stringEnum(
    ["system-one", "retrieval", "manual"],
    "發牌來源：System One 判斷，或沒有 System One 時用檢索排名發出；手動加入的卡是 manual。",
  ),
);

add(
  "ContextEntry",
  objectOf(
    "ContextEntry",
    ["entryId", "layer", "title", "tokenEstimate", "state", "position"],
    {
      entryId: str("項目識別碼；工作上下文也可以有代表項。"),
      layer: ref("ContextLayer"),
      cardId: str("對應的卡片；工作上下文與高速變動層沒有。"),
      title: str("給人看的標題。"),
      tokenEstimate: int("token 估算。", { minimum: 0 }),
      state: ref("ContextEntryState"),
      position: int("在上下文中的位置，從 0 開始。", { minimum: 0 }),
      dealProbability: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "開局發牌時 System One 給的相關機率；刻意不發牌的卡省略。0.4–0.6 是『可能相關』區間，不自動發。",
      },
      dealSource: ref("ContextDealSource"),
    },
    "上下文裡的一個項目。dealProbability／dealSource 只有第 4 層的開局卡會帶。",
  ),
);

add(
  "ContextView",
  objectOf(
    "ContextView",
    [
      "sessionId",
      "version",
      "entries",
      "usedTokens",
      "budgetTokens",
      "contextWindow",
      "compactionThreshold",
    ],
    {
      sessionId: str("會話識別碼。"),
      version: int("每次變動加 1；客戶端丟棄較小的版本。", { minimum: 0 }),
      entries: arrayOf(ref("ContextEntry"), "依上下文實際順序。"),
      usedTokens: int("目前佔用的估算值；等於 entries 的 tokenEstimate 加總。", {
        minimum: 0,
      }),
      budgetTokens: int("可用預算（contextWindow 減去保留給輸出的量）。", { minimum: 0 }),
      contextWindow: int("目前主模型的上下文上限。", { minimum: 1 }),
      compactionThreshold: { type: "number", description: "觸發壓縮的比例，預設 0.75。" },
      lastCompactedAt: str("上次壓縮時間，RFC 3339。", { format: "date-time" }),
    },
  ),
);

add(
  "ContextGetRequestPayload",
  objectOf("ContextGetRequestPayload", ["sessionId"], {
    sessionId: str("會話識別碼。"),
  }),
);

add(
  "ContextGetResponsePayload",
  objectOf("ContextGetResponsePayload", ["context"], {
    context: ref("ContextView"),
  }),
);

add(
  "ContextAddCardRequestPayload",
  objectOf("ContextAddCardRequestPayload", ["sessionId", "cardId"], {
    sessionId: str("會話識別碼。"),
    cardId: str("要加入的卡片；只會追加在後段。"),
  }),
);

add(
  "ContextAddCardResponsePayload",
  objectOf("ContextAddCardResponsePayload", ["context"], {
    context: ref("ContextView"),
  }),
);

add(
  "ContextRemoveCardRequestPayload",
  objectOf("ContextRemoveCardRequestPayload", ["sessionId", "cardId"], {
    sessionId: str("會話識別碼。"),
    cardId: str("要移除的卡片；標記為 pending-removal，下次壓縮生效。"),
  }),
);

add(
  "ContextRemoveCardResponsePayload",
  objectOf("ContextRemoveCardResponsePayload", ["context"], {
    context: ref("ContextView"),
  }),
);

add(
  "ContextCompactRequestPayload",
  objectOf("ContextCompactRequestPayload", ["sessionId"], {
    sessionId: str("會話識別碼。"),
    instructions: str("給摘要模型的額外指示；使用者手動壓縮時可省略。"),
  }),
);

add(
  "ContextCompactResponsePayload",
  objectOf("ContextCompactResponsePayload", ["sessionId", "scheduled"], {
    sessionId: str("會話識別碼。"),
    scheduled: bool("是否已排入壓縮；完成時會送 context.compacted。"),
  }),
);

add(
  "ContextChangedEventPayload",
  objectOf("ContextChangedEventPayload", ["sessionId", "context"], {
    sessionId: str("會話識別碼。"),
    context: ref("ContextView"),
  }),
);

add(
  "ContextCompactedEventPayload",
  objectOf(
    "ContextCompactedEventPayload",
    ["sessionId", "summaryCardId", "beforeTokens", "afterTokens", "compactedAt"],
    {
      sessionId: str("會話識別碼。"),
      summaryCardId: str("壓縮產出的短期記憶卡。"),
      beforeTokens: int("壓縮前佔用。", { minimum: 0 }),
      afterTokens: int("壓縮後佔用。", { minimum: 0 }),
      compactedAt: str("完成時間，RFC 3339。", { format: "date-time" }),
    },
  ),
);

// ---------------------------------------------------------------------------
// M1：會話封存與刪除
// ---------------------------------------------------------------------------

add(
  "SessionArchive",
  objectOf("SessionArchive", ["archivedAt", "purgeAt"], {
    archivedAt: str("開始封存倒數的時間，RFC 3339。", { format: "date-time" }),
    purgeAt: str("倒數結束、預定刪除的時間，RFC 3339。", { format: "date-time" }),
  }),
);

add(
  "SessionArchiveRequestPayload",
  objectOf("SessionArchiveRequestPayload", ["sessionId"], {
    sessionId: str("要封存的會話。"),
    purgeAfterDays: int("倒數天數；省略時用設定值（預設 7）。", { minimum: 1, maximum: 365 }),
  }),
);

add(
  "SessionArchiveResponsePayload",
  objectOf("SessionArchiveResponsePayload", ["sessionId", "archive"], {
    sessionId: str("會話識別碼。"),
    archive: ref("SessionArchive"),
  }),
);

add(
  "SessionUnarchiveRequestPayload",
  objectOf("SessionUnarchiveRequestPayload", ["sessionId"], {
    sessionId: str("要取消封存的會話。"),
  }),
);

add(
  "SessionUnarchiveResponsePayload",
  objectOf("SessionUnarchiveResponsePayload", ["sessionId", "unarchived"], {
    sessionId: str("會話識別碼。"),
    unarchived: bool("是否已取消封存。"),
  }),
);

add(
  "SessionDeletionPreviewRequestPayload",
  objectOf("SessionDeletionPreviewRequestPayload", ["sessionId"], {
    sessionId: str("要預覽刪除的會話。"),
  }),
);

add(
  "SessionDeletionPreviewResponsePayload",
  objectOf(
    "SessionDeletionPreviewResponsePayload",
    ["sessionId", "subtreeSessionIds", "exclusiveCards", "sharedCards", "assets"],
    {
      sessionId: str("會話識別碼。"),
      subtreeSessionIds: arrayOf(str("會話識別碼。"), "連同支線的整個子樹。"),
      exclusiveCards: int("會一起刪除的專屬卡片數。", { minimum: 0 }),
      sharedCards: int("仍被其他會話或白板引用的卡片數；不會刪除。", { minimum: 0 }),
      assets: int("會一起刪除的原檔數。", { minimum: 0 }),
    },
  ),
);

add(
  "SessionDeleteRequestPayload",
  objectOf("SessionDeleteRequestPayload", ["sessionId", "clientRequestId"], {
    sessionId: str("要刪除的會話；支線一定連同刪除。"),
    clientRequestId: str("客戶端產生的冪等鍵。"),
  }),
);

add(
  "SessionDeleteResponsePayload",
  objectOf(
    "SessionDeleteResponsePayload",
    ["sessionId", "deletedSessionIds", "deletedCards", "deletedAssets"],
    {
      sessionId: str("會話識別碼。"),
      deletedSessionIds: arrayOf(str("會話識別碼。"), "實際刪除的子樹。"),
      deletedCards: int("實際刪除的專屬卡片數。", { minimum: 0 }),
      deletedAssets: int("實際刪除的原檔數。", { minimum: 0 }),
    },
  ),
);

add(
  "SessionArchivedEventPayload",
  objectOf("SessionArchivedEventPayload", ["sessionId", "archive"], {
    sessionId: str("會話識別碼。"),
    archive: ref("SessionArchive"),
  }),
);

add(
  "SessionUnarchivedEventPayload",
  objectOf("SessionUnarchivedEventPayload", ["sessionId"], {
    sessionId: str("會話識別碼。"),
  }),
);

add(
  "SessionDeletedEventPayload",
  objectOf(
    "SessionDeletedEventPayload",
    ["sessionId", "deletedSessionIds", "deletedCards", "deletedAssets"],
    {
      sessionId: str("會話識別碼。"),
      deletedSessionIds: arrayOf(str("會話識別碼。"), "整個子樹。"),
      deletedCards: int("刪除的專屬卡片數。", { minimum: 0 }),
      deletedAssets: int("刪除的原檔數。", { minimum: 0 }),
    },
  ),
);

// ---------------------------------------------------------------------------
// M1：設定、模組與模型
// ---------------------------------------------------------------------------

add(
  "SettingLevel",
  stringEnum(["free", "approval", "human-only"], "設定分級；未標明一律視為 human-only。"),
);

add(
  "SettingItem",
  objectOf("SettingItem", ["key", "value", "level", "updatedAt"], {
    key: str("設定鍵。"),
    value: ref("JSONValue"),
    level: ref("SettingLevel"),
    title: str("給人看的標題。"),
    description: str("給人看的說明。"),
    updatedAt: str("最後更新時間，RFC 3339。", { format: "date-time" }),
  }),
);

add("SystemSettingsGetRequestPayload", objectOf("SystemSettingsGetRequestPayload", [], {}));

add(
  "SystemSettingsGetResponsePayload",
  objectOf("SystemSettingsGetResponsePayload", ["settings"], {
    settings: arrayOf(ref("SettingItem"), "所有分級的設定。"),
  }),
);

add(
  "SettingChange",
  objectOf("SettingChange", ["key", "value"], {
    key: str("設定鍵。"),
    value: ref("JSONValue"),
  }),
);

add(
  "SystemSettingsSetRequestPayload",
  objectOf("SystemSettingsSetRequestPayload", ["changes", "clientRequestId"], {
    changes: arrayOf(ref("SettingChange"), "要修改的設定；一次可以多筆。", { minItems: 1 }),
    clientRequestId: str("冪等鍵。"),
  }),
);

add(
  "SystemSettingsSetResponsePayload",
  objectOf("SystemSettingsSetResponsePayload", ["applied", "requiresApproval"], {
    applied: arrayOf(ref("SettingItem"), "已套用的設定。"),
    requiresApproval: bool("是否需要人工核准；M1 由客戶端（人）修改時固定 false。"),
    approvalId: str("需要核准時的審批識別碼；M1 不使用。"),
  }),
);

add(
  "SystemSettingsChangedEventPayload",
  objectOf("SystemSettingsChangedEventPayload", ["changes", "changedBy", "changedAt"], {
    changes: arrayOf(ref("SettingItem"), "變更後的設定。"),
    changedBy: str("變更者，例如 user:<deviceId>、agent:<conversationId>、system。"),
    changedAt: str("變更時間，RFC 3339。", { format: "date-time" }),
  }),
);

add(
  "SettingKind",
  stringEnum(
    ["string", "number", "integer", "boolean", "enum", "string-list", "path"],
    "設定值的輸入種類；設定頁據此產生表單。",
  ),
);

add(
  "ModuleSettingDeclaration",
  objectOf("ModuleSettingDeclaration", ["key", "title", "kind", "level"], {
    key: str("設定鍵。"),
    title: str("標題。"),
    kind: ref("SettingKind"),
    level: ref("SettingLevel"),
    description: str("說明。"),
  }),
);

add("ModuleState", stringEnum(["loaded", "active", "inactive", "failed"], "模組的執行狀態。"));

add(
  "ModuleInfo",
  objectOf(
    "ModuleInfo",
    ["moduleId", "name", "version", "enabled", "state", "protocolPrefixes", "settings"],
    {
      moduleId: str("模組識別碼。"),
      name: str("顯示名稱。"),
      version: str("版本。"),
      enabled: bool("使用者是否啟用。"),
      state: ref("ModuleState"),
      failure: str("載入或啟用失敗的原因。"),
      protocolPrefixes: arrayOf(str("命名空間前綴。"), "模組登記的協定命名空間。"),
      settings: arrayOf(ref("ModuleSettingDeclaration"), "設定宣告，不含值。"),
    },
  ),
);

add("SystemModulesGetRequestPayload", objectOf("SystemModulesGetRequestPayload", [], {}));

add(
  "SystemModulesGetResponsePayload",
  objectOf("SystemModulesGetResponsePayload", ["modules"], {
    modules: arrayOf(ref("ModuleInfo"), "依模組識別碼排序。"),
  }),
);

add(
  "SystemModulesSetEnabledRequestPayload",
  objectOf("SystemModulesSetEnabledRequestPayload", ["moduleId", "enabled", "clientRequestId"], {
    moduleId: str("模組識別碼。"),
    enabled: bool("是否啟用。"),
    clientRequestId: str("冪等鍵。"),
  }),
);

add(
  "SystemModulesSetEnabledResponsePayload",
  objectOf("SystemModulesSetEnabledResponsePayload", ["module"], {
    module: ref("ModuleInfo"),
  }),
);

add(
  "SystemModulesChangedEventPayload",
  objectOf("SystemModulesChangedEventPayload", ["module"], {
    module: ref("ModuleInfo"),
  }),
);

add("ModelProviderKind", stringEnum(["api-key", "aggregator", "local"], "供應商接入方式。"));

add("ModelInputKind", stringEnum(["text", "image", "audio"], "模型接受的輸入種類。"));

add(
  "ModelInfo",
  objectOf("ModelInfo", ["modelId", "contextWindow", "input"], {
    modelId: str("供應商的模型識別碼。"),
    displayName: str("給人看的名稱。"),
    contextWindow: int("上下文上限。", { minimum: 1 }),
    maxOutputTokens: int("輸出上限。", { minimum: 1 }),
    input: arrayOf(ref("ModelInputKind"), "接受的輸入種類。"),
  }),
);

add(
  "ModelProviderInfo",
  objectOf("ModelProviderInfo", ["providerId", "kind", "displayName", "models"], {
    providerId: str("供應商識別碼；由使用者命名，穩定不變。"),
    kind: ref("ModelProviderKind"),
    displayName: str("顯示名稱。"),
    baseUrl: str("OpenAI 相容端點的基底網址；直接供應商可省略。"),
    credentialRef: str("鑰匙圈的帳號名；不是金鑰本身。"),
    models: arrayOf(ref("ModelInfo"), "這個供應商提供的模型。"),
  }),
);

add("ModelRole", stringEnum(["main", "small", "writing", "system-one"], "四個模型角色。"));

add(
  "ModelRoleMode",
  stringEnum(
    ["model", "unset", "none"],
    "角色的設定方式：model 指定模型、unset 走退回、none 明確關閉（只有 system-one 可用）。",
  ),
);

add(
  "ModelRef",
  objectOf("ModelRef", ["providerId", "modelId"], {
    providerId: str("供應商識別碼。"),
    modelId: str("模型識別碼。"),
  }),
);

add(
  "ModelRoleSelection",
  objectOf("ModelRoleSelection", ["role", "mode"], {
    role: ref("ModelRole"),
    mode: ref("ModelRoleMode"),
    ref: ref("ModelRef"),
  }),
);

add(
  "ModelRoleSource",
  stringEnum(
    ["configured", "fallback-main", "fallback-small", "none"],
    "解析結果的來源；fallback 表示走了退回規則。",
  ),
);

add(
  "ResolvedModelRole",
  objectOf("ResolvedModelRole", ["role", "source"], {
    role: ref("ModelRole"),
    source: ref("ModelRoleSource"),
    ref: ref("ModelRef"),
  }),
);

add(
  "SystemModelsState",
  objectOf("SystemModelsState", ["providers", "roles", "resolved"], {
    providers: arrayOf(ref("ModelProviderInfo"), "供應商清單，不含金鑰。"),
    roles: arrayOf(ref("ModelRoleSelection"), "角色設定。"),
    resolved: arrayOf(ref("ResolvedModelRole"), "退回規則套用後的實際使用。"),
  }),
);

add("SystemModelsGetRequestPayload", objectOf("SystemModelsGetRequestPayload", [], {}));

add(
  "SystemModelsSetRequestPayload",
  objectOf("SystemModelsSetRequestPayload", ["clientRequestId"], {
    providers: arrayOf(ref("ModelProviderInfo"), "要套用的供應商清單；省略代表不改。"),
    roles: arrayOf(ref("ModelRoleSelection"), "要套用的角色設定；省略代表不改。"),
    clientRequestId: str("冪等鍵。"),
  }),
);

add(
  "BlobInfo",
  objectOf("BlobInfo", ["blobId", "mediaType", "sizeBytes"], {
    blobId: str("內容雜湊（SHA-256 小寫十六進位）。"),
    mediaType: str("內容類型。"),
    sizeBytes: int("位元組數。", { minimum: 0 }),
  }),
);

// ---------------------------------------------------------------------------
// M4：白板。卡片本體仍在 cards/；投影不是複本，一份卡可出現在多個白板。
// ---------------------------------------------------------------------------

add(
  "BoardPoint",
  objectOf("BoardPoint", ["x", "y"], {
    x: int("畫布 x 座標。", { minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    y: int("畫布 y 座標。", { minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  }),
);

add(
  "BoardSize",
  objectOf("BoardSize", ["width", "height"], {
    width: int("投影框寬度。", { minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    height: int("投影框高度。", { minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  }),
);

add("BoardItemOrigin", stringEnum(["canvas", "inbox"], "投影所在區域。"));
add("BoardProjectedBy", stringEnum(["user", "agent"], "投影的建立者。"));

add(
  "BoardItem",
  objectOf("BoardItem", ["id", "cardId", "position", "size", "pinned", "origin"], {
    id: str("投影的 ULID；不同白板上的同一張卡有不同 id。"),
    cardId: str("卡片本體的 ULID。"),
    position: ref("BoardPoint"),
    size: ref("BoardSize"),
    pinned: bool("任一個投影釘選時，該卡片的新鮮度固定 100。"),
    origin: ref("BoardItemOrigin"),
    projectedBy: ref("BoardProjectedBy"),
    groupId: str("所屬分組 id；省略代表在畫布上。"),
  }),
);

add(
  "BoardEdge",
  objectOf("BoardEdge", ["id", "from", "to"], {
    id: str("連線的 ULID。"),
    from: str("起點投影 id，不是卡片 id。"),
    to: str("終點投影 id，不是卡片 id。"),
    label: str("連線標籤。"),
  }),
);

add(
  "BoardGroup",
  objectOf("BoardGroup", ["id", "label"], {
    id: str("分組的 ULID。"),
    label: str("分組名稱。"),
    parentId: str("上層分組 id；形成循環時拒絕。"),
  }),
);

add(
  "BoardDocument",
  objectOf(
    "BoardDocument",
    ["schema", "id", "title", "createdAt", "updatedAt", "items", "inbox", "edges", "groups"],
    {
      schema: literal(1),
      id: str("白板 ULID。"),
      title: str("白板名稱。"),
      createdAt: str("建立時間，RFC 3339。", { format: "date-time" }),
      updatedAt: str("最後變更時間；單寫者可用於儲存前比對。", { format: "date-time" }),
      items: arrayOf(ref("BoardItem"), "投影清單。"),
      inbox: arrayOf(ref("BoardItem"), "收件區的投影。"),
      edges: arrayOf(ref("BoardEdge"), "只屬於這份白板的顯式連線。"),
      groups: arrayOf(ref("BoardGroup"), "可巢狀的分組。"),
    },
    "一份白板的完整內容，等於 boards/<id>.json。",
  ),
);

add(
  "BoardSummary",
  objectOf("BoardSummary", ["id", "title", "updatedAt", "itemCount"], {
    id: str("白板 ULID。"),
    title: str("白板名稱。"),
    updatedAt: str("最後變更時間，RFC 3339。", { format: "date-time" }),
    itemCount: int("投影數量。", { minimum: 0 }),
  }),
);

add("BoardChange", stringEnum(["created", "updated", "deleted"], "白板變更的種類。"));

add(
  "BoardListRequestPayload",
  objectOf("BoardListRequestPayload", [], {}, "列出所有白板；不需要參數。"),
);

add(
  "BoardListResponsePayload",
  objectOf("BoardListResponsePayload", ["boards"], {
    boards: arrayOf(ref("BoardSummary"), "依最後變更時間排序。"),
  }),
);

add(
  "BoardGetRequestPayload",
  objectOf("BoardGetRequestPayload", ["boardId"], {
    boardId: str("要讀取的白板。"),
  }),
);

add(
  "BoardGetResponsePayload",
  objectOf("BoardGetResponsePayload", ["board"], {
    board: ref("BoardDocument"),
  }),
);

add(
  "BoardCreateRequestPayload",
  objectOf("BoardCreateRequestPayload", ["boardId", "title", "clientRequestId"], {
    boardId: str("客戶端產生的白板 ULID。"),
    title: str("白板名稱。"),
    clientRequestId: str("冪等鍵；重送只建立一次。"),
  }),
);

add(
  "BoardCreateResponsePayload",
  objectOf("BoardCreateResponsePayload", ["board"], {
    board: ref("BoardDocument"),
  }),
);

add(
  "BoardSaveRequestPayload",
  objectOf("BoardSaveRequestPayload", ["board", "baseUpdatedAt"], {
    board: ref("BoardDocument"),
    baseUpdatedAt: str("單寫者比對用的 updatedAt；不保護同時寫入。", {
      format: "date-time",
    }),
    clientRequestId: str("冪等鍵。"),
  }),
);

add(
  "BoardSaveResponsePayload",
  objectOf("BoardSaveResponsePayload", ["board"], {
    board: ref("BoardDocument"),
  }),
);

add(
  "BoardDeleteRequestPayload",
  objectOf("BoardDeleteRequestPayload", ["boardId"], {
    boardId: str("要刪除的白板；卡片本體不受影響。"),
  }),
);

add(
  "BoardDeleteResponsePayload",
  objectOf("BoardDeleteResponsePayload", ["deleted"], {
    deleted: bool("是否真的刪掉了檔案。"),
  }),
);

add(
  "BoardProjectCardRequestPayload",
  objectOf("BoardProjectCardRequestPayload", ["boardId", "itemId", "cardId", "position"], {
    boardId: str("目標白板。"),
    itemId: str("新投影的 ULID。"),
    cardId: str("卡片本體的 ULID。"),
    position: ref("BoardPoint"),
    size: ref("BoardSize"),
    groupId: str("放進的分組；省略代表畫布。"),
    pinned: bool("是否釘選；預設 false。"),
  }),
);

add(
  "BoardProjectCardResponsePayload",
  objectOf("BoardProjectCardResponsePayload", ["board"], {
    board: ref("BoardDocument"),
  }),
);

add(
  "BoardUnprojectCardRequestPayload",
  objectOf("BoardUnprojectCardRequestPayload", ["boardId", "itemId"], {
    boardId: str("白板。"),
    itemId: str("要移除的投影；卡片本體不受影響。"),
  }),
);

add(
  "BoardUnprojectCardResponsePayload",
  objectOf("BoardUnprojectCardResponsePayload", ["board"], {
    board: ref("BoardDocument"),
  }),
);

add(
  "BoardCreateCardFromSelectionRequestPayload",
  objectOf(
    "BoardCreateCardFromSelectionRequestPayload",
    ["boardId", "cardIds", "title", "body", "itemId", "position", "clientRequestId"],
    {
      boardId: str("圈選所在的白板；新卡會投影到這份白板。"),
      cardIds: arrayOf(str("被圈選的卡片 ULID；順序保留，重複去掉。"), "來源卡。"),
      title: str("新卡標題。"),
      body: str("新卡內文（Markdown）。"),
      itemId: str("新投影的 ULID。"),
      position: ref("BoardPoint"),
      clientRequestId: str("冪等鍵。"),
    },
  ),
);

add(
  "BoardCreateCardFromSelectionResponsePayload",
  objectOf("BoardCreateCardFromSelectionResponsePayload", ["board", "cardId"], {
    board: ref("BoardDocument"),
    cardId: str("新卡的 ULID；其 sources 指回被圈選的卡。"),
  }),
);

add(
  "BoardChangedEventPayload",
  objectOf("BoardChangedEventPayload", ["boardId", "change"], {
    boardId: str("變更的白板。"),
    change: ref("BoardChange"),
    board: ref("BoardDocument"),
    cardIds: arrayOf(str("受影響的卡片，用來同步釘選與新鮮度。"), "受影響的卡片。"),
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
// M1：卡片、上下文、封存與刪除、設定、模組、模型
// ---------------------------------------------------------------------------

// 卡片
requestFrame("CardListRequest", "card.list", "CardListRequestPayload", "列出卡片庫。");
responseFrame("CardListResponse", "card.list", "CardListResponsePayload", "卡片列表。");
requestFrame("CardGetRequest", "card.get", "CardGetRequestPayload", "讀取一張卡片。");
responseFrame("CardGetResponse", "card.get", "CardGetResponsePayload", "卡片的完整內容。");
requestFrame("CardCreateRequest", "card.create", "CardCreateRequestPayload", "建立卡片。");
responseFrame("CardCreateResponse", "card.create", "CardCreateResponsePayload", "建立的卡片。");
requestFrame("CardPatchRequest", "card.patch", "CardPatchRequestPayload", "以補丁編修卡片。");
responseFrame("CardPatchResponse", "card.patch", "CardPatchResponsePayload", "編修後的卡片。");
requestFrame(
  "CardPatchesListRequest",
  "card.patches.list",
  "CardPatchesListRequestPayload",
  "列出卡片的待決補丁。",
);
responseFrame(
  "CardPatchesListResponse",
  "card.patches.list",
  "CardPatchesListResponsePayload",
  "待決補丁清單。",
);
requestFrame(
  "CardPatchAcceptRequest",
  "card.patch.accept",
  "CardPatchAcceptRequestPayload",
  "接受一筆待決補丁，重算 revision 比對後寫入正本。",
);
responseFrame(
  "CardPatchAcceptResponse",
  "card.patch.accept",
  "CardPatchAcceptResponsePayload",
  "接受結果與更新後的卡片。",
);
requestFrame(
  "CardPatchRejectRequest",
  "card.patch.reject",
  "CardPatchRejectRequestPayload",
  "拒絕一筆待決補丁，卡片內文不變。",
);
responseFrame(
  "CardPatchRejectResponse",
  "card.patch.reject",
  "CardPatchRejectResponsePayload",
  "拒絕結果。",
);
requestFrame(
  "CardVersionsListRequest",
  "card.versions.list",
  "CardVersionsListRequestPayload",
  "列出卡片的版本歷史。",
);
responseFrame(
  "CardVersionsListResponse",
  "card.versions.list",
  "CardVersionsListResponsePayload",
  "版本歷史。",
);
requestFrame(
  "CardVersionGetRequest",
  "card.version.get",
  "CardVersionGetRequestPayload",
  "讀取版本內文。",
);
responseFrame(
  "CardVersionGetResponse",
  "card.version.get",
  "CardVersionGetResponsePayload",
  "重放後的版本內文。",
);
requestFrame(
  "CardVersionRestoreRequest",
  "card.version.restore",
  "CardVersionRestoreRequestPayload",
  "還原到舊版；重放後寫成新版本。",
);
responseFrame(
  "CardVersionRestoreResponse",
  "card.version.restore",
  "CardVersionRestoreResponsePayload",
  "還原後的卡片與新版本。",
);
requestFrame("CardDeleteRequest", "card.delete", "CardDeleteRequestPayload", "刪除卡片。");
responseFrame(
  "CardDeleteResponse",
  "card.delete",
  "CardDeleteResponsePayload",
  "刪除結果與連帶刪除的原檔數。",
);
requestFrame("CardSearchRequest", "card.search", "CardSearchRequestPayload", "全文搜尋卡片。");
responseFrame("CardSearchResponse", "card.search", "CardSearchResponsePayload", "搜尋結果。");
requestFrame("CardRefreshRequest", "card.refresh", "CardRefreshRequestPayload", "使用者按保鮮。");
responseFrame(
  "CardRefreshResponse",
  "card.refresh",
  "CardRefreshResponsePayload",
  "保鮮後的新鮮度。",
);
eventFrame(
  "CardChangedEvent",
  "card.changed",
  "CardChangedEventPayload",
  "卡片建立、更新、刪除、保鮮或重新索引；掛在 system 串流。",
);

// 白板
requestFrame("BoardListRequest", "board.list", "BoardListRequestPayload", "列出所有白板。");
responseFrame("BoardListResponse", "board.list", "BoardListResponsePayload", "白板列表。");
requestFrame("BoardGetRequest", "board.get", "BoardGetRequestPayload", "讀取一份白板。");
responseFrame("BoardGetResponse", "board.get", "BoardGetResponsePayload", "白板完整內容。");
requestFrame("BoardCreateRequest", "board.create", "BoardCreateRequestPayload", "建立空白白板。");
responseFrame("BoardCreateResponse", "board.create", "BoardCreateResponsePayload", "建立的白板。");
requestFrame("BoardSaveRequest", "board.save", "BoardSaveRequestPayload", "整份覆寫白板。");
responseFrame("BoardSaveResponse", "board.save", "BoardSaveResponsePayload", "儲存後的白板。");
requestFrame(
  "BoardDeleteRequest",
  "board.delete",
  "BoardDeleteRequestPayload",
  "刪除白板，不刪卡片。",
);
responseFrame("BoardDeleteResponse", "board.delete", "BoardDeleteResponsePayload", "刪除結果。");
requestFrame(
  "BoardProjectCardRequest",
  "board.project_card",
  "BoardProjectCardRequestPayload",
  "把卡片投影進白板。",
);
responseFrame(
  "BoardProjectCardResponse",
  "board.project_card",
  "BoardProjectCardResponsePayload",
  "投影後的白板。",
);
requestFrame(
  "BoardUnprojectCardRequest",
  "board.unproject_card",
  "BoardUnprojectCardRequestPayload",
  "取消投影，不刪卡片。",
);
responseFrame(
  "BoardUnprojectCardResponse",
  "board.unproject_card",
  "BoardUnprojectCardResponsePayload",
  "取消後的白板。",
);
requestFrame(
  "BoardCreateCardFromSelectionRequest",
  "board.create_card_from_selection",
  "BoardCreateCardFromSelectionRequestPayload",
  "圈選卡片生成新卡並投影到白板；sources 指回來源卡。",
);
responseFrame(
  "BoardCreateCardFromSelectionResponse",
  "board.create_card_from_selection",
  "BoardCreateCardFromSelectionResponsePayload",
  "新卡與更新後的白板。",
);
eventFrame(
  "BoardChangedEvent",
  "board.changed",
  "BoardChangedEventPayload",
  "白板建立、更新或刪除；掛在 system 串流。",
);

// 多模態
requestFrame(
  "MediaImportRequest",
  "media.import",
  "MediaImportRequestPayload",
  "以已上傳的 blobId 匯入圖片或音訊。",
);
responseFrame(
  "MediaImportResponse",
  "media.import",
  "MediaImportResponsePayload",
  "匯入結果與文字替身狀態。",
);

// 上下文
requestFrame("ContextGetRequest", "context.get", "ContextGetRequestPayload", "取得目前上下文。");
responseFrame("ContextGetResponse", "context.get", "ContextGetResponsePayload", "上下文視圖。");
requestFrame(
  "ContextAddCardRequest",
  "context.add_card",
  "ContextAddCardRequestPayload",
  "把卡片追加到上下文後段。",
);
responseFrame(
  "ContextAddCardResponse",
  "context.add_card",
  "ContextAddCardResponsePayload",
  "加入後的上下文視圖。",
);
requestFrame(
  "ContextRemoveCardRequest",
  "context.remove_card",
  "ContextRemoveCardRequestPayload",
  "標記移除一張卡，下次壓縮生效。",
);
responseFrame(
  "ContextRemoveCardResponse",
  "context.remove_card",
  "ContextRemoveCardResponsePayload",
  "標記後的上下文視圖。",
);
requestFrame(
  "ContextCompactRequest",
  "context.compact",
  "ContextCompactRequestPayload",
  "手動觸發壓縮。",
);
responseFrame(
  "ContextCompactResponse",
  "context.compact",
  "ContextCompactResponsePayload",
  "壓縮已排入。",
);
eventFrame(
  "ContextChangedEvent",
  "context.changed",
  "ContextChangedEventPayload",
  "上下文內容變了；掛在會話串流。",
);
eventFrame(
  "ContextCompactedEvent",
  "context.compacted",
  "ContextCompactedEventPayload",
  "一次壓縮完成；掛在會話串流。",
);

// 會話封存與刪除
requestFrame(
  "SessionArchiveRequest",
  "session.archive",
  "SessionArchiveRequestPayload",
  "開始封存倒數。",
);
responseFrame(
  "SessionArchiveResponse",
  "session.archive",
  "SessionArchiveResponsePayload",
  "封存倒數已開始。",
);
requestFrame(
  "SessionUnarchiveRequest",
  "session.unarchive",
  "SessionUnarchiveRequestPayload",
  "取消封存。",
);
responseFrame(
  "SessionUnarchiveResponse",
  "session.unarchive",
  "SessionUnarchiveResponsePayload",
  "取消封存的結果。",
);
requestFrame(
  "SessionDeletionPreviewRequest",
  "session.deletion_preview",
  "SessionDeletionPreviewRequestPayload",
  "刪除前預覽連帶刪除的會話、卡片與原檔。",
);
responseFrame(
  "SessionDeletionPreviewResponse",
  "session.deletion_preview",
  "SessionDeletionPreviewResponsePayload",
  "預覽結果。",
);
requestFrame(
  "SessionDeleteRequest",
  "session.delete",
  "SessionDeleteRequestPayload",
  "立即刪除會話與專屬卡片。",
);
responseFrame(
  "SessionDeleteResponse",
  "session.delete",
  "SessionDeleteResponsePayload",
  "實際刪除的數量。",
);
eventFrame(
  "SessionArchivedEvent",
  "session.archived",
  "SessionArchivedEventPayload",
  "會話開始封存倒數；system 與會話串流各送一則。",
);
eventFrame(
  "SessionUnarchivedEvent",
  "session.unarchived",
  "SessionUnarchivedEventPayload",
  "會話取消封存。",
);
eventFrame(
  "SessionDeletedEvent",
  "session.deleted",
  "SessionDeletedEventPayload",
  "會話刪除完成；system 串流上的那一則讓列表移除。",
);

// 設定
requestFrame(
  "SystemSettingsGetRequest",
  "system.settings.get",
  "SystemSettingsGetRequestPayload",
  "讀取設定與分級。",
);
responseFrame(
  "SystemSettingsGetResponse",
  "system.settings.get",
  "SystemSettingsGetResponsePayload",
  "設定清單。",
);
requestFrame(
  "SystemSettingsSetRequest",
  "system.settings.set",
  "SystemSettingsSetRequestPayload",
  "修改設定。",
);
responseFrame(
  "SystemSettingsSetResponse",
  "system.settings.set",
  "SystemSettingsSetResponsePayload",
  "已套用的設定。",
);
eventFrame(
  "SystemSettingsChangedEvent",
  "system.settings.changed",
  "SystemSettingsChangedEventPayload",
  "設定變更；掛在 system 串流。",
);

// 模組
requestFrame(
  "SystemModulesGetRequest",
  "system.modules.get",
  "SystemModulesGetRequestPayload",
  "讀取模組清單與狀態。",
);
responseFrame(
  "SystemModulesGetResponse",
  "system.modules.get",
  "SystemModulesGetResponsePayload",
  "模組清單。",
);
requestFrame(
  "SystemModulesSetEnabledRequest",
  "system.modules.set_enabled",
  "SystemModulesSetEnabledRequestPayload",
  "啟用或停用一個模組。",
);
responseFrame(
  "SystemModulesSetEnabledResponse",
  "system.modules.set_enabled",
  "SystemModulesSetEnabledResponsePayload",
  "更新後的模組資訊。",
);
eventFrame(
  "SystemModulesChangedEvent",
  "system.modules.changed",
  "SystemModulesChangedEventPayload",
  "模組狀態改變；掛在 system 串流。",
);

// 模型
requestFrame(
  "SystemModelsGetRequest",
  "system.models.get",
  "SystemModelsGetRequestPayload",
  "讀取供應商、角色與解析結果。",
);
responseFrame(
  "SystemModelsGetResponse",
  "system.models.get",
  "SystemModelsState",
  "目前的模型設定。",
);
requestFrame(
  "SystemModelsSetRequest",
  "system.models.set",
  "SystemModelsSetRequestPayload",
  "設定供應商與角色；只影響新對話。",
);
responseFrame(
  "SystemModelsSetResponse",
  "system.models.set",
  "SystemModelsState",
  "套用後的模型設定。",
);
eventFrame(
  "SystemModelsChangedEvent",
  "system.models.changed",
  "SystemModelsState",
  "模型設定變更；掛在 system 串流。",
);

// ---------------------------------------------------------------------------
// 影格聯集
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// M2：通知、發牌機率與裝置配對
// ---------------------------------------------------------------------------

add("NotificationKind", stringEnum(["schedule", "heartbeat", "distillation"], "通知的來源種類。"));

add(
  "CardiaryNotification",
  objectOf(
    "CardiaryNotification",
    ["notificationId", "kind", "title", "body", "createdAt", "payload"],
    {
      notificationId: str("通知識別碼。"),
      kind: ref("NotificationKind"),
      title: str("給人看的標題，例如「蒸餾 2026-11-16：新增 3」。"),
      body: str("Markdown 內文；客戶端不渲染原始 HTML。"),
      createdAt: str("建立時間，RFC 3339。", { format: "date-time" }),
      readAt: str("已讀時間，RFC 3339；未讀省略。", { format: "date-time" }),
      sourceScheduleId: str("來源排程；不是排程產生的通知省略。"),
      sourceConversationId: str("來源背景對話；沒有省略。"),
      payload: jsonObject(),
    },
    "一則通知。kind 各自的結構化資料在 payload，例如蒸餾的逐項變更清單與復原資訊。",
  ),
);

add(
  "NotificationListRequestPayload",
  objectOf("NotificationListRequestPayload", [], {
    limit: int("最多回傳幾筆，預設 50。", { minimum: 1, maximum: 200 }),
    before: str("回傳 createdAt 早於此游標的通知；用上一頁的 nextCursor。"),
    unreadOnly: bool("只要未讀。"),
  }),
);

add(
  "NotificationListResponsePayload",
  objectOf("NotificationListResponsePayload", ["notifications", "totalUnread"], {
    notifications: arrayOf(ref("CardiaryNotification"), "依 createdAt 由新到舊。", {
      maxItems: 200,
    }),
    totalUnread: int("目前未讀總數。", { minimum: 0 }),
    nextCursor: str("下一頁的游標；沒有更多時省略。"),
  }),
);

add(
  "NotificationMarkReadRequestPayload",
  objectOf("NotificationMarkReadRequestPayload", [], {
    ids: arrayOf(str("通知識別碼。"), "要標記已讀的通知；最多 500 筆。", {
      maxItems: 500,
    }),
    all: bool("一次清空全部未讀；ids 與 all 至少給一個。"),
  }),
);

add(
  "NotificationMarkReadResponsePayload",
  objectOf("NotificationMarkReadResponsePayload", ["updated", "totalUnread"], {
    updated: int("這次標記了幾則。", { minimum: 0 }),
    totalUnread: int("標記後的未讀總數。", { minimum: 0 }),
  }),
);

add(
  "NotificationCreateCardRequestPayload",
  objectOf("NotificationCreateCardRequestPayload", ["notificationId"], {
    notificationId: str("要轉成卡片的通知；同一則重送回同一張卡。"),
  }),
);

add(
  "NotificationCreateCardResponsePayload",
  objectOf("NotificationCreateCardResponsePayload", ["card", "deduped"], {
    card: ref("CardSummary"),
    deduped: bool("這則通知已經轉過，回同一張卡。"),
  }),
);

add(
  "NotificationChangedEventPayload",
  objectOf(
    "NotificationChangedEventPayload",
    ["notification"],
    {
      notification: ref("CardiaryNotification"),
    },
    "通知變了（新增或已讀狀態改變）；upsert 語意，掛在 system 串流。",
  ),
);

add("DeviceKind", stringEnum(["web", "ios"], "裝置的種類。"));

add(
  "PairedDevice",
  objectOf(
    "PairedDevice",
    ["deviceId", "name", "kind", "createdAt"],
    {
      deviceId: str("裝置識別碼。"),
      name: str("使用者看到的裝置名稱，由配對時輸入。"),
      kind: ref("DeviceKind"),
      createdAt: str("配對時間，RFC 3339。", { format: "date-time" }),
      lastUsedAt: str("最後使用時間，RFC 3339；從未使用省略。", { format: "date-time" }),
      revokedAt: str("撤銷時間，RFC 3339；未撤銷省略。", { format: "date-time" }),
    },
    "一個已配對的裝置。Token 不在這個物件裡，也從不從主機回傳明文。",
  ),
);

add(
  "DeviceListResponsePayload",
  objectOf("DeviceListResponsePayload", ["devices"], {
    devices: arrayOf(ref("PairedDevice"), "已配對的裝置，含已撤銷的。"),
  }),
);

add(
  "DeviceRevokeRequestPayload",
  objectOf("DeviceRevokeRequestPayload", ["deviceId"], {
    deviceId: str("殼經私有控制通道要求撤銷的裝置。"),
  }),
);

add(
  "DeviceRevokeResponsePayload",
  objectOf("DeviceRevokeResponsePayload", ["revoked", "deviceId"], {
    revoked: bool("已標記撤銷；既有連線隨即被關閉。"),
    deviceId: str("撤銷的裝置。"),
  }),
);

add(
  "DeviceListChangedEventPayload",
  objectOf(
    "DeviceListChangedEventPayload",
    ["devices"],
    {
      devices: arrayOf(ref("PairedDevice"), "目前全部裝置的完整清單。"),
    },
    "裝置清單變了（配對、撤銷）；掛在 system 串流。",
  ),
);

add(
  "PairingRequestedEventPayload",
  objectOf(
    "PairingRequestedEventPayload",
    ["pairingRequestId", "deviceName", "code", "requestedAt", "expiresAt"],
    {
      pairingRequestId: str("配對請求識別碼。"),
      deviceName: str("裝置送出配對時自稱的名稱。"),
      code: str("短碼供使用者核對，不可用於授權。"),
      remoteAddress: str("裝置的連線位址；只用於核對，不當授權依據。"),
      requestedAt: str("請求時間，RFC 3339。", { format: "date-time" }),
      expiresAt: str("過期時間，RFC 3339；之後配對請求作廢。", { format: "date-time" }),
    },
    "配對通知只經殼的私有控制通道傳遞；核准或拒絕也只能走控制通道。",
  ),
);

add(
  "PairingBeginRequestPayload",
  objectOf("PairingBeginRequestPayload", ["deviceName", "kind"], {
    deviceName: str("裝置想在 Mac 上顯示的名稱。"),
    kind: ref("DeviceKind"),
  }),
);

add(
  "PairingBeginResponsePayload",
  objectOf("PairingBeginResponsePayload", ["pairingRequestId", "code", "expiresAt"], {
    pairingRequestId: str("待處理配對請求。"),
    code: str("顯示給使用者與 Mac 核對的短碼；不得作為授權憑證。"),
    expiresAt: str("請求過期時間。", { format: "date-time" }),
  }),
);

add(
  "PairingCompleteRequestPayload",
  objectOf("PairingCompleteRequestPayload", ["pairingRequestId"], {
    pairingRequestId: str("只能由提出配對請求的同一條連線領取結果。"),
  }),
);

add(
  "PairingCompleteResponsePayload",
  objectOf(
    "PairingCompleteResponsePayload",
    ["deviceId", "deviceName", "deviceToken"],
    {
      deviceId: str("配對成功的裝置識別碼。"),
      deviceName: str("裝置想在 Mac 上顯示的名稱。"),
      deviceToken: str(
        "裝置專屬的存取 Token；只在這個回應回一次，主機只存 SHA-256。之後每次連線在 system.hello 的 payload 帶它。",
      ),
    },
    "配對成功；連線隨即關閉，客戶端以 deviceToken 重連。",
  ),
);

add(
  "PairingApproveRequestPayload",
  objectOf(
    "PairingApproveRequestPayload",
    ["pairingRequestId"],
    {
      pairingRequestId: str("要核准的配對請求；重送同一請求回 conflict。"),
    },
    "僅供殼的私有控制通道使用，不接受公開客戶端連線。",
  ),
);

add(
  "PairingApproveResponsePayload",
  objectOf("PairingApproveResponsePayload", ["approved", "deviceId"], {
    approved: bool("已核准並簽發裝置 Token。"),
    deviceId: str("新配對的裝置識別碼。"),
  }),
);

add(
  "PairingDenyRequestPayload",
  objectOf(
    "PairingDenyRequestPayload",
    ["pairingRequestId"],
    {
      pairingRequestId: str("要拒絕的配對請求；重送同一請求回 conflict。"),
    },
    "僅供殼的私有控制通道使用，不接受公開客戶端連線。",
  ),
);

add(
  "PairingDenyResponsePayload",
  objectOf("PairingDenyResponsePayload", ["denied"], {
    denied: bool("已拒絕；裝置拿不到 Token。"),
  }),
);

requestFrame(
  "NotificationListRequest",
  "notification.list",
  "NotificationListRequestPayload",
  "列出通知。",
);
responseFrame(
  "NotificationListResponse",
  "notification.list",
  "NotificationListResponsePayload",
  "通知清單。",
);
requestFrame(
  "NotificationMarkReadRequest",
  "notification.mark_read",
  "NotificationMarkReadRequestPayload",
  "標記通知已讀。",
);
responseFrame(
  "NotificationMarkReadResponse",
  "notification.mark_read",
  "NotificationMarkReadResponsePayload",
  "標記結果與剩餘未讀數。",
);
requestFrame(
  "NotificationCreateCardRequest",
  "notification.create_card",
  "NotificationCreateCardRequestPayload",
  "把通知轉成一張卡片。",
);
responseFrame(
  "NotificationCreateCardResponse",
  "notification.create_card",
  "NotificationCreateCardResponsePayload",
  "轉出的卡片。",
);
eventFrame(
  "NotificationChangedEvent",
  "notification.changed",
  "NotificationChangedEventPayload",
  "通知變了；掛在 system 串流。",
);

requestFrame(
  "PairingBeginRequest",
  "pairing.begin",
  "PairingBeginRequestPayload",
  "未認證裝置建立配對請求。",
);
responseFrame(
  "PairingBeginResponse",
  "pairing.begin",
  "PairingBeginResponsePayload",
  "配對短碼與期限，短碼只供人核對。",
);
requestFrame(
  "PairingCompleteRequest",
  "pairing.complete",
  "PairingCompleteRequestPayload",
  "在提出配對請求的同一連線領取核准結果。",
);
responseFrame(
  "PairingCompleteResponse",
  "pairing.complete",
  "PairingCompleteResponsePayload",
  "配對結果；成功時帶一次 deviceToken。",
);

// ---------------------------------------------------------------------------
// M5：外部代理、MCP、設定分級 API、儲存用量與情緒
// ---------------------------------------------------------------------------

add(
  "AgentProgress",
  objectOf("AgentProgress", ["step", "label", "completed", "total"], {
    step: str("步驟識別碼。"),
    label: str("給人看的步驟說明。"),
    completed: int("已完成的步驟數。", { minimum: 0 }),
    total: int("總步驟數。", { minimum: 0 }),
  }),
);

add(
  "AgentPendingPermission",
  objectOf("AgentPendingPermission", ["approvalId", "toolName"], {
    approvalId: str("等待決定的審批識別碼；客戶端用 approval.decide 核准或拒絕。"),
    toolName: str("代理想執行的工具名稱。"),
    description: str("代理提供的動作說明。"),
  }),
);

add("AgentKind", stringEnum(["opencode", "claude-code"], "外部代理的種類。"));

add(
  "AgentStatus",
  stringEnum(
    ["starting", "running", "waiting-approval", "stopped", "failed"],
    "外部代理的狀態；waiting-approval 表示等待人工審批才能啟動。",
  ),
);

add(
  "AgentSessionInfo",
  objectOf(
    "AgentSessionInfo",
    ["agentSessionId", "agentKind", "status", "workingDirectory", "startedAt"],
    {
      agentSessionId: str("代理工作階段識別碼。"),
      agentKind: ref("AgentKind"),
      status: ref("AgentStatus"),
      workingDirectory: str("工作目錄（絕對路徑）。"),
      progress: ref("AgentProgress"),
      message: str("給人看的進度或失敗原因。"),
      resultUnknown: bool("結果是否未知：主機重啟或代理行程異常結束時為 true。"),
      pendingPermission: ref("AgentPendingPermission"),
      startedAt: str("建立時間，RFC 3339。", { format: "date-time" }),
    },
  ),
);

add(
  "AgentStartRequestPayload",
  objectOf("AgentStartRequestPayload", ["agentKind", "workingDirectory"], {
    agentKind: ref("AgentKind"),
    workingDirectory: str("工作目錄（絕對路徑）；代理會在這個目錄下啟動。"),
    prompt: str("要交給代理的任務提示；省略代表只啟動不下任務。"),
    clientRequestId: str("冪等鍵；重送只啟動一次。"),
  }),
);

add(
  "AgentStartResponsePayload",
  objectOf("AgentStartResponsePayload", ["agentSessionId"], {
    agentSessionId: str("已建立的代理工作階段識別碼；狀態先為 waiting-approval。"),
    approvalId: str("啟動的審批識別碼；核准後代理才會啟動。"),
  }),
);

add(
  "AgentStopRequestPayload",
  objectOf("AgentStopRequestPayload", ["agentSessionId"], {
    agentSessionId: str("要停止的代理工作階段。"),
  }),
);

add(
  "AgentStopResponsePayload",
  objectOf("AgentStopResponsePayload", ["agentSessionId", "stopped"], {
    agentSessionId: str("要停止的代理工作階段。"),
    stopped: bool("是否真的停掉了代理。"),
  }),
);

add(
  "AgentListRequestPayload",
  objectOf("AgentListRequestPayload", [], {}, "列出代理工作階段；不需要參數。"),
);

add(
  "AgentListResponsePayload",
  objectOf("AgentListResponsePayload", ["agents"], {
    agents: arrayOf(ref("AgentSessionInfo"), "目前存在的代理工作階段，依建立時間由新到舊。"),
  }),
);

add(
  "AgentStateChangedEventPayload",
  objectOf("AgentStateChangedEventPayload", ["agentSessionId", "agentKind", "status"], {
    agentSessionId: str("代理工作階段識別碼。"),
    agentKind: ref("AgentKind"),
    status: ref("AgentStatus"),
    progress: ref("AgentProgress"),
    message: str("給人看的進度或失敗原因。"),
    resultUnknown: bool("結果是否未知：主機重啟或代理行程異常結束時為 true。"),
    pendingPermission: ref("AgentPendingPermission"),
  }),
);

add("McpTransport", stringEnum(["stdio", "http"], "MCP 伺服器的傳輸方式。"));

add("McpServerState", stringEnum(["disabled", "ready", "failed"], "MCP 伺服器的狀態。"));

add(
  "McpPersistentDataInfo",
  objectOf("McpPersistentDataInfo", ["allowed", "bytes", "files"], {
    allowed: bool(
      "是否已核准寫入自己的持久資料目錄（modules/mcp/<serverId>/）；核准後手改設定會失效。",
    ),
    bytes: int("目錄內檔案的容量總和（bytes）。", { minimum: 0 }),
    files: int("目錄內檔案與符號連結的數量；子目錄不計入。", { minimum: 0 }),
  }),
);

add(
  "McpServerInfo",
  objectOf(
    "McpServerInfo",
    ["serverId", "name", "transport", "allowedHosts", "enabled", "state", "createdAt"],
    {
      serverId: str("MCP 伺服器識別碼。"),
      name: str("給人看的名稱。"),
      transport: ref("McpTransport"),
      command: str("stdio 傳輸的指令。"),
      args: arrayOf(str("指令參數。"), "stdio 傳輸的指令參數。"),
      url: str("http 傳輸的伺服器 URL。"),
      allowedHosts: arrayOf(
        str("主機名稱，例如 api.example.com。"),
        "HTTP 傳輸允許連線的主機；stdio 傳輸不需要外連，可以空陣列。",
      ),
      enabled: bool("使用者是否啟用。"),
      state: ref("McpServerState"),
      failure: str("啟動失敗或沙盒無法套用時的原因。"),
      persistentData: ref("McpPersistentDataInfo"),
      createdAt: str("建立時間，RFC 3339。", { format: "date-time" }),
      updatedAt: str("最後更新時間，RFC 3339。", { format: "date-time" }),
    },
  ),
);

add(
  "McpServersListRequestPayload",
  objectOf("McpServersListRequestPayload", [], {}, "列出 MCP 伺服器；不需要參數。"),
);

add(
  "McpServersListResponsePayload",
  objectOf("McpServersListResponsePayload", ["servers"], {
    servers: arrayOf(ref("McpServerInfo"), "目前存在的 MCP 伺服器，依名稱排序。"),
  }),
);

add(
  "McpServerAddRequestPayload",
  objectOf("McpServerAddRequestPayload", ["name", "transport", "allowedHosts"], {
    name: str("給人看的名稱。"),
    transport: ref("McpTransport"),
    command: str("stdio 傳輸的指令。"),
    args: arrayOf(str("指令參數。"), "stdio 傳輸的指令參數。"),
    url: str("http 傳輸的伺服器 URL。"),
    allowedHosts: arrayOf(
      str("主機名稱，例如 api.example.com。"),
      "HTTP 傳輸允許連線的主機；stdio 傳輸不需要外連，可以空陣列。",
    ),
    clientRequestId: str("冪等鍵；重送只提出一次審批。"),
    persistentData: bool(
      "是否在核准時一併授權這個伺服器寫入自己的持久資料目錄（modules/mcp/<serverId>/）；預設不授權。",
    ),
  }),
);

add(
  "McpServerAddResponsePayload",
  objectOf("McpServerAddResponsePayload", ["approvalId"], {
    approvalId: str("新增的 MCP 伺服器已送出人工審批；核准前伺服器不存在，也不提供工具。"),
  }),
);

add(
  "McpServerRemoveRequestPayload",
  objectOf("McpServerRemoveRequestPayload", ["serverId"], {
    serverId: str("要移除的 MCP 伺服器。"),
  }),
);

add(
  "McpServerRemoveResponsePayload",
  objectOf("McpServerRemoveResponsePayload", ["serverId", "removed"], {
    serverId: str("要移除的 MCP 伺服器。"),
    removed: bool("是否真的移除了伺服器。"),
  }),
);

add(
  "McpServerSetEnabledRequestPayload",
  objectOf("McpServerSetEnabledRequestPayload", ["serverId", "enabled"], {
    serverId: str("MCP 伺服器。"),
    enabled: bool("是否啟用。"),
    clientRequestId: str("冪等鍵。"),
  }),
);

add(
  "McpServerSetEnabledResponsePayload",
  objectOf("McpServerSetEnabledResponsePayload", ["server"], {
    server: ref("McpServerInfo"),
  }),
);

add(
  "McpServerAllowHostsRequestPayload",
  objectOf("McpServerAllowHostsRequestPayload", ["serverId", "allowedHosts"], {
    serverId: str("HTTP 傳輸的 MCP 伺服器。"),
    allowedHosts: arrayOf(
      str("主機名稱，例如 api.example.com。"),
      "允許連線的主機；改動只影響這個伺服器。",
    ),
  }),
);

add(
  "McpServerAllowHostsResponsePayload",
  objectOf("McpServerAllowHostsResponsePayload", ["server"], {
    server: ref("McpServerInfo"),
  }),
);

add(
  "McpServersChangedEventPayload",
  objectOf("McpServersChangedEventPayload", ["server", "removed"], {
    server: ref("McpServerInfo"),
    removed: bool("true 表示伺服器已被移除；server 是移除前的最後狀態。"),
  }),
);

add(
  "SettingTierItem",
  objectOf(
    "SettingTierItem",
    ["key", "value", "tier", "updatedAt"],
    {
      key: str("設定鍵。"),
      value: ref("JSONValue"),
      tier: ref("SettingLevel"),
      title: str("給人看的標題。"),
      description: str("給人看的說明。"),
      updatedAt: str("最後更新時間，RFC 3339。", { format: "date-time" }),
    },
    "一項設定與它的分級；agent 看到的清單不含 human-only 的項目。",
  ),
);

add(
  "SettingChangeStatus",
  stringEnum(
    ["pending", "applied", "rejected"],
    "設定變更紀錄的狀態；pending 等待人工決定，applied 已生效，rejected 被拒絕。",
  ),
);

add("SettingsChangeDecision", stringEnum(["approve", "reject"], "人工對一個待決設定提議的決定。"));

add(
  "SettingChangeRecord",
  objectOf(
    "SettingChangeRecord",
    ["changeId", "key", "value", "tier", "status", "proposedBy", "proposedAt"],
    {
      changeId: str("設定變更紀錄識別碼。"),
      key: str("設定鍵。"),
      value: ref("JSONValue"),
      tier: ref("SettingLevel"),
      status: ref("SettingChangeStatus"),
      proposedBy: str("提出者，例如 user:<deviceId>、agent:<conversationId>、system。"),
      proposedAt: str("提出時間，RFC 3339。", { format: "date-time" }),
      decidedAt: str("人工決定時間，RFC 3339；尚未決定時省略。", {
        format: "date-time",
      }),
    },
    "一筆設定變更紀錄；approval 分級的變更會先待決再生效。",
  ),
);

add(
  "SettingsListRequestPayload",
  objectOf("SettingsListRequestPayload", [], {}, "列出設定與分級；不需要參數。"),
);

add(
  "SettingsListResponsePayload",
  objectOf("SettingsListResponsePayload", ["settings"], {
    settings: arrayOf(
      ref("SettingTierItem"),
      "這個客戶端看得到的設定，含分級；人看得到全部，agent 看不到 human-only。",
    ),
  }),
);

add(
  "SettingsProposeChangeRequestPayload",
  objectOf("SettingsProposeChangeRequestPayload", ["key", "value"], {
    key: str("設定鍵。"),
    value: ref("JSONValue"),
    clientRequestId: str("冪等鍵；重送只提出一次。"),
  }),
);

add(
  "SettingsProposeChangeResponsePayload",
  objectOf("SettingsProposeChangeResponsePayload", ["change"], {
    change: ref("SettingChangeRecord"),
  }),
);

add(
  "SettingsChangesListRequestPayload",
  objectOf("SettingsChangesListRequestPayload", [], {}, "列出設定變更紀錄與待決提議；不需要參數。"),
);

add(
  "SettingsChangesListResponsePayload",
  objectOf("SettingsChangesListResponsePayload", ["changes"], {
    changes: arrayOf(ref("SettingChangeRecord"), "依提出時間由新到舊。"),
  }),
);

add(
  "SettingsChangeDecideRequestPayload",
  objectOf("SettingsChangeDecideRequestPayload", ["changeId", "decision"], {
    changeId: str("待決的設定變更紀錄。"),
    decision: ref("SettingsChangeDecision"),
  }),
);

add(
  "SettingsChangeDecideResponsePayload",
  objectOf("SettingsChangeDecideResponsePayload", ["change"], {
    change: ref("SettingChangeRecord"),
  }),
);

add(
  "SettingsChangedEventPayload",
  objectOf("SettingsChangedEventPayload", ["changes", "changedBy", "changedAt"], {
    changes: arrayOf(
      ref("SettingTierItem"),
      "變更後的設定；這個客戶端看得到的範圍，agent 看不到 human-only。",
    ),
    changedBy: str("變更者，例如 user:<deviceId>、agent:<conversationId>、system。"),
    changedAt: str("變更時間，RFC 3339。", { format: "date-time" }),
  }),
);

add(
  "StorageUsageCategory",
  stringEnum(
    ["cards", "assets", "cache", "state", "logs", "tmp", "shellState"],
    "儲存用量的類別；tmp 是暫存，shellState 是殼狀態（只有殼能清，用量經私有控制面取得）。",
  ),
);

add(
  "StorageCategoryUsage",
  objectOf("StorageCategoryUsage", ["category", "bytes", "cleanableBytes"], {
    category: ref("StorageUsageCategory"),
    bytes: int("目前佔用的位元組數。", { minimum: 0 }),
    cleanableBytes: int(
      "這個類別可安全釋放的位元組數；cards、assets、state、shellState 是正本或由殼管理，固定為 0。",
      { minimum: 0 },
    ),
  }),
);

add(
  "OutsideWriteStatus",
  stringEnum(
    ["measured", "absent", "unavailable"],
    "資料夾外寫入的量測結果；measured 有可信 bytes，absent 的 bytes 為 0，unavailable 省略 bytes、不可報 0。",
  ),
);

add(
  "StorageOutsideWriteEntry",
  objectOf("StorageOutsideWriteEntry", ["path", "tool", "status"], {
    path: str("候選位置的完整路徑。"),
    tool: str("寫入這位置的代理工具；目前是 claude-code，日後可擴充其他工具。"),
    bytes: int("量得的位元組數；absent 為 0，unavailable 省略這個欄位。", { minimum: 0 }),
    status: ref("OutsideWriteStatus"),
  }),
);

add(
  "StorageUsageRequestPayload",
  objectOf("StorageUsageRequestPayload", [], {}, "讀取各類別的儲存用量；不需要參數。"),
);

add(
  "StorageUsageResponsePayload",
  objectOf("StorageUsageResponsePayload", ["usage"], {
    usage: arrayOf(ref("StorageCategoryUsage"), "依類別列出用量。"),
    outsideWrites: arrayOf(
      ref("StorageOutsideWriteEntry"),
      "選用：代理在 Cardiary 資料夾外的寫入明細；模組未啟用或量測失敗時省略，不報 0。",
    ),
  }),
);

add(
  "StorageCleanupTarget",
  objectOf("StorageCleanupTarget", ["category", "items", "bytes"], {
    category: str(
      "可清理的類別；只接受 cache、temp、indexes、logs。cards、assets、state 等正本一律拒絕，也不能用符號連結逃到正本。",
    ),
    items: int("要刪除的目標數量（檔案或目錄）。", { minimum: 0 }),
    bytes: int("估計會釋放的位元組數。", { minimum: 0 }),
  }),
);

add(
  "StorageCleanupPreviewRequestPayload",
  objectOf("StorageCleanupPreviewRequestPayload", ["categories"], {
    categories: arrayOf(
      str("只接受 cache、temp、indexes、logs。"),
      "要預覽的類別；正本一律拒絕。",
      { minItems: 1 },
    ),
  }),
);

add(
  "StorageCleanupPreviewResponsePayload",
  objectOf("StorageCleanupPreviewResponsePayload", ["targets", "totalBytes"], {
    targets: arrayOf(ref("StorageCleanupTarget"), "預覽會清掉的目標；沒有目標時為空陣列。"),
    totalBytes: int("預計釋放的總位元組數。", { minimum: 0 }),
  }),
);

add(
  "StorageCleanupApplyRequestPayload",
  objectOf("StorageCleanupApplyRequestPayload", ["categories"], {
    categories: arrayOf(
      str("只接受 cache、temp、indexes、logs。"),
      "要執行的類別；必須先預覽過、目標沒有改變，而且執行中的暫存不能清。",
      { minItems: 1 },
    ),
  }),
);

add(
  "StorageCleanupApplyResponsePayload",
  objectOf("StorageCleanupApplyResponsePayload", ["targets", "totalBytes", "recordId"], {
    targets: arrayOf(ref("StorageCleanupTarget"), "實際清理的目標。"),
    totalBytes: int("實際釋放的總位元組數。", { minimum: 0 }),
    recordId: str("這次清理的紀錄識別碼；紀錄是 state 資料庫正本。"),
  }),
);

add(
  "StorageChangedEventPayload",
  objectOf("StorageChangedEventPayload", ["categories"], {
    categories: arrayOf(
      str("儲存用量改變的類別。"),
      "儲存用量變更或清理完成後送出；客戶端應重新讀取 storage.usage。",
    ),
    totalBytes: int("清理釋放的總位元組數；只在清理完成後的事件帶。", {
      minimum: 0,
    }),
  }),
);

add(
  "EmotionGetRequestPayload",
  objectOf("EmotionGetRequestPayload", [], {}, "讀取目前情緒狀態；不需要參數。"),
);

add(
  "EmotionGetResponsePayload",
  objectOf(
    "EmotionGetResponsePayload",
    ["dimensions", "updatedAt"],
    {
      dimensions: jsonObject(),
      updatedAt: str("上次更新時間，RFC 3339。", { format: "date-time" }),
    },
    "目前的情緒維度值；只給介面顯示，代理不能改。具體維度與數值範圍待使用者裁決，協定不約束。",
  ),
);

requestFrame(
  "AgentStartRequest",
  "agent.start",
  "AgentStartRequestPayload",
  "啟動外部代理；啟動前需要人工審批。",
);
responseFrame(
  "AgentStartResponse",
  "agent.start",
  "AgentStartResponsePayload",
  "已建立的代理工作階段。",
);
requestFrame("AgentStopRequest", "agent.stop", "AgentStopRequestPayload", "停止一個代理工作階段。");
responseFrame("AgentStopResponse", "agent.stop", "AgentStopResponsePayload", "停止結果。");
requestFrame("AgentListRequest", "agent.list", "AgentListRequestPayload", "列出代理工作階段。");
responseFrame(
  "AgentListResponse",
  "agent.list",
  "AgentListResponsePayload",
  "目前的代理工作階段清單。",
);
eventFrame(
  "AgentStateChangedEvent",
  "agent.state_changed",
  "AgentStateChangedEventPayload",
  "代理狀態改變；掛在 system 串流。",
);

requestFrame(
  "McpServersListRequest",
  "mcp.servers.list",
  "McpServersListRequestPayload",
  "列出 MCP 伺服器。",
);
responseFrame(
  "McpServersListResponse",
  "mcp.servers.list",
  "McpServersListResponsePayload",
  "目前的 MCP 伺服器清單。",
);
requestFrame(
  "McpServerAddRequest",
  "mcp.server.add",
  "McpServerAddRequestPayload",
  "新增一個 MCP 伺服器；需要人工審批，核准前不存在。",
);
responseFrame(
  "McpServerAddResponse",
  "mcp.server.add",
  "McpServerAddResponsePayload",
  "已送出人工審批。",
);
requestFrame(
  "McpServerRemoveRequest",
  "mcp.server.remove",
  "McpServerRemoveRequestPayload",
  "移除一個 MCP 伺服器。",
);
responseFrame(
  "McpServerRemoveResponse",
  "mcp.server.remove",
  "McpServerRemoveResponsePayload",
  "移除結果。",
);
requestFrame(
  "McpServerSetEnabledRequest",
  "mcp.server.set_enabled",
  "McpServerSetEnabledRequestPayload",
  "啟用或停用一個 MCP 伺服器。",
);
responseFrame(
  "McpServerSetEnabledResponse",
  "mcp.server.set_enabled",
  "McpServerSetEnabledResponsePayload",
  "更新後的伺服器資訊。",
);
requestFrame(
  "McpServerAllowHostsRequest",
  "mcp.server.allow_hosts",
  "McpServerAllowHostsRequestPayload",
  "修改一個 HTTP MCP 伺服器允許連線的主機。",
);
responseFrame(
  "McpServerAllowHostsResponse",
  "mcp.server.allow_hosts",
  "McpServerAllowHostsResponsePayload",
  "更新後的伺服器資訊。",
);
eventFrame(
  "McpServersChangedEvent",
  "mcp.servers_changed",
  "McpServersChangedEventPayload",
  "MCP 伺服器清單改變；掛在 system 串流。",
);

requestFrame(
  "SettingsListRequest",
  "settings.list",
  "SettingsListRequestPayload",
  "列出設定與分級。",
);
responseFrame(
  "SettingsListResponse",
  "settings.list",
  "SettingsListResponsePayload",
  "這個客戶端看得到的設定，含分級。",
);
requestFrame(
  "SettingsProposeChangeRequest",
  "settings.propose_change",
  "SettingsProposeChangeRequestPayload",
  "提出一個設定變更；分級決定是否需要審批。",
);
responseFrame(
  "SettingsProposeChangeResponse",
  "settings.propose_change",
  "SettingsProposeChangeResponsePayload",
  "設定變更紀錄；approval 分級會先待決。",
);
requestFrame(
  "SettingsChangesListRequest",
  "settings.changes.list",
  "SettingsChangesListRequestPayload",
  "列出設定變更紀錄與待決提議。",
);
responseFrame(
  "SettingsChangesListResponse",
  "settings.changes.list",
  "SettingsChangesListResponsePayload",
  "設定變更紀錄清單。",
);
requestFrame(
  "SettingsChangeDecideRequest",
  "settings.change.decide",
  "SettingsChangeDecideRequestPayload",
  "核准或拒絕一個待決的設定提議。",
);
responseFrame(
  "SettingsChangeDecideResponse",
  "settings.change.decide",
  "SettingsChangeDecideResponsePayload",
  "決定後的設定變更紀錄。",
);
eventFrame(
  "SettingsChangedEvent",
  "settings.changed",
  "SettingsChangedEventPayload",
  "設定變更；掛在 system 串流。",
);

requestFrame(
  "StorageUsageRequest",
  "storage.usage",
  "StorageUsageRequestPayload",
  "讀取各類別的儲存用量。",
);
responseFrame(
  "StorageUsageResponse",
  "storage.usage",
  "StorageUsageResponsePayload",
  "各類別的用量與可清理量。",
);
requestFrame(
  "StorageCleanupPreviewRequest",
  "storage.cleanup.preview",
  "StorageCleanupPreviewRequestPayload",
  "預覽一次清理會清掉的目標與釋放空間。",
);
responseFrame(
  "StorageCleanupPreviewResponse",
  "storage.cleanup.preview",
  "StorageCleanupPreviewResponsePayload",
  "預覽結果；先確認這個內容再執行 storage.cleanup.apply。",
);
requestFrame(
  "StorageCleanupApplyRequest",
  "storage.cleanup.apply",
  "StorageCleanupApplyRequestPayload",
  "執行預覽過的清理；未預覽、目標改變或碰到正本時拒絕。",
);
responseFrame(
  "StorageCleanupApplyResponse",
  "storage.cleanup.apply",
  "StorageCleanupApplyResponsePayload",
  "實際清理結果與紀錄識別碼。",
);
eventFrame(
  "StorageChangedEvent",
  "storage.changed",
  "StorageChangedEventPayload",
  "儲存用量改變；掛在 system 串流。",
);

requestFrame(
  "EmotionGetRequest",
  "emotion.get",
  "EmotionGetRequestPayload",
  "讀取目前情緒維度值與更新時間；只給介面顯示。",
);
responseFrame("EmotionGetResponse", "emotion.get", "EmotionGetResponsePayload", "目前的情緒狀態。");

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
    ref("SessionArchiveRequest"),
    ref("SessionUnarchiveRequest"),
    ref("SessionDeletionPreviewRequest"),
    ref("SessionDeleteRequest"),
    ref("CardListRequest"),
    ref("CardGetRequest"),
    ref("CardCreateRequest"),
    ref("CardPatchRequest"),
    ref("CardPatchesListRequest"),
    ref("CardPatchAcceptRequest"),
    ref("CardPatchRejectRequest"),
    ref("CardVersionsListRequest"),
    ref("CardVersionGetRequest"),
    ref("CardVersionRestoreRequest"),
    ref("CardDeleteRequest"),
    ref("CardSearchRequest"),
    ref("CardRefreshRequest"),
    ref("BoardListRequest"),
    ref("BoardGetRequest"),
    ref("BoardCreateRequest"),
    ref("BoardSaveRequest"),
    ref("BoardDeleteRequest"),
    ref("BoardProjectCardRequest"),
    ref("BoardUnprojectCardRequest"),
    ref("BoardCreateCardFromSelectionRequest"),
    ref("MediaImportRequest"),
    ref("ContextGetRequest"),
    ref("ContextAddCardRequest"),
    ref("ContextRemoveCardRequest"),
    ref("ContextCompactRequest"),
    ref("SystemSettingsGetRequest"),
    ref("SystemSettingsSetRequest"),
    ref("SystemModulesGetRequest"),
    ref("SystemModulesSetEnabledRequest"),
    ref("SystemModelsGetRequest"),
    ref("SystemModelsSetRequest"),
    ref("ApprovalDecideRequest"),
    ref("ApprovalPauseAllRequest"),
    ref("ModuleRequest"),
    ref("NotificationListRequest"),
    ref("NotificationMarkReadRequest"),
    ref("NotificationCreateCardRequest"),
    ref("PairingBeginRequest"),
    ref("PairingCompleteRequest"),
    ref("AgentStartRequest"),
    ref("AgentStopRequest"),
    ref("AgentListRequest"),
    ref("McpServersListRequest"),
    ref("McpServerAddRequest"),
    ref("McpServerRemoveRequest"),
    ref("McpServerSetEnabledRequest"),
    ref("McpServerAllowHostsRequest"),
    ref("SettingsListRequest"),
    ref("SettingsProposeChangeRequest"),
    ref("SettingsChangesListRequest"),
    ref("SettingsChangeDecideRequest"),
    ref("StorageUsageRequest"),
    ref("StorageCleanupPreviewRequest"),
    ref("StorageCleanupApplyRequest"),
    ref("EmotionGetRequest"),
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
    ref("SessionArchiveResponse"),
    ref("SessionUnarchiveResponse"),
    ref("SessionDeletionPreviewResponse"),
    ref("SessionDeleteResponse"),
    ref("CardListResponse"),
    ref("CardGetResponse"),
    ref("CardCreateResponse"),
    ref("CardPatchResponse"),
    ref("CardPatchesListResponse"),
    ref("CardPatchAcceptResponse"),
    ref("CardPatchRejectResponse"),
    ref("CardVersionsListResponse"),
    ref("CardVersionGetResponse"),
    ref("CardVersionRestoreResponse"),
    ref("CardDeleteResponse"),
    ref("CardSearchResponse"),
    ref("CardRefreshResponse"),
    ref("BoardListResponse"),
    ref("BoardGetResponse"),
    ref("BoardCreateResponse"),
    ref("BoardSaveResponse"),
    ref("BoardDeleteResponse"),
    ref("BoardProjectCardResponse"),
    ref("BoardUnprojectCardResponse"),
    ref("BoardCreateCardFromSelectionResponse"),
    ref("MediaImportResponse"),
    ref("ContextGetResponse"),
    ref("ContextAddCardResponse"),
    ref("ContextRemoveCardResponse"),
    ref("ContextCompactResponse"),
    ref("SystemSettingsGetResponse"),
    ref("SystemSettingsSetResponse"),
    ref("SystemModulesGetResponse"),
    ref("SystemModulesSetEnabledResponse"),
    ref("SystemModelsGetResponse"),
    ref("SystemModelsSetResponse"),
    ref("StreamTurnStartedEvent"),
    ref("StreamTextDeltaEvent"),
    ref("StreamMessageCompletedEvent"),
    ref("StreamToolCallEvent"),
    ref("StreamToolResultEvent"),
    ref("StreamTurnStateEvent"),
    ref("StreamUiEvent"),
    ref("CardChangedEvent"),
    ref("BoardChangedEvent"),
    ref("ContextChangedEvent"),
    ref("ContextCompactedEvent"),
    ref("SessionArchivedEvent"),
    ref("SessionUnarchivedEvent"),
    ref("SessionDeletedEvent"),
    ref("SystemSettingsChangedEvent"),
    ref("SystemModulesChangedEvent"),
    ref("SystemModelsChangedEvent"),
    ref("ApprovalRequestedEvent"),
    ref("ApprovalDecideResponse"),
    ref("ApprovalDecidedEvent"),
    ref("ApprovalPauseAllResponse"),
    ref("NotificationListResponse"),
    ref("NotificationMarkReadResponse"),
    ref("NotificationCreateCardResponse"),
    ref("NotificationChangedEvent"),
    ref("PairingBeginResponse"),
    ref("PairingCompleteResponse"),
    ref("AgentStartResponse"),
    ref("AgentStopResponse"),
    ref("AgentListResponse"),
    ref("AgentStateChangedEvent"),
    ref("McpServersListResponse"),
    ref("McpServerAddResponse"),
    ref("McpServerRemoveResponse"),
    ref("McpServerSetEnabledResponse"),
    ref("McpServerAllowHostsResponse"),
    ref("McpServersChangedEvent"),
    ref("SettingsListResponse"),
    ref("SettingsProposeChangeResponse"),
    ref("SettingsChangesListResponse"),
    ref("SettingsChangeDecideResponse"),
    ref("SettingsChangedEvent"),
    ref("StorageUsageResponse"),
    ref("StorageCleanupPreviewResponse"),
    ref("StorageCleanupApplyResponse"),
    ref("StorageChangedEvent"),
    ref("EmotionGetResponse"),
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
