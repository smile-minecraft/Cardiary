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
  | SessionArchiveRequest
  | SessionUnarchiveRequest
  | SessionDeletionPreviewRequest
  | SessionDeleteRequest
  | CardListRequest
  | CardGetRequest
  | CardCreateRequest
  | CardPatchRequest
  | CardPatchesListRequest
  | CardPatchAcceptRequest
  | CardPatchRejectRequest
  | CardVersionsListRequest
  | CardVersionGetRequest
  | CardVersionRestoreRequest
  | CardDeleteRequest
  | CardSearchRequest
  | CardRefreshRequest
  | BoardListRequest
  | BoardGetRequest
  | BoardCreateRequest
  | BoardSaveRequest
  | BoardDeleteRequest
  | BoardProjectCardRequest
  | BoardUnprojectCardRequest
  | BoardCreateCardFromSelectionRequest
  | MediaImportRequest
  | ContextGetRequest
  | ContextAddCardRequest
  | ContextRemoveCardRequest
  | ContextCompactRequest
  | SystemSettingsGetRequest
  | SystemSettingsSetRequest
  | SystemModulesGetRequest
  | SystemModulesSetEnabledRequest
  | SystemModelsGetRequest
  | SystemModelsSetRequest
  | ApprovalDecideRequest
  | ApprovalPauseAllRequest
  | ModuleRequest
  | NotificationListRequest
  | NotificationMarkReadRequest
  | NotificationCreateCardRequest
  | PairingBeginRequest
  | PairingCompleteRequest;
/**
 * 客戶端平台。
 */
export type ClientPlatform = "macos" | "ios" | "ipados" | "web" | "other";
/**
 * 送出訊息時的行為。queue 在目前回合結束後生效；steer 在下一個模型請求前送達，不中止目前串流；interrupt 先中止目前生成再送出。
 */
export type DeliveryMode = "queue" | "steer" | "interrupt";
/**
 * 卡片種類。memory、summary、persona、bedrock 只由系統或匯入建立。
 */
export type CardKind = "note" | "image" | "audio" | "memory" | "summary" | "persona" | "bedrock";
/**
 * 列表與搜尋的生命週期篩選。
 */
export type CardLifecycleFilter = "live" | "cold" | "all";
/**
 * 補丁格式；代理只能用 unified。
 */
export type CardPatchFormat = "unified" | "replace";
/**
 * 待決補丁的狀態。
 */
export type PendingPatchStatus = "pending" | "accepted" | "rejected";
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
 * 供應商接入方式。
 */
export type ModelProviderKind = "api-key" | "aggregator" | "local";
/**
 * 模型接受的輸入種類。
 */
export type ModelInputKind = "text" | "image" | "audio";
/**
 * 四個模型角色。
 */
export type ModelRole = "main" | "small" | "writing" | "system-one";
/**
 * 角色的設定方式：model 指定模型、unset 走退回、none 明確關閉（只有 system-one 可用）。
 */
export type ModelRoleMode = "model" | "unset" | "none";
/**
 * 裝置的種類。
 */
export type DeviceKind = "web" | "ios";
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
  | SessionArchiveResponse
  | SessionUnarchiveResponse
  | SessionDeletionPreviewResponse
  | SessionDeleteResponse
  | CardListResponse
  | CardGetResponse
  | CardCreateResponse
  | CardPatchResponse
  | CardPatchesListResponse
  | CardPatchAcceptResponse
  | CardPatchRejectResponse
  | CardVersionsListResponse
  | CardVersionGetResponse
  | CardVersionRestoreResponse
  | CardDeleteResponse
  | CardSearchResponse
  | CardRefreshResponse
  | BoardListResponse
  | BoardGetResponse
  | BoardCreateResponse
  | BoardSaveResponse
  | BoardDeleteResponse
  | BoardProjectCardResponse
  | BoardUnprojectCardResponse
  | BoardCreateCardFromSelectionResponse
  | MediaImportResponse
  | ContextGetResponse
  | ContextAddCardResponse
  | ContextRemoveCardResponse
  | ContextCompactResponse
  | SystemSettingsGetResponse
  | SystemSettingsSetResponse
  | SystemModulesGetResponse
  | SystemModulesSetEnabledResponse
  | SystemModelsGetResponse
  | SystemModelsSetResponse
  | StreamTurnStartedEvent
  | StreamTextDeltaEvent
  | StreamMessageCompletedEvent
  | StreamToolCallEvent
  | StreamToolResultEvent
  | StreamTurnStateEvent
  | StreamUiEvent
  | CardChangedEvent
  | BoardChangedEvent
  | ContextChangedEvent
  | ContextCompactedEvent
  | SessionArchivedEvent
  | SessionUnarchivedEvent
  | SessionDeletedEvent
  | SystemSettingsChangedEvent
  | SystemModulesChangedEvent
  | SystemModelsChangedEvent
  | ApprovalRequestedEvent
  | ApprovalDecideResponse
  | ApprovalDecidedEvent
  | ApprovalPauseAllResponse
  | NotificationListResponse
  | NotificationMarkReadResponse
  | NotificationCreateCardResponse
  | NotificationChangedEvent
  | PairingBeginResponse
  | PairingCompleteResponse
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
 * 卡片生命週期；cold 是蒸餾後的冷封存。
 */
export type CardLifecycle = "live" | "cold";
/**
 * 版本記錄的種類。
 */
export type CardVersionKind = "create" | "patch" | "checkpoint" | "restore" | "merge";
/**
 * 多模態的種類；只有圖片與音訊。
 */
export type MediaKind = "image" | "audio";
/**
 * 由本機能力產生的文字來源；none 表示沒有產生。
 */
export type MediaLocalTextSource = "local" | "none";
/**
 * 由小模型產生的文字來源；none 表示沒有產生。
 */
export type MediaModelTextSource = "small-model" | "none";
/**
 * 八層的識別碼，順序由前往後。
 */
export type ContextLayer =
  | "bedrock"
  | "persona"
  | "core-memory"
  | "opening-memory"
  | "short-term-memory"
  | "other-cards"
  | "working-context"
  | "volatile-state";
/**
 * 項目在上下文中的狀態。
 */
export type ContextEntryState = "active" | "pending-removal";
/**
 * 發牌來源：System One 判斷，或沒有 System One 時用檢索排名發出；手動加入的卡是 manual。
 */
export type ContextDealSource = "system-one" | "retrieval" | "manual";
/**
 * 設定分級；未標明一律視為 human-only。
 */
export type SettingLevel = "free" | "approval" | "human-only";
/**
 * 模組的執行狀態。
 */
export type ModuleState = "loaded" | "active" | "inactive" | "failed";
/**
 * 設定值的輸入種類；設定頁據此產生表單。
 */
export type SettingKind =
  "string" | "number" | "integer" | "boolean" | "enum" | "string-list" | "path";
/**
 * 解析結果的來源；fallback 表示走了退回規則。
 */
export type ModelRoleSource = "configured" | "fallback-main" | "fallback-small" | "none";
/**
 * 工具結果狀態。
 */
export type ToolResultStatus = "ok" | "error";
/**
 * 卡片變更的種類。reindexed 表示只有索引或中繼資料變了。
 */
export type CardChange = "created" | "updated" | "deleted" | "refreshed" | "reindexed";
/**
 * 白板變更的種類。
 */
export type BoardChange = "created" | "updated" | "deleted";
/**
 * 做出決定的來源。
 */
