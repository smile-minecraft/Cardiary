/* eslint-disable */
/**
 * 這個檔案由 packages/protocol/schema/protocol.schema.json 產生，不要手改。
 * 重新產生：pnpm --filter @cardiary/protocol generate
 */

/**
 * Cardiary 主機服務與客戶端之間的 JSON 協定。持續狀態走 WebSocket，大型檔案走 HTTP。
 */
export type CardiaryProtocol = ClientFrame | ServerFrame;
/**
 * 客戶端送給主機的所有訊息。
 */
export type ClientFrame =
  | SystemHelloRequest
  | SystemSubscribeRequest
  | SystemUnsubscribeRequest
  | SessionCreateRequest
  | SessionListRequest
  | SessionSendMessageRequest
  | SessionInterruptRequest
  | SessionSubscribeRequest
  | SessionUnsubscribeRequest
  | SessionGetHistoryRequest
  | ApprovalDecideRequest
  | ApprovalPauseAllRequest
  | ModuleRequest;
/**
 * 客戶端平台。
 */
export type ClientPlatform = "macos" | "ios" | "ipados" | "web" | "other";
/**
 * 送出訊息時的行為。queue 在下一個模型請求生效，不中止目前串流；interrupt 先中止目前生成再送出。
 */
export type DeliveryMode = "queue" | "interrupt";
/**
 * 任意 JSON 值。只用於工具輸出、模組資料與錯誤細節，協定欄位不使用。
 */
export type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | {
      [k: string]: JSONValue;
    };
/**
 * 主機送給客戶端的所有訊息。
 */
export type ServerFrame =
  | SystemHelloResponse
  | SystemSubscribeResponse
  | SystemUnsubscribeResponse
  | SystemStatusEvent
  | SessionCreateResponse
  | SessionListResponse
  | SessionSendMessageResponse
  | SessionInterruptResponse
  | SessionSubscribeResponse
  | SessionUnsubscribeResponse
  | SessionGetHistoryResponse
  | StreamTurnStartedEvent
  | StreamTextDeltaEvent
  | StreamMessageCompletedEvent
  | StreamToolCallEvent
  | StreamToolResultEvent
  | StreamTurnStateEvent
  | StreamUiEvent
  | ApprovalRequestedEvent
  | ApprovalDecideResponse
  | ApprovalDecidedEvent
  | ApprovalPauseAllResponse
  | ErrorFrame
  | ModuleResponse
  | ModuleEvent;
/**
 * 資料夾狀態。
 */
export type FolderState = "ready" | "not_selected" | "unavailable";
/**
 * 主機服務狀態。
 */
export type ServiceState = "running" | "paused" | "degraded";
/**
 * 會話狀態。
 */
export type SessionStatus = "idle" | "running" | "waiting_approval" | "archived";
/**
 * 主機實際採用的送出方式。
 */
export type SendMessageDisposition = "started" | "queued" | "interrupted_then_started";
/**
 * 會話歷史中的一則訊息，依 role 區分。
 */
export type TranscriptEntry = UserTranscriptEntry | AssistantTranscriptEntry | ToolTranscriptEntry;
/**
 * 訊息狀態。
 */
export type MessageStatus = "streaming" | "complete" | "interrupted" | "failed";
/**
 * 回合狀態。
 */
export type TurnPhase =
  "queued" | "running" | "waiting_approval" | "completed" | "failed" | "interrupted";
/**
 * 審批範圍的種類。
 */
export type ApprovalScopeKind = "tool_call" | "settings_change" | "schedule";
/**
 * 審批決定的效果。
 */
export type ApprovalEffect = "approve" | "reject" | "approve_always";
/**
 * 工具結果狀態。
 */
export type ToolResultStatus = "ok" | "error";
/**
 * 做出決定的來源。
 */
export type DeciderKind = "client" | "system";
/**
 * 協定層級的錯誤碼。
 */
