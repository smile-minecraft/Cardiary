import Foundation

/// 產生請求識別碼。格式是 `req_` 加 26 個 Crockford base32 字元，
/// 前 10 碼是毫秒時間戳，其餘是隨機值；同一條連線內不重複。
enum RequestID {
    private static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    private final class Counter: @unchecked Sendable {
        let lock = NSLock()
        var lastTimestamp: UInt64 = 0
        var counter: UInt64 = 0
    }

    private static let state = Counter()

    static func next(now: Date = Date()) -> String {
        state.lock.lock()
        defer { state.lock.unlock() }

        let milliseconds = UInt64(max(0, now.timeIntervalSince1970) * 1000)
        if milliseconds <= state.lastTimestamp {
            state.counter &+= 1
        } else {
            state.lastTimestamp = milliseconds
            state.counter = 0
        }

        var value = state.lastTimestamp << 32 | (state.counter & 0xFFFF_FFFF)
        var characters = [Character]()
        characters.reserveCapacity(26)
        for _ in 0..<26 {
            let index = Int(value & 0x1F)
            characters.append(alphabet[index])
            value >>= 5
        }
        return "req_" + String(characters.reversed())
    }
}

extension JSONValue {
    public var intValue: Int? {
        if case .number(let value) = self, value.rounded() == value {
            return Int(value)
        }
        if case .string(let text) = self {
            return Int(text)
        }
        return nil
    }

    public var stringValue: String? {
        if case .string(let text) = self { return text }
        return nil
    }

    public var boolValue: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }

    public var arrayValue: [JSONValue]? {
        if case .array(let values) = self { return values }
        return nil
    }

    public var objectValue: [String: JSONValue]? {
        if case .object(let values) = self { return values }
        return nil
    }
}

extension ServerFrame {
    /// 事件的串流名稱；回應與錯誤沒有串流。
    var eventStream: String? {
        switch self {
        case .systemStatusEvent(let frame): return frame.stream
        case .streamTurnStartedEvent(let frame): return frame.stream
        case .streamTextDeltaEvent(let frame): return frame.stream
        case .streamMessageCompletedEvent(let frame): return frame.stream
        case .streamToolCallEvent(let frame): return frame.stream
        case .streamToolResultEvent(let frame): return frame.stream
        case .streamTurnStateEvent(let frame): return frame.stream
        case .streamUiEvent(let frame): return frame.stream
        case .approvalRequestedEvent(let frame): return frame.stream
        case .approvalDecidedEvent(let frame): return frame.stream
        case .moduleEvent(let frame): return frame.stream
        default: return nil
        }
    }

    /// 事件的耐久序號；非事件或非耐久事件（delta）沒有。
    var eventSeq: Int? {
        switch self {
        case .systemStatusEvent(let frame): return frame.seq
        case .streamTurnStartedEvent(let frame): return frame.seq
        case .streamTextDeltaEvent: return nil
        case .streamMessageCompletedEvent(let frame): return frame.seq
        case .streamToolCallEvent(let frame): return frame.seq
        case .streamToolResultEvent(let frame): return frame.seq
        case .streamTurnStateEvent(let frame): return frame.seq
        case .streamUiEvent(let frame): return frame.seq
        case .approvalRequestedEvent(let frame): return frame.seq
        case .approvalDecidedEvent(let frame): return frame.seq
        case .moduleEvent(let frame): return frame.seq
        default: return nil
        }
    }

    /// 給錯誤訊息用的種類標籤。
    var kindLabel: String {
        switch self {
        case .systemHelloResponse: return "system.hello"
        case .systemSubscribeResponse: return "system.subscribe"
        case .systemUnsubscribeResponse: return "system.unsubscribe"
        case .systemStatusEvent: return "system.status"
        case .sessionCreateResponse: return "session.create"
        case .sessionListResponse: return "session.list"
        case .sessionSendMessageResponse: return "session.send_message"
        case .sessionInterruptResponse: return "session.interrupt"
        case .sessionSubscribeResponse: return "session.subscribe"
        case .sessionUnsubscribeResponse: return "session.unsubscribe"
        case .sessionGetHistoryResponse: return "session.get_history"
        case .streamTurnStartedEvent: return "stream.turn_started"
        case .streamTextDeltaEvent: return "stream.text_delta"
        case .streamMessageCompletedEvent: return "stream.message_completed"
        case .streamToolCallEvent: return "stream.tool_call"
        case .streamToolResultEvent: return "stream.tool_result"
        case .streamTurnStateEvent: return "stream.turn_state"
        case .streamUiEvent: return "stream.ui"
        case .approvalRequestedEvent: return "approval.requested"
        case .approvalDecideResponse: return "approval.decide"
        case .approvalDecidedEvent: return "approval.decided"
        case .approvalPauseAllResponse: return "approval.pause_all"
        case .errorFrame: return "error"
        case .moduleResponse(let frame): return frame.type
        case .moduleEvent(let frame): return frame.type
        }
    }
}
