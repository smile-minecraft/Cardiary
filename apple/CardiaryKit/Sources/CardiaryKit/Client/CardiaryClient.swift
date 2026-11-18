import Foundation

/// 連線失敗後的重連節奏。故意放慢到 4 秒上限，避免服務還沒準備好就被打滿。
public struct ReconnectPolicy: Equatable, Sendable {
    public var baseDelay: Duration
    public var maxDelay: Duration
    public var maxAttempts: Int?

    public init(
        baseDelay: Duration = .milliseconds(250),
        maxDelay: Duration = .seconds(4),
        maxAttempts: Int? = nil
    ) {
        self.baseDelay = baseDelay
        self.maxDelay = maxDelay
        self.maxAttempts = maxAttempts
    }

    public static let `default` = ReconnectPolicy()

    public func delay(afterAttempt attempt: Int) -> Duration {
        guard attempt > 1 else { return baseDelay }
        var delay = baseDelay
        for _ in 1..<attempt {
            delay = delay * 2
            if delay >= maxDelay { return maxDelay }
        }
        return min(delay, maxDelay)
    }
}

/// 殼使用的客戶端：負責連線、版本協商、訂閱與斷線重連。
///
/// 補送規則在 `StreamCursor`：重連時先比對 `system.hello` 回報的 epoch；不同就
/// 要求完整快照，不帶 `lastSeq`。同一個 epoch 才帶 `lastSeq` 補送。
public actor CardiaryClient {
    public struct Configuration: Sendable {
        public var endpoint: URL
        public var clientToken: String
        public var client: ClientInfo
        public var reconnect: ReconnectPolicy
        /// 是否在連上後列出並訂閱進行中的會話（待審批數量需要）。
        public var subscribeActiveSessions: Bool

        public init(
            endpoint: URL,
            clientToken: String,
            client: ClientInfo,
            reconnect: ReconnectPolicy = .default,
            subscribeActiveSessions: Bool = true
        ) {
            self.endpoint = endpoint
            self.clientToken = clientToken
            self.client = client
            self.reconnect = reconnect
            self.subscribeActiveSessions = subscribeActiveSessions
        }
    }

    public enum State: Equatable, Sendable {
        case idle
        case connecting(attempt: Int)
        case connected(epoch: String, serverVersion: String)
        case disconnected(reason: String)
        case stopped
    }

    private let configuration: Configuration
    private let transportFactory: @Sendable (URL) -> any CardiaryTransport

    private var connection: CardiaryConnection?
    private var state: State = .idle
    private var runTask: Task<Void, Never>?
    private var systemModel = SystemStatusModel()
    private var sessions: [String: SessionStreamModel] = [:]
    private var approvals = ApprovalCounter()
    /// 介面明確訂閱的會話。重連時除了進行中的會話，也要重新訂閱這些。
    private var subscribedSessionIds: Set<String> = []
    private var forceFullSnapshot = false
    private var hasConnectedBefore = false

    /// 回呼。殼在 `start()` 之前設定；之後只讀。
    public nonisolated let handlers = Handlers()

    public init(
        configuration: Configuration,
        transportFactory: @escaping @Sendable (URL) -> any CardiaryTransport = { WebSocketTransport(endpoint: $0) }
    ) {
        self.configuration = configuration
        self.transportFactory = transportFactory
    }

    public var currentState: State { state }

    public var systemStatus: SystemStatus? { systemModel.status }

    /// 目前的待審批清單（依請求時間排序）。介面在重連後用它補回內容。
    public var pendingApprovals: [ApprovalRequest] { approvals.requests }

    public func start() {
        guard runTask == nil else { return }
        runTask = Task { [weak self] in
            await self?.runLoop()
        }
    }

    public func stop() async {
        runTask?.cancel()
        runTask = nil
        await connection?.close()
        connection = nil
        update(state: .stopped)
    }

    /// 緊急全部暫停。連線不在時直接報錯，由畫面顯示「服務未連線」。
    public func pauseAllApprovals(reason: String) async throws {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        _ = try await connection.pauseAllApprovals(reason: reason)
    }

    // MARK: - 介面使用的請求

    /// 列出會話的一頁；`listAllSessions()` 會自動翻頁。
    public func listSessions(
        cursor: String? = nil,
        limit: Int? = nil
    ) async throws -> SessionListResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.listSessions(cursor: cursor, limit: limit)
    }

    /// 翻頁列出全部會話。頁數有上限，避免主機出問題時無限迴圈。
    public func listAllSessions() async throws -> [SessionSummary] {
        var summaries: [SessionSummary] = []
        var cursor: String?
        var pageCount = 0
        repeat {
            let page = try await listSessions(cursor: cursor, limit: 50)
            summaries.append(contentsOf: page.sessions)
            cursor = page.nextCursor
            pageCount += 1
        } while cursor != nil && pageCount < 20
        return summaries
    }

    public func createSession(
        clientRequestId: String,
        title: String? = nil
    ) async throws -> SessionCreateResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.createSession(clientRequestId: clientRequestId, title: title)
    }

    public func sendMessage(
        sessionId: String,
        text: String,
        delivery: DeliveryMode = .queue,
        clientMessageId: String? = nil
    ) async throws -> SessionSendMessageResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.sendMessage(
            sessionId: sessionId,
            text: text,
            delivery: delivery,
            clientMessageId: clientMessageId
        )
    }

    public func interruptSession(
        sessionId: String,
        reason: String? = nil
    ) async throws -> SessionInterruptResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.interruptSession(sessionId: sessionId, reason: reason)
    }

    /// 取得對話歷史；不帶 `cursor` 時從最新一段開始，往回翻頁帶上次回傳的游標。
    public func getHistory(
        sessionId: String,
        cursor: String? = nil,
        limit: Int? = nil
    ) async throws -> SessionGetHistoryResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.getHistory(sessionId: sessionId, cursor: cursor, limit: limit)
    }

    /// 訂閱一場會話。記錄在內部，重連時會自動重新訂閱（含帶 lastSeq 補送）。
    /// 回傳的快照（如果有）由呼叫端套用到畫面上。
    public func subscribeSession(
        sessionId: String,
        historyLimit: Int? = nil
    ) async throws -> SessionSubscribeResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        let existing = sessions[sessionId]
        let base = existing?.cursor ?? StreamCursor(stream: "session:\(sessionId)")
        let parameters = base.subscriptionParameters(currentEpoch: systemModel.cursor.epoch ?? "")
        let response = try await connection.subscribeSession(
            sessionId: sessionId,
            lastSeq: parameters.lastSeq,
            epoch: parameters.epoch,
            historyLimit: historyLimit
        )
        var model = existing ?? SessionStreamModel(sessionId: sessionId)
        if let snapshot = response.snapshot {
            model.applySnapshot(snapshot, epoch: response.epoch, seq: response.seq)
            // 快照帶著主機現在的待審批：重連時不必等補送事件，數量與內容就正確。
            approvals.adoptSnapshot(snapshot.pendingApproval, sessionId: sessionId)
            publishApprovals()
        } else {
            model.adoptEpochOnly(response.epoch)
        }
        sessions[sessionId] = model
        subscribedSessionIds.insert(sessionId)
        return response
    }

    /// 不再訂閱這場會話：通知主機取消訂閱，並從內部記錄移除，重連時不再重訂閱。
    /// 主機不在連線時略過通知，本地記錄照樣移除。
    public func unsubscribeSession(sessionId: String) async {
        subscribedSessionIds.remove(sessionId)
        sessions.removeValue(forKey: sessionId)
        if let connection {
            _ = try? await connection.unsubscribeSession(sessionId: sessionId)
        }
    }

    public func decideApproval(
        approvalId: String,
        optionId: String,
        note: String? = nil
    ) async throws -> ApprovalDecideResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.decideApproval(approvalId: approvalId, optionId: optionId, note: note)
    }

    public func getModels() async throws -> SystemModelsState {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.getModels()
    }

    public func setModels(
        providers: [ModelProviderInfo]? = nil,
        roles: [ModelRoleSelection]? = nil,
        clientRequestId: String
    ) async throws -> SystemModelsState {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.setModels(
            providers: providers,
            roles: roles,
            clientRequestId: clientRequestId
        )
    }

    public func getSettings() async throws -> SystemSettingsGetResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.getSettings()
    }

    public func setSettings(
        changes: [SettingChange],
        clientRequestId: String
    ) async throws -> SystemSettingsSetResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.setSettings(changes: changes, clientRequestId: clientRequestId)
    }

    public func getModules() async throws -> SystemModulesGetResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.getModules()
    }

    public func setModuleEnabled(
        moduleId: String,
        enabled: Bool,
        clientRequestId: String
    ) async throws -> SystemModulesSetEnabledResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.setModuleEnabled(
            moduleId: moduleId,
            enabled: enabled,
            clientRequestId: clientRequestId
        )
    }

    // MARK: - 儲存空間

    public func getStorageUsage() async throws -> StorageUsageResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.getStorageUsage()
    }

    public func previewStorageCleanup(
        categories: [String]
    ) async throws -> StorageCleanupPreviewResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.previewStorageCleanup(categories: categories)
    }

    public func applyStorageCleanup(
        categories: [String]
    ) async throws -> StorageCleanupApplyResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.applyStorageCleanup(categories: categories)
    }

    // MARK: - MCP

    /// `mcp.servers_changed` 的專用回呼；再設定一次會取代前一個，`nil` 取消訂閱。
    public var onMcpServersChanged: (@Sendable (McpServersChangedEventPayload) -> Void)? {
        get { handlers.onMcpServersChanged }
        set { handlers.onMcpServersChanged = newValue }
    }

    /// MCP 介面用非同步介面訂閱事件，讓測試替身可以用 actor 實作。
    public func setMcpServersChangedHandler(
        _ handler: (@Sendable (McpServersChangedEventPayload) -> Void)?
    ) async {
        onMcpServersChanged = handler
    }

    public func listMcpServers() async throws -> McpServersListResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.listMcpServers()
    }

    public func addMcpServer(
        name: String,
        transport: McpTransport,
        command: String? = nil,
        args: [String]? = nil,
        url: String? = nil,
        allowedHosts: [String] = [],
        clientRequestId: String? = nil,
        persistentData: Bool? = nil
    ) async throws -> McpServerAddResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.addMcpServer(
            name: name,
            transport: transport,
            command: command,
            args: args,
            url: url,
            allowedHosts: allowedHosts,
            clientRequestId: clientRequestId,
            persistentData: persistentData
        )
    }

    public func removeMcpServer(serverId: String) async throws -> McpServerRemoveResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.removeMcpServer(serverId: serverId)
    }

    public func setMcpServerEnabled(
        serverId: String,
        enabled: Bool,
        clientRequestId: String? = nil
    ) async throws -> McpServerSetEnabledResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.setMcpServerEnabled(
            serverId: serverId,
            enabled: enabled,
            clientRequestId: clientRequestId
        )
    }

    public func setMcpServerAllowedHosts(
        serverId: String,
        allowedHosts: [String]
    ) async throws -> McpServerAllowHostsResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.setMcpServerAllowedHosts(
            serverId: serverId,
            allowedHosts: allowedHosts
        )
    }

    // MARK: - 模組請求

    /// 對第一方模組（`module.*`）送請求，回傳回應的整個 payload（`{ data: … }`）。
    ///
    /// 匯入介面用它送 `module.import.*`；呼叫端從 `data` 解碼自己需要的型別。
    public func sendModuleRequest(
        _ type: String,
        payload: JSONValue
    ) async throws -> JSONValue {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.sendModuleRequest(type: type, payload: payload)
    }

    // MARK: - 卡片、上下文與封存

    /// 列出一頁卡片；翻頁帶上一次的 `cursor`。
    public func listCards(
        kinds: [CardKind]? = nil,
        tags: [String]? = nil,
        persona: String? = nil,
        lifecycle: CardLifecycleFilter? = nil,
        query: String? = nil,
        includeSuperseded: Bool? = nil,
        cursor: String? = nil,
        limit: Int? = nil
    ) async throws -> CardListResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.listCards(
            kinds: kinds,
            tags: tags,
            persona: persona,
            lifecycle: lifecycle,
            query: query,
            includeSuperseded: includeSuperseded,
            cursor: cursor,
            limit: limit
        )
    }

    public func getCard(cardId: String) async throws -> CardGetResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.getCard(cardId: cardId)
    }

    public func createCard(
        kind: CardKind,
        title: String,
        body: String,
        summary: String? = nil,
        tags: [String]? = nil,
        persona: String? = nil,
        sources: [String]? = nil,
        supersedes: String? = nil,
        assetBlobId: String? = nil,
        clientRequestId: String
    ) async throws -> CardCreateResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.createCard(
            kind: kind,
            title: title,
            body: body,
            summary: summary,
            tags: tags,
            persona: persona,
            sources: sources,
            supersedes: supersedes,
            assetBlobId: assetBlobId,
            clientRequestId: clientRequestId
        )
    }

    public func patchCard(
        cardId: String,
        baseRevision: String,
        patch: CardPatch,
        clientRequestId: String? = nil
    ) async throws -> CardPatchResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.patchCard(
            cardId: cardId,
            baseRevision: baseRevision,
            patch: patch,
            clientRequestId: clientRequestId
        )
    }

    public func listCardPatches(cardId: String) async throws -> CardPatchesListResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.listCardPatches(cardId: cardId)
    }

    public func acceptCardPatch(patchId: String, clientRequestId: String) async throws -> CardPatchAcceptResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.acceptCardPatch(patchId: patchId, clientRequestId: clientRequestId)
    }

    public func rejectCardPatch(patchId: String, clientRequestId: String) async throws -> CardPatchRejectResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.rejectCardPatch(patchId: patchId, clientRequestId: clientRequestId)
    }

    public func listCardVersions(cardId: String) async throws -> CardVersionsListResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.listCardVersions(cardId: cardId)
    }

    public func getCardVersion(cardId: String, versionId: String) async throws -> CardVersionGetResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.getCardVersion(cardId: cardId, versionId: versionId)
    }

    public func restoreCardVersion(cardId: String, versionId: String, baseRevision: String, clientRequestId: String) async throws -> CardVersionRestoreResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.restoreCardVersion(cardId: cardId, versionId: versionId, baseRevision: baseRevision, clientRequestId: clientRequestId)
    }

    public func deleteCard(
        cardId: String,
        clientRequestId: String
    ) async throws -> CardDeleteResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.deleteCard(cardId: cardId, clientRequestId: clientRequestId)
    }

    public func searchCards(
        query: String,
        kinds: [CardKind]? = nil,
        tags: [String]? = nil,
        includeSuperseded: Bool? = nil,
        limit: Int? = nil,
        cursor: String? = nil
    ) async throws -> CardSearchResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.searchCards(
            query: query,
            kinds: kinds,
            tags: tags,
            includeSuperseded: includeSuperseded,
            limit: limit,
            cursor: cursor
        )
    }

    public func refreshCard(cardId: String) async throws -> CardRefreshResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.refreshCard(cardId: cardId)
    }

    public func getContext(sessionId: String) async throws -> ContextGetResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.getContext(sessionId: sessionId)
    }

    public func addCardToContext(
        sessionId: String,
        cardId: String
    ) async throws -> ContextAddCardResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.addCardToContext(sessionId: sessionId, cardId: cardId)
    }

    public func removeCardFromContext(
        sessionId: String,
        cardId: String
    ) async throws -> ContextRemoveCardResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.removeCardFromContext(sessionId: sessionId, cardId: cardId)
    }

    public func compactContext(
        sessionId: String,
        instructions: String? = nil
    ) async throws -> ContextCompactResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.compactContext(
            sessionId: sessionId,
            instructions: instructions
        )
    }

    public func archiveSession(
        sessionId: String,
        purgeAfterDays: Int? = nil
    ) async throws -> SessionArchiveResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.archiveSession(
            sessionId: sessionId,
            purgeAfterDays: purgeAfterDays
        )
    }

    public func unarchiveSession(
        sessionId: String
    ) async throws -> SessionUnarchiveResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.unarchiveSession(sessionId: sessionId)
    }

    public func previewSessionDeletion(
        sessionId: String
    ) async throws -> SessionDeletionPreviewResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.previewSessionDeletion(sessionId: sessionId)
    }

    public func deleteSession(
        sessionId: String,
        clientRequestId: String
    ) async throws -> SessionDeleteResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.deleteSession(
            sessionId: sessionId,
            clientRequestId: clientRequestId
        )
    }

    public func importMedia(
        blobId: String,
        locale: String? = nil,
        ocrLocales: [String]? = nil,
        title: String? = nil,
        tags: [String]? = nil,
        persona: String? = nil
    ) async throws -> MediaImportResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.importMedia(
            blobId: blobId,
            locale: locale,
            ocrLocales: ocrLocales,
            title: title,
            tags: tags,
            persona: persona
        )
    }

    // MARK: - 白板

    /// 列出所有白板；儀表板用 `updatedAt` 排序。
    public func listBoards() async throws -> BoardListResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.listBoards()
    }

    public func getBoard(boardId: String) async throws -> BoardGetResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.getBoard(boardId: boardId)
    }

    // MARK: - 外部代理

    /// 列出主機目前追蹤的外部代理會話；`agent.state_changed` 會持續更新內容。
    public func listAgents() async throws -> AgentListResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.listAgents()
    }

    /// 啟動外部代理；主機會先建立啟動審批，核准後才真的啟動行程。
    public func startAgent(
        agentKind: AgentKind,
        workingDirectory: String,
        prompt: String?,
        clientRequestId: String?
    ) async throws -> AgentStartResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.startAgent(
            agentKind: agentKind,
            workingDirectory: workingDirectory,
            prompt: prompt,
            clientRequestId: clientRequestId
        )
    }

    /// 停止外部代理；還沒決定的審批會被撤回，行程會被收拾乾淨。
    public func stopAgent(agentSessionId: String) async throws -> AgentStopResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.stopAgent(agentSessionId: agentSessionId)
    }

    public func createBoard(
        boardId: String,
        title: String,
        clientRequestId: String
    ) async throws -> BoardCreateResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.createBoard(
            boardId: boardId,
            title: title,
            clientRequestId: clientRequestId
        )
    }

    /// 存回整份白板；過期的 `baseUpdatedAt` 會讓主機回 `conflict`。
    public func saveBoard(
        board: BoardDocument,
        baseUpdatedAt: String,
        clientRequestId: String? = nil
    ) async throws -> BoardSaveResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.saveBoard(
            board: board,
            baseUpdatedAt: baseUpdatedAt,
            clientRequestId: clientRequestId
        )
    }

    public func deleteBoard(boardId: String) async throws -> BoardDeleteResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.deleteBoard(boardId: boardId)
    }

    /// 人類把既有卡投影到畫布上；釘選在這邊帶。
    public func projectCardOnBoard(
        boardId: String,
        itemId: String,
        cardId: String,
        position: BoardPoint,
        size: BoardSize? = nil,
        groupId: String? = nil,
        pinned: Bool? = nil
    ) async throws -> BoardProjectCardResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.projectCardOnBoard(
            boardId: boardId,
            itemId: itemId,
            cardId: cardId,
            position: position,
            size: size,
            groupId: groupId,
            pinned: pinned
        )
    }

    public func unprojectCardOnBoard(
        boardId: String,
        itemId: String
    ) async throws -> BoardUnprojectCardResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.unprojectCardOnBoard(boardId: boardId, itemId: itemId)
    }

    /// 圈選既有卡片後生成一張新卡，血緣記在 `cardIds`。
    public func createCardFromSelection(
        boardId: String,
        cardIds: [String],
        title: String,
        body: String,
        itemId: String,
        position: BoardPoint,
        clientRequestId: String
    ) async throws -> BoardCreateCardFromSelectionResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.createCardFromSelection(
            boardId: boardId,
            cardIds: cardIds,
            title: title,
            body: body,
            itemId: itemId,
            position: position,
            clientRequestId: clientRequestId
        )
    }

    // MARK: - 通知

    public func listNotifications(
        limit: Int? = nil,
        before: String? = nil,
        unreadOnly: Bool? = nil
    ) async throws -> NotificationListResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.listNotifications(
            limit: limit,
            before: before,
            unreadOnly: unreadOnly
        )
    }

    public func markNotificationsRead(
        ids: [String]? = nil,
        all: Bool? = nil
    ) async throws -> NotificationMarkReadResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.markNotificationsRead(ids: ids, all: all)
    }

    public func createCardFromNotification(
        notificationId: String
    ) async throws -> NotificationCreateCardResponsePayload {
        guard let connection else { throw CardiaryClientError.connectionClosed }
        return try await connection.createCardFromNotification(notificationId: notificationId)
    }

    // MARK: - 連線迴圈

    private func runLoop() async {
        var attempt = 0
        while !Task.isCancelled {
            attempt += 1
            update(state: .connecting(attempt: attempt))
            do {
                try await connectOnce()
                // 連線期間出錯會拋出，統一由下面的 catch 處理。
            } catch {
                if Task.isCancelled { return }
                let reason = (error as? CardiaryClientError)?.errorDescription ?? "\(error)"
                update(state: .disconnected(reason: reason))
                handlers.onDiagnostic?("客戶端連線中斷：\(reason)")

                if case .incompatibleVersion = error as? CardiaryClientError {
                    // 版本不符不是暫時性錯誤：停止重連，由畫面顯示「需要更新」。
                    handlers.onDiagnostic?("協定版本不符，停止重連。")
                    return
                }

                if let maxAttempts = configuration.reconnect.maxAttempts, attempt >= maxAttempts {
                    return
                }
                let delay = configuration.reconnect.delay(afterAttempt: attempt)
                try? await Task.sleep(for: delay)
                continue
            }
            attempt = 0
        }
    }

    private func connectOnce() async throws {
        let connection = CardiaryConnection(
            transport: transportFactory(configuration.endpoint),
            clientToken: configuration.clientToken
        )
        self.connection = connection

        let handshake: CardiaryConnection.Handshake
        do {
            handshake = try await connection.open(
                client: configuration.client,
                resumeSystemSeq: systemModel.cursor.lastSeq > 0 ? systemModel.cursor.lastSeq : nil
            )
        } catch {
            // 連線失敗要收掉底層 transport，否則重連會累積半開的連線。
            await connection.close()
            self.connection = nil
            throw error
        }

        let epochChanged = hasConnectedBefore && systemModel.cursor.epoch != nil
            && systemModel.cursor.epoch != handshake.epoch
        if epochChanged || forceFullSnapshot {
            // 舊 epoch 的 lastSeq 一律無效：丟掉游標與會話狀態，要求完整快照。
            systemModel = SystemStatusModel(epoch: handshake.epoch, lastSeq: 0)
            sessions.removeAll()
            approvals.reset()
            publishApprovals()
            forceFullSnapshot = false
            handlers.onDiagnostic?("事件 epoch 改變（\(handshake.epoch)），重新載入快照。")
            handlers.onEpochChange?(handshake.epoch)
        }
        hasConnectedBefore = true
        if systemModel.cursor.epoch == nil {
            systemModel = SystemStatusModel(epoch: handshake.epoch, lastSeq: 0)
        }
        update(state: .connected(epoch: handshake.epoch, serverVersion: handshake.serverVersion))

        let parameters = systemModel.cursor.subscriptionParameters(currentEpoch: handshake.epoch)
        let subscribe: SystemSubscribeResponsePayload
        do {
            subscribe = try await connection.subscribeSystem(
                lastSeq: parameters.lastSeq,
                epoch: parameters.epoch
            )
        } catch {
            await connection.close()
            self.connection = nil
            throw error
        }
        if let snapshot = subscribe.snapshot {
            systemModel.applySnapshot(snapshot, epoch: subscribe.epoch, seq: subscribe.seq)
            // 只有真的套用快照才回報一次；補送的情況等事件推進，避免重複通知。
            if let status = systemModel.status {
                handlers.onSystemStatus?(status)
            }
        } else {
            // 沒有快照代表主機要補送 lastSeq + 1 到回應 seq 的事件；保留 lastSeq，
            // 讓補送事件推進游標，否則全部會被當成重複。
            systemModel.adoptEpochOnly(subscribe.epoch)
        }
        // 快照帶著主機現在的待決宿主審批（沒有對話的審批）。只替換
        // sessionId 為空的項目，會話快照或事件帶進來的不動。
        approvals.adoptSystemSnapshot(subscribe.pendingApprovals)
        publishApprovals()

        if configuration.subscribeActiveSessions || !subscribedSessionIds.isEmpty {
            await subscribeActiveSessions(on: connection, epoch: subscribe.epoch)
        }

        for await frame in connection.events {
            if Task.isCancelled { break }
            handle(frame: frame, connectionEpoch: handshake.epoch, connection: connection)
        }
        await connection.close()
        if Task.isCancelled { return }
        throw CardiaryClientError.connectionClosed
    }

    private func subscribeActiveSessions(on connection: CardiaryConnection, epoch: String) async {
        do {
            var summaries: [SessionSummary] = []
            if configuration.subscribeActiveSessions {
                summaries = try await listAllSessions()
            } else {
                // 只列進行中的會話沒有意義；呼叫端只訂閱明確記錄的會話時直接用記錄。
                summaries = []
            }

            var idsToSubscribe = subscribedSessionIds
            idsToSubscribe.formUnion(summaries.filter { $0.status == .running }.map(\.id))

            for id in idsToSubscribe {
                let existing = sessions[id]
                let parameters = (existing?.cursor ?? StreamCursor(stream: "session:\(id)"))
                    .subscriptionParameters(currentEpoch: epoch)
                let response = try await connection.subscribeSession(
                    sessionId: id,
                    lastSeq: parameters.lastSeq,
                    epoch: parameters.epoch
                )
                var model = existing ?? SessionStreamModel(sessionId: id)
                if let snapshot = response.snapshot {
                    model.applySnapshot(snapshot, epoch: response.epoch, seq: response.seq)
                    approvals.adoptSnapshot(snapshot.pendingApproval, sessionId: id)
                    publishApprovals()
                } else {
                    // 同 epoch 的補送：保留 lastSeq，等事件推進。
                    model.adoptEpochOnly(response.epoch)
                }
                sessions[id] = model
            }
        } catch {
            // 會話列表失敗不影響系統串流；待審批數量會在下次重連時補上。
            handlers.onDiagnostic?("列出會話失敗：\(error)")
        }
    }

    private func handle(
        frame: ServerFrame,
        connectionEpoch: String,
        connection: CardiaryConnection
    ) {
        // 每一則事件都轉交給介面；view model 自己過濾感興趣的串流。
        handlers.onSessionEvent?(frame)
        if case .moduleEvent = frame {
            handlers.onModuleEvent?(frame)
        }
        if case .boardChangedEvent(let event) = frame {
            handlers.onBoardChanged?(event.payload)
        }
        if case .mcpServersChangedEvent(let event) = frame {
            handlers.onMcpServersChanged?(event.payload)
        }

        switch frame {
        case .systemStatusEvent(let event):
            let advance = systemModel.apply(event)
            switch advance {
            case .applied:
                if let status = systemModel.status {
                    handlers.onSystemStatus?(status)
                }
            case .gap:
                forceFullSnapshot = true
                handlers.onDiagnostic?("system 串流有缺口，要求完整快照。")
                Task { await connection.close() }
            case .epochChanged:
                forceFullSnapshot = true
                Task { await connection.close() }
            case .duplicate:
                break
            }

        default:
            approvals.apply(frame)
            publishApprovals()

            if let stream = frame.eventStream, let sessionId = Self.sessionId(from: stream),
                var model = sessions[sessionId]
            {
                let advance = model.apply(frame)
                sessions[sessionId] = model
                if case .gap = advance {
                    forceFullSnapshot = true
                    Task { await connection.close() }
                }
            }
        }
    }

    /// 待審批數量與內容一起送給介面：選單列用數量，檢視欄用清單。
    private func publishApprovals() {
        handlers.onApprovalCount?(approvals.count)
        handlers.onApprovals?(approvals.requests)
    }

    private static func sessionId(from stream: String) -> String? {
        let prefix = "session:"
        guard stream.hasPrefix(prefix) else { return nil }
        return String(stream.dropFirst(prefix.count))
    }

    private func update(state: State) {
        guard self.state != state else { return }
        self.state = state
        handlers.onStateChange?(state)
    }
}


