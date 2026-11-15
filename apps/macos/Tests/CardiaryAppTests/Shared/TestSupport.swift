import CardiaryKit
import Foundation

@testable import CardiaryApp

/// 測試用的服務替身：所有請求都回預先設定的資料，並記下呼叫順序。
actor FakeCardiaryService:
    ConversationService, ModelSettingsService, SettingsService, ModulesService, ApprovalService
{
    enum Failure: Error, Equatable {
        case send
        case history
        case models
        case approval
        case pause
    }

    private var listPages: [SessionListResponsePayload]
    private let fallbackSessions: [SessionSummary]
    private let historyPages: [String?: SessionGetHistoryResponsePayload]
    private let snapshot: SessionSnapshot?
    private let createSummary: SessionSummary?
    private let sendResponse: SessionSendMessageResponsePayload?
    private var modelsState: SystemModelsState
    private let failure: Failure?
    private var settingsItems: [SettingItem]
    private var modulesList: [ModuleInfo]

    private(set) var historyCursors: [String?] = []
    private(set) var listCalls = 0
    private(set) var subscribedSessions: [String] = []
    private(set) var unsubscribedSessions: [String] = []
    private(set) var sends: [(text: String, delivery: DeliveryMode, clientMessageId: String?)] = []
    private(set) var interruptCalls = 0
    private(set) var modelSetCalls: [(providers: [ModelProviderInfo]?, roles: [ModelRoleSelection]?)] = []
    private(set) var approvalDecisions: [(approvalId: String, optionId: String, note: String?)] = []
    private(set) var pauseAllCalls = 0
    private(set) var settingChanges: [[SettingChange]] = []
    private(set) var moduleChanges: [(moduleId: String, enabled: Bool)] = []

    init(
        sessions: [SessionSummary] = [],
        listPages: [SessionListResponsePayload] = [],
        historyPages: [String?: SessionGetHistoryResponsePayload] = [:],
        snapshot: SessionSnapshot? = nil,
        createSummary: SessionSummary? = nil,
        sendResponse: SessionSendMessageResponsePayload? = nil,
        modelsState: SystemModelsState = SystemModelsState(providers: [], roles: [], resolved: []),
        settings: [SettingItem] = [],
        modules: [ModuleInfo] = [],
        failure: Failure? = nil
    ) {
        self.fallbackSessions = sessions
        self.listPages = listPages
        self.historyPages = historyPages
        self.snapshot = snapshot
        self.createSummary = createSummary
        self.sendResponse = sendResponse
        self.modelsState = modelsState
        self.settingsItems = settings
        self.modulesList = modules
        self.failure = failure
    }

    // MARK: - ConversationService

    func listSessions(cursor: String?, limit: Int?) async throws -> SessionListResponsePayload {
        listCalls += 1
        if !listPages.isEmpty {
            return listPages.removeFirst()
        }
        return SessionListResponsePayload(sessions: fallbackSessions)
    }

    func createSession(clientRequestId: String, title: String?) async throws -> SessionCreateResponsePayload {
        let summary = createSummary ?? Fixtures.summary("session-new")
        return SessionCreateResponsePayload(session: summary)
    }

    func getHistory(
        sessionId: String,
        cursor: String?,
        limit: Int?
    ) async throws -> SessionGetHistoryResponsePayload {
        historyCursors.append(cursor)
        if failure == .history { throw Failure.history }
        return historyPages[cursor] ?? SessionGetHistoryResponsePayload(entries: [])
    }

    func sendMessage(
        sessionId: String,
        text: String,
        delivery: DeliveryMode,
        clientMessageId: String?
    ) async throws -> SessionSendMessageResponsePayload {
        sends.append((text, delivery, clientMessageId))
        if failure == .send { throw Failure.send }
        return sendResponse ?? SessionSendMessageResponsePayload(
            sessionId: sessionId,
            userMessageId: "user-sent",
            turnId: "turn-1",
            disposition: .started
        )
    }

    func interruptSession(sessionId: String, reason: String?) async throws -> SessionInterruptResponsePayload {
        interruptCalls += 1
        return SessionInterruptResponsePayload(sessionId: sessionId, interrupted: true)
    }

    func subscribeSession(sessionId: String, historyLimit: Int?) async throws -> SessionSubscribeResponsePayload {
        subscribedSessions.append(sessionId)
        return SessionSubscribeResponsePayload(
            sessionId: sessionId,
            stream: "session:\(sessionId)",
            seq: 0,
            epoch: "epoch-1",
            resyncRequired: false,
            snapshot: snapshot
        )
    }

    func unsubscribeSession(sessionId: String) async {
        unsubscribedSessions.append(sessionId)
    }

    // MARK: - SettingsService

    func getSettings() async throws -> SystemSettingsGetResponsePayload {
        SystemSettingsGetResponsePayload(settings: settingsItems)
    }

    func setSettings(
        changes: [SettingChange],
        clientRequestId: String
    ) async throws -> SystemSettingsSetResponsePayload {
        settingChanges.append(changes)
        var applied: [SettingItem] = []
        for change in changes {
            if let index = settingsItems.firstIndex(where: { $0.key == change.key }) {
                let current = settingsItems[index]
                let updated = SettingItem(
                    key: current.key,
                    value: change.value,
                    level: current.level,
                    title: current.title,
                    description: current.description,
                    updatedAt: "2026-01-01T00:00:08Z"
                )
                settingsItems[index] = updated
                applied.append(updated)
            } else {
                let item = SettingItem(
                    key: change.key,
                    value: change.value,
                    level: .free,
                    updatedAt: "2026-01-01T00:00:08Z"
                )
                settingsItems.append(item)
                applied.append(item)
            }
        }
        return SystemSettingsSetResponsePayload(
            applied: applied,
            requiresApproval: false,
            approvalId: nil
        )
    }

    // MARK: - ModulesService

    func getModules() async throws -> SystemModulesGetResponsePayload {
        SystemModulesGetResponsePayload(modules: modulesList)
    }

    func setModuleEnabled(
        moduleId: String,
        enabled: Bool,
        clientRequestId: String
    ) async throws -> SystemModulesSetEnabledResponsePayload {
        moduleChanges.append((moduleId, enabled))
        guard let index = modulesList.firstIndex(where: { $0.moduleId == moduleId }) else {
            throw Failure.models
        }
        let current = modulesList[index]
        let updated = ModuleInfo(
            moduleId: current.moduleId,
            name: current.name,
            version: current.version,
            enabled: enabled,
            state: enabled ? .loaded : .inactive,
            failure: current.failure,
            protocolPrefixes: current.protocolPrefixes,
            settings: current.settings
        )
        modulesList[index] = updated
        return SystemModulesSetEnabledResponsePayload(module: updated)
    }

    // MARK: - ApprovalService

    func decideApproval(
        approvalId: String,
        optionId: String,
        note: String?
    ) async throws -> ApprovalDecideResponsePayload {
        approvalDecisions.append((approvalId, optionId, note))
        if failure == .approval { throw Failure.approval }
        let effect: ApprovalEffect
        switch optionId {
        case "reject": effect = .reject
        case "always": effect = .approveAlways
        default: effect = .approve
        }
        return ApprovalDecideResponsePayload(
            approvalId: approvalId,
            effect: effect,
            decidedAt: "2026-01-01T00:00:07Z",
            persisted: true
        )
    }

    func pauseAllApprovals(reason: String) async throws {
        pauseAllCalls += 1
        if failure == .pause { throw Failure.pause }
    }

    // MARK: - ModelSettingsService

    func getModels() async throws -> SystemModelsState {
        if failure == .models { throw Failure.models }
        return modelsState
    }

    func setModels(
        providers: [ModelProviderInfo]?,
        roles: [ModelRoleSelection]?,
        clientRequestId: String
    ) async throws -> SystemModelsState {
        modelSetCalls.append((providers, roles))
        if let providers {
            modelsState = SystemModelsState(
                providers: providers,
                roles: modelsState.roles,
                resolved: modelsState.resolved
            )
        }
        if let roles {
            modelsState = SystemModelsState(
                providers: modelsState.providers,
                roles: roles,
                resolved: modelsState.resolved
            )
        }
        return modelsState
    }
}