export type DeciderKind = "client" | "system";
/**
 * 通知的來源種類。
 */
export type NotificationKind = "schedule" | "heartbeat" | "distillation";
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
  /**
   * 客戶端上次收到的事件 epoch。省略或與主機不同時，lastSeq 一律視為不可用。
   */
  epoch?: string;
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
   * 客戶端上次收到的事件 epoch。省略或與主機不同時，lastSeq 一律視為不可用。
   */
  epoch?: string;
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
 * 開始封存倒數。
 */
export interface SessionArchiveRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "session.archive";
  payload: SessionArchiveRequestPayload;
}
export interface SessionArchiveRequestPayload {
  /**
   * 要封存的會話。
   */
  sessionId: string;
  /**
   * 倒數天數；省略時用設定值（預設 7）。
   */
  purgeAfterDays?: number;
}
/**
 * 取消封存。
 */
export interface SessionUnarchiveRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "session.unarchive";
  payload: SessionUnarchiveRequestPayload;
}
export interface SessionUnarchiveRequestPayload {
  /**
   * 要取消封存的會話。
   */
  sessionId: string;
}
/**
 * 刪除前預覽連帶刪除的會話、卡片與原檔。
 */
export interface SessionDeletionPreviewRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "session.deletion_preview";
  payload: SessionDeletionPreviewRequestPayload;
}
export interface SessionDeletionPreviewRequestPayload {
  /**
   * 要預覽刪除的會話。
   */
  sessionId: string;
}
/**
 * 立即刪除會話與專屬卡片。
 */
export interface SessionDeleteRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "session.delete";
  payload: SessionDeleteRequestPayload;
}
export interface SessionDeleteRequestPayload {
  /**
   * 要刪除的會話；支線一定連同刪除。
   */
  sessionId: string;
  /**
   * 客戶端產生的冪等鍵。
   */
  clientRequestId: string;
}
/**
 * 列出卡片庫。
 */
export interface CardListRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "card.list";
  payload: CardListRequestPayload;
}
export interface CardListRequestPayload {
  /**
   * 只回這幾種。
   */
  kinds?: CardKind[];
  /**
   * 同時包含這些標籤。
   *
   * Items: 標籤。
   */
  tags?: string[];
  /**
   * 人格分區。
   */
  persona?: string;
  lifecycle?: CardLifecycleFilter;
  /**
   * 簡易查詢；等同 card.search 的前綴比對。
   */
  query?: string;
  /**
   * 是否包含被取代的卡；預設 false。
   */
  includeSuperseded?: boolean;
  /**
   * 上一頁的游標。
   */
  cursor?: string;
  /**
   * 最多回傳幾筆。
   */
  limit?: number;
}
/**
 * 讀取一張卡片。
 */
export interface CardGetRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "card.get";
  payload: CardGetRequestPayload;
}
export interface CardGetRequestPayload {
  /**
   * 要讀取的卡片。
   */
  cardId: string;
}
/**
 * 建立卡片。
 */
export interface CardCreateRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "card.create";
  payload: CardCreateRequestPayload;
}
export interface CardCreateRequestPayload {
  kind: CardKind;
  /**
   * 標題。
   */
  title: string;
  /**
   * 內文（Markdown）。
   */
  body: string;
  /**
   * 摘要。
   */
  summary?: string;
  /**
   * 標籤。
   *
   * Items: 標籤。
   */
  tags?: string[];
  /**
   * 人格分區。
   */
  persona?: string;
  /**
   * 血緣。
   *
   * Items: 來源卡片識別碼。
   */
  sources?: string[];
  /**
   * 被這張卡取代的舊卡。
   */
  supersedes?: string;
  /**
   * 已上傳原檔的 blobId；圖片與音訊卡必填。
   */
  assetBlobId?: string;
  /**
   * 客戶端產生的冪等鍵；同一個鍵重送只會建立一張卡。
   */
  clientRequestId: string;
}
/**
 * 以補丁編修卡片。
 */
export interface CardPatchRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "card.patch";
  payload: CardPatchRequestPayload;
}
export interface CardPatchRequestPayload {
  /**
   * 要編修的卡片。
   */
  cardId: string;
  /**
   * 客戶端讀到的 revision；與目前檔案不符時回 conflict。
   */
  baseRevision: string;
  patch: CardPatch;
  /**
   * 冪等鍵；重送不會套用兩次。
   */
  clientRequestId?: string;
}
export interface CardPatch {
  format: CardPatchFormat;
  /**
   * 統一 diff（unified）或整段內文（replace）。
   */
  text: string;
}
/**
 * 列出卡片的待決補丁。
 */
export interface CardPatchesListRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "card.patches.list";
  payload: CardPatchesListRequestPayload;
}
export interface CardPatchesListRequestPayload {
  /**
   * 要列出待決補丁的卡片。
   */
  cardId: string;
  status?: PendingPatchStatus;
}
/**
 * 接受一筆待決補丁，重算 revision 比對後寫入正本。
 */
export interface CardPatchAcceptRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "card.patch.accept";
  payload: CardPatchAcceptRequestPayload;
}
export interface CardPatchAcceptRequestPayload {
  /**
   * 要接受的待決補丁。
   */
  patchId: string;
  /**
   * 冪等鍵。
   */
  clientRequestId: string;
}
/**
 * 拒絕一筆待決補丁，卡片內文不變。
 */
export interface CardPatchRejectRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "card.patch.reject";
  payload: CardPatchRejectRequestPayload;
}
export interface CardPatchRejectRequestPayload {
  /**
   * 要拒絕的待決補丁。
   */
  patchId: string;
  /**
   * 冪等鍵。
   */
  clientRequestId: string;
}
/**
 * 列出卡片的版本歷史。
 */
export interface CardVersionsListRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "card.versions.list";
  payload: CardVersionsListRequestPayload;
}
export interface CardVersionsListRequestPayload {
  /**
   * 要列出版本歷史的卡片。
   */
  cardId: string;
}
/**
 * 讀取版本內文。
 */
export interface CardVersionGetRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "card.version.get";
  payload: CardVersionGetRequestPayload;
}
export interface CardVersionGetRequestPayload {
  /**
   * 卡片識別碼。
   */
  cardId: string;
  /**
   * 要讀取的版本。
   */
  versionId: string;
}
/**
 * 還原到舊版；重放後寫成新版本。
 */
export interface CardVersionRestoreRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "card.version.restore";
  payload: CardVersionRestoreRequestPayload;
}
export interface CardVersionRestoreRequestPayload {
  /**
   * 要還原的卡片。
   */
  cardId: string;
  /**
   * 要還原到的版本。
   */
  versionId: string;
  /**
   * 確認還原時看到的 revision。
   */
  baseRevision: string;
  /**
   * 冪等鍵。
   */
  clientRequestId: string;
}
/**
 * 刪除卡片。
 */
export interface CardDeleteRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "card.delete";
  payload: CardDeleteRequestPayload;
}
export interface CardDeleteRequestPayload {
  /**
   * 要刪除的卡片。
   */
  cardId: string;
  /**
   * 冪等鍵。
   */
  clientRequestId: string;
}
/**
 * 全文搜尋卡片。
 */
