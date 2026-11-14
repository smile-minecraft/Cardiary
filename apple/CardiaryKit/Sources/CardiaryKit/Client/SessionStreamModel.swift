import Foundation

/// 進行中訊息的文字狀態。
///
/// 規則來自 `docs/design/protocol.md` 第 6 節「快照邊界與進行中的文字」：
/// 快照的 `text` 是取代，之後的 delta 才附加，`message_completed` 用完整文字取代整段。
public struct StreamingTextState: Equatable, Sendable {
    public private(set) var messageId: String
    public private(set) var turnId: String
    public private(set) var text: String
    public let startedAt: String
    public private(set) var truncated: Bool

    public init(message: StreamingMessage) {
        self.messageId = message.messageId
        self.turnId = message.turnId
        self.text = message.text
        self.startedAt = message.startedAt
        self.truncated = message.truncated ?? false
    }

    mutating func replace(with text: String, truncated: Bool) {
        self.text = text
        self.truncated = truncated
    }

    mutating func append(_ delta: String) {
        text += delta
    }
}

/// 單一會話串流的本地狀態：序號游標與進行中的文字。
///
/// M0 的殼只需要這兩件事；訊息歷史與卡片由畫面層自己的模型處理。
public struct SessionStreamModel: Equatable, Sendable {
    public let sessionId: String
    public private(set) var cursor: StreamCursor
    public private(set) var streaming: StreamingTextState?
    /// 最近一次完成的助理訊息，供選單列顯示。
    public private(set) var lastCompletedMessageId: String?

    public init(sessionId: String, epoch: String? = nil, lastSeq: Int = 0) {
        self.sessionId = sessionId
        self.cursor = StreamCursor(stream: "session:\(sessionId)", epoch: epoch, lastSeq: lastSeq)
    }

    public var stream: String { "session:\(sessionId)" }

    /// 只更新游標，不改動已套用的快照內容。
    public mutating func adopt(epoch: String, seq: Int) {
        cursor.adopt(epoch: epoch, seq: seq)
    }

    /// 只記錄 epoch，保留 `lastSeq`：沒有快照時，補送事件才推得動游標。
    public mutating func adoptEpochOnly(_ epoch: String) {
        cursor.adoptEpochOnly(epoch)
    }

    public mutating func applySnapshot(_ snapshot: SessionSnapshot, epoch: String, seq: Int) {
        cursor.adopt(epoch: epoch, seq: seq)
        streaming = snapshot.streaming.map(StreamingTextState.init(message:))
    }

    /// 套用一則會話串流事件。非耐久事件（delta）不推進游標。
    @discardableResult
    public mutating func apply(_ frame: ServerFrame) -> StreamCursor.Advance? {
        guard let eventStream = frame.eventStream, eventStream == stream else { return nil }

        switch frame {
        case .streamTextDeltaEvent(let event):
            if let current = streaming, current.messageId == event.payload.messageId {
                streaming?.append(event.payload.delta)
            } else {
                // 沒有對應的進行中訊息時，用 delta 建立暫存的進行中狀態；
                // `message_completed` 會用完整文字取代整段。
                streaming = StreamingTextState(
                    message: StreamingMessage(
                        messageId: event.payload.messageId,
                        turnId: event.payload.turnId,
                        text: event.payload.delta,
                        startedAt: event.emittedAt
                    )
                )
            }
            return nil

        case .streamMessageCompletedEvent(let event):
            guard let epoch = cursor.epoch else { return .epochChanged }
            let advance = cursor.advance(to: event.seq, epoch: epoch)
            guard case .applied = advance else { return advance }
            let entry = event.payload.entry
            if streaming?.messageId == entry.id {
                streaming = nil
            }
            lastCompletedMessageId = entry.id
            return advance

        default:
            guard let epoch = cursor.epoch else { return .epochChanged }
            return cursor.advance(to: frame.eventSeq ?? 0, epoch: epoch)
        }
    }
}

/// 待審批數量。殼只訂閱有進行中工作的會話，用事件維護計數。
public struct ApprovalCounter: Equatable, Sendable {
    private var pending: Set<String> = []

    public init() {}

    public var count: Int { pending.count }

    public mutating func apply(_ frame: ServerFrame) {
        switch frame {
        case .approvalRequestedEvent(let event):
            pending.insert(event.payload.approvalId)
        case .approvalDecidedEvent(let event):
            pending.remove(event.payload.approvalId)
        default:
            break
        }
    }

    public mutating func reset() {
        pending.removeAll()
    }
}
