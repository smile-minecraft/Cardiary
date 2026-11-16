import type { ConversationId, JsonValue } from "@cardiary/engine-adapter";
import type { URL } from "node:url";

/** 卡片變更的種類。 */
export type CardChangeKind = "created" | "updated" | "deleted" | "refreshed" | "reindexed";

/**
 * 外部程式代理在協定層的狀態。
 *
 * 對齊協定 `AgentStatus`；領域層的 `completed` 在協定層以 `stopped` 表示，
 * 結果寫在 `message`。模組內部的完整狀態不經這個型別。
 */
export type ExternalAgentStatus = "starting" | "running" | "waiting-approval" | "stopped" | "failed";

/**
 * 模組想送給客戶端的協定事件。
 *
 * 主機的協定閘道會再轉成正式訊息、用 schema 驗證、簽發序號並落地；
 * 模組不能自己寫 WebSocket，也不能指定 `seq`。
 */
export type ProtocolEventIntent =
  | {
      readonly kind: "notification";
      readonly title: string;
      readonly body: string;
      readonly level?: "info" | "warning" | "error";
      readonly conversationId?: ConversationId;
    }
  | { readonly kind: "conversation-updated"; readonly conversationId: ConversationId }
  | {
      readonly kind: "card-changed";
      readonly cardId: string;
      readonly change: CardChangeKind;
      /** 變更後的 revision；刪除時省略。 */
      readonly revision?: string;
      /** 變更後的新鮮度；只有保鮮與載入會帶。 */
      readonly freshness?: number;
    }
  | {
      readonly kind: "context-changed";
      readonly conversationId: ConversationId;
      /** 對應協定 ContextView 的內容；主機驗證後才送出。 */
      readonly context: JsonValue;
    }
  | {
      readonly kind: "context-compacted";
      readonly conversationId: ConversationId;
      /** 對應協定 ContextCompactedEventPayload。 */
      readonly payload: JsonValue;
    }
  | {
      readonly kind: "session-lifecycle";
      readonly conversationId: ConversationId;
      readonly event: "archived" | "unarchived" | "deleted";
      /** 對應協定同名事件的 payload。 */
      readonly payload: JsonValue;
    }
  | { readonly kind: "settings-changed"; readonly payload: JsonValue }
  | { readonly kind: "models-changed"; readonly payload: JsonValue }
  | {
      readonly kind: "notification-changed";
      /** 對應協定 CardiaryNotification；主機驗證後才覆寫。 */
      readonly notification: JsonValue;
    }
  | { readonly kind: "module-changed"; readonly payload: JsonValue }
  | { readonly kind: "board-changed"; readonly boardId: string; readonly payload: JsonValue }
  | {
      readonly kind: "mcp-servers-changed";
      /** 對應協定 McpServersChangedEventPayload。 */
      readonly payload: JsonValue;
    }
  | {
      readonly kind: "external-agent-status";
      readonly agentSessionId: string;
      readonly agentKind: "opencode" | "claude-code";
      readonly status: ExternalAgentStatus;
      readonly progress?: {
        readonly step: string;
        readonly label: string;
        readonly completed: number;
        readonly total: number;
      };
      readonly message?: string;
    }
  | { readonly kind: "module-event"; readonly type: string; readonly payload: JsonValue };

/** 註冊結果；停用模組或重載時由主機呼叫 `dispose` 撤銷。 */
export interface ProtocolRegistrationHandle {
  dispose(): void;
}

/** 協定請求的輸入；`payload` 是該型別的 JSON 物件。 */
export interface ProtocolRequestContext {
  /** 完整型別，例如 `card.patch` 或 `module.cards.search`。 */
  readonly type: string;
  readonly payload: JsonValue;
  /** 請求涉及的會話；沒有會話的系統訊息省略。 */
  readonly sessionId?: ConversationId;
  /** 送出請求的客戶端 instanceId。 */
  readonly clientId: string;
}

/**
 * 協定請求處理器。
 *
 * 回傳值是**該型別的 response payload**（schema 定義的形狀）；閘道負責
 * 包信封、配 `replyTo` 與錯誤轉換。`module.*` 的第三方模組例外，回傳
 * `{ data }`，由閘道包成 `ModuleResponsePayload`。
 */
export type ProtocolRequestHandler = (
  request: ProtocolRequestContext,
) => Promise<JsonValue> | JsonValue;

/** 模組註冊的 HTTP 路由；`path` 是精確路徑或以 `/` 結尾的前綴。 */
export interface ModuleHttpRoute {
  readonly method: "GET" | "HEAD" | "POST";
  readonly path: string;
  handle(request: ModuleHttpRequest): Promise<ModuleHttpResponse> | ModuleHttpResponse;
}

/** HTTP 請求；body 是串流，不整份進記憶體。 */
export interface ModuleHttpRequest {
  readonly method: "GET" | "HEAD" | "POST";
  readonly url: URL;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: AsyncIterable<Uint8Array>;
}

/** HTTP 回應；body 可以是位元組或串流。 */
export interface ModuleHttpResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Uint8Array | AsyncIterable<Uint8Array>;
}

/** 模組送出事件與註冊協定處理器的介面；由主機的閘道實作。 */
export interface ProtocolEventEmitter {
  emit(intent: ProtocolEventIntent): void;
  /**
   * 註冊一個命名空間（`card`）或單一型別（`session.archive`）。
   *
   * 前綴不含尾端的點。同一個前綴或型別只能註冊一次；核心型別保留，
   * 註冊會被拒絕並使模組進 `failed`。
   */
  registerNamespace(prefix: string, handler: ProtocolRequestHandler): ProtocolRegistrationHandle;
  /** 註冊 HTTP 路由；同一個 method 與 path 只能註冊一次。 */
  registerHttpRoute(route: ModuleHttpRoute): ProtocolRegistrationHandle;
}
