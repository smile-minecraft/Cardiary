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
        case .systemPermissionsChangedEvent(let frame): return frame.stream
        case .systemModulesChangedEvent(let frame): return frame.stream
        case .systemModelsChangedEvent(let frame): return frame.stream
        case .moduleEvent(let frame): return frame.stream
        case .agentStateChangedEvent(let frame): return frame.stream
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
        case .systemPermissionsChangedEvent(let frame): return frame.seq
        case .systemModulesChangedEvent(let frame): return frame.seq
        case .systemModelsChangedEvent(let frame): return frame.seq
        case .moduleEvent(let frame): return frame.seq
        case .agentStateChangedEvent(let frame): return frame.seq
        // 通知尚未由此客戶端處理，不推進既有事件的游標。
        case .notificationChangedEvent: return nil
        case .notificationListResponse, .notificationMarkReadResponse,
             .notificationCreateCardResponse, .pairingBeginResponse, .pairingCompleteResponse:
            return nil
        // 回應與其他非耐久事件沒有序號。
        default: return nil
        }
    }

    /// 回應幀對應的請求識別碼；事件與沒有 `replyTo` 的錯誤回傳 nil。
    /// `handle(_:)` 用它把回應交還給等待的請求。
    var replyTo: String? {
        switch self {
        case .systemHelloResponse(let frame): return frame.replyTo
        case .systemSubscribeResponse(let frame): return frame.replyTo
        case .systemUnsubscribeResponse(let frame): return frame.replyTo
        case .systemStatusEvent: return nil
        case .sessionCreateResponse(let frame): return frame.replyTo
        case .sessionListResponse(let frame): return frame.replyTo
        case .sessionSendMessageResponse(let frame): return frame.replyTo
        case .sessionInterruptResponse(let frame): return frame.replyTo
        case .sessionSubscribeResponse(let frame): return frame.replyTo
        case .sessionUnsubscribeResponse(let frame): return frame.replyTo
        case .sessionGetHistoryResponse(let frame): return frame.replyTo
        case .sessionArchiveResponse(let frame): return frame.replyTo
        case .sessionUnarchiveResponse(let frame): return frame.replyTo
        case .sessionDeletionPreviewResponse(let frame): return frame.replyTo
        case .sessionDeleteResponse(let frame): return frame.replyTo
        case .cardListResponse(let frame): return frame.replyTo
        case .cardGetResponse(let frame): return frame.replyTo
        case .cardCreateResponse(let frame): return frame.replyTo
        case .cardPatchResponse(let frame): return frame.replyTo
        case .cardPatchesListResponse(let frame): return frame.replyTo
        case .cardPatchAcceptResponse(let frame): return frame.replyTo
        case .cardPatchRejectResponse(let frame): return frame.replyTo
        case .cardVersionsListResponse(let frame): return frame.replyTo
        case .cardVersionGetResponse(let frame): return frame.replyTo
        case .cardVersionRestoreResponse(let frame): return frame.replyTo
        case .cardDeleteResponse(let frame): return frame.replyTo
        case .cardSearchResponse(let frame): return frame.replyTo
        case .cardRefreshResponse(let frame): return frame.replyTo
        case .boardListResponse(let frame): return frame.replyTo
        case .boardGetResponse(let frame): return frame.replyTo
        case .boardCreateResponse(let frame): return frame.replyTo
        case .boardSaveResponse(let frame): return frame.replyTo
        case .boardDeleteResponse(let frame): return frame.replyTo
        case .boardProjectCardResponse(let frame): return frame.replyTo
        case .boardUnprojectCardResponse(let frame): return frame.replyTo
        case .boardCreateCardFromSelectionResponse(let frame): return frame.replyTo
        case .mediaImportResponse(let frame): return frame.replyTo
        case .contextGetResponse(let frame): return frame.replyTo
        case .contextAddCardResponse(let frame): return frame.replyTo
        case .contextRemoveCardResponse(let frame): return frame.replyTo
        case .contextCompactResponse(let frame): return frame.replyTo
        case .systemSettingsGetResponse(let frame): return frame.replyTo
        case .systemSettingsSetResponse(let frame): return frame.replyTo
        case .systemPermissionsGetResponse(let frame): return frame.replyTo
        case .systemPermissionsSetCategoryResponse(let frame): return frame.replyTo
        case .systemPermissionsSetDomainsResponse(let frame): return frame.replyTo
        case .systemPermissionsGrantAllowAllResponse(let frame): return frame.replyTo
        case .systemPermissionsRevokeAllowAllResponse(let frame): return frame.replyTo
        case .systemModulesGetResponse(let frame): return frame.replyTo
        case .systemModulesSetEnabledResponse(let frame): return frame.replyTo
        case .systemModelsGetResponse(let frame): return frame.replyTo
        case .systemModelsSetResponse(let frame): return frame.replyTo
        case .streamTurnStartedEvent: return nil
        case .streamTextDeltaEvent: return nil
        case .streamMessageCompletedEvent: return nil
        case .streamToolCallEvent: return nil
        case .streamToolResultEvent: return nil
        case .streamTurnStateEvent: return nil
        case .streamUiEvent: return nil
        case .cardChangedEvent: return nil
        case .boardChangedEvent: return nil
        case .contextChangedEvent: return nil
        case .contextCompactedEvent: return nil
        case .sessionArchivedEvent: return nil
        case .sessionUnarchivedEvent: return nil
        case .sessionDeletedEvent: return nil
        case .systemSettingsChangedEvent: return nil
        case .systemPermissionsChangedEvent: return nil
        case .systemModulesChangedEvent: return nil
        case .systemModelsChangedEvent: return nil
        case .approvalRequestedEvent: return nil
        case .approvalDecideResponse(let frame): return frame.replyTo
        case .approvalDecidedEvent: return nil
        case .approvalPauseAllResponse(let frame): return frame.replyTo
        case .notificationListResponse(let frame): return frame.replyTo
        case .notificationMarkReadResponse(let frame): return frame.replyTo
        case .notificationCreateCardResponse(let frame): return frame.replyTo
        case .notificationChangedEvent: return nil
        case .pairingBeginResponse(let frame): return frame.replyTo
        case .pairingCompleteResponse(let frame): return frame.replyTo
        case .agentStartResponse(let frame): return frame.replyTo
        case .agentStopResponse(let frame): return frame.replyTo
        case .agentListResponse(let frame): return frame.replyTo
        case .agentStateChangedEvent: return nil
        case .mcpServersListResponse(let frame): return frame.replyTo
        case .mcpServerAddResponse(let frame): return frame.replyTo
        case .mcpServerRemoveResponse(let frame): return frame.replyTo
        case .mcpServerSetEnabledResponse(let frame): return frame.replyTo
        case .mcpServerAllowHostsResponse(let frame): return frame.replyTo
        case .mcpServersChangedEvent: return nil
        case .settingsListResponse(let frame): return frame.replyTo
        case .settingsProposeChangeResponse(let frame): return frame.replyTo
        case .settingsChangesListResponse(let frame): return frame.replyTo
        case .settingsChangeDecideResponse(let frame): return frame.replyTo
        case .settingsChangedEvent: return nil
        case .storageUsageResponse(let frame): return frame.replyTo
        case .storageCleanupPreviewResponse(let frame): return frame.replyTo
        case .storageCleanupApplyResponse(let frame): return frame.replyTo
        case .storageChangedEvent: return nil
        case .emotionGetResponse(let frame): return frame.replyTo
        case .errorFrame(let frame): return frame.replyTo
        case .moduleResponse(let frame): return frame.replyTo
        case .moduleEvent: return nil
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
        case .cardPatchesListResponse: return "card.patches.list"
        case .cardPatchAcceptResponse: return "card.patch.accept"
        case .cardPatchRejectResponse: return "card.patch.reject"
        case .cardVersionsListResponse: return "card.versions.list"
        case .cardVersionGetResponse: return "card.version.get"
        case .cardVersionRestoreResponse: return "card.version.restore"
        case .cardDeleteResponse: return "card.delete"
        case .cardSearchResponse: return "card.search"
        case .cardRefreshResponse: return "card.refresh"
        case .boardListResponse: return "board.list"
        case .boardGetResponse: return "board.get"
        case .boardCreateResponse: return "board.create"
        case .boardSaveResponse: return "board.save"
        case .boardDeleteResponse: return "board.delete"
        case .boardProjectCardResponse: return "board.project_card"
        case .boardUnprojectCardResponse: return "board.unproject_card"
        case .boardCreateCardFromSelectionResponse: return "board.create_card_from_selection"
        case .boardChangedEvent: return "board.changed"
        case .mediaImportResponse: return "media.import"
        case .contextGetResponse: return "context.get"
        case .contextAddCardResponse: return "context.add_card"
        case .contextRemoveCardResponse: return "context.remove_card"
        case .contextCompactResponse: return "context.compact"
        case .systemSettingsGetResponse: return "system.settings.get"
        case .systemSettingsSetResponse: return "system.settings.set"
        case .systemPermissionsGetResponse: return "system.permissions.get"
        case .systemPermissionsSetCategoryResponse: return "system.permissions.set_category"
        case .systemPermissionsSetDomainsResponse: return "system.permissions.set_domains"
        case .systemPermissionsGrantAllowAllResponse: return "system.permissions.grant_allow_all"
        case .systemPermissionsRevokeAllowAllResponse: return "system.permissions.revoke_allow_all"
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
        case .systemPermissionsChangedEvent: return "system.permissions.changed"
        case .systemModulesChangedEvent: return "system.modules.changed"
        case .systemModelsChangedEvent: return "system.models.changed"
        case .agentStartResponse: return "agent.start"
        case .agentStopResponse: return "agent.stop"
        case .agentListResponse: return "agent.list"
        case .agentStateChangedEvent: return "agent.state_changed"
        case .mcpServersListResponse: return "mcp.servers.list"
        case .mcpServerAddResponse: return "mcp.server.add"
        case .mcpServerRemoveResponse: return "mcp.server.remove"
        case .mcpServerSetEnabledResponse: return "mcp.server.set_enabled"
        case .mcpServerAllowHostsResponse: return "mcp.server.allow_hosts"
        case .mcpServersChangedEvent: return "mcp.servers_changed"
        case .settingsListResponse: return "settings.list"
        case .settingsProposeChangeResponse: return "settings.propose_change"
        case .settingsChangesListResponse: return "settings.changes.list"
        case .settingsChangeDecideResponse: return "settings.change.decide"
        case .settingsChangedEvent: return "settings.changed"
        case .storageUsageResponse: return "storage.usage"
        case .storageCleanupPreviewResponse: return "storage.cleanup.preview"
        case .storageCleanupApplyResponse: return "storage.cleanup.apply"
        case .storageChangedEvent: return "storage.changed"
        case .emotionGetResponse: return "emotion.get"
        case .errorFrame: return "error"
        case .moduleResponse(let frame): return frame.type
        case .moduleEvent(let frame): return frame.type
        }
    }
}