export interface CardSearchRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "card.search";
  payload: CardSearchRequestPayload;
}
export interface CardSearchRequestPayload {
  /**
   * 查詢字串；中文用子字串比對。
   */
  query: string;
  /**
   * 只搜這幾種。
   */
  kinds?: CardKind[];
  /**
   * 同時包含這些標籤。
   *
   * Items: 標籤。
   */
  tags?: string[];
  /**
   * 是否包含被取代的卡；預設 false。
   */
  includeSuperseded?: boolean;
  /**
   * 最多回傳幾筆。
   */
  limit?: number;
  /**
   * 上一頁的游標。
   */
  cursor?: string;
}
/**
 * 使用者按保鮮。
 */
export interface CardRefreshRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "card.refresh";
  payload: CardRefreshRequestPayload;
}
export interface CardRefreshRequestPayload {
  /**
   * 要保鮮的卡片。
   */
  cardId: string;
}
/**
 * 列出所有白板。
 */
export interface BoardListRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "board.list";
  payload: BoardListRequestPayload;
}
/**
 * 列出所有白板；不需要參數。
 */
export interface BoardListRequestPayload {}
/**
 * 讀取一份白板。
 */
export interface BoardGetRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "board.get";
  payload: BoardGetRequestPayload;
}
export interface BoardGetRequestPayload {
  /**
   * 要讀取的白板。
   */
  boardId: string;
}
/**
 * 建立空白白板。
 */
export interface BoardCreateRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "board.create";
  payload: BoardCreateRequestPayload;
}
export interface BoardCreateRequestPayload {
  /**
   * 客戶端產生的白板 ULID。
   */
  boardId: string;
  /**
   * 白板名稱。
   */
  title: string;
  /**
   * 冪等鍵；重送只建立一次。
   */
  clientRequestId: string;
}
/**
 * 整份覆寫白板。
 */
export interface BoardSaveRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "board.save";
  payload: BoardSaveRequestPayload;
}
export interface BoardSaveRequestPayload {
  board: BoardDocument;
  /**
   * 客戶端讀到的 updatedAt；與目前檔不符時回 conflict。
   */
  baseUpdatedAt: string;
  /**
   * 冪等鍵。
   */
  clientRequestId?: string;
}
/**
 * 一份白板的完整內容，等於 boards/<id>.json。
 */
export interface BoardDocument {
  schema: 1;
  /**
   * 白板 ULID。
   */
  id: string;
  /**
   * 白板名稱。
   */
  title: string;
  /**
   * 建立時間，RFC 3339。
   */
  createdAt: string;
  /**
   * 最後變更時間；同時是儲存的樂觀鎖。
   */
  updatedAt: string;
  /**
   * 投影清單。
   */
  items: BoardItem[];
  /**
   * 只屬於這份白板的顯式連線。
   */
  edges: BoardEdge[];
  /**
   * 可巢狀的分組。
   */
  groups: BoardGroup[];
}
export interface BoardItem {
  /**
   * 投影的 ULID；不同白板上的同一張卡有不同 id。
   */
  id: string;
  /**
   * 卡片本體的 ULID。
   */
  cardId: string;
  position: BoardPoint;
  size: BoardSize;
  /**
   * 任一個投影釘選時，該卡片的新鮮度固定 100。
   */
  pinned: boolean;
  /**
   * 所屬分組 id；省略代表在畫布上。
   */
  groupId?: string;
}
export interface BoardPoint {
  /**
   * 畫布 x 座標。
   */
  x: number;
  /**
   * 畫布 y 座標。
   */
  y: number;
}
export interface BoardSize {
  /**
   * 投影框寬度。
   */
  width: number;
  /**
   * 投影框高度。
   */
  height: number;
}
export interface BoardEdge {
  /**
   * 連線的 ULID。
   */
  id: string;
  /**
   * 起點投影 id，不是卡片 id。
   */
  from: string;
  /**
   * 終點投影 id，不是卡片 id。
   */
  to: string;
  /**
   * 連線標籤。
   */
  label?: string;
}
export interface BoardGroup {
  /**
   * 分組的 ULID。
   */
  id: string;
  /**
   * 分組名稱。
   */
  label: string;
  /**
   * 上層分組 id；形成循環時拒絕。
   */
  parentId?: string;
}
/**
 * 刪除白板，不刪卡片。
 */
export interface BoardDeleteRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "board.delete";
  payload: BoardDeleteRequestPayload;
}
export interface BoardDeleteRequestPayload {
  /**
   * 要刪除的白板；卡片本體不受影響。
   */
  boardId: string;
}
/**
 * 把卡片投影進白板。
 */
export interface BoardProjectCardRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "board.project_card";
  payload: BoardProjectCardRequestPayload;
}
export interface BoardProjectCardRequestPayload {
  /**
   * 目標白板。
   */
  boardId: string;
  /**
   * 新投影的 ULID。
   */
  itemId: string;
  /**
   * 卡片本體的 ULID。
   */
  cardId: string;
  position: BoardPoint;
  size?: BoardSize;
  /**
   * 放進的分組；省略代表畫布。
   */
  groupId?: string;
  /**
   * 是否釘選；預設 false。
   */
  pinned?: boolean;
}
/**
 * 取消投影，不刪卡片。
 */
export interface BoardUnprojectCardRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "board.unproject_card";
  payload: BoardUnprojectCardRequestPayload;
}
export interface BoardUnprojectCardRequestPayload {
  /**
   * 白板。
   */
  boardId: string;
  /**
   * 要移除的投影；卡片本體不受影響。
   */
  itemId: string;
}
/**
 * 圈選卡片生成新卡並投影到白板；sources 指回來源卡。
 */
export interface BoardCreateCardFromSelectionRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "board.create_card_from_selection";
  payload: BoardCreateCardFromSelectionRequestPayload;
}
export interface BoardCreateCardFromSelectionRequestPayload {
  /**
   * 圈選所在的白板；新卡會投影到這份白板。
   */
  boardId: string;
  /**
   * 來源卡。
   *
   * Items: 被圈選的卡片 ULID；順序保留，重複去掉。
   */
  cardIds: string[];
  /**
   * 新卡標題。
   */
  title: string;
  /**
   * 新卡內文（Markdown）。
   */
  body: string;
  /**
   * 新投影的 ULID。
   */
  itemId: string;
  position: BoardPoint;
  /**
   * 冪等鍵。
   */
  clientRequestId: string;
}
/**
 * 以已上傳的 blobId 匯入圖片或音訊。
 */
export interface MediaImportRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "media.import";
  payload: MediaImportRequestPayload;
}
export interface MediaImportRequestPayload {
  /**
   * 已上傳原檔的 SHA-256 小寫十六進位；先用 POST /v1/blobs 上傳。
   */
  blobId: string;
  /**
   * 語音轉文字的語言，例如 zh-TW；只有音訊使用。
   */
  locale?: string;
  /**
   * 圖片的 OCR 語言，依優先順序。
   *
   * Items: OCR 語言。
   */
  ocrLocales?: string[];
  /**
   * 卡片標題；省略時由文字替身產生。
   */
  title?: string;
  /**
   * 標籤。
   *
   * Items: 標籤。
   */
  tags?: string[];
  /**
   * 人格分區；省略時用 default。
   */
  persona?: string;
}
/**
 * 取得目前上下文。
 */
export interface ContextGetRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "context.get";
  payload: ContextGetRequestPayload;
}
export interface ContextGetRequestPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
}
/**
 * 把卡片追加到上下文後段。
 */
export interface ContextAddCardRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "context.add_card";
  payload: ContextAddCardRequestPayload;
}
export interface ContextAddCardRequestPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 要加入的卡片；只會追加在後段。
   */
  cardId: string;
}
/**
 * 標記移除一張卡，下次壓縮生效。
 */
