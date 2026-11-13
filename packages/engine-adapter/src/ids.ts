/**
 * 轉接層對外使用的識別碼都是不透明字串，由轉接層簽發與解讀。
 * 其他套件只負責保存與傳遞，不拆解內容。
 */

/** 對話識別碼。 */
export type ConversationId = string;

/** 一輪回應的識別碼；一輪包含模型輸出與其中的工具呼叫。 */
export type TurnId = string;

/** 對話中一則訊息的識別碼。 */
export type MessageId = string;

/** 一次工具呼叫的識別碼。 */
export type ToolCallId = string;

/** 工具名稱；同一名稱在同一時間只有一個作用中的版本。 */
export type ToolName = string;

/** 工具組識別碼；同一模組的不同版本共用同一個識別碼。 */
export type ToolBundleId = string;

/** 審批請求識別碼。 */
export type ApprovalRequestId = string;

/** ISO 8601 時間字串（UTC）。 */
export type IsoInstant = string;

/** 對話事件序號；同一對話內嚴格遞增的整數。 */
export type EventSeq = number;

/** 對話中的一個位置，可作為分岔點。由轉接層簽發，內容不透明。 */
export type ConversationCursor = string;
