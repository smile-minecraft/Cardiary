import type {
  ConversationSummary,
  EngineAdapter,
  MessageReceipt,
  SendMessageRequest,
} from "@cardiary/engine-adapter";

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
}

export type HostEngine = EngineAdapter & HostEngineExtensions;