export interface ContextRemoveCardRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "context.remove_card";
  payload: ContextRemoveCardRequestPayload;
}
export interface ContextRemoveCardRequestPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 要移除的卡片；標記為 pending-removal，下次壓縮生效。
   */
  cardId: string;
}
/**
 * 手動觸發壓縮。
 */
export interface ContextCompactRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "context.compact";
  payload: ContextCompactRequestPayload;
}
export interface ContextCompactRequestPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 給摘要模型的額外指示；使用者手動壓縮時可省略。
   */
  instructions?: string;
}
/**
 * 讀取設定與分級。
 */
export interface SystemSettingsGetRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "system.settings.get";
  payload: SystemSettingsGetRequestPayload;
}
export interface SystemSettingsGetRequestPayload {}
/**
 * 修改設定。
 */
export interface SystemSettingsSetRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "system.settings.set";
  payload: SystemSettingsSetRequestPayload;
}
export interface SystemSettingsSetRequestPayload {
  /**
   * 要修改的設定；一次可以多筆。
   *
   * @minItems 1
   */
  changes: [SettingChange, ...SettingChange[]];
  /**
   * 冪等鍵。
   */
  clientRequestId: string;
}
export interface SettingChange {
  /**
   * 設定鍵。
   */
  key: string;
  value: JSONValue;
}
/**
 * 讀取模組清單與狀態。
 */
export interface SystemModulesGetRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "system.modules.get";
  payload: SystemModulesGetRequestPayload;
}
export interface SystemModulesGetRequestPayload {}
/**
 * 啟用或停用一個模組。
 */
export interface SystemModulesSetEnabledRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "system.modules.set_enabled";
  payload: SystemModulesSetEnabledRequestPayload;
}
export interface SystemModulesSetEnabledRequestPayload {
  /**
   * 模組識別碼。
   */
  moduleId: string;
  /**
   * 是否啟用。
   */
  enabled: boolean;
  /**
   * 冪等鍵。
   */
  clientRequestId: string;
}
/**
 * 讀取供應商、角色與解析結果。
 */
export interface SystemModelsGetRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "system.models.get";
  payload: SystemModelsGetRequestPayload;
}
export interface SystemModelsGetRequestPayload {}
/**
 * 設定供應商與角色；只影響新對話。
 */
export interface SystemModelsSetRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "system.models.set";
  payload: SystemModelsSetRequestPayload;
}
export interface SystemModelsSetRequestPayload {
  /**
   * 要套用的供應商清單；省略代表不改。
   */
  providers?: ModelProviderInfo[];
  /**
   * 要套用的角色設定；省略代表不改。
   */
  roles?: ModelRoleSelection[];
  /**
   * 冪等鍵。
   */
  clientRequestId: string;
}
export interface ModelProviderInfo {
  /**
   * 供應商識別碼；由使用者命名，穩定不變。
   */
  providerId: string;
  kind: ModelProviderKind;
  /**
   * 顯示名稱。
   */
  displayName: string;
  /**
   * OpenAI 相容端點的基底網址；直接供應商可省略。
   */
  baseUrl?: string;
  /**
   * 鑰匙圈的帳號名；不是金鑰本身。
   */
  credentialRef?: string;
  /**
   * 這個供應商提供的模型。
   */
  models: ModelInfo[];
}
export interface ModelInfo {
  /**
   * 供應商的模型識別碼。
   */
  modelId: string;
  /**
   * 給人看的名稱。
   */
  displayName?: string;
  /**
   * 上下文上限。
   */
  contextWindow: number;
  /**
   * 輸出上限。
   */
  maxOutputTokens?: number;
  /**
   * 接受的輸入種類。
   */
  input: ModelInputKind[];
}
export interface ModelRoleSelection {
  role: ModelRole;
  mode: ModelRoleMode;
  ref?: ModelRef;
}
export interface ModelRef {
  /**
   * 供應商識別碼。
   */
  providerId: string;
  /**
   * 模型識別碼。
   */
  modelId: string;
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
 * 列出通知。
 */
export interface NotificationListRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "notification.list";
  payload: NotificationListRequestPayload;
}
export interface NotificationListRequestPayload {
  /**
   * 最多回傳幾筆，預設 50。
   */
  limit?: number;
  /**
   * 回傳 createdAt 早於此游標的通知；用上一頁的 nextCursor。
   */
  before?: string;
  /**
   * 只要未讀。
   */
  unreadOnly?: boolean;
}
/**
 * 標記通知已讀。
 */
export interface NotificationMarkReadRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "notification.mark_read";
  payload: NotificationMarkReadRequestPayload;
}
export interface NotificationMarkReadRequestPayload {
  /**
   * 要標記已讀的通知；最多 500 筆。
   *
   * @maxItems 500
   *
   * Items: 通知識別碼。
   */
  ids?: string[];
  /**
   * 一次清空全部未讀；ids 與 all 至少給一個。
   */
  all?: boolean;
}
/**
 * 把通知轉成一張卡片。
 */
export interface NotificationCreateCardRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "notification.create_card";
  payload: NotificationCreateCardRequestPayload;
}
export interface NotificationCreateCardRequestPayload {
  /**
   * 要轉成卡片的通知；同一則重送回同一張卡。
   */
  notificationId: string;
}
/**
 * 未認證裝置建立配對請求。
 */
export interface PairingBeginRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "pairing.begin";
  payload: PairingBeginRequestPayload;
}
export interface PairingBeginRequestPayload {
  /**
   * 裝置想在 Mac 上顯示的名稱。
   */
  deviceName: string;
  kind: DeviceKind;
}
/**
 * 在提出配對請求的同一連線領取核准結果。
 */
export interface PairingCompleteRequest {
  v: 1;
  kind: "request";
  /**
   * 客戶端產生的請求識別碼；同一條連線內用來重送與去重。
   */
  id: string;
  type: "pairing.complete";
  payload: PairingCompleteRequestPayload;
}
export interface PairingCompleteRequestPayload {
  /**
   * 只能由提出配對請求的同一條連線領取結果。
   */
  pairingRequestId: string;
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
  /**
   * 目前的事件 epoch。客戶端重連時先比對它；不同就代表上次的事件歷史已經斷了，訂閱時不要帶 lastSeq。
   */
  epoch: string;
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
  /**
   * HTTP blob 單檔的上傳上限；省略代表沒有提供 blob 端點。
   */
  maxBlobBytes?: number;
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
  /**
   * 是否提供卡片類訊息。
   */
  cards?: boolean;
  /**
   * 是否提供上下文類訊息。
   */
  context?: boolean;
  /**
   * 是否提供會話封存與刪除。
   */
  archive?: boolean;
  /**
   * 是否提供圖片與音訊的匯入。
   */
  media?: boolean;
  /**
   * 是否提供 HTTP blob 上傳與下載。
   */
  blobs?: boolean;
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
   * 這個序號所屬的事件 epoch。與請求的 epoch 不同時，resyncRequired 一定是 true。
   */
  epoch: string;
  /**
   * 是否附上完整快照；false 表示接下來只會補送 seq 之後的耐久事件。
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
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
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
  archive?: SessionArchive;
}
export interface SessionArchive {
  /**
   * 開始封存倒數的時間，RFC 3339。
   */
  archivedAt: string;
  /**
   * 倒數結束、預定刪除的時間，RFC 3339。
   */
  purgeAt: string;
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
   * 這個序號所屬的事件 epoch。與請求的 epoch 不同時，resyncRequired 一定是 true。
   */
  epoch: string;
  /**
   * 是否附上完整快照；false 表示接下來只會補送 seq 之後的耐久事件。
   */
  resyncRequired: boolean;
  snapshot?: SessionSnapshot;
}
export interface SessionSnapshot {
  session: SessionSummary;
  /**
   * 最新一段已完成的歷史，依時間由舊到新。
   */
  entries: TranscriptEntry[];
  activeTurn?: TurnState;
  pendingApproval?: ApprovalRequest;
  streaming?: StreamingMessage;
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
  details?: TurnErrorDetails;
}
/**
 * 回合失敗的機器可讀補充資訊。不能放金鑰、Token 或個人資料；給人看的說明放在 message。
 */