export type ErrorCode =
  | "auth_invalid"
  | "auth_expired"
  | "not_authenticated"
  | "incompatible_version"
  | "invalid_message"
  | "payload_too_large"
  | "not_found"
  | "conflict"
  | "busy"
  | "permission_denied"
  | "rate_limited"
  | "unavailable"
  | "internal"
  | "cancelled"
  | "unsupported";

/**
 * 連線後的第一則請求：驗證、版本協商與客戶端資訊。
 */
export interface SystemHelloRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "system.hello";
  payload: SystemHelloRequestPayload;
}
/**
 * 連線後的第一則請求。伺服器在驗證與版本協商完成前不接受其他請求。
 */
export interface SystemHelloRequestPayload {
  auth?: HelloAuth;
  protocol: ProtocolRange;
  client: ClientInfo;
  resume?: HelloResume;
}
/**
 * WebSocket 第一則訊息攜帶的驗證資料。原生客戶端也可以改用 Authorization 標頭。
 */
export interface HelloAuth {
  /**
   * 驗證 Token。連線成功後不得再出現在任何訊息或日誌。
   */
  token: string;
}
export interface ProtocolRange {
  /**
   * 客戶端支援的最低協定主版本。
   */
  min: number;
  /**
   * 客戶端支援的最高協定主版本。
   */
  max: number;
}
export interface ClientInfo {
  /**
   * 客戶端名稱，例如 Cardiary macOS。
   */
  name: string;
  /**
   * 客戶端版本。
   */
  version: string;
  platform: ClientPlatform;
  /**
   * 同一次安裝穩定的隨機識別碼；只用於區分客戶端，不含個人資料。
   */
  instanceId: string;
}
export interface HelloResume {
  /**
   * 客戶端最後收到的系統串流序號。
   */
  systemSeq?: number;
}
/**
 * 訂閱系統狀態串流。
 */
export interface SystemSubscribeRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "system.subscribe";
  payload: SystemSubscribeRequestPayload;
}
export interface SystemSubscribeRequestPayload {
  /**
   * 客戶端最後收到的系統串流序號；省略代表要一份完整快照。
   */
  lastSeq?: number;
}
/**
 * 取消系統狀態串流。
 */
export interface SystemUnsubscribeRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "system.unsubscribe";
  payload: EmptyPayload;
}
/**
 * 沒有內容的請求或回應。
 */
export interface EmptyPayload {}
/**
 * 建立一場會話。
 */
export interface SessionCreateRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "session.create";
  payload: SessionCreateRequestPayload;
}
export interface SessionCreateRequestPayload {
  /**
   * 初始標題；省略時由主機產生。
   */
  title?: string;
  /**
   * 客戶端產生的冪等鍵；同一個鍵重送只會建立一場會話。
   */
  clientRequestId?: string;
}
/**
 * 列出會話。
 */
export interface SessionListRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "session.list";
  payload: SessionListRequestPayload;
}
export interface SessionListRequestPayload {
  /**
   * 上一頁回傳的游標。
   */
  cursor?: string;
  /**
   * 最多回傳幾筆。
   */
  limit?: number;
}
/**
 * 送出使用者訊息；可排隊插話或中止後重送。
 */
export interface SessionSendMessageRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "session.send_message";
  payload: SessionSendMessageRequestPayload;
}
export interface SessionSendMessageRequestPayload {
  /**
   * 目標會話。
   */
  sessionId: string;
  /**
   * 使用者訊息文字。
   */
  text: string;
  delivery: DeliveryMode;
  /**
   * 客戶端產生的訊息冪等鍵；重送時主機回傳同一則訊息。
   */
  clientMessageId?: string;
}
/**
 * 中止目前生成，不送出新的訊息。
 */
export interface SessionInterruptRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "session.interrupt";
  payload: SessionInterruptRequestPayload;
}
export interface SessionInterruptRequestPayload {
  /**
   * 要中止的會話。
   */
  sessionId: string;
  /**
   * 中止原因，會寫入日誌與回合狀態。
   */
  reason?: string;
}
/**
 * 訂閱一場會話的歷史與事件。
 */