/// 測試資料。全部用固定值，讓斷言看得出差異。
enum Fixtures {
    static func summary(
        _ id: String,
        title: String? = nil,
        status: SessionStatus = .idle,
        messageCount: Int = 0,
        updatedAt: String = "2026-01-01T00:00:00Z"
    ) -> SessionSummary {
        SessionSummary(
            id: id,
            title: title ?? "對話 \(id)",
            status: status,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: updatedAt,
            messageCount: messageCount
        )
    }

    static func userEntry(_ id: String, text: String, turnId: String = "turn-1") -> TranscriptEntry {
        .userTranscriptEntry(UserTranscriptEntry(
            id: id,
            role: "user",
            turnId: turnId,
            createdAt: "2026-01-01T00:00:00Z",
            text: text
        ))
    }

    static func assistantEntry(
        _ id: String,
        text: String,
        status: MessageStatus = .complete,
        turnId: String = "turn-1"
    ) -> TranscriptEntry {
        .assistantTranscriptEntry(AssistantTranscriptEntry(
            id: id,
            role: "assistant",
            turnId: turnId,
            createdAt: "2026-01-01T00:00:00Z",
            text: text,
            status: status
        ))
    }

    static func toolEntry(
        _ id: String,
        toolCallId: String,
        name: String = "read_file",
        output: String? = nil,
        status: MessageStatus = .complete
    ) -> TranscriptEntry {
        .toolTranscriptEntry(ToolTranscriptEntry(
            id: id,
            role: "tool",
            turnId: "turn-1",
            createdAt: "2026-01-01T00:00:00Z",
            toolCallId: toolCallId,
            name: name,
            input: ["path": .string("/notes.md")],
            output: output.map { ToolOutput(text: $0) },
            status: status,
            diagnostics: []
        ))
    }