export interface TurnErrorDetails {
  /**
   * 機器可讀的原因碼，例如 credential_missing、credential_invalid、quota_exceeded、provider_timeout、connection_failed、model_not_configured。開放字串，閘道可以帶其他診斷碼。
   */
  reason?: string;
  /**
   * 建議的重試等待毫秒數；只在可以判斷時帶上。
   */
  retryAfterMs?: number;
  /**
   * 出錯的設定或請求欄位，例如 roles。
   */
  field?: string;
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
 * 訂閱快照中進行中的助理訊息。只在該會話有進行中的回合時出現；不落地，重啟後消失。
 */
export interface StreamingMessage {
  /**
   * 正在生長的助理訊息識別碼。
   */
  messageId: string;
  /**
   * 所屬回合。
   */
  turnId: string;
  /**
   * 到快照邊界為止已生成的文字。客戶端用它取代本地顯示中的文字，不是附加。
   */
  text: string;
  /**
   * 開始生成時間，RFC 3339。
   */
  startedAt: string;
  /**
   * 文字是否因緩衝上限被截斷；省略代表沒有。最終訊息完成事件仍帶完整文字。
   */
  truncated?: boolean;
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
 * 封存倒數已開始。
 */
export interface SessionArchiveResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "session.archive";
  payload: SessionArchiveResponsePayload;
}
export interface SessionArchiveResponsePayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  archive: SessionArchive;
}
/**
 * 取消封存的結果。
 */
export interface SessionUnarchiveResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "session.unarchive";
  payload: SessionUnarchiveResponsePayload;
}
export interface SessionUnarchiveResponsePayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 是否已取消封存。
   */
  unarchived: boolean;
}
/**
 * 預覽結果。
 */
export interface SessionDeletionPreviewResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "session.deletion_preview";
  payload: SessionDeletionPreviewResponsePayload;
}
export interface SessionDeletionPreviewResponsePayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 連同支線的整個子樹。
   *
   * Items: 會話識別碼。
   */
  subtreeSessionIds: string[];
  /**
   * 會一起刪除的專屬卡片數。
   */
  exclusiveCards: number;
  /**
   * 仍被其他會話或白板引用的卡片數；不會刪除。
   */
  sharedCards: number;
  /**
   * 會一起刪除的原檔數。
   */
  assets: number;
}
/**
 * 實際刪除的數量。
 */
export interface SessionDeleteResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "session.delete";
  payload: SessionDeleteResponsePayload;
}
export interface SessionDeleteResponsePayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 實際刪除的子樹。
   *
   * Items: 會話識別碼。
   */
  deletedSessionIds: string[];
  /**
   * 實際刪除的專屬卡片數。
   */
  deletedCards: number;
  /**
   * 實際刪除的原檔數。
   */
  deletedAssets: number;
}
/**
 * 卡片列表。
 */
export interface CardListResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "card.list";
  payload: CardListResponsePayload;
}
export interface CardListResponsePayload {
  /**
   * 依建立時間由新到舊。
   */
  cards: CardSummary[];
  /**
   * 下一頁游標；沒有更多資料時省略。
   */
  nextCursor?: string;
}
export interface CardSummary {
  /**
   * 卡片識別碼。
   */
  cardId: string;
  kind: CardKind;
  /**
   * 標題。
   */
  title: string;
  /**
   * 一兩句話的摘要。
   */
  summary?: string;
  /**
   * 標籤，保留原本順序。
   *
   * Items: 標籤。
   */
  tags: string[];
  /**
   * 人格分區，預設 default。
   */
  persona: string;
  /**
   * 建立時間，RFC 3339。
   */
  createdAt: string;
  /**
   * 最後更新時間，RFC 3339。
   */
  updatedAt?: string;
  /**
   * 新鮮度 0 到 100；檢視欄與卡片庫用它褪色。
   */
  freshness: number;
  lifecycle: CardLifecycle;
  /**
   * 取代這張卡的新卡；有值時不進預設搜尋與列表。
   */
  supersededBy?: string;
  asset?: CardAsset;
  /**
   * 檔案格式不符，索引無法解析；true 時不提供內文。
   */
  broken?: boolean;
  /**
   * 格式不符的原因，給人看。
   */
  brokenReason?: string;
}
export interface CardAsset {
  /**
   * 內容雜湊（SHA-256 小寫十六進位），也是 HTTP blob 的識別碼。
   */
  blobId: string;
  /**
   * 例如 image/png、audio/mp4。
   */
  mediaType: string;
  /**
   * 原檔位元組數。
   */
  sizeBytes: number;
}
/**
 * 卡片的完整內容。
 */
export interface CardGetResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "card.get";
  payload: CardGetResponsePayload;
}
export interface CardGetResponsePayload {
  card: Card;
}
export interface Card {
  /**
   * 卡片識別碼。
   */
  cardId: string;
  kind: CardKind;
  /**
   * 標題。
   */
  title: string;
  /**
   * 摘要。
   */
  summary?: string;
  /**
   * 內文（Markdown）；補丁編輯的對象。
   */
  body: string;
  /**
   * 標籤。
   *
   * Items: 標籤。
   */
  tags: string[];
  /**
   * 人格分區。
   */
  persona: string;
  /**
   * 建立時間，RFC 3339。
   */
  createdAt: string;
  /**
   * 最後更新時間，RFC 3339。
   */
  updatedAt?: string;
  /**
   * 新鮮度 0 到 100。
   */
  freshness: number;
  lifecycle: CardLifecycle;
  /**
   * 取代這張卡的新卡。
   */
  supersededBy?: string;
  /**
   * 被這張卡取代的舊卡。
   */
  supersedes?: string;
  /**
   * 血緣：由哪些卡生成。
   *
   * Items: 來源卡片識別碼。
   */
  sources: string[];
  asset?: CardAsset;
  links: CardLinks;
  /**
   * 正規化內容的 SHA-256；補丁的樂觀鎖。
   */
  revision: string;
}
export interface CardLinks {
  /**
   * 內文 [[ ]] 的目標，依出現順序。
   *
   * Items: 目標卡片或標題。
   */
  outgoing: string[];
  /**
   * 連到這張卡的卡片。
   *
   * Items: 來源卡片識別碼。
   */
  backlinks: string[];
}
/**
 * 建立的卡片。
 */
export interface CardCreateResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "card.create";
  payload: CardCreateResponsePayload;
}
export interface CardCreateResponsePayload {
  card: CardSummary;
}
/**
 * 編修後的卡片。
 */
export interface CardPatchResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "card.patch";
  payload: CardPatchResponsePayload;
}
export interface CardPatchResponsePayload {
  card: Card;
}
/**
 * 待決補丁清單。
 */