export interface SessionSubscribeRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "session.subscribe";
  payload: SessionSubscribeRequestPayload;
}
export interface SessionSubscribeRequestPayload {
  /**
   * 要訂閱的會話。
   */
  sessionId: string;
  /**
   * 客戶端最後收到的會話串流序號；省略代表要一份完整快照。
   */
  lastSeq?: number;
  /**
   * 快照最多帶幾則歷史訊息。
   */
  historyLimit?: number;
}
/**
 * 取消訂閱一場會話。
 */
export interface SessionUnsubscribeRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "session.unsubscribe";
  payload: SessionUnsubscribeRequestPayload;
}
export interface SessionUnsubscribeRequestPayload {
  /**
   * 要取消訂閱的會話。
   */
  sessionId: string;
}
/**
 * 往回捲動時分頁取得較早的訊息。
 */
export interface SessionGetHistoryRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "session.get_history";
  payload: SessionGetHistoryRequestPayload;
}
export interface SessionGetHistoryRequestPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 上一頁回傳的游標。
   */
  cursor?: string;
  /**
   * 最多回傳幾則。
   */
  limit?: number;
}
/**
 * 核准或拒絕一筆審批。
 */
export interface ApprovalDecideRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "approval.decide";
  payload: ApprovalDecideRequestPayload;
}
export interface ApprovalDecideRequestPayload {
  /**
   * 要決定的審批。
   */
  approvalId: string;
  /**
   * ApprovalRequest.options 裡的選項。
   */
  optionId: string;
  /**
   * 使用者留下的備註。
   */
  note?: string;
}
/**
 * 緊急暫停所有進行中的任務。
 */
export interface ApprovalPauseAllRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "approval.pause_all";
  payload: ApprovalPauseAllRequestPayload;
}
export interface ApprovalPauseAllRequestPayload {
  /**
   * 暫停原因。
   */
  reason?: string;
}
/**
 * 模組貢獻的請求。主機依 type 的命名空間路由給對應模組。
 */
export interface ModuleRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼。
   */
  id: string;
  /**
   * 模組命名空間的請求型別，例如 module.cards.search。
   */
  type: string;
  payload: ModuleRequestPayload;
}
export interface ModuleRequestPayload {
  data: JSONObject;
}
/**
 * 字串鍵的 JSON 物件。
 */
export interface JSONObject {
  [k: string]: JSONValue;
}
/**
 * 驗證與版本協商的結果。
 */
export interface SystemHelloResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "system.hello";
  payload: SystemHelloResponsePayload;
}
/**
 * 版本協商與驗證的結果。
 */
export interface SystemHelloResponsePayload {
  protocol: ProtocolInfo;
  server: ServerInfo;
  /**
   * 這次連線的識別碼；重連後會改變。
   */
  connectionId: string;
  limits: ServerLimits;
  capabilities: ServerCapabilities;
}
export interface ProtocolInfo {
  /**
   * 這次連線使用的協定主版本。
   */
  version: number;
  /**
   * 伺服器支援的最低主版本。
   */
  min: number;
  /**
   * 伺服器支援的最高主版本。
   */
  max: number;
}
export interface ServerInfo {
  /**
   * 主機服務名稱。
   */
  name: string;
  /**
   * 主機服務版本。
   */
  version: string;
}
export interface ServerLimits {
  /**
   * 單一 WebSocket 訊息的最大位元組數。
   */
  maxFrameBytes: number;
  /**
   * 每個串流保留的可補送事件數量。
   */
  replayWindow: number;
  /**
   * WebSocket ping 的間隔秒數。
   */
  heartbeatSeconds: number;
}
export interface ServerCapabilities {
  /**
   * 是否接受模組命名空間的請求與事件。
   */
  modules: boolean;
  /**
   * 是否提供 HTTP 大型檔案端點。
   */
  files: boolean;
}
/**
 * 系統狀態串流的訂閱結果。
 */