    /// 產生一頁歷史訊息：`ids` 由舊到新。
    static func historyPage(
        _ ids: [String],
        nextCursor: String? = nil
    ) -> SessionGetHistoryResponsePayload {
        SessionGetHistoryResponsePayload(
            entries: ids.map { assistantEntry($0, text: "訊息 \($0)") },
            nextCursor: nextCursor
        )
    }

    static func snapshot(
        session: SessionSummary,
        entries: [TranscriptEntry] = [],
        streaming: StreamingMessage? = nil,
        activeTurn: TurnState? = nil,
        pendingApproval: ApprovalRequest? = nil
    ) -> SessionSnapshot {
        SessionSnapshot(
            session: session,
            entries: entries,
            activeTurn: activeTurn,
            pendingApproval: pendingApproval,
            streaming: streaming
        )
    }

    static func turnStarted(sessionId: String = "s1", turnId: String = "turn-2", seq: Int = 1) -> ServerFrame {
        .streamTurnStartedEvent(StreamTurnStartedEvent(
            stream: "session:\(sessionId)",
            seq: seq,
            emittedAt: "2026-01-01T00:00:01Z",
            payload: StreamTurnStartedEventPayload(
                sessionId: sessionId,
                turnId: turnId,
                triggerMessageId: "user-1",
                startedAt: "2026-01-01T00:00:01Z"
            )
        ))
    }

    static func delta(
        _ text: String,
        sessionId: String = "s1",
        messageId: String = "msg-1",
        turnId: String = "turn-2",
        seq: Int = 2
    ) -> ServerFrame {
        .streamTextDeltaEvent(StreamTextDeltaEvent(
            stream: "session:\(sessionId)",
            seq: seq,
            emittedAt: "2026-01-01T00:00:02Z",
            payload: StreamTextDeltaEventPayload(
                sessionId: sessionId,
                turnId: turnId,
                messageId: messageId,
                delta: text
            )
        ))
    }

    static func completed(
        _ text: String,
        id: String = "msg-1",
        sessionId: String = "s1",
        turnId: String = "turn-2",
        seq: Int = 3
    ) -> ServerFrame {
        .streamMessageCompletedEvent(StreamMessageCompletedEvent(
            stream: "session:\(sessionId)",
            seq: seq,
            emittedAt: "2026-01-01T00:00:03Z",
            payload: StreamMessageCompletedEventPayload(
                sessionId: sessionId,
                turnId: turnId,
                entry: AssistantTranscriptEntry(
                    id: id,
                    role: "assistant",
                    turnId: turnId,
                    createdAt: "2026-01-01T00:00:03Z",
                    text: text,
                    status: .complete
                )
            )
        ))
    }