export interface CardPatchesListResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "card.patches.list";
  payload: CardPatchesListResponsePayload;
}
export interface CardPatchesListResponsePayload {
  /**
   * 依建立時間由舊到新。
   */
  patches: PendingCardPatch[];
}
export interface PendingCardPatch {
  /**
   * 待決補丁識別碼。
   */
  patchId: string;
  /**
   * 目標卡片。
   */
  cardId: string;
  /**
   * 提出時讀到的 revision；接受時會重算比對。
   */
  baseRevision: string;
  patch: CardPatch;
  status: PendingPatchStatus;
  /**
   * 補丁摘要。
   */
  summary?: string;
  /**
   * 來源對話。
   */
  sourceConversationId?: string;
  /**
   * 來源回合。
   */
  sourceTurnId?: string;
  /**
   * 建立時間（ISO 8601）。
   */
  createdAt: string;
  /**
   * 決定時間（ISO 8601）；尚未決定時省略。
   */
  decidedAt?: string;
}
/**
 * 接受結果與更新後的卡片。
 */
export interface CardPatchAcceptResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "card.patch.accept";
  payload: CardPatchAcceptResponsePayload;
}
export interface CardPatchAcceptResponsePayload {
  patch: PendingCardPatch;
  card: Card;
}
/**
 * 拒絕結果。
 */
export interface CardPatchRejectResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "card.patch.reject";
  payload: CardPatchRejectResponsePayload;
}
export interface CardPatchRejectResponsePayload {
  patch: PendingCardPatch;
}
/**
 * 版本歷史。
 */
export interface CardVersionsListResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "card.versions.list";
  payload: CardVersionsListResponsePayload;
}
export interface CardVersionsListResponsePayload {
  /**
   * 依序號由小到大。
   */
  versions: CardVersion[];
}
export interface CardVersion {
  /**
   * 版本識別碼。
   */
  versionId: string;
  /**
   * 卡片識別碼。
   */
  cardId: string;
  /**
   * 遞增序號。
   */
  seq: number;
  kind: CardVersionKind;
  /**
   * 這一版的 revision。
   */
  revision: string;
  /**
   * 內文 SHA-256。
   */
  bodyHash: string;
  /**
   * 補丁或還原所根據的 revision。
   */
  baseRevision?: string;
  /**
   * 補丁格式。
   */
  patchFormat?: string;
  /**
   * 補丁內容或整段內文。
   */
  patchText?: string;
  /**
   * 建立時間（ISO 8601）。
   */
  createdAt: string;
  /**
   * 被合併的版本數。
   */
  mergedCount?: number;
  /**
   * 合併的序號範圍。
   */
  mergedSeqRange?: string;
}
/**
 * 重放後的版本內文。
 */
export interface CardVersionGetResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "card.version.get";
  payload: CardVersionGetResponsePayload;
}
export interface CardVersionGetResponsePayload {
  /**
   * 重放後的版本內文。
   */
  body: string;
}
/**
 * 還原後的卡片與新版本。
 */
export interface CardVersionRestoreResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "card.version.restore";
  payload: CardVersionRestoreResponsePayload;
}
export interface CardVersionRestoreResponsePayload {
  card: Card;
  version: CardVersion;
}
/**
 * 刪除結果與連帶刪除的原檔數。
 */
export interface CardDeleteResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "card.delete";
  payload: CardDeleteResponsePayload;
}
export interface CardDeleteResponsePayload {
  /**
   * 已刪除的卡片。
   */
  cardId: string;
  /**
   * 連帶刪除的原檔數；還有其他卡引用時是 0。
   */
  deletedAssets: number;
}
/**
 * 搜尋結果。
 */
export interface CardSearchResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "card.search";
  payload: CardSearchResponsePayload;
}
export interface CardSearchResponsePayload {
  /**
   * 依分數由高到低。
   */
  hits: CardSearchHit[];
  /**
   * 下一頁游標。
   */
  nextCursor?: string;
}
export interface CardSearchHit {
  card: CardSummary;
  /**
   * 相關度分數，越大越前面。
   */
  score: number;
  /**
   * 命中片段；不含完整內文。
   */
  snippet: string;
}
/**
 * 保鮮後的新鮮度。
 */
export interface CardRefreshResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "card.refresh";
  payload: CardRefreshResponsePayload;
}
export interface CardRefreshResponsePayload {
  /**
   * 卡片識別碼。
   */
  cardId: string;
  /**
   * 保鮮後的新鮮度，固定 100。
   */
  freshness: number;
}
/**
 * 白板列表。
 */
export interface BoardListResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "board.list";
  payload: BoardListResponsePayload;
}
export interface BoardListResponsePayload {
  /**
   * 依最後變更時間排序。
   */
  boards: BoardSummary[];
}
export interface BoardSummary {
  /**
   * 白板 ULID。
   */
  id: string;
  /**
   * 白板名稱。
   */
  title: string;
  /**
   * 最後變更時間，RFC 3339。
   */
  updatedAt: string;
  /**
   * 投影數量。
   */
  itemCount: number;
}
/**
 * 白板完整內容。
 */
export interface BoardGetResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "board.get";
  payload: BoardGetResponsePayload;
}
export interface BoardGetResponsePayload {
  board: BoardDocument;
}
/**
 * 建立的白板。
 */
export interface BoardCreateResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "board.create";
  payload: BoardCreateResponsePayload;
}
export interface BoardCreateResponsePayload {
  board: BoardDocument;
}
/**
 * 儲存後的白板。
 */
export interface BoardSaveResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "board.save";
  payload: BoardSaveResponsePayload;
}
export interface BoardSaveResponsePayload {
  board: BoardDocument;
}
/**
 * 刪除結果。
 */
export interface BoardDeleteResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "board.delete";
  payload: BoardDeleteResponsePayload;
}
export interface BoardDeleteResponsePayload {
  /**
   * 是否真的刪掉了檔案。
   */
  deleted: boolean;
}
/**
 * 投影後的白板。
 */
export interface BoardProjectCardResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "board.project_card";
  payload: BoardProjectCardResponsePayload;
}
export interface BoardProjectCardResponsePayload {
  board: BoardDocument;
}
/**
 * 取消後的白板。
 */
export interface BoardUnprojectCardResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "board.unproject_card";
  payload: BoardUnprojectCardResponsePayload;
}
export interface BoardUnprojectCardResponsePayload {
  board: BoardDocument;
}
/**
 * 新卡與更新後的白板。
 */
export interface BoardCreateCardFromSelectionResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "board.create_card_from_selection";
  payload: BoardCreateCardFromSelectionResponsePayload;
}
export interface BoardCreateCardFromSelectionResponsePayload {
  board: BoardDocument;
  /**
   * 新卡的 ULID；其 sources 指回被圈選的卡。
   */
  cardId: string;
}
/**
 * 匯入結果與文字替身狀態。
 */
export interface MediaImportResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "media.import";
  payload: MediaImportResponsePayload;
}
export interface MediaImportResponsePayload {
  /**
   * 建立的卡片；同一個 blobId 重送回同一張卡。
   */
  cardId: string;
  kind: MediaKind;
  textStandIn: MediaTextStandIn;
  /**
   * 這個 blobId 已經有卡片，這次接回既有的卡片。
   */
  deduped: boolean;
}
export interface MediaTextStandIn {
  sources: MediaTextStandInSources;
  /**
   * 無法產生的部分；完整時是空陣列。卡片內文的「缺少的部分」與這裡一致。
   *
   * Items: 給人看的缺少說明。
   */
  missingParts: string[];
}
/**
 * 文字替身每一塊的來源；缺哪一塊要說清楚。
 */