export interface SystemSubscribeResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "system.subscribe";
  payload: SystemSubscribeResponsePayload;
}
export interface SystemSubscribeResponsePayload {
  /**
   * 串流識別碼，系統串流固定是 system。
   */
  stream: string;
  /**
   * 訂閱當下的最新序號。
   */
  seq: number;
  /**
   * 是否附上完整快照；false 表示接下來只會補送 seq 之後的事件。
   */
  resyncRequired: boolean;
  snapshot?: SystemStatus;
}
export interface SystemStatus {
  folder: FolderStatus;
  service: ServiceStatus;
}
export interface FolderStatus {
  state: FolderState;
  /**
   * 給使用者看的資料夾名稱，不含完整路徑。
   */
  displayName: string;
  /**
   * 資料夾目前是否可寫。
   */
  writable: boolean;
  /**
   * 狀態不是 ready 時的原因。
   */
  reason?: string;
}
export interface ServiceStatus {
  state: ServiceState;
  /**
   * 主機服務版本。
   */
  version: string;
  /**
   * 服務已執行的秒數。
   */
  uptimeSeconds: number;
  /**
   * 目前進行中的任務數。
   */
  activeTasks: number;
}
/**
 * 系統狀態串流的取消結果。
 */
export interface SystemUnsubscribeResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "system.unsubscribe";
  payload: SystemUnsubscribeResponsePayload;
}
export interface SystemUnsubscribeResponsePayload {
  /**
   * 已取消訂閱的串流識別碼。
   */
  stream: string;
}
/**
 * 資料夾或服務狀態改變。
 */
export interface SystemStatusEvent {
  v: 1;
  kind: "event";
  type: "system.status";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 這個串流的單調遞增序號，從 1 開始。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: SystemStatus;
}
/**
 * 建立會話的結果。
 */
export interface SessionCreateResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "session.create";
  payload: SessionCreateResponsePayload;
}
export interface SessionCreateResponsePayload {
  session: SessionSummary;
}
export interface SessionSummary {
  /**
   * 會話識別碼。
   */
  id: string;
  /**
   * 會話標題。
   */
  title: string;
  status: SessionStatus;
  /**
   * 建立時間，RFC 3339。
   */
  createdAt: string;
  /**
   * 最後更新時間，RFC 3339。
   */
  updatedAt: string;
  /**
   * 可見訊息數量。
   */
  messageCount: number;
}
/**
 * 會話列表。
 */
export interface SessionListResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "session.list";
  payload: SessionListResponsePayload;
}
export interface SessionListResponsePayload {
  sessions: SessionSummary[];
  /**
   * 下一頁游標；沒有更多資料時省略。
   */
  nextCursor?: string;
}
/**
 * 訊息已接受，回傳實際採用的送出方式。
 */
export interface SessionSendMessageResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "session.send_message";
  payload: SessionSendMessageResponsePayload;
}
export interface SessionSendMessageResponsePayload {
  /**
   * 目標會話。
   */
  sessionId: string;
  /**
   * 已接受的訊息識別碼。
   */
  userMessageId: string;
  /**
   * 訊息對應的回應回合。
   */
  turnId: string;
  disposition: SendMessageDisposition;
  /**
   * 排隊時，前面尚未結束的回合識別碼。
   */
  queuedBehindTurnId?: string;
}
/**
 * 中止的結果。
 */
export interface SessionInterruptResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "session.interrupt";
  payload: SessionInterruptResponsePayload;
}
export interface SessionInterruptResponsePayload {
  /**
   * 目標會話。
   */
  sessionId: string;
  /**
   * 這次請求是否真的中止了進行中的生成。
   */
  interrupted: boolean;
}
/**
 * 會話串流的訂閱結果。
 */
