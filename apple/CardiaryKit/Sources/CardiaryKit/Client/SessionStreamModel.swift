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
            if streaming?.messageId == entry.id || streaming?.turnId == entry.turnId {
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

/// 待審批清單。殼只訂閱有進行中工作的會話，用事件維護；選單列要數量，
/// 檢視欄要完整內容，所以這裡留著請求本身，不是只記識別碼。
public struct ApprovalCounter: Equatable, Sendable {
    private var pending: [String: ApprovalRequest] = [:]

    public init() {}

    public var count: Int { pending.count }

    /// 依請求時間排序；同一時間用識別碼排，讓畫面順序固定。
    public var requests: [ApprovalRequest] {
        pending.values.sorted {
            ($0.requestedAt, $0.approvalId) < ($1.requestedAt, $1.approvalId)
        }
    }

    public mutating func apply(_ frame: ServerFrame) {
        switch frame {
        case .approvalRequestedEvent(let event):
            pending[event.payload.approvalId] = event.payload
        case .approvalDecidedEvent(let event):
            pending.removeValue(forKey: event.payload.approvalId)
        default:
            break
        }
    }

    /// 套用 system 快照的待決宿主審批。宿主審批的 sessionId 是空字串；
    /// 會話快照或會話事件帶進來的項目不受影響。快照是主機的現況：沒有
    /// 待決宿主審批時，就清掉本地留著的那些空 sessionId 項目（可能已被
    /// 其他客戶端決定，或是逾時作廢）。欄位不存在（補送而非快照）時不動。
    public mutating func adoptSystemSnapshot(_ requests: [ApprovalRequest]?) {
        guard let requests else { return }
        let stale = pending.filter { $0.value.sessionId.isEmpty }.map(\.key)
        for id in stale {
            pending.removeValue(forKey: id)
        }
        for request in requests where request.sessionId.isEmpty {
            pending[request.approvalId] = request
        }
    }

    /// 套用會話快照的待審批。快照是主機的現況：這個會話沒有待審批時，
    /// 就清掉本地留著的那一筆（可能已被其他客戶端決定）。
    public mutating func adoptSnapshot(_ request: ApprovalRequest?, sessionId: String) {
        let stale = pending.filter { $0.value.sessionId == sessionId }.map(\.key)
        for id in stale {
            pending.removeValue(forKey: id)
        }
        if let request {
            pending[request.approvalId] = request
        }
    }

    public mutating func reset() {
        pending.removeAll()
    }
}