export interface MediaTextStandInSources {
  ocr: MediaLocalTextSource;
  description: MediaModelTextSource;
  transcript: MediaLocalTextSource;
  summary: MediaModelTextSource;
}
/**
 * 上下文視圖。
 */
export interface ContextGetResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "context.get";
  payload: ContextGetResponsePayload;
}
export interface ContextGetResponsePayload {
  context: ContextView;
}
export interface ContextView {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 每次變動加 1；客戶端丟棄較小的版本。
   */
  version: number;
  /**
   * 依上下文實際順序。
   */
  entries: ContextEntry[];
  /**
   * 目前佔用的估算值；等於 entries 的 tokenEstimate 加總。
   */
  usedTokens: number;
  /**
   * 可用預算（contextWindow 減去保留給輸出的量）。
   */
  budgetTokens: number;
  /**
   * 目前主模型的上下文上限。
   */
  contextWindow: number;
  /**
   * 觸發壓縮的比例，預設 0.75。
   */
  compactionThreshold: number;
  /**
   * 上次壓縮時間，RFC 3339。
   */
  lastCompactedAt?: string;
}
/**
 * 上下文裡的一個項目。dealProbability／dealSource 只有第 4 層的開局卡會帶。
 */
export interface ContextEntry {
  /**
   * 項目識別碼；工作上下文也可以有代表項。
   */
  entryId: string;
  layer: ContextLayer;
  /**
   * 對應的卡片；工作上下文與高速變動層沒有。
   */
  cardId?: string;
  /**
   * 給人看的標題。
   */
  title: string;
  /**
   * token 估算。
   */
  tokenEstimate: number;
  state: ContextEntryState;
  /**
   * 在上下文中的位置，從 0 開始。
   */
  position: number;
  /**
   * 開局發牌時 System One 給的相關機率；刻意不發牌的卡省略。0.4–0.6 是『可能相關』區間，不自動發。
   */
  dealProbability?: number;
  dealSource?: ContextDealSource;
}
/**
 * 加入後的上下文視圖。
 */
export interface ContextAddCardResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "context.add_card";
  payload: ContextAddCardResponsePayload;
}
export interface ContextAddCardResponsePayload {
  context: ContextView;
}
/**
 * 標記後的上下文視圖。
 */
export interface ContextRemoveCardResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "context.remove_card";
  payload: ContextRemoveCardResponsePayload;
}
export interface ContextRemoveCardResponsePayload {
  context: ContextView;
}
/**
 * 壓縮已排入。
 */
export interface ContextCompactResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "context.compact";
  payload: ContextCompactResponsePayload;
}
export interface ContextCompactResponsePayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 是否已排入壓縮；完成時會送 context.compacted。
   */
  scheduled: boolean;
}
/**
 * 設定清單。
 */
export interface SystemSettingsGetResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "system.settings.get";
  payload: SystemSettingsGetResponsePayload;
}
export interface SystemSettingsGetResponsePayload {
  /**
   * 所有分級的設定。
   */
  settings: SettingItem[];
}
export interface SettingItem {
  /**
   * 設定鍵。
   */
  key: string;
  value: JSONValue;
  level: SettingLevel;
  /**
   * 給人看的標題。
   */
  title?: string;
  /**
   * 給人看的說明。
   */
  description?: string;
  /**
   * 最後更新時間，RFC 3339。
   */
  updatedAt: string;
}
/**
 * 已套用的設定。
 */
export interface SystemSettingsSetResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "system.settings.set";
  payload: SystemSettingsSetResponsePayload;
}
export interface SystemSettingsSetResponsePayload {
  /**
   * 已套用的設定。
   */
  applied: SettingItem[];
  /**
   * 是否需要人工核准；M1 由客戶端（人）修改時固定 false。
   */
  requiresApproval: boolean;
  /**
   * 需要核准時的審批識別碼；M1 不使用。
   */
  approvalId?: string;
}
/**
 * 模組清單。
 */
export interface SystemModulesGetResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "system.modules.get";
  payload: SystemModulesGetResponsePayload;
}
export interface SystemModulesGetResponsePayload {
  /**
   * 依模組識別碼排序。
   */
  modules: ModuleInfo[];
}
export interface ModuleInfo {
  /**
   * 模組識別碼。
   */
  moduleId: string;
  /**
   * 顯示名稱。
   */
  name: string;
  /**
   * 版本。
   */
  version: string;
  /**
   * 使用者是否啟用。
   */
  enabled: boolean;
  state: ModuleState;
  /**
   * 載入或啟用失敗的原因。
   */
  failure?: string;
  /**
   * 模組登記的協定命名空間。
   *
   * Items: 命名空間前綴。
   */
  protocolPrefixes: string[];
  /**
   * 設定宣告，不含值。
   */
  settings: ModuleSettingDeclaration[];
}
export interface ModuleSettingDeclaration {
  /**
   * 設定鍵。
   */
  key: string;
  /**
   * 標題。
   */
  title: string;
  kind: SettingKind;
  level: SettingLevel;
  /**
   * 說明。
   */
  description?: string;
}
/**
 * 更新後的模組資訊。
 */
export interface SystemModulesSetEnabledResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "system.modules.set_enabled";
  payload: SystemModulesSetEnabledResponsePayload;
}
export interface SystemModulesSetEnabledResponsePayload {
  module: ModuleInfo;
}
/**
 * 目前的模型設定。
 */
export interface SystemModelsGetResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "system.models.get";
  payload: SystemModelsState;
}
export interface SystemModelsState {
  /**
   * 供應商清單，不含金鑰。
   */
  providers: ModelProviderInfo[];
  /**
   * 角色設定。
   */
  roles: ModelRoleSelection[];
  /**
   * 退回規則套用後的實際使用。
   */
  resolved: ResolvedModelRole[];
}
export interface ResolvedModelRole {
  role: ModelRole;
  source: ModelRoleSource;
  ref?: ModelRef;
}
/**
 * 套用後的模型設定。
 */
export interface SystemModelsSetResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "system.models.set";
  payload: SystemModelsState;
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
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
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
 * 助理文字增量；不落地、不佔序號，只沿著目前的連線送出。
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
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
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
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
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
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
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
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
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
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
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
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
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
 * 卡片建立、更新、刪除、保鮮或重新索引；掛在 system 串流。
 */
export interface CardChangedEvent {
  v: 1;
  kind: "event";
  type: "card.changed";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: CardChangedEventPayload;
}
export interface CardChangedEventPayload {
  /**
   * 卡片識別碼。
   */
  cardId: string;
  change: CardChange;
  /**
   * 變更後的 revision；刪除時省略。
   */
  revision?: string;
  /**
   * 變更後的新鮮度；只有保鮮與載入會帶。
   */
  freshness?: number;
}
/**
 * 白板建立、更新或刪除；掛在 system 串流。
 */
