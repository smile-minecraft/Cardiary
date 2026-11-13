import type { ApprovalRequestDraft, ApprovalResolution } from "./approval.js";
import type { ConversationId, ToolBundleId, ToolCallId, ToolName, TurnId } from "./ids.js";
import type { JsonSchema, JsonValue } from "./json.js";

/**
 * 工具的重跑安全性。
 *
 * `safe` 表示工具被中斷後重跑一次不會重複產生副作用（或有冪等保護）；
 * `unsafe` 表示引擎重啟後不得自動重跑，只能回報 `interrupted` 讓模型決定下一步。
 * 工具必須明確宣告，沒有預設值。
 */
export type ReplaySafety = "safe" | "unsafe";

/** 工具結果的診斷碼；引擎與轉接層補上的狀況用這些值表達。 */
export type ToolDiagnosticCode =
  | "interrupted"
  | "paused"
  | "cancelled"
  | "timed-out"
  | "output-truncated"
  | "permission-denied"
  | "approval-denied"
  | "approval-expired"
  | "tool-unavailable";

/** 工具結果的診斷訊息。 */
export interface ToolDiagnostic {
  readonly code: ToolDiagnosticCode;
  readonly message?: string;
}

/** 工具回傳給模型的內容。 */
export type ToolContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "json"; readonly value: JsonValue }
  | { readonly type: "image"; readonly assetId: string; readonly mediaType: string };

/** 工具執行成功。 */
export interface ToolSuccess {
  readonly ok: true;
  readonly content: readonly ToolContent[];
  readonly diagnostics?: readonly ToolDiagnostic[];
  /** 給客戶端介面用的資料；模型看不到。 */
  readonly metadata?: JsonValue;
}

/** 工具執行失敗；訊息會回到模型，讓它決定重試或改路徑。 */
export interface ToolFailure {
  readonly ok: false;
  readonly message: string;
  readonly diagnostics?: readonly ToolDiagnostic[];
  readonly metadata?: JsonValue;
}

export type ToolOutcome = ToolSuccess | ToolFailure;

/** 長時間工具的進度回報；由轉接層轉成事件。 */
export interface ToolProgress {
  readonly message?: string;
  readonly fraction?: number;
  readonly data?: JsonValue;
}

/**
 * 工具執行時取得的環境。
 *
 * 等待審批用 `requestApproval`；它會先落地請求再等待，回傳決定、逾時或撤回。
 * `signal` 在取消、緊急暫停或資料磁碟拔除時觸發，工具應儘快結束。
 */
export interface ToolExecutionContext {
  readonly conversationId: ConversationId;
  readonly turnId: TurnId;
  readonly callId: ToolCallId;
  readonly toolName: ToolName;
  readonly signal: AbortSignal;
  /** 本次任務的暫存目錄，位於 Cardiary 的 tmp 區內，任務結束後由主機清除。 */
  readonly tempDir: string;
  /** 工具執行的預設工作目錄。 */
  readonly workingDir: string;
  requestApproval(draft: ApprovalRequestDraft): Promise<ApprovalResolution>;
  reportProgress?(progress: ToolProgress): void;
}

/** 工具定義；模組註冊工具時提供。 */
export interface ToolDefinition {
  readonly name: ToolName;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly replay: ReplaySafety;
  execute(input: JsonValue, context: ToolExecutionContext): Promise<ToolOutcome>;
}

/** 工具組的版本號；由模組主機在每次啟用或重載時配發，單調遞增。 */
export type ToolGeneration = number;

/**
 * 一組一起註冊的工具；同一個模組的不同版本共用 `bundleId`。
 *
 * 對話建立時釘選工具組版本，之後模組重載不會改到進行中的對話；
 * 舊版本的定義要保留到所有釘選它的對話都完成壓縮為止。
 */
export interface ToolBundleDraft {
  readonly bundleId: ToolBundleId;
  readonly label: string;
  readonly tools: readonly ToolDefinition[];
}

/** 已註冊的工具組。 */
export interface ToolBundle extends ToolBundleDraft {
  readonly generation: ToolGeneration;
}

/** 對話釘選的工具組版本。 */
export interface ToolBundlePin {
  readonly bundleId: ToolBundleId;
  readonly generation: ToolGeneration;
}

/** 工具組的目前狀態；`pinnedByConversations` 用來判斷能否退役。 */
export interface ToolBundleState {
  readonly bundleId: ToolBundleId;
  readonly generation: ToolGeneration;
  readonly pinnedByConversations: number;
}

/**
 * 行程內的工具註冊表。
 *
 * 同名工具的新版本不會影響已釘選舊版的對話；對話只記工具名稱，
 * 每次呼叫時解析到釘選的版本。模組停用後，呼叫回傳 `tool-unavailable`，
 * 重新啟用同一個版本即可恢復。
 */
export interface ToolRegistry {
  register(bundle: ToolBundle): Promise<void>;
  /** 移除指定版本；仍有對話釘選時只標記為不可用，不刪除歷史。 */
  retire(bundleId: ToolBundleId, generation: ToolGeneration): Promise<void>;
  list(): Promise<readonly ToolBundleState[]>;
}