export interface SessionSubscribeResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "session.subscribe";
  payload: SessionSubscribeResponsePayload;
}
export interface SessionSubscribeResponsePayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 串流識別碼，格式是 session:<sessionId>。
   */
  stream: string;
  /**
   * 訂閱當下的最新序號。
   */
  seq: number;
  /**
   * 是否附上完整快照；false 表示接下來只會補送 seq 之後的事件。
   */
  resyncRequired: boolean;
  snapshot?: SessionSnapshot;
}
export interface SessionSnapshot {
  session: SessionSummary;
  /**
   * 最新一段歷史，依時間由舊到新。
   */
  entries: TranscriptEntry[];
  activeTurn?: TurnState;
  pendingApproval?: ApprovalRequest;
}
export interface UserTranscriptEntry {
  /**
   * 訊息識別碼。
   */
  id: string;
  role: "user";
  /**
   * 所屬回合。
   */
  turnId: string;
  /**
   * 建立時間，RFC 3339。
   */
  createdAt: string;
  /**
   * 訊息文字。
   */
  text: string;
}
export interface AssistantTranscriptEntry {
  /**
   * 訊息識別碼。
   */
  id: string;
  role: "assistant";
  /**
   * 所屬回合。
   */
  turnId: string;
  /**
   * 建立時間，RFC 3339。
   */
  createdAt: string;
  /**
   * 目前的完整文字。串流中的訊息會持續變長。
   */
  text: string;
  status: MessageStatus;
}
export interface ToolTranscriptEntry {
  /**
   * 訊息識別碼。
   */
  id: string;
  role: "tool";
  /**
   * 所屬回合。
   */
  turnId: string;
  /**
   * 建立時間，RFC 3339。
   */
  createdAt: string;
  /**
   * 工具呼叫識別碼。
   */
  toolCallId: string;
  /**
   * 工具名稱。
   */
  name: string;
  input: JSONObject;
  output?: ToolOutput;
  status: MessageStatus;
  /**
   * 工具結果的診斷碼。
   */
  diagnostics: ToolDiagnostic[];
}
export interface ToolOutput {
  /**
   * 給人或模型看的文字輸出。
   */
  text?: string;
  data?: JSONValue;
  /**
   * 輸出是否被截斷。
   */
  truncated?: boolean;
}
export interface ToolDiagnostic {
  /**
   * 診斷碼。目前使用 interrupted、truncated、full_output、timeout、denied；這是開放字串，新增代碼不需要改協定版本。
   */
  code: string;
  /**
   * 補充說明。
   */
  message?: string;
}
export interface TurnState {
  /**
   * 回合識別碼。
   */
  turnId: string;
  state: TurnPhase;
  /**
   * 開始時間，RFC 3339。
   */
  startedAt: string;
  /**
   * 結束時間，RFC 3339。
   */
  endedAt?: string;
  error?: TurnError;
}
export interface TurnError {
  /**
   * 錯誤碼。
   */
  code: string;
  /**
   * 錯誤說明。
   */
  message: string;
  /**
   * 這回合是否可以重試。
   */
  retryable: boolean;
}
export interface ApprovalRequest {
  /**
   * 審批識別碼。
   */
  approvalId: string;
  /**
   * 所屬會話。
   */
  sessionId: string;
  /**
   * 所屬回合。
   */
  turnId: string;
  /**
   * 相關的工具呼叫。
   */
  toolCallId?: string;
  /**
   * 給人看的審批標題。
   */
  title: string;
  /**
   * 補充說明，例如要執行的指令。
   */
  summary?: string;
  scope: ApprovalScope;
  /**
   * 可選的決定；至少一個。
   *
   * @minItems 1
   */
  options: [ApprovalOption, ...ApprovalOption[]];
  /**
   * 請求時間，RFC 3339。
   */
  requestedAt: string;
  /**
   * 逾時時間，RFC 3339；省略代表不會自動逾時。
   */
  expiresAt?: string;
}
export interface ApprovalScope {
  kind: ApprovalScopeKind;
  /**
   * 審批對象，例如工具名稱或設定鍵。
   */
  target: string;
  detail?: JSONValue;
}
export interface ApprovalOption {
  /**
   * 選項識別碼。
   */
  id: string;
  /**
   * 給使用者看的按鈕文字。
   */
  label: string;
  effect: ApprovalEffect;
}
/**
 * 取消訂閱的結果。
 */