    static func toolCall(
        toolCallId: String = "call-1",
        name: String = "read_file",
        sessionId: String = "s1",
        seq: Int = 4
    ) -> ServerFrame {
        .streamToolCallEvent(StreamToolCallEvent(
            stream: "session:\(sessionId)",
            seq: seq,
            emittedAt: "2026-01-01T00:00:04Z",
            payload: StreamToolCallEventPayload(
                sessionId: sessionId,
                turnId: "turn-2",
                toolCallId: toolCallId,
                name: name,
                title: "讀取檔案",
                input: ["path": .string("/notes.md")]
            )
        ))
    }

    static func toolResult(
        toolCallId: String = "call-1",
        status: ToolResultStatus = .ok,
        text: String = "三行內容",
        sessionId: String = "s1",
        seq: Int = 5
    ) -> ServerFrame {
        .streamToolResultEvent(StreamToolResultEvent(
            stream: "session:\(sessionId)",
            seq: seq,
            emittedAt: "2026-01-01T00:00:05Z",
            payload: StreamToolResultEventPayload(
                sessionId: sessionId,
                turnId: "turn-2",
                toolCallId: toolCallId,
                status: status,
                output: ToolOutput(text: text),
                diagnostics: []
            )
        ))
    }

    static func turnState(
        _ state: TurnPhase,
        sessionId: String = "s1",
        turnId: String = "turn-2",
        seq: Int = 6
    ) -> ServerFrame {
        .streamTurnStateEvent(StreamTurnStateEvent(
            stream: "session:\(sessionId)",
            seq: seq,
            emittedAt: "2026-01-01T00:00:06Z",
            payload: TurnState(
                turnId: turnId,
                state: state,
                startedAt: "2026-01-01T00:00:01Z",
                endedAt: state == .completed ? "2026-01-01T00:00:07Z" : nil
            )
        ))
    }

    static func approval(
        approvalId: String = "approval-1",
        sessionId: String = "s1",
        title: String = "寫入檔案",
        requestedAt: String = "2026-01-01T00:00:05Z",
        toolName: String = "write_file",
        approveAlways: Bool = true
    ) -> ApprovalRequest {
        ApprovalRequest(
            approvalId: approvalId,
            sessionId: sessionId,
            turnId: "turn-2",
            toolCallId: "call-1",
            title: title,
            summary: "代理想寫入 ~/notes.md",
            scope: ApprovalScope(kind: .toolCall, target: toolName),
            options: [
                ApprovalOption(id: "approve", label: "核准", effect: .approve),
                ApprovalOption(id: "reject", label: "拒絕", effect: .reject),
            ] + (approveAlways
                ? [ApprovalOption(id: "always", label: "一律允許", effect: .approveAlways)]
                : []),
            requestedAt: requestedAt
        )
    }

    static func approvalRequested(_ approval: ApprovalRequest) -> ServerFrame {
        .approvalRequestedEvent(ApprovalRequestedEvent(
            stream: "session:\(approval.sessionId)",
            seq: 7,
            emittedAt: "2026-01-01T00:00:05Z",
            payload: approval
        ))
    }

    static func approvalDecided(_ approval: ApprovalRequest) -> ServerFrame {
        .approvalDecidedEvent(ApprovalDecidedEvent(
            stream: "session:\(approval.sessionId)",
            seq: 8,
            emittedAt: "2026-01-01T00:00:06Z",
            payload: ApprovalDecidedEventPayload(
                approvalId: approval.approvalId,
                sessionId: approval.sessionId,
                effect: .approve,
                decidedAt: "2026-01-01T00:00:06Z",
                decidedBy: DecidedBy(kind: .client)
            )
        ))
    }

    static func modelProvider(
        _ providerId: String,
        models: [String]
    ) -> ModelProviderInfo {
        ModelProviderInfo(
            providerId: providerId,
            kind: .apiKey,
            displayName: providerId,
            models: models.map {
                ModelInfo(modelId: $0, displayName: $0, contextWindow: 128_000, input: [.text])
            }
        )
    }
}
