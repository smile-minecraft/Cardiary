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
        case .cardChangedEvent(let frame): return frame.stream
        case .contextChangedEvent(let frame): return frame.stream
        case .contextCompactedEvent(let frame): return frame.stream
        case .sessionArchivedEvent(let frame): return frame.stream
        case .sessionUnarchivedEvent(let frame): return frame.stream
        case .sessionDeletedEvent(let frame): return frame.stream
        case .systemSettingsChangedEvent(let frame): return frame.stream
        case .systemModulesChangedEvent(let frame): return frame.stream
        case .systemModelsChangedEvent(let frame): return frame.stream
        case .moduleEvent(let frame): return frame.stream
        // 通知目前尚無客戶端處理；不要當成既有會話事件。
        case .notificationChangedEvent: return nil
        case .notificationListResponse, .notificationMarkReadResponse,
             .notificationCreateCardResponse, .pairingBeginResponse, .pairingCompleteResponse:
            return nil
        // 回應與其他非事件沒有串流。
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
        case .cardChangedEvent(let frame): return frame.seq
        case .contextChangedEvent(let frame): return frame.seq
        case .contextCompactedEvent(let frame): return frame.seq
        case .sessionArchivedEvent(let frame): return frame.seq
        case .sessionUnarchivedEvent(let frame): return frame.seq
        case .sessionDeletedEvent(let frame): return frame.seq
        case .systemSettingsChangedEvent(let frame): return frame.seq
        case .systemModulesChangedEvent(let frame): return frame.seq
        case .systemModelsChangedEvent(let frame): return frame.seq
        case .moduleEvent(let frame): return frame.seq
        // 通知尚未由此客戶端處理，不推進既有事件的游標。
        case .notificationChangedEvent: return nil
        case .notificationListResponse, .notificationMarkReadResponse,
             .notificationCreateCardResponse, .pairingBeginResponse, .pairingCompleteResponse:
            return nil
        // 回應與其他非耐久事件沒有序號。
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
        case .sessionArchiveResponse: return "session.archive"
        case .sessionUnarchiveResponse: return "session.unarchive"
        case .sessionDeletionPreviewResponse: return "session.deletion_preview"
        case .sessionDeleteResponse: return "session.delete"
        case .cardListResponse: return "card.list"
        case .cardGetResponse: return "card.get"
        case .cardCreateResponse: return "card.create"
        case .cardPatchResponse: return "card.patch"
        case .cardDeleteResponse: return "card.delete"
        case .cardSearchResponse: return "card.search"
        case .cardRefreshResponse: return "card.refresh"
        case .mediaImportResponse: return "media.import"
        case .contextGetResponse: return "context.get"
        case .contextAddCardResponse: return "context.add_card"
        case .contextRemoveCardResponse: return "context.remove_card"
        case .contextCompactResponse: return "context.compact"
        case .systemSettingsGetResponse: return "system.settings.get"
        case .systemSettingsSetResponse: return "system.settings.set"
        case .systemModulesGetResponse: return "system.modules.get"
        case .systemModulesSetEnabledResponse: return "system.modules.set_enabled"
        case .systemModelsGetResponse: return "system.models.get"
        case .systemModelsSetResponse: return "system.models.set"
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
        case .notificationListResponse: return "notification.list"
        case .notificationMarkReadResponse: return "notification.mark_read"
        case .notificationCreateCardResponse: return "notification.create_card"
        case .notificationChangedEvent: return "notification.changed"
        case .pairingBeginResponse: return "pairing.begin"
        case .pairingCompleteResponse: return "pairing.complete"
        case .cardChangedEvent: return "card.changed"
        case .contextChangedEvent: return "context.changed"
        case .contextCompactedEvent: return "context.compacted"
        case .sessionArchivedEvent: return "session.archived"
        case .sessionUnarchivedEvent: return "session.unarchived"
        case .sessionDeletedEvent: return "session.deleted"
        case .systemSettingsChangedEvent: return "system.settings.changed"
        case .systemModulesChangedEvent: return "system.modules.changed"
        case .systemModelsChangedEvent: return "system.models.changed"
        case .errorFrame: return "error"
        case .moduleResponse(let frame): return frame.type
        case .moduleEvent(let frame): return frame.type
        }
    }
}