/// 客戶端的回呼集合。用鎖保護，讓殼與測試可以從任何執行緒設定與讀取。
public final class Handlers: @unchecked Sendable {
    private let lock = NSLock()
    private var stateHandler: (@Sendable (CardiaryClient.State) -> Void)?
    private var statusHandler: (@Sendable (SystemStatus) -> Void)?
    private var approvalHandler: (@Sendable (Int) -> Void)?
    private var approvalsHandler: (@Sendable ([ApprovalRequest]) -> Void)?
    private var diagnosticHandler: (@Sendable (String) -> Void)?
    private var sessionEventHandler: (@Sendable (ServerFrame) -> Void)?
    private var moduleEventHandler: (@Sendable (ServerFrame) -> Void)?
    private var boardChangedHandler: (@Sendable (BoardChangedEventPayload) -> Void)?
    private var mcpServersChangedHandler: (@Sendable (McpServersChangedEventPayload) -> Void)?
    private var epochChangeHandler: (@Sendable (String) -> Void)?

    public init() {}

    public var onStateChange: (@Sendable (CardiaryClient.State) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return stateHandler }
        set { lock.lock(); stateHandler = newValue; lock.unlock() }
    }

    public var onSystemStatus: (@Sendable (SystemStatus) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return statusHandler }
        set { lock.lock(); statusHandler = newValue; lock.unlock() }
    }

    public var onApprovalCount: (@Sendable (Int) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return approvalHandler }
        set { lock.lock(); approvalHandler = newValue; lock.unlock() }
    }

    /// 待審批的完整清單。檢視欄用它畫內容，數量與內容在同一次呼叫送出。
    public var onApprovals: (@Sendable ([ApprovalRequest]) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return approvalsHandler }
        set { lock.lock(); approvalsHandler = newValue; lock.unlock() }
    }

    public var onDiagnostic: (@Sendable (String) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return diagnosticHandler }
        set { lock.lock(); diagnosticHandler = newValue; lock.unlock() }
    }

    /// 每一則伺服器事件（不含回應）都會觸發；介面過濾需要的串流。
    public var onSessionEvent: (@Sendable (ServerFrame) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return sessionEventHandler }
        set { lock.lock(); sessionEventHandler = newValue; lock.unlock() }
    }

    /// 只轉送 `module.*` 事件；匯入流程用它接進度，不必動共用的 `onSessionEvent`。
    public var onModuleEvent: (@Sendable (ServerFrame) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return moduleEventHandler }
        set { lock.lock(); moduleEventHandler = newValue; lock.unlock() }
    }

    /// 只轉送 `board.changed`；白板畫面訂閱這一個，不必自己拆 frame。
    public var onBoardChanged: (@Sendable (BoardChangedEventPayload) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return boardChangedHandler }
        set { lock.lock(); boardChangedHandler = newValue; lock.unlock() }
    }

    /// 只轉送 `mcp.servers_changed`；MCP 設定畫面訂閱這一個，不必自己拆 frame。
    public var onMcpServersChanged: (@Sendable (McpServersChangedEventPayload) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return mcpServersChangedHandler }
        set { lock.lock(); mcpServersChangedHandler = newValue; lock.unlock() }
    }

    /// 收到與先前不同的 epoch（或串流缺口後被迫重載）時觸發，帶新的 epoch。
    /// 介面應丟棄本地狀態並從快照重新載入。
    public var onEpochChange: (@Sendable (String) -> Void)? {
        get { lock.lock(); defer { lock.unlock() }; return epochChangeHandler }
        set { lock.lock(); epochChangeHandler = newValue; lock.unlock() }
    }
}
