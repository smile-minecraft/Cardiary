import type {
  ConversationId,
  ConversationSummary,
  EngineAdapter,
  MessageReceipt,
  SendMessageRequest,
} from "@cardiary/engine-adapter";

/** 一輪助理訊息回報的用量；形狀與引擎轉接層相同。 */
export interface HostConversationUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly requestTokens: number;
}

/** 主機要求引擎套用的壓縮；範圍由主機決定。 */
export interface HostCompactionRequest {
  readonly summary: string;
  readonly keepFromCursor: string;
  readonly beforeTokens: number;
  readonly afterTokens: number;
}

/**
 * 主機需要的轉接層擴充方法。
 *
 * 設計文件把它們列在「實作時要調整」：`suspend()`／`resume()` 與兩個
 * 冪等回查由引擎轉接層工作補上；在那之前假引擎先提供同一組簽名，主機
 * 只依賴這份介面，不直接碰引擎型別。
 */
export interface HostEngineExtensions {
  suspend(): Promise<void>;
  resume(): Promise<void>;
  findConversationByClientRequestId(clientRequestId: string): Promise<ConversationSummary | null>;
  findMessageByClientId(sessionId: string, clientMessageId: string): Promise<MessageReceipt | null>;
  /** 列出所有對話；`session.list` 需要它。 */
  listConversations?(): Promise<readonly ConversationSummary[]>;
  /** 送訊息時一併記下 `clientMessageId`；沒有這個方法時退回 `sendMessage`。 */
  sendMessageWithClientId?(
    request: SendMessageRequest & { readonly clientMessageId?: string },
  ): Promise<MessageReceipt>;
  /** 換掉第 1 到 6 層的固定前綴；沒有這個方法時上下文只讀。 */
  configureConversationContext?(
    conversationId: ConversationId,
    systemContext: string,
  ): Promise<void>;
  /** 套用主機算好的壓縮；等待中的工具組與前綴在同一步換版。 */
  compactConversation?(
    conversationId: ConversationId,
    request: HostCompactionRequest,
  ): Promise<{ readonly beforeTokens: number; readonly afterTokens: number }>;
  /** 最近一輪的用量；還沒有一輪時回 `null`。 */
  readConversationUsage?(conversationId: ConversationId): Promise<HostConversationUsage | null>;
}

export type HostEngine = EngineAdapter & HostEngineExtensions;
