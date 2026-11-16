import CardiaryKit
import Foundation

@testable import CardiaryApp

/// 測試用的服務替身：所有請求都回預先設定的資料，並記下呼叫順序。
actor FakeCardiaryService:
    ConversationService, ModelSettingsService, SettingsService, ModulesService, ApprovalService,
    CardService, ContextService, SessionManagementService, MediaImportService, NotificationService,
    StorageService, McpService, AgentService
{
    enum Failure: Error, Equatable {
        case send
        case history
        case models
        case approval
        case pause
        case create
        case storageUsage
        case storagePreview
        case storageApply
    }

    private var listPages: [SessionListResponsePayload]
    private let fallbackSessions: [SessionSummary]
    private let historyPages: [String?: SessionGetHistoryResponsePayload]
    private let snapshot: SessionSnapshot?
    private let createSummary: SessionSummary?
    private let sendResponse: SessionSendMessageResponsePayload?
    private var sendDelay: Duration = .zero
    private var modelsState: SystemModelsState
    private let failure: Failure?
    private var settingsItems: [SettingItem]
    private var modulesList: [ModuleInfo]
    private var mcpServersList: [McpServerInfo]
    private var cards: [Card]
    private var context: ContextView
    private var storageUsageRows: [StorageCategoryUsage]
    private let storagePreviewPayload: StorageCleanupPreviewResponsePayload?
    private let storageApplyPayload: StorageCleanupApplyResponsePayload?
    private var agentSessions: [AgentSessionInfo]

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
    private(set) var mcpAdds: [(name: String, transport: McpTransport, command: String?, args: [String]?, url: String?, allowedHosts: [String], clientRequestId: String?)] = []
    private(set) var mcpRemoves: [String] = []
    private(set) var mcpEnabled: [(serverId: String, enabled: Bool)] = []
    private(set) var mcpAllowedHosts: [(serverId: String, hosts: [String])] = []
    private(set) var mcpServerHandlerInstalled = false
    private var mcpServerHandler: (@Sendable (McpServersChangedEventPayload) -> Void)?
    private(set) var cardListCalls: [(cursor: String?, limit: Int?)] = []
    private(set) var cardSearches: [String] = []
    private(set) var cardPatches: [(cardId: String, baseRevision: String, patch: CardPatch)] = []
    private(set) var cardDeletes: [String] = []
    private(set) var cardRefreshes: [String] = []
    private(set) var contextAdds: [(sessionId: String, cardId: String)] = []
    private(set) var contextRemoves: [(sessionId: String, cardId: String)] = []
    private(set) var contextCompactions: [(sessionId: String, instructions: String?)] = []
    private(set) var archivedSessions: [(sessionId: String, purgeAfterDays: Int?)] = []
    private(set) var unarchivedSessions: [String] = []
    private(set) var deletionPreviews: [String] = []
    private(set) var deletedSessions: [String] = []
    private(set) var importedBlobIds: [String] = []
    private(set) var storageUsageCalls = 0
    private(set) var storagePreviewCategories: [[String]] = []
    private(set) var storageApplyCategories: [[String]] = []

    init(
        sessions: [SessionSummary] = [],
        listPages: [SessionListResponsePayload] = [],
        historyPages: [String?: SessionGetHistoryResponsePayload] = [:],
        snapshot: SessionSnapshot? = nil,
        createSummary: SessionSummary? = nil,
        sendResponse: SessionSendMessageResponsePayload? = nil,
        sendDelay: Duration = .zero,
        modelsState: SystemModelsState = SystemModelsState(providers: [], roles: [], resolved: []),
        settings: [SettingItem] = [],
        modules: [ModuleInfo] = [],
        mcpServers: [McpServerInfo] = [],
        cards: [Card] = [],
        context: ContextView? = nil,
        storageUsage: [StorageCategoryUsage] = [],
        storagePreview: StorageCleanupPreviewResponsePayload? = nil,
        storageApply: StorageCleanupApplyResponsePayload? = nil,
        agentSessions: [AgentSessionInfo] = [],
        failure: Failure? = nil
    ) {
        self.fallbackSessions = sessions
        self.listPages = listPages
        self.historyPages = historyPages
        self.snapshot = snapshot
        self.createSummary = createSummary
        self.sendResponse = sendResponse
        self.sendDelay = sendDelay
        self.modelsState = modelsState
        self.settingsItems = settings
        self.modulesList = modules
        self.mcpServersList = mcpServers
        self.cards = cards
        self.context = context ?? Fixtures.contextView()
        self.storageUsageRows = storageUsage
        self.storagePreviewPayload = storagePreview
        self.storageApplyPayload = storageApply
        self.agentSessions = agentSessions
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
        if failure == .create { throw Failure.create }
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
        if sendDelay > .zero { try await Task.sleep(for: sendDelay) }
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
        case "reject", "deny": effect = .reject
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

    // MARK: - McpService

    func listMcpServers() async throws -> McpServersListResponsePayload {
        McpServersListResponsePayload(servers: mcpServersList)
    }

    func addMcpServer(
        name: String,
        transport: McpTransport,
        command: String?,
        args: [String]?,
        url: String?,
        allowedHosts: [String],
        clientRequestId: String?
    ) async throws -> McpServerAddResponsePayload {
        mcpAdds.append((name, transport, command, args, url, allowedHosts, clientRequestId))
        return McpServerAddResponsePayload(approvalId: "approval-mcp")
    }

    func removeMcpServer(serverId: String) async throws -> McpServerRemoveResponsePayload {
        mcpRemoves.append(serverId)
        return McpServerRemoveResponsePayload(serverId: serverId, removed: true)
    }

    func setMcpServerEnabled(
        serverId: String,
        enabled: Bool,
        clientRequestId: String?
    ) async throws -> McpServerSetEnabledResponsePayload {
        mcpEnabled.append((serverId, enabled))
        guard let index = mcpServersList.firstIndex(where: { $0.serverId == serverId }) else {
            throw Failure.models
        }
        let current = mcpServersList[index]
        let updated = McpServerInfo(
            serverId: current.serverId,
            name: current.name,
            transport: current.transport,
            command: current.command,
            args: current.args,
            url: current.url,
            allowedHosts: current.allowedHosts,
            enabled: enabled,
            state: enabled ? .ready : .disabled,
            failure: enabled ? nil : current.failure,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt
        )
        mcpServersList[index] = updated
        return McpServerSetEnabledResponsePayload(server: updated)
    }

    func setMcpServerAllowedHosts(
        serverId: String,
        allowedHosts: [String]
    ) async throws -> McpServerAllowHostsResponsePayload {
        mcpAllowedHosts.append((serverId, allowedHosts))
        guard let index = mcpServersList.firstIndex(where: { $0.serverId == serverId }) else {
            throw Failure.models
        }
        let current = mcpServersList[index]
        let updated = McpServerInfo(
            serverId: current.serverId,
            name: current.name,
            transport: current.transport,
            command: current.command,
            args: current.args,
            url: current.url,
            allowedHosts: allowedHosts,
            enabled: current.enabled,
            state: current.state,
            failure: current.failure,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt
        )
        mcpServersList[index] = updated
        return McpServerAllowHostsResponsePayload(server: updated)
    }

    func setMcpServersChangedHandler(
        _ handler: (@Sendable (McpServersChangedEventPayload) -> Void)?
    ) async {
        mcpServerHandler = handler
        mcpServerHandlerInstalled = handler != nil
    }

    /// 從測試模擬事件到達；模型的事件處理應該更新資料。
    func emitMcpServersChanged(_ payload: McpServersChangedEventPayload) {
        mcpServerHandler?(payload)
    }

    // MARK: - AgentService

    func listAgents() async throws -> AgentListResponsePayload {
        AgentListResponsePayload(agents: agentSessions)
    }

    // MARK: - CardService

    func listCards(
        kinds: [CardKind]?,
        tags: [String]?,
        persona: String?,
        lifecycle: CardLifecycleFilter?,
        query: String?,
        includeSuperseded: Bool?,
        cursor: String?,
        limit: Int?
    ) async throws -> CardListResponsePayload {
        cardListCalls.append((cursor, limit))
        let summaries = cards
            .filter { lifecycle == nil || lifecycle == .all || $0.lifecycle == (lifecycle == .cold ? .cold : .live) }
            .filter { kinds?.contains($0.kind) ?? true }
            .map { cardSummary(of: $0) }
        return CardListResponsePayload(cards: summaries, nextCursor: nil)
    }

    func getCard(cardId: String) async throws -> CardGetResponsePayload {
        guard let card = cards.first(where: { $0.cardId == cardId }) else {
            throw Failure.models
        }
        return CardGetResponsePayload(card: card)
    }

    func createCard(
        kind: CardKind,
        title: String,
        body: String,
        summary: String?,
        tags: [String]?,
        persona: String?,
        sources: [String]?,
        supersedes: String?,
        assetBlobId: String?,
        clientRequestId: String
    ) async throws -> CardCreateResponsePayload {
        if let existing = cards.first(where: { $0.title == title && $0.body == body }) {
            return CardCreateResponsePayload(card: cardSummary(of: existing))
        }
        let card = Card(
            cardId: "card-\(cards.count + 1)",
            kind: kind,
            title: title,
            summary: summary,
            body: body,
            tags: tags ?? [],
            persona: persona ?? "default",
            createdAt: "2026-01-01T00:00:00Z",
            freshness: 100,
            lifecycle: .live,
            sources: sources ?? [],
            links: CardLinks(outgoing: [], backlinks: []),
            revision: "rev-1"
        )
        cards.append(card)
        return CardCreateResponsePayload(card: cardSummary(of: card))
    }

    func patchCard(
        cardId: String,
        baseRevision: String,
        patch: CardPatch,
        clientRequestId: String?
    ) async throws -> CardPatchResponsePayload {
        cardPatches.append((cardId, baseRevision, patch))
        guard let index = cards.firstIndex(where: { $0.cardId == cardId }) else {
            throw Failure.models
        }
        let current = cards[index]
        let updated = Card(
            cardId: current.cardId,
            kind: current.kind,
            title: current.title,
            summary: current.summary,
            body: patch.text,
            tags: current.tags,
            persona: current.persona,
            createdAt: current.createdAt,
            updatedAt: "2026-01-01T00:00:09Z",
            freshness: current.freshness,
            lifecycle: current.lifecycle,
            supersedes: current.supersedes,
            sources: current.sources,
            asset: current.asset,
            links: current.links,
            revision: "rev-2"
        )
        cards[index] = updated
        return CardPatchResponsePayload(card: updated)
    }

    func deleteCard(cardId: String, clientRequestId: String) async throws -> CardDeleteResponsePayload {
        cardDeletes.append(cardId)
        cards.removeAll { $0.cardId == cardId }
        return CardDeleteResponsePayload(cardId: cardId, deletedAssets: 0)
    }

    func searchCards(
        query: String,
        kinds: [CardKind]?,
        tags: [String]?,
        includeSuperseded: Bool?,
        limit: Int?,
        cursor: String?
    ) async throws -> CardSearchResponsePayload {
        cardSearches.append(query)
        let hits = cards
            .filter { $0.title.contains(query) || $0.body.contains(query) }
            .filter { kinds?.contains($0.kind) ?? true }
            .map { CardSearchHit(card: cardSummary(of: $0), score: 1, snippet: "…\(query)…") }
        return CardSearchResponsePayload(hits: hits, nextCursor: nil)
    }

    func refreshCard(cardId: String) async throws -> CardRefreshResponsePayload {
        cardRefreshes.append(cardId)
        return CardRefreshResponsePayload(cardId: cardId, freshness: 100)
    }

    // MARK: - ContextService

    func getContext(sessionId: String) async throws -> ContextGetResponsePayload {
        ContextGetResponsePayload(context: context)
    }

    func addCardToContext(
        sessionId: String,
        cardId: String
    ) async throws -> ContextAddCardResponsePayload {
        contextAdds.append((sessionId, cardId))
        return ContextAddCardResponsePayload(context: context)
    }

    func removeCardFromContext(
        sessionId: String,
        cardId: String
    ) async throws -> ContextRemoveCardResponsePayload {
        contextRemoves.append((sessionId, cardId))
        return ContextRemoveCardResponsePayload(context: context)
    }

    func compactContext(
        sessionId: String,
        instructions: String?
    ) async throws -> ContextCompactResponsePayload {
        contextCompactions.append((sessionId, instructions))
        return ContextCompactResponsePayload(sessionId: sessionId, scheduled: true)
    }

    // MARK: - SessionManagementService

    func archiveSession(
        sessionId: String,
        purgeAfterDays: Int?
    ) async throws -> SessionArchiveResponsePayload {
        archivedSessions.append((sessionId, purgeAfterDays))
        return SessionArchiveResponsePayload(
            sessionId: sessionId,
            archive: SessionArchive(
                archivedAt: "2026-01-01T00:00:00Z",
                purgeAt: "2026-01-31T00:00:00Z"
            )
        )
    }

    func unarchiveSession(sessionId: String) async throws -> SessionUnarchiveResponsePayload {
        unarchivedSessions.append(sessionId)
        return SessionUnarchiveResponsePayload(sessionId: sessionId, unarchived: true)
    }

    func previewSessionDeletion(
        sessionId: String
    ) async throws -> SessionDeletionPreviewResponsePayload {
        deletionPreviews.append(sessionId)
        return SessionDeletionPreviewResponsePayload(
            sessionId: sessionId,
            subtreeSessionIds: [sessionId],
            exclusiveCards: 2,
            sharedCards: 1,
            assets: 1
        )
    }

    func deleteSession(
        sessionId: String,
        clientRequestId: String
    ) async throws -> SessionDeleteResponsePayload {
        deletedSessions.append(sessionId)
        return SessionDeleteResponsePayload(
            sessionId: sessionId,
            deletedSessionIds: [sessionId],
            deletedCards: 2,
            deletedAssets: 1
        )
    }

    // MARK: - StorageService

    func getStorageUsage() async throws -> StorageUsageResponsePayload {
        storageUsageCalls += 1
        if failure == .storageUsage { throw Failure.storageUsage }
        return StorageUsageResponsePayload(usage: storageUsageRows)
    }

    func previewStorageCleanup(
        categories: [String]
    ) async throws -> StorageCleanupPreviewResponsePayload {
        storagePreviewCategories.append(categories)
        if failure == .storagePreview { throw Failure.storagePreview }
        if let storagePreviewPayload { return storagePreviewPayload }
        let targets = categories.map {
            StorageCleanupTarget(category: $0, items: 0, bytes: 0)
        }
        return StorageCleanupPreviewResponsePayload(targets: targets, totalBytes: 0)
    }

    func applyStorageCleanup(
        categories: [String]
    ) async throws -> StorageCleanupApplyResponsePayload {
        storageApplyCategories.append(categories)
        if failure == .storageApply { throw Failure.storageApply }
        if let storageApplyPayload { return storageApplyPayload }
        let targets = categories.map {
            StorageCleanupTarget(category: $0, items: 0, bytes: 0)
        }
        return StorageCleanupApplyResponsePayload(
            targets: targets,
            totalBytes: 0,
            recordId: "rec-storage-\(storageApplyCategories.count)"
        )
    }

    // MARK: - MediaImportService

    func importMedia(
        blobId: String,
        locale: String?,
        ocrLocales: [String]?,
        title: String?,
        tags: [String]?,
        persona: String?
    ) async throws -> MediaImportResponsePayload {
        importedBlobIds.append(blobId)
        return MediaImportResponsePayload(
            cardId: "card-image",
            kind: .image,
            textStandIn: MediaTextStandIn(
                sources: MediaTextStandInSources(
                    ocr: .local,
                    description: .smallModel,
                    transcript: .none,
                    summary: .none
                ),
                missingParts: []
            ),
            deduped: false
        )
    }

    private func cardSummary(of card: Card) -> CardSummary {
        CardSummary(
            cardId: card.cardId,
            kind: card.kind,
            title: card.title,
            summary: card.summary,
            tags: card.tags,
            persona: card.persona,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
            freshness: card.freshness,
            lifecycle: card.lifecycle,
            supersededBy: card.supersededBy,
            asset: card.asset
        )
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

    // MARK: - NotificationService

    func listNotifications(
        limit: Int?,
        before: String?,
        unreadOnly: Bool?
    ) async throws -> NotificationListResponsePayload {
        NotificationListResponsePayload(notifications: [], totalUnread: 0)
    }

    func markNotificationsRead(
        ids: [String]?,
        all: Bool?
    ) async throws -> NotificationMarkReadResponsePayload {
        NotificationMarkReadResponsePayload(updated: ids?.count ?? 0, totalUnread: 0)
    }

    func createCardFromNotification(
        notificationId: String
    ) async throws -> NotificationCreateCardResponsePayload {
        NotificationCreateCardResponsePayload(
            card: CardSummary(
                cardId: "card-\(notificationId)",
                kind: .note,
                title: "通知",
                tags: ["通知"],
                persona: "default",
                createdAt: "2026-01-01T00:00:00Z",
                freshness: 100,
                lifecycle: .live
            ),
            deduped: false
        )
    }
}

/// 測試用的媒體服務：記下上傳與匯入的呼叫，回固定資料。
actor FakeMediaService: MediaService {
    private(set) var uploads: [(fileURL: URL?, mediaType: String, bytes: Int)] = []
    private(set) var importedBlobIds: [String] = []
    private let blobId: String

    init(blobId: String = String(repeating: "a", count: 64)) {
        self.blobId = blobId
    }

    func upload(fileURL: URL, mediaType: String) async throws -> BlobInfo {
        let size = (try? Data(contentsOf: fileURL).count) ?? 0
        uploads.append((fileURL, mediaType, size))
        return BlobInfo(blobId: blobId, mediaType: mediaType, sizeBytes: size)
    }

    func upload(data: Data, mediaType: String) async throws -> BlobInfo {
        uploads.append((nil, mediaType, data.count))
        return BlobInfo(blobId: blobId, mediaType: mediaType, sizeBytes: data.count)
    }

    func download(blobId: String, variant: BlobClient.Variant?) async throws -> Data {
        Data()
    }

    func importMedia(
        blobId: String,
        locale: String?,
        ocrLocales: [String]?,
        title: String?,
        tags: [String]?,
        persona: String?
    ) async throws -> MediaImportResponsePayload {
        importedBlobIds.append(blobId)
        return MediaImportResponsePayload(
            cardId: "card-image",
            kind: .image,
            textStandIn: MediaTextStandIn(
                sources: MediaTextStandInSources(
                    ocr: .local,
                    description: .smallModel,
                    transcript: .none,
                    summary: .none
                ),
                missingParts: []
            ),
            deduped: false
        )
    }
}

/// 測試資料。全部用固定值，讓斷言看得出差異。
enum Fixtures {
    static func card(
        _ id: String,
        title: String? = nil,
        kind: CardKind = .note,
        body: String = "內文",
        tags: [String] = [],
        freshness: Int = 100,
        lifecycle: CardLifecycle = .live,
        revision: String = "rev-1"
    ) -> Card {
        Card(
            cardId: id,
            kind: kind,
            title: title ?? "卡片 \(id)",
            body: body,
            tags: tags,
            persona: "default",
            createdAt: "2026-01-01T00:00:00Z",
            freshness: freshness,
            lifecycle: lifecycle,
            sources: ["s1"],
            links: CardLinks(outgoing: [], backlinks: []),
            revision: revision
        )
    }

    static func contextView(
        sessionId: String = "s1",
        entries: [ContextEntry]? = nil
    ) -> ContextView {
        ContextView(
            sessionId: sessionId,
            version: 1,
            entries: entries ?? [
                ContextEntry(
                    entryId: "entry-1",
                    layer: .persona,
                    cardId: "card-persona",
                    title: "人格卡",
                    tokenEstimate: 120,
                    state: .active,
                    position: 0
                ),
                ContextEntry(
                    entryId: "entry-2",
                    layer: .workingContext,
                    title: "逐字稿",
                    tokenEstimate: 400,
                    state: .active,
                    position: 1
                ),
            ],
            usedTokens: 520,
            budgetTokens: 1000,
            contextWindow: 200_000,
            compactionThreshold: 0.75
        )
    }

    static func summary(        _ id: String,
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

    /// 外部代理會話；`startedAt` 可排序，方便測試快照順序。
    static func agentInfo(
        id: String = "agent-1",
        kind: AgentKind = .opencode,
        status: AgentStatus = .running,
        workingDirectory: String = "/work",
        progress: AgentProgress? = nil,
        message: String? = nil,
        resultUnknown: Bool? = nil,
        pendingPermission: AgentPendingPermission? = nil,
        startedAt: String = "2026-01-01T00:00:00Z"
    ) -> AgentSessionInfo {
        AgentSessionInfo(
            agentSessionId: id,
            agentKind: kind,
            status: status,
            workingDirectory: workingDirectory,
            progress: progress,
            message: message,
            resultUnknown: resultUnknown,
            pendingPermission: pendingPermission,
            startedAt: startedAt
        )
    }

    static func agentPermission(
        approvalId: String = "approval-1",
        toolName: String = "shell",
        description: String? = "執行指令"
    ) -> AgentPendingPermission {
        AgentPendingPermission(
            approvalId: approvalId,
            toolName: toolName,
            description: description
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
