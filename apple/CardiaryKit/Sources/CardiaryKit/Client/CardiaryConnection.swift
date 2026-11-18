import Foundation

/// 一條已建立且完成版本協商的客戶端連線。
///
/// 負責 frame 的收送、`replyTo` 對應與版本檢查；重連、epoch 比對與補送的決策
/// 在 `CardiaryClient`。事件透過 `events` 串流送出，呼叫端在自己的工作裡消費。
public actor CardiaryConnection {
    /// `system.hello` 的結果。
    public struct Handshake: Equatable, Sendable {
        public let connectionId: String
        /// 這次連線所屬的事件 epoch。重連時用來判斷要不要重新載入快照。
        public let epoch: String
        public let negotiatedVersion: Int
        public let limits: ServerLimits
        public let capabilities: ServerCapabilities
        public let serverName: String
        public let serverVersion: String
    }

    public struct RequestOptions: Sendable {
        public var timeout: Duration

        public init(timeout: Duration = .seconds(10)) {
            self.timeout = timeout
        }

        public static let `default` = RequestOptions()
    }

    public nonisolated let events: AsyncStream<ServerFrame>

    private let transport: any CardiaryTransport
    private let clientToken: String
    private let eventContinuation: AsyncStream<ServerFrame>.Continuation

    private var pending: [String: CheckedContinuation<ServerFrame, Error>] = [:]
    private var readerTask: Task<Void, Never>?
    private var closed = false
    private var handshake: Handshake?

    public init(transport: any CardiaryTransport, clientToken: String) {
        self.transport = transport
        self.clientToken = clientToken
        let (stream, continuation) = AsyncStream.makeStream(of: ServerFrame.self)
        self.events = stream
        self.eventContinuation = continuation
    }

    /// 送出 `system.hello`、驗證版本並回傳協商結果。
    ///
    /// `resumeSystemSeq` 只用於診斷：主機不靠它決定補送，補送由每個訂閱各自的
    /// `lastSeq` 與 `epoch` 決定。
    public func open(
        client: ClientInfo,
        resumeSystemSeq: Int? = nil,
        options: RequestOptions = .default
    ) async throws -> Handshake {
        guard !closed else { throw CardiaryClientError.connectionClosed }
        if let handshake { return handshake }

        let request = SystemHelloRequest(
            id: RequestID.next(),
            payload: SystemHelloRequestPayload(
                auth: HelloAuth(token: clientToken),
                protocol: ProtocolRange(min: ProtocolVersion.current, max: ProtocolVersion.current),
                client: client,
                resume: resumeSystemSeq.map { HelloResume(systemSeq: $0) }
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .systemHelloResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "system.hello 收到 \(frame.kindLabel) 而不是回應。"
            )
        }

        let negotiated = response.payload.protocol.version
        guard negotiated == ProtocolVersion.current else {
            throw CardiaryClientError.incompatibleVersion(
                serverMin: response.payload.protocol.min,
                serverMax: response.payload.protocol.max
            )
        }

        let result = Handshake(
            connectionId: response.payload.connectionId,
            epoch: response.payload.epoch,
            negotiatedVersion: negotiated,
            limits: response.payload.limits,
            capabilities: response.payload.capabilities,
            serverName: response.payload.server.name,
            serverVersion: response.payload.server.version
        )
        handshake = result
        return result
    }

    /// 訂閱 `system` 串流。帶 `lastSeq` 與 `epoch` 時主機會嘗試補送；不帶就回快照。
    public func subscribeSystem(
        lastSeq: Int? = nil,
        epoch: String? = nil,
        options: RequestOptions = .default
    ) async throws -> SystemSubscribeResponsePayload {
        let request = SystemSubscribeRequest(
            id: RequestID.next(),
            payload: SystemSubscribeRequestPayload(lastSeq: lastSeq, epoch: epoch)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .systemSubscribeResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "system.subscribe 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 訂閱單一會話串流。
    public func subscribeSession(
        sessionId: String,
        lastSeq: Int? = nil,
        epoch: String? = nil,
        historyLimit: Int? = nil,
        options: RequestOptions = .default
    ) async throws -> SessionSubscribeResponsePayload {
        let request = SessionSubscribeRequest(
            id: RequestID.next(),
            payload: SessionSubscribeRequestPayload(
                sessionId: sessionId,
                lastSeq: lastSeq,
                epoch: epoch,
                historyLimit: historyLimit
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .sessionSubscribeResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "session.subscribe 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 取消訂閱單一會話串流。
    public func unsubscribeSession(
        sessionId: String,
        options: RequestOptions = .default
    ) async throws -> SessionUnsubscribeResponsePayload {
        let request = SessionUnsubscribeRequest(
            id: RequestID.next(),
            payload: SessionUnsubscribeRequestPayload(sessionId: sessionId)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .sessionUnsubscribeResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "session.unsubscribe 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func listSessions(
        cursor: String? = nil,
        limit: Int? = nil,
        options: RequestOptions = .default
    ) async throws -> SessionListResponsePayload {
        let request = SessionListRequest(
            id: RequestID.next(),
            payload: SessionListRequestPayload(cursor: cursor, limit: limit)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .sessionListResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "session.list 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 緊急全部暫停：暫停所有等待中的審批。
    public func pauseAllApprovals(
        reason: String? = nil,
        options: RequestOptions = .default
    ) async throws -> ApprovalPauseAllResponsePayload {
        let request = ApprovalPauseAllRequest(
            id: RequestID.next(),
            payload: ApprovalPauseAllRequestPayload(reason: reason)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .approvalPauseAllResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "approval.pause_all 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 建立一場對話；帶 `clientRequestId` 時重送不會建立第二場。
    public func createSession(
        clientRequestId: String? = nil,
        title: String? = nil,
        options: RequestOptions = .default
    ) async throws -> SessionCreateResponsePayload {
        let request = SessionCreateRequest(
            id: RequestID.next(),
            payload: SessionCreateRequestPayload(title: title, clientRequestId: clientRequestId)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .sessionCreateResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "session.create 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 取得對話的歷史訊息；不帶 `cursor` 時從最新一段開始。
    public func getHistory(
        sessionId: String,
        cursor: String? = nil,
        limit: Int? = nil,
        options: RequestOptions = .default
    ) async throws -> SessionGetHistoryResponsePayload {
        let request = SessionGetHistoryRequest(
            id: RequestID.next(),
            payload: SessionGetHistoryRequestPayload(sessionId: sessionId, cursor: cursor, limit: limit)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .sessionGetHistoryResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "session.get_history 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 中斷一場對話進行中的工作。
    public func interruptSession(
        sessionId: String,
        reason: String? = nil,
        options: RequestOptions = .default
    ) async throws -> SessionInterruptResponsePayload {
        let request = SessionInterruptRequest(
            id: RequestID.next(),
            payload: SessionInterruptRequestPayload(sessionId: sessionId, reason: reason)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .sessionInterruptResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "session.interrupt 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func getModels(
        options: RequestOptions = .default
    ) async throws -> SystemModelsState {
        let request = SystemModelsGetRequest(
            id: RequestID.next(),
            payload: SystemModelsGetRequestPayload()
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .systemModelsGetResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "system.models.get 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func setModels(
        providers: [ModelProviderInfo]? = nil,
        roles: [ModelRoleSelection]? = nil,
        clientRequestId: String,
        options: RequestOptions = .default
    ) async throws -> SystemModelsState {
        let request = SystemModelsSetRequest(
            id: RequestID.next(),
            payload: SystemModelsSetRequestPayload(
                providers: providers,
                roles: roles,
                clientRequestId: clientRequestId
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .systemModelsSetResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "system.models.set 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func getSettings(
        options: RequestOptions = .default
    ) async throws -> SystemSettingsGetResponsePayload {
        let request = SystemSettingsGetRequest(
            id: RequestID.next(),
            payload: SystemSettingsGetRequestPayload()
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .systemSettingsGetResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "system.settings.get 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func setSettings(
        changes: [SettingChange],
        clientRequestId: String,
        options: RequestOptions = .default
    ) async throws -> SystemSettingsSetResponsePayload {
        let request = SystemSettingsSetRequest(
            id: RequestID.next(),
            payload: SystemSettingsSetRequestPayload(
                changes: changes,
                clientRequestId: clientRequestId
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .systemSettingsSetResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "system.settings.set 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func getModules(
        options: RequestOptions = .default
    ) async throws -> SystemModulesGetResponsePayload {
        let request = SystemModulesGetRequest(
            id: RequestID.next(),
            payload: SystemModulesGetRequestPayload()
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .systemModulesGetResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "system.modules.get 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func setModuleEnabled(
        moduleId: String,
        enabled: Bool,
        clientRequestId: String,
        options: RequestOptions = .default
    ) async throws -> SystemModulesSetEnabledResponsePayload {
        let request = SystemModulesSetEnabledRequest(
            id: RequestID.next(),
            payload: SystemModulesSetEnabledRequestPayload(
                moduleId: moduleId,
                enabled: enabled,
                clientRequestId: clientRequestId
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .systemModulesSetEnabledResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "system.modules.set_enabled 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    // MARK: - 儲存空間

    public func getStorageUsage(
        options: RequestOptions = .default
    ) async throws -> StorageUsageResponsePayload {
        let request = StorageUsageRequest(
            id: RequestID.next(),
            payload: StorageUsageRequestPayload()
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .storageUsageResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "storage.usage 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func previewStorageCleanup(
        categories: [String],
        options: RequestOptions = .default
    ) async throws -> StorageCleanupPreviewResponsePayload {
        let request = StorageCleanupPreviewRequest(
            id: RequestID.next(),
            payload: StorageCleanupPreviewRequestPayload(categories: categories)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .storageCleanupPreviewResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "storage.cleanup.preview 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func applyStorageCleanup(
        categories: [String],
        options: RequestOptions = .default
    ) async throws -> StorageCleanupApplyResponsePayload {
        let request = StorageCleanupApplyRequest(
            id: RequestID.next(),
            payload: StorageCleanupApplyRequestPayload(categories: categories)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .storageCleanupApplyResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "storage.cleanup.apply 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    // MARK: - MCP

    public func listMcpServers(
        options: RequestOptions = .default
    ) async throws -> McpServersListResponsePayload {
        let request = McpServersListRequest(
            id: RequestID.next(),
            payload: McpServersListRequestPayload()
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .mcpServersListResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "mcp.servers.list 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 新增伺服器。這一步只送審批：回應帶 `approvalId`，批准後才以
    /// `mcp.servers_changed` 事件通知實際結果。
    ///
    /// `persistentData` 是使用者是否授權它寫入自己的持久資料目錄；只有標準輸入的
    /// 伺服器有這個選項。傳 `nil` 表示不指定，主機一律視為不授權。
    public func addMcpServer(
        name: String,
        transport: McpTransport,
        command: String? = nil,
        args: [String]? = nil,
        url: String? = nil,
        allowedHosts: [String] = [],
        clientRequestId: String? = nil,
        persistentData: Bool? = nil,
        options: RequestOptions = .default
    ) async throws -> McpServerAddResponsePayload {
        let request = McpServerAddRequest(
            id: RequestID.next(),
            payload: McpServerAddRequestPayload(
                name: name,
                transport: transport,
                command: command,
                args: args,
                url: url,
                allowedHosts: allowedHosts,
                clientRequestId: clientRequestId,
                persistentData: persistentData
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .mcpServerAddResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "mcp.server.add 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func removeMcpServer(
        serverId: String,
        options: RequestOptions = .default
    ) async throws -> McpServerRemoveResponsePayload {
        let request = McpServerRemoveRequest(
            id: RequestID.next(),
            payload: McpServerRemoveRequestPayload(serverId: serverId)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .mcpServerRemoveResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "mcp.server.remove 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func setMcpServerEnabled(
        serverId: String,
        enabled: Bool,
        clientRequestId: String? = nil,
        options: RequestOptions = .default
    ) async throws -> McpServerSetEnabledResponsePayload {
        let request = McpServerSetEnabledRequest(
            id: RequestID.next(),
            payload: McpServerSetEnabledRequestPayload(
                serverId: serverId,
                enabled: enabled,
                clientRequestId: clientRequestId
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .mcpServerSetEnabledResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "mcp.server.set_enabled 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func setMcpServerAllowedHosts(
        serverId: String,
        allowedHosts: [String],
        options: RequestOptions = .default
    ) async throws -> McpServerAllowHostsResponsePayload {
        let request = McpServerAllowHostsRequest(
            id: RequestID.next(),
            payload: McpServerAllowHostsRequestPayload(
                serverId: serverId,
                allowedHosts: allowedHosts
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .mcpServerAllowHostsResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "mcp.server.allow_hosts 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 對第一方模組的 `module.*` 請求。
    ///
    /// 請求與回應的 payload 都是 `{ data: … }`（`protocol.md` 第 6 節）；這裡
    /// 回傳整個回應 payload，呼叫端自己從 `data` 解碼。回應由 `perform` 的
    /// `replyTo` 對應，與其他請求走同一條 resume 路徑。
    public func sendModuleRequest(
        type: String,
        payload: JSONValue,
        options: RequestOptions = .default
    ) async throws -> JSONValue {
        guard case .object(let data) = payload else {
            throw CardiaryClientError.invalidFrame("\(type) 的 payload 必須是 JSON 物件。")
        }
        let request = ModuleRequest(
            id: RequestID.next(),
            type: type,
            payload: ModuleRequestPayload(data: data)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .moduleResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame("\(type) 收到 \(frame.kindLabel) 而不是回應。")
        }
        return .object(["data": .object(response.payload.data)])
    }

    /// 送一則使用者訊息；`clientMessageId` 讓重送不會新增訊息。
    public func sendMessage(
        sessionId: String,
        text: String,
        delivery: DeliveryMode = .queue,
        clientMessageId: String? = nil,
        options: RequestOptions = .default
    ) async throws -> SessionSendMessageResponsePayload {
        let request = SessionSendMessageRequest(
            id: RequestID.next(),
            payload: SessionSendMessageRequestPayload(
                sessionId: sessionId,
                text: text,
                delivery: delivery,
                clientMessageId: clientMessageId
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .sessionSendMessageResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "session.send_message 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 送出審批決定；`optionId` 是請求裡的選項（例如 `approve`、`deny`）。
    public func decideApproval(
        approvalId: String,
        optionId: String,
        note: String? = nil,
        options: RequestOptions = .default
    ) async throws -> ApprovalDecideResponsePayload {
        let request = ApprovalDecideRequest(
            id: RequestID.next(),
            payload: ApprovalDecideRequestPayload(
                approvalId: approvalId,
                optionId: optionId,
                note: note
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .approvalDecideResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "approval.decide 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    // MARK: - 卡片

    /// 列出一頁卡片；篩選條件沒帶的欄位不會出現在請求裡。
    public func listCards(
        kinds: [CardKind]? = nil,
        tags: [String]? = nil,
        persona: String? = nil,
        lifecycle: CardLifecycleFilter? = nil,
        query: String? = nil,
        includeSuperseded: Bool? = nil,
        cursor: String? = nil,
        limit: Int? = nil,
        options: RequestOptions = .default
    ) async throws -> CardListResponsePayload {
        let request = CardListRequest(
            id: RequestID.next(),
            payload: CardListRequestPayload(
                kinds: kinds,
                tags: tags,
                persona: persona,
                lifecycle: lifecycle,
                query: query,
                includeSuperseded: includeSuperseded,
                cursor: cursor,
                limit: limit
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .cardListResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "card.list 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func getCard(
        cardId: String,
        options: RequestOptions = .default
    ) async throws -> CardGetResponsePayload {
        let request = CardGetRequest(
            id: RequestID.next(),
            payload: CardGetRequestPayload(cardId: cardId)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .cardGetResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "card.get 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 建立一張卡片；`clientRequestId` 讓重送不會建立第二張。
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
        clientRequestId: String,
        options: RequestOptions = .default
    ) async throws -> CardCreateResponsePayload {
        let request = CardCreateRequest(
            id: RequestID.next(),
            payload: CardCreateRequestPayload(
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
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .cardCreateResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "card.create 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 以 `baseRevision` 做樂觀鎖套用補丁；revision 不符時主機回 `conflict`。
    public func patchCard(
        cardId: String,
        baseRevision: String,
        patch: CardPatch,
        clientRequestId: String? = nil,
        options: RequestOptions = .default
    ) async throws -> CardPatchResponsePayload {
        let request = CardPatchRequest(
            id: RequestID.next(),
            payload: CardPatchRequestPayload(
                cardId: cardId,
                baseRevision: baseRevision,
                patch: patch,
                clientRequestId: clientRequestId
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .cardPatchResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "card.patch 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func listCardPatches(cardId: String, options: RequestOptions = .default) async throws -> CardPatchesListResponsePayload {
        let request = CardPatchesListRequest(id: RequestID.next(), payload: CardPatchesListRequestPayload(cardId: cardId, status: .pending))
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .cardPatchesListResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame("card.patches.list 收到 \(frame.kindLabel) 而不是回應。")
        }
        return response.payload
    }

    public func acceptCardPatch(patchId: String, clientRequestId: String, options: RequestOptions = .default) async throws -> CardPatchAcceptResponsePayload {
        let request = CardPatchAcceptRequest(id: RequestID.next(), payload: CardPatchAcceptRequestPayload(patchId: patchId, clientRequestId: clientRequestId))
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .cardPatchAcceptResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame("card.patch.accept 收到 \(frame.kindLabel) 而不是回應。")
        }
        return response.payload
    }

    public func rejectCardPatch(patchId: String, clientRequestId: String, options: RequestOptions = .default) async throws -> CardPatchRejectResponsePayload {
        let request = CardPatchRejectRequest(id: RequestID.next(), payload: CardPatchRejectRequestPayload(patchId: patchId, clientRequestId: clientRequestId))
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .cardPatchRejectResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame("card.patch.reject 收到 \(frame.kindLabel) 而不是回應。")
        }
        return response.payload
    }

    public func listCardVersions(cardId: String, options: RequestOptions = .default) async throws -> CardVersionsListResponsePayload {
        let request = CardVersionsListRequest(id: RequestID.next(), payload: CardVersionsListRequestPayload(cardId: cardId))
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .cardVersionsListResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame("card.versions.list 收到 \(frame.kindLabel) 而不是回應。")
        }
        return response.payload
    }

    public func getCardVersion(cardId: String, versionId: String, options: RequestOptions = .default) async throws -> CardVersionGetResponsePayload {
        let request = CardVersionGetRequest(id: RequestID.next(), payload: CardVersionGetRequestPayload(cardId: cardId, versionId: versionId))
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .cardVersionGetResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame("card.version.get 收到 \(frame.kindLabel) 而不是回應。")
        }
        return response.payload
    }

    public func restoreCardVersion(cardId: String, versionId: String, baseRevision: String, clientRequestId: String, options: RequestOptions = .default) async throws -> CardVersionRestoreResponsePayload {
        let request = CardVersionRestoreRequest(id: RequestID.next(), payload: CardVersionRestoreRequestPayload(cardId: cardId, versionId: versionId, baseRevision: baseRevision, clientRequestId: clientRequestId))
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .cardVersionRestoreResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame("card.version.restore 收到 \(frame.kindLabel) 而不是回應。")
        }
        return response.payload
    }

    public func deleteCard(
        cardId: String,
        clientRequestId: String,
        options: RequestOptions = .default
    ) async throws -> CardDeleteResponsePayload {
        let request = CardDeleteRequest(
            id: RequestID.next(),
            payload: CardDeleteRequestPayload(
                cardId: cardId,
                clientRequestId: clientRequestId
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .cardDeleteResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "card.delete 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func searchCards(
        query: String,
        kinds: [CardKind]? = nil,
        tags: [String]? = nil,
        includeSuperseded: Bool? = nil,
        limit: Int? = nil,
        cursor: String? = nil,
        options: RequestOptions = .default
    ) async throws -> CardSearchResponsePayload {
        let request = CardSearchRequest(
            id: RequestID.next(),
            payload: CardSearchRequestPayload(
                query: query,
                kinds: kinds,
                tags: tags,
                includeSuperseded: includeSuperseded,
                limit: limit,
                cursor: cursor
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .cardSearchResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "card.search 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 卡片被實際使用時保鮮；新數值由主機計算。
    public func refreshCard(
        cardId: String,
        options: RequestOptions = .default
    ) async throws -> CardRefreshResponsePayload {
        let request = CardRefreshRequest(
            id: RequestID.next(),
            payload: CardRefreshRequestPayload(cardId: cardId)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .cardRefreshResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "card.refresh 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    // MARK: - 上下文

    public func getContext(
        sessionId: String,
        options: RequestOptions = .default
    ) async throws -> ContextGetResponsePayload {
        let request = ContextGetRequest(
            id: RequestID.next(),
            payload: ContextGetRequestPayload(sessionId: sessionId)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .contextGetResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "context.get 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 把卡片加入對話的上下文後段。
    public func addCardToContext(
        sessionId: String,
        cardId: String,
        options: RequestOptions = .default
    ) async throws -> ContextAddCardResponsePayload {
        let request = ContextAddCardRequest(
            id: RequestID.next(),
            payload: ContextAddCardRequestPayload(sessionId: sessionId, cardId: cardId)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .contextAddCardResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "context.add_card 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 移除卡片只是標記，下一次壓縮才真的拿掉。
    public func removeCardFromContext(
        sessionId: String,
        cardId: String,
        options: RequestOptions = .default
    ) async throws -> ContextRemoveCardResponsePayload {
        let request = ContextRemoveCardRequest(
            id: RequestID.next(),
            payload: ContextRemoveCardRequestPayload(sessionId: sessionId, cardId: cardId)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .contextRemoveCardResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "context.remove_card 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 要求主機壓縮上下文；回應只代表排入，完成要看 `context.compacted` 事件。
    public func compactContext(
        sessionId: String,
        instructions: String? = nil,
        options: RequestOptions = .default
    ) async throws -> ContextCompactResponsePayload {
        let request = ContextCompactRequest(
            id: RequestID.next(),
            payload: ContextCompactRequestPayload(
                sessionId: sessionId,
                instructions: instructions
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .contextCompactResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "context.compact 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    // MARK: - 封存與刪除

    public func archiveSession(
        sessionId: String,
        purgeAfterDays: Int? = nil,
        options: RequestOptions = .default
    ) async throws -> SessionArchiveResponsePayload {
        let request = SessionArchiveRequest(
            id: RequestID.next(),
            payload: SessionArchiveRequestPayload(
                sessionId: sessionId,
                purgeAfterDays: purgeAfterDays
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .sessionArchiveResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "session.archive 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func unarchiveSession(
        sessionId: String,
        options: RequestOptions = .default
    ) async throws -> SessionUnarchiveResponsePayload {
        let request = SessionUnarchiveRequest(
            id: RequestID.next(),
            payload: SessionUnarchiveRequestPayload(sessionId: sessionId)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .sessionUnarchiveResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "session.unarchive 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 刪除前的預估：會帶走哪些對話、多少張專屬與共享卡片、多少個原檔。
    public func previewSessionDeletion(
        sessionId: String,
        options: RequestOptions = .default
    ) async throws -> SessionDeletionPreviewResponsePayload {
        let request = SessionDeletionPreviewRequest(
            id: RequestID.next(),
            payload: SessionDeletionPreviewRequestPayload(sessionId: sessionId)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .sessionDeletionPreviewResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "session.deletion_preview 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func deleteSession(
        sessionId: String,
        clientRequestId: String,
        options: RequestOptions = .default
    ) async throws -> SessionDeleteResponsePayload {
        let request = SessionDeleteRequest(
            id: RequestID.next(),
            payload: SessionDeleteRequestPayload(
                sessionId: sessionId,
                clientRequestId: clientRequestId
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .sessionDeleteResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "session.delete 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    // MARK: - 媒體

    /// 以已上傳的 blob 匯入圖片或音訊；主機同步完成後才回應。
    public func importMedia(
        blobId: String,
        locale: String? = nil,
        ocrLocales: [String]? = nil,
        title: String? = nil,
        tags: [String]? = nil,
        persona: String? = nil,
        options: RequestOptions = .default
    ) async throws -> MediaImportResponsePayload {
        let request = MediaImportRequest(
            id: RequestID.next(),
            payload: MediaImportRequestPayload(
                blobId: blobId,
                locale: locale,
                ocrLocales: ocrLocales,
                title: title,
                tags: tags,
                persona: persona
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .mediaImportResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "media.import 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    // MARK: - 通知

    /// 列出一頁通知與未讀總數。
    public func listNotifications(
        limit: Int? = nil,
        before: String? = nil,
        unreadOnly: Bool? = nil,
        options: RequestOptions = .default
    ) async throws -> NotificationListResponsePayload {
        let request = NotificationListRequest(
            id: RequestID.next(),
            payload: NotificationListRequestPayload(
                limit: limit,
                before: before,
                unreadOnly: unreadOnly
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .notificationListResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "notification.list 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 標示通知已讀；`ids` 與 `all` 二選一。
    public func markNotificationsRead(
        ids: [String]? = nil,
        all: Bool? = nil,
        options: RequestOptions = .default
    ) async throws -> NotificationMarkReadResponsePayload {
        let request = NotificationMarkReadRequest(
            id: RequestID.next(),
            payload: NotificationMarkReadRequestPayload(ids: ids, all: all)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .notificationMarkReadResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "notification.mark_read 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 把通知轉成卡片；主机去重，重送回同一張卡。
    public func createCardFromNotification(
        notificationId: String,
        options: RequestOptions = .default
    ) async throws -> NotificationCreateCardResponsePayload {
        let request = NotificationCreateCardRequest(
            id: RequestID.next(),
            payload: NotificationCreateCardRequestPayload(notificationId: notificationId)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .notificationCreateCardResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "notification.create_card 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func close() async {
        guard !closed else { return }
        closed = true
        readerTask?.cancel()
        readerTask = nil
        let all = pending
        pending.removeAll()
        for (_, continuation) in all {
            continuation.resume(throwing: CardiaryClientError.connectionClosed)
        }
        eventContinuation.finish()
        await transport.close()
    }

    // MARK: - 白板

    public func listBoards(
        options: RequestOptions = .default
    ) async throws -> BoardListResponsePayload {
        let request = BoardListRequest(
            id: RequestID.next(),
            payload: BoardListRequestPayload()
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .boardListResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "board.list 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func getBoard(
        boardId: String,
        options: RequestOptions = .default
    ) async throws -> BoardGetResponsePayload {
        let request = BoardGetRequest(
            id: RequestID.next(),
            payload: BoardGetRequestPayload(boardId: boardId)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .boardGetResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "board.get 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func createBoard(
        boardId: String,
        title: String,
        clientRequestId: String,
        options: RequestOptions = .default
    ) async throws -> BoardCreateResponsePayload {
        let request = BoardCreateRequest(
            id: RequestID.next(),
            payload: BoardCreateRequestPayload(
                boardId: boardId,
                title: title,
                clientRequestId: clientRequestId
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .boardCreateResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "board.create 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 存回整份白板；`baseUpdatedAt` 是讀到時的版本，過期會得到 `conflict`。
    public func saveBoard(
        board: BoardDocument,
        baseUpdatedAt: String,
        clientRequestId: String? = nil,
        options: RequestOptions = .default
    ) async throws -> BoardSaveResponsePayload {
        let request = BoardSaveRequest(
            id: RequestID.next(),
            payload: BoardSaveRequestPayload(
                board: board,
                baseUpdatedAt: baseUpdatedAt,
                clientRequestId: clientRequestId
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .boardSaveResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "board.save 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func deleteBoard(
        boardId: String,
        options: RequestOptions = .default
    ) async throws -> BoardDeleteResponsePayload {
        let request = BoardDeleteRequest(
            id: RequestID.next(),
            payload: BoardDeleteRequestPayload(boardId: boardId)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .boardDeleteResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "board.delete 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func projectCardOnBoard(
        boardId: String,
        itemId: String,
        cardId: String,
        position: BoardPoint,
        size: BoardSize? = nil,
        groupId: String? = nil,
        pinned: Bool? = nil,
        options: RequestOptions = .default
    ) async throws -> BoardProjectCardResponsePayload {
        let request = BoardProjectCardRequest(
            id: RequestID.next(),
            payload: BoardProjectCardRequestPayload(
                boardId: boardId,
                itemId: itemId,
                cardId: cardId,
                position: position,
                size: size,
                groupId: groupId,
                pinned: pinned
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .boardProjectCardResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "board.project_card 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    public func unprojectCardOnBoard(
        boardId: String,
        itemId: String,
        options: RequestOptions = .default
    ) async throws -> BoardUnprojectCardResponsePayload {
        let request = BoardUnprojectCardRequest(
            id: RequestID.next(),
            payload: BoardUnprojectCardRequestPayload(boardId: boardId, itemId: itemId)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .boardUnprojectCardResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "board.unproject_card 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 圈選既有卡片後生成一張新卡，血緣記在 `cardIds`。
    public func createCardFromSelection(
        boardId: String,
        cardIds: [String],
        title: String,
        body: String,
        itemId: String,
        position: BoardPoint,
        clientRequestId: String,
        options: RequestOptions = .default
    ) async throws -> BoardCreateCardFromSelectionResponsePayload {
        let request = BoardCreateCardFromSelectionRequest(
            id: RequestID.next(),
            payload: BoardCreateCardFromSelectionRequestPayload(
                boardId: boardId,
                cardIds: cardIds,
                title: title,
                body: body,
                itemId: itemId,
                position: position,
                clientRequestId: clientRequestId
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .boardCreateCardFromSelectionResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "board.create_card_from_selection 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    // MARK: - 外部代理

    public func listAgents(
        options: RequestOptions = .default
    ) async throws -> AgentListResponsePayload {
        let request = AgentListRequest(
            id: RequestID.next(),
            payload: AgentListRequestPayload()
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .agentListResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "agent.list 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 啟動外部代理；主機會先建立啟動審批，核准後才真的啟動行程。
    public func startAgent(
        agentKind: AgentKind,
        workingDirectory: String,
        prompt: String?,
        clientRequestId: String?,
        options: RequestOptions = .default
    ) async throws -> AgentStartResponsePayload {
        let request = AgentStartRequest(
            id: RequestID.next(),
            payload: AgentStartRequestPayload(
                agentKind: agentKind,
                workingDirectory: workingDirectory,
                prompt: prompt,
                clientRequestId: clientRequestId
            )
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .agentStartResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "agent.start 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    /// 停止外部代理；還沒決定的審批會被撤回，行程會被收拾乾淨。
    public func stopAgent(
        agentSessionId: String,
        options: RequestOptions = .default
    ) async throws -> AgentStopResponsePayload {
        let request = AgentStopRequest(
            id: RequestID.next(),
            payload: AgentStopRequestPayload(agentSessionId: agentSessionId)
        )
        let frame = try await perform(id: request.id, encode: request, options: options)
        guard case .agentStopResponse(let response) = frame else {
            throw CardiaryClientError.invalidFrame(
                "agent.stop 收到 \(frame.kindLabel) 而不是回應。"
            )
        }
        return response.payload
    }

    // MARK: - 收送

    private func perform<T: Encodable>(
        id: String,
        encode request: T,
        options: RequestOptions
    ) async throws -> ServerFrame {
        guard !closed else { throw CardiaryClientError.connectionClosed }
        startReaderIfNeeded()

        let text: String
        do {
            let data = try JSONEncoder().encode(request)
            guard let encoded = String(data: data, encoding: .utf8) else {
                throw CardiaryClientError.invalidFrame("請求無法編碼成 UTF-8。")
            }
            text = encoded
        } catch let error as CardiaryClientError {
            throw error
        } catch {
            throw CardiaryClientError.invalidFrame("請求編碼失敗：\(error)")
        }

        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            Task { [transport] in
                do {
                    try await transport.send(text)
                } catch {
                    await self.failPending(id: id, error: error)
                    return
                }
                if let timeout = Self.nanoseconds(options.timeout) {
                    try? await Task.sleep(nanoseconds: timeout)
                    await self.failPending(id: id, error: CardiaryClientError.timeout)
                }
            }
        }
    }

    private static func nanoseconds(_ duration: Duration) -> UInt64? {
        let components = duration.components
        guard components.seconds >= 0, components.attoseconds >= 0 else { return nil }
        let seconds = UInt64(components.seconds)
        let attoseconds = UInt64(components.attoseconds / 1_000_000_000)
        let (whole, overflow) = seconds.multipliedReportingOverflow(by: 1_000_000_000)
        guard !overflow else { return nil }
        return whole + attoseconds
    }

    private func startReaderIfNeeded() {
        guard readerTask == nil, !closed else { return }
        readerTask = Task { [weak self] in
            await self?.readLoop()
        }
    }

    private func readLoop() async {
        while !closed {
            let text: String?
            do {
                text = try await transport.receive()
            } catch {
                await finish(with: error)
                return
            }
            guard let text else {
                await finish(with: CardiaryClientError.connectionClosed)
                return
            }
            do {
                try handle(text)
            } catch {
                await finish(with: error)
                return
            }
        }
    }

    private func handle(_ text: String) throws {
        guard let data = text.data(using: .utf8) else {
            throw CardiaryClientError.invalidFrame("訊息不是 UTF-8。")
        }
        let frame: ServerFrame
        do {
            frame = try JSONDecoder().decode(ServerFrame.self, from: data)
        } catch {
            throw CardiaryClientError.invalidFrame("\(error)")
        }

        switch frame {
        case .errorFrame(let error):
            guard let replyTo = error.replyTo else {
                throw wrappedError(error)
            }
            guard let continuation = pending.removeValue(forKey: replyTo) else {
                throw CardiaryClientError.unexpectedReply(replyTo)
            }
            continuation.resume(throwing: wrappedError(error))
        default:
            if let replyTo = frame.replyTo {
                resume(replyTo, with: frame)
            } else {
                eventContinuation.yield(frame)
            }
        }
    }

    private func resume(_ replyTo: String, with frame: ServerFrame) {
        guard let continuation = pending.removeValue(forKey: replyTo) else {
            // 沒有對應請求的回應是協定錯誤：丟棄並關閉，避免偽造的回應被套用。
            eventContinuation.finish()
            return
        }
        continuation.resume(returning: frame)
    }

    private func wrappedError(_ error: ErrorFrame) -> CardiaryClientError {
        if error.code == .incompatibleVersion {
            let details = error.details
            return .incompatibleVersion(
                serverMin: details?["serverMin"]?.intValue,
                serverMax: details?["serverMax"]?.intValue
            )
        }
        return .server(error)
    }

    private func failPending(id: String, error: Error) {
        guard let continuation = pending.removeValue(forKey: id) else { return }
        continuation.resume(throwing: error)
    }

    private func finish(with error: Error) async {
        guard !closed else { return }
        closed = true
        readerTask?.cancel()
        readerTask = nil
        let clientError = (error as? CardiaryClientError) ?? .invalidFrame("\(error)")
        let all = pending
        pending.removeAll()
        for (_, continuation) in all {
            continuation.resume(throwing: clientError)
        }
        eventContinuation.finish()
        await transport.close()
    }
}