export interface SessionUnsubscribeResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "session.unsubscribe";
  payload: SessionUnsubscribeResponsePayload;
}
export interface SessionUnsubscribeResponsePayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 是否已取消訂閱。
   */
  unsubscribed: boolean;
}
/**
 * 較早的訊息分頁。
 */
export interface SessionGetHistoryResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "session.get_history";
  payload: SessionGetHistoryResponsePayload;
}
export interface SessionGetHistoryResponsePayload {
  /**
   * 依時間由舊到新。
   */
  entries: TranscriptEntry[];
  /**
   * 下一頁游標；沒有更多資料時省略。
   */
  nextCursor?: string;
}
/**
 * 一個回應回合開始。
 */
export interface StreamTurnStartedEvent {
  v: 1;
  kind: "event";
  type: "stream.turn_started";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 這個串流的單調遞增序號，從 1 開始。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: StreamTurnStartedEventPayload;
}
export interface StreamTurnStartedEventPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 回合識別碼。
   */
  turnId: string;
  /**
   * 觸發這回合的使用者訊息。
   */
  triggerMessageId: string;
  /**
   * 開始時間，RFC 3339。
   */
  startedAt: string;
}
/**
 * 助理文字增量。
 */
export interface StreamTextDeltaEvent {
  v: 1;
  kind: "event";
  type: "stream.text_delta";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 這個串流的單調遞增序號，從 1 開始。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: StreamTextDeltaEventPayload;
}
export interface StreamTextDeltaEventPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 回合識別碼。
   */
  turnId: string;
  /**
   * 正在增長的助理訊息。
   */
  messageId: string;
  /**
   * 這次追加的文字。
   */
  delta: string;
}
/**
 * 助理訊息完成。
 */
export interface StreamMessageCompletedEvent {
  v: 1;
  kind: "event";
  type: "stream.message_completed";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 這個串流的單調遞增序號，從 1 開始。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: StreamMessageCompletedEventPayload;
}
export interface StreamMessageCompletedEventPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 回合識別碼。
   */
  turnId: string;
  entry: AssistantTranscriptEntry;
  usage?: TokenUsage;
}
export interface TokenUsage {
  /**
   * 輸入 token 數。
   */
  inputTokens?: number;
  /**
   * 輸出 token 數。
   */
  outputTokens?: number;
}
/**
 * 模型要求呼叫工具。
 */
export interface StreamToolCallEvent {
  v: 1;
  kind: "event";
  type: "stream.tool_call";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 這個串流的單調遞增序號，從 1 開始。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: StreamToolCallEventPayload;
}
export interface StreamToolCallEventPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 回合識別碼。
   */
  turnId: string;
  /**
   * 工具呼叫識別碼。
   */
  toolCallId: string;
  /**
   * 工具名稱。
   */
  name: string;
  /**
   * 給人看的工具動作標題。
   */
  title?: string;
  input: JSONObject;
}
/**
 * 工具結果，含診斷碼。
 */
export interface StreamToolResultEvent {
  v: 1;
  kind: "event";
  type: "stream.tool_result";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 這個串流的單調遞增序號，從 1 開始。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: StreamToolResultEventPayload;
}
export interface StreamToolResultEventPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 回合識別碼。
   */
  turnId: string;
  /**
   * 工具呼叫識別碼。
   */
  toolCallId: string;
  status: ToolResultStatus;
  output: ToolOutput;
  /**
   * 工具結果的診斷碼。
   */
  diagnostics: ToolDiagnostic[];
}
/**
 * 回合狀態改變。
 */
export interface StreamTurnStateEvent {
  v: 1;
  kind: "event";
  type: "stream.turn_state";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 這個串流的單調遞增序號，從 1 開始。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: TurnState;
}
/**
 * 工具專屬的介面資料；由客戶端依 renderer 渲染。
 */