export interface BoardChangedEvent {
  v: 1;
  kind: "event";
  type: "board.changed";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: BoardChangedEventPayload;
}
export interface BoardChangedEventPayload {
  /**
   * 變更的白板。
   */
  boardId: string;
  change: BoardChange;
  board?: BoardDocument;
  /**
   * 受影響的卡片。
   *
   * Items: 受影響的卡片，用來同步釘選與新鮮度。
   */
  cardIds?: string[];
}
/**
 * 上下文內容變了；掛在會話串流。
 */
export interface ContextChangedEvent {
  v: 1;
  kind: "event";
  type: "context.changed";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: ContextChangedEventPayload;
}
export interface ContextChangedEventPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  context: ContextView;
}
/**
 * 一次壓縮完成；掛在會話串流。
 */
export interface ContextCompactedEvent {
  v: 1;
  kind: "event";
  type: "context.compacted";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: ContextCompactedEventPayload;
}
export interface ContextCompactedEventPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 壓縮產出的短期記憶卡。
   */
  summaryCardId: string;
  /**
   * 壓縮前佔用。
   */
  beforeTokens: number;
  /**
   * 壓縮後佔用。
   */
  afterTokens: number;
  /**
   * 完成時間，RFC 3339。
   */
  compactedAt: string;
}
/**
 * 會話開始封存倒數；system 與會話串流各送一則。
 */
export interface SessionArchivedEvent {
  v: 1;
  kind: "event";
  type: "session.archived";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: SessionArchivedEventPayload;
}
export interface SessionArchivedEventPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  archive: SessionArchive;
}
/**
 * 會話取消封存。
 */
export interface SessionUnarchivedEvent {
  v: 1;
  kind: "event";
  type: "session.unarchived";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: SessionUnarchivedEventPayload;
}
export interface SessionUnarchivedEventPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
}
/**
 * 會話刪除完成；system 串流上的那一則讓列表移除。
 */
export interface SessionDeletedEvent {
  v: 1;
  kind: "event";
  type: "session.deleted";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: SessionDeletedEventPayload;
}
export interface SessionDeletedEventPayload {
  /**
   * 會話識別碼。
   */
  sessionId: string;
  /**
   * 整個子樹。
   *
   * Items: 會話識別碼。
   */
  deletedSessionIds: string[];
  /**
   * 刪除的專屬卡片數。
   */
  deletedCards: number;
  /**
   * 刪除的原檔數。
   */
  deletedAssets: number;
}
/**
 * 設定變更；掛在 system 串流。
 */
export interface SystemSettingsChangedEvent {
  v: 1;
  kind: "event";
  type: "system.settings.changed";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: SystemSettingsChangedEventPayload;
}
export interface SystemSettingsChangedEventPayload {
  /**
   * 變更後的設定。
   */
  changes: SettingItem[];
  /**
   * 變更者，例如 user:<deviceId>、agent:<conversationId>、system。
   */
  changedBy: string;
  /**
   * 變更時間，RFC 3339。
   */
  changedAt: string;
}
/**
 * 模組狀態改變；掛在 system 串流。
 */
export interface SystemModulesChangedEvent {
  v: 1;
  kind: "event";
  type: "system.modules.changed";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: SystemModulesChangedEventPayload;
}
export interface SystemModulesChangedEventPayload {
  module: ModuleInfo;
}
/**
 * 模型設定變更；掛在 system 串流。
 */
export interface SystemModelsChangedEvent {
  v: 1;
  kind: "event";
  type: "system.models.changed";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: SystemModelsState;
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
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
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
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
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
 * 通知清單。
 */
export interface NotificationListResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "notification.list";
  payload: NotificationListResponsePayload;
}
export interface NotificationListResponsePayload {
  /**
   * 依 createdAt 由新到舊。
   *
   * @maxItems 200
   */
  notifications: CardiaryNotification[];
  /**
   * 目前未讀總數。
   */
  totalUnread: number;
  /**
   * 下一頁的游標；沒有更多時省略。
   */
  nextCursor?: string;
}
/**
 * 一則通知。kind 各自的結構化資料在 payload，例如蒸餾的逐項變更清單與復原資訊。
 */
export interface CardiaryNotification {
  /**
   * 通知識別碼。
   */
  notificationId: string;
  kind: NotificationKind;
  /**
   * 給人看的標題，例如「蒸餾 2026-11-16：新增 3」。
   */
  title: string;
  /**
   * Markdown 內文；客戶端不渲染原始 HTML。
   */
  body: string;
  /**
   * 建立時間，RFC 3339。
   */
  createdAt: string;
  /**
   * 已讀時間，RFC 3339；未讀省略。
   */
  readAt?: string;
  /**
   * 來源排程；不是排程產生的通知省略。
   */
  sourceScheduleId?: string;
  /**
   * 來源背景對話；沒有省略。
   */
  sourceConversationId?: string;
  payload: {
    [k: string]: JSONValue;
  };
}
/**
 * 標記結果與剩餘未讀數。
 */
export interface NotificationMarkReadResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "notification.mark_read";
  payload: NotificationMarkReadResponsePayload;
}
export interface NotificationMarkReadResponsePayload {
  /**
   * 這次標記了幾則。
   */
  updated: number;
  /**
   * 標記後的未讀總數。
   */
  totalUnread: number;
}
/**
 * 轉出的卡片。
 */
export interface NotificationCreateCardResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "notification.create_card";
  payload: NotificationCreateCardResponsePayload;
}
export interface NotificationCreateCardResponsePayload {
  card: CardSummary;
  /**
   * 這則通知已經轉過，回同一張卡。
   */
  deduped: boolean;
}
/**
 * 通知變了；掛在 system 串流。
 */
export interface NotificationChangedEvent {
  v: 1;
  kind: "event";
  type: "notification.changed";
  /**
   * 串流識別碼，system 或 session:<sessionId>。
   */
  stream: string;
  /**
   * 耐久事件是這個串流在同一個 epoch 內的單調遞增序號，從 1 開始；非耐久事件填目前的耐久邊界。
   */
  seq: number;
  /**
   * 主機送出時間，RFC 3339。
   */
  emittedAt: string;
  payload: NotificationChangedEventPayload;
}
/**
 * 通知變了（新增或已讀狀態改變）；upsert 語意，掛在 system 串流。
 */
export interface NotificationChangedEventPayload {
  notification: CardiaryNotification;
}
/**
 * 配對短碼與期限，短碼只供人核對。
 */
export interface PairingBeginResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "pairing.begin";
  payload: PairingBeginResponsePayload;
}
export interface PairingBeginResponsePayload {
  /**
   * 待處理配對請求。
   */
  pairingRequestId: string;
  /**
   * 顯示給使用者與 Mac 核對的短碼；不得作為授權憑證。
   */
  code: string;
  /**
   * 請求過期時間。
   */
  expiresAt: string;
}
/**
 * 配對結果；成功時帶一次 deviceToken。
 */
export interface PairingCompleteResponse {
  v: 1;
  kind: "response";
  /**
   * 對應的請求 id。
   */
  replyTo: string;
  type: "pairing.complete";
  payload: PairingCompleteResponsePayload;
}
/**
 * 配對成功；連線隨即關閉，客戶端以 deviceToken 重連。
 */
export interface PairingCompleteResponsePayload {
  /**
   * 配對成功的裝置識別碼。
   */
  deviceId: string;
  /**
   * 裝置想在 Mac 上顯示的名稱。
   */
  deviceName: string;
  /**
   * 裝置專屬的存取 Token；只在這個回應回一次，主機只存 SHA-256。之後每次連線在 system.hello 的 payload 帶它。
   */
  deviceToken: string;
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