export interface StreamUiEvent {
  v: 1;
  kind: "event";
  type: "stream.ui";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 這個串流的單調遞增序號，從 1 開始。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: StreamUiEventPayload;
}
export interface StreamUiEventPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 回合識別碼。
   */
  turnId: string;
  /**
   * 相關的工具呼叫。
   */
  toolCallId?: string;
  /**
   * 介面渲染器名稱，使用模組命名空間，例如 module.cards.grid。
   */
  renderer: string;
  data: JSONValue;
}
/**
 * 需要使用者決定時送出審批請求。
 */
export interface ApprovalRequestedEvent {
  v: 1;
  kind: "event";
  type: "approval.requested";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 這個串流的單調遞增序號，從 1 開始。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: ApprovalRequest;
}
/**
 * 審批決定已持久化。
 */
export interface ApprovalDecideResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "approval.decide";
  payload: ApprovalDecideResponsePayload;
}
export interface ApprovalDecideResponsePayload {
  /**
   * 審批識別碼。
   */
  approvalId: string;
  effect: ApprovalEffect;
  /**
   * 決定時間，RFC 3339。
   */
  decidedAt: string;
  /**
   * 決定是否已寫入耐久儲存；true 代表主機重啟後仍會續跑。
   */
  persisted: boolean;
}
/**
 * 任何客戶端做出決定後，通知其他客戶端。
 */
export interface ApprovalDecidedEvent {
  v: 1;
  kind: "event";
  type: "approval.decided";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 這個串流的單調遞增序號，從 1 開始。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: ApprovalDecidedEventPayload;
}
export interface ApprovalDecidedEventPayload {
  /**
   * 審批識別碼。
   */
  approvalId: string;
  /**
   * 所屬會話。
   */
  sessionId: string;
  effect: ApprovalEffect;
  /**
   * 決定時間，RFC 3339。
   */
  decidedAt: string;
  decidedBy: DecidedBy;
}
export interface DecidedBy {
  kind: DeciderKind;
  /**
   * 決定者的客戶端 instanceId。
   */
  clientId?: string;
}
/**
 * 緊急暫停的結果。
 */
export interface ApprovalPauseAllResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "approval.pause_all";
  payload: ApprovalPauseAllResponsePayload;
}
export interface ApprovalPauseAllResponsePayload {
  /**
   * 暫停時間，RFC 3339。
   */
  pausedAt: string;
  /**
   * Items: 被中止的會話識別碼。
   */
  interruptedSessionIds: string[];
}
/**
 * 錯誤信封。HTTP 端點使用同一個結構作為錯誤回應內容。
 */
export interface ErrorFrame {
  v: 1;
  kind: "error";
  /**
   * 對應的請求 id；連線層級的錯誤沒有這個欄位。
   */
  replyTo?: string;
  code: ErrorCode;
  /**
   * 給人看的錯誤說明，不含敏感資料。
   */
  message: string;
  details?: JSONObject;
  /**
   * 客戶端是否可以原樣重試。
   */
  retryable: boolean;
}
/**
 * 模組貢獻的回應。
 */
export interface ModuleResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的模組請求 id。
   */
  replyTo: string;
  /**
   * 模組命名空間的回應型別。
   */
  type: string;
  payload: ModuleResponsePayload;
}
export interface ModuleResponsePayload {
  data: JSONObject;
}
/**
 * 模組貢獻的事件。未安裝對應模組的客戶端可以忽略。
 */
export interface ModuleEvent {
  v: 1;
  kind: "event";
  /**
   * 模組命名空間的事件型別，例如 module.cards.changed。
   */
  type: string;
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 這個串流的單調遞增序號。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: ModuleEventPayload;
}
export interface ModuleEventPayload {
  data: JSONObject;
  /**
   * 模組事件的 payload schema 版本。
   */
  schemaVersion?: string;
}
