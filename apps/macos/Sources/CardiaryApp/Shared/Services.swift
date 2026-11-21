import CardiaryKit
import CardiaryShellCore
import Foundation

/// 對話需要的請求。view model 只依賴這個介面，測試用假的實作，不需要真的主機。
public protocol ConversationService: Sendable {
    func listSessions(cursor: String?, limit: Int?) async throws -> SessionListResponsePayload
    func createSession(clientRequestId: String, title: String?) async throws -> SessionCreateResponsePayload
    func getHistory(sessionId: String, cursor: String?, limit: Int?) async throws -> SessionGetHistoryResponsePayload
    func sendMessage(
        sessionId: String,
        text: String,
        delivery: DeliveryMode,
        clientMessageId: String?
    ) async throws -> SessionSendMessageResponsePayload
    func interruptSession(sessionId: String, reason: String?) async throws -> SessionInterruptResponsePayload
    func subscribeSession(sessionId: String, historyLimit: Int?) async throws -> SessionSubscribeResponsePayload
    func unsubscribeSession(sessionId: String) async
}

/// 模型設定需要的請求（首次設定與設定頁共用）。
public protocol ModelSettingsService: Sendable {
    func getModels() async throws -> SystemModelsState
    func setModels(
        providers: [ModelProviderInfo]?,
        roles: [ModelRoleSelection]?,
        clientRequestId: String
    ) async throws -> SystemModelsState
}

/// 設定頁的一般設定：讀取與修改設定值（含分級）。
public protocol SettingsService: Sendable {
    func getSettings() async throws -> SystemSettingsGetResponsePayload
    func setSettings(
        changes: [SettingChange],
        clientRequestId: String
    ) async throws -> SystemSettingsSetResponsePayload
}

/// 設定頁的模組清單與啟停。
public protocol ModulesService: Sendable {
    func getModules() async throws -> SystemModulesGetResponsePayload
    func setModuleEnabled(
        moduleId: String,
        enabled: Bool,
        clientRequestId: String
    ) async throws -> SystemModulesSetEnabledResponsePayload
}

/// 設定頁的儲存空間：讀取用量，預覽後才執行清理。
public protocol StorageService: Sendable {
    func getStorageUsage() async throws -> StorageUsageResponsePayload
    func previewStorageCleanup(categories: [String]) async throws -> StorageCleanupPreviewResponsePayload
    func applyStorageCleanup(categories: [String]) async throws -> StorageCleanupApplyResponsePayload
}

/// MCP 伺服器：清單、新增（送審批）、移除、啟停與允許網域。
///
/// 新增只回審批編號，真正的變更由 `mcp.servers_changed` 事件送來；畫面用
/// `setMcpServersChangedHandler` 訂閱，再設定一次會取代前一個。
public protocol McpService: Sendable {
    func listMcpServers() async throws -> McpServersListResponsePayload
    func addMcpServer(
        name: String,
        transport: McpTransport,
        command: String?,
        args: [String]?,
        url: String?,
        allowedHosts: [String],
        clientRequestId: String?,
        persistentData: Bool?
    ) async throws -> McpServerAddResponsePayload
    func removeMcpServer(serverId: String) async throws -> McpServerRemoveResponsePayload
    func setMcpServerEnabled(
        serverId: String,
        enabled: Bool,
        clientRequestId: String?
    ) async throws -> McpServerSetEnabledResponsePayload
    func setMcpServerAllowedHosts(
        serverId: String,
        allowedHosts: [String]
    ) async throws -> McpServerAllowHostsResponsePayload
    func setMcpServersChangedHandler(
        _ handler: (@Sendable (McpServersChangedEventPayload) -> Void)?
    ) async
}

/// 審批需要的請求。檢視欄與選單列共用同一條路徑。
public protocol ApprovalService: Sendable {
    func decideApproval(
        approvalId: String,
        optionId: String,
        note: String?
    ) async throws -> ApprovalDecideResponsePayload
    func pauseAllApprovals(reason: String) async throws
}

/// 卡片庫的讀取與編輯；篩選條件沒帶的欄位不會出現在請求裡。
public protocol CardService: Sendable {
    func listCards(
        kinds: [CardKind]?,
        tags: [String]?,
        persona: String?,
        lifecycle: CardLifecycleFilter?,
        query: String?,
        includeSuperseded: Bool?,
        cursor: String?,
        limit: Int?
    ) async throws -> CardListResponsePayload
    func getCard(cardId: String) async throws -> CardGetResponsePayload
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
    ) async throws -> CardCreateResponsePayload
    func patchCard(
        cardId: String,
        baseRevision: String,
        patch: CardPatch,
        clientRequestId: String?
    ) async throws -> CardPatchResponsePayload
    func listCardPatches(cardId: String) async throws -> CardPatchesListResponsePayload
    func acceptCardPatch(patchId: String, clientRequestId: String) async throws -> CardPatchAcceptResponsePayload
    func rejectCardPatch(patchId: String, clientRequestId: String) async throws -> CardPatchRejectResponsePayload
    func listCardVersions(cardId: String) async throws -> CardVersionsListResponsePayload
    func getCardVersion(cardId: String, versionId: String) async throws -> CardVersionGetResponsePayload
    func restoreCardVersion(cardId: String, versionId: String, baseRevision: String, clientRequestId: String) async throws -> CardVersionRestoreResponsePayload
    func deleteCard(cardId: String, clientRequestId: String) async throws -> CardDeleteResponsePayload
    func searchCards(
        query: String,
        kinds: [CardKind]?,
        tags: [String]?,
        includeSuperseded: Bool?,
        limit: Int?,
        cursor: String?
    ) async throws -> CardSearchResponsePayload
    func refreshCard(cardId: String) async throws -> CardRefreshResponsePayload
}

/// 檢視欄的上下文：讀取、加入與移除卡片、要求壓縮。
public protocol ContextService: Sendable {
    func getContext(sessionId: String) async throws -> ContextGetResponsePayload
    func addCardToContext(sessionId: String, cardId: String) async throws -> ContextAddCardResponsePayload
    func removeCardFromContext(
        sessionId: String,
        cardId: String
    ) async throws -> ContextRemoveCardResponsePayload
    func compactContext(
        sessionId: String,
        instructions: String?
    ) async throws -> ContextCompactResponsePayload
}

/// 封存區與刪除確認。
public protocol SessionManagementService: Sendable {
    func archiveSession(
        sessionId: String,
        purgeAfterDays: Int?
    ) async throws -> SessionArchiveResponsePayload
    func unarchiveSession(sessionId: String) async throws -> SessionUnarchiveResponsePayload
    func previewSessionDeletion(
        sessionId: String
    ) async throws -> SessionDeletionPreviewResponsePayload
    func deleteSession(
        sessionId: String,
        clientRequestId: String
    ) async throws -> SessionDeleteResponsePayload
}

/// 媒體匯入的協定部分：以已上傳的 blobId 建卡。
public protocol MediaImportService: Sendable {
    func importMedia(
        blobId: String,
        locale: String?,
        ocrLocales: [String]?,
        title: String?,
        tags: [String]?,
        persona: String?
    ) async throws -> MediaImportResponsePayload
}

/// 圖片與音訊匯入：先上傳原檔，再以 blobId 走協定建卡。
public protocol MediaService: Sendable {
    func upload(fileURL: URL, mediaType: String) async throws -> BlobInfo
    func upload(data: Data, mediaType: String) async throws -> BlobInfo
    /// 下載原檔；帶 `variant` 時取得主機產生的縮圖。卡片畫面只在可見範圍載入。
    func download(blobId: String, variant: BlobClient.Variant?) async throws -> Data
    func importMedia(
        blobId: String,
        locale: String?,
        ocrLocales: [String]?,
        title: String?,
        tags: [String]?,
        persona: String?
    ) async throws -> MediaImportResponsePayload
}

extension MediaService {
    /// 一步完成匯入：上傳原檔後用回傳的 `blobId` 建卡。
    public func importFile(
        fileURL: URL,
        mediaType: String,
        locale: String? = nil,
        ocrLocales: [String]? = nil,
        title: String? = nil,
        tags: [String]? = nil,
        persona: String? = nil
    ) async throws -> MediaImportResponsePayload {
        let blob = try await upload(fileURL: fileURL, mediaType: mediaType)
        return try await importMedia(
            blobId: blob.blobId,
            locale: locale,
            ocrLocales: ocrLocales,
            title: title,
            tags: tags,
            persona: persona
        )
    }
}

/// 殼組好的媒體服務：原檔走 HTTP，建卡走協定。
public struct CardiaryMediaService: MediaService {
    private let blobs: BlobClient
    private let importer: any MediaImportService

    public init(blobs: BlobClient, importer: any MediaImportService) {
        self.blobs = blobs
        self.importer = importer
    }

    public func upload(fileURL: URL, mediaType: String) async throws -> BlobInfo {
        try await blobs.upload(fileURL: fileURL, mediaType: mediaType)
    }

    public func upload(data: Data, mediaType: String) async throws -> BlobInfo {
        try await blobs.upload(data: data, mediaType: mediaType)
    }

    public func download(blobId: String, variant: BlobClient.Variant?) async throws -> Data {
        try await blobs.download(blobId: blobId, variant: variant)
    }

    public func importMedia(
        blobId: String,
        locale: String?,
        ocrLocales: [String]?,
        title: String?,
        tags: [String]?,
        persona: String?
    ) async throws -> MediaImportResponsePayload {
        try await importer.importMedia(
            blobId: blobId,
            locale: locale,
            ocrLocales: ocrLocales,
            title: title,
            tags: tags,
            persona: persona
        )
    }
}

/// 通知流的讀取、標已讀與轉卡；view model 只依賴這個介面。
public protocol NotificationService: Sendable {
    func listNotifications(limit: Int?, before: String?, unreadOnly: Bool?) async throws -> NotificationListResponsePayload
    func markNotificationsRead(ids: [String]?, all: Bool?) async throws -> NotificationMarkReadResponsePayload
    func createCardFromNotification(notificationId: String) async throws -> NotificationCreateCardResponsePayload
}

/// 外部代理的會話清單、事件串流與啟停；view model 只依賴這個介面。
public protocol AgentService: Sendable {
    func listAgents() async throws -> AgentListResponsePayload
    func startAgent(
        agentKind: AgentKind,
        workingDirectory: String,
        prompt: String?,
        clientRequestId: String?
    ) async throws -> AgentStartResponsePayload
    func stopAgent(agentSessionId: String) async throws -> AgentStopResponsePayload
}

/// 權限模式：System One 審核類別、可委派網域與全部允許。只有本機 Mac 客戶端能呼叫。
public protocol PermissionModesService: Sendable {
    func getPermissionModes() async throws -> PermissionModesState
    func setPermissionCategory(
        _ category: DelegatedCategory,
        enabled: Bool,
        paths: [String],
        clientRequestId: String
    ) async throws -> PermissionModesState
    func setPermissionDomains(_ domains: [String], clientRequestId: String) async throws
        -> PermissionModesState
    func grantAllowAll(
        tools: [String],
        paths: [String],
        domains: [String],
        clientRequestId: String
    ) async throws -> PermissionModesState
    func revokeAllowAll(clientRequestId: String) async throws -> PermissionModesState
}

/// 配對核准與裝置管理：全部走殼的私有控制通道，不在客戶端協定上。
public protocol RemoteControlService: Sendable {
    func decidePairing(requestId: String, approve: Bool) async throws
    func listDevices() async throws -> [ShellPairedDevice]
    func revokeDevice(deviceId: String) async throws
}

public typealias CardiaryService =
    ConversationService & ModelSettingsService & SettingsService & ModulesService & ApprovalService
    & CardService & ContextService & SessionManagementService & MediaImportService & NotificationService
    & StorageService & McpService & AgentService & PermissionModesService

extension CardiaryClient:
    ConversationService, ModelSettingsService, SettingsService, ModulesService, ApprovalService,
    CardService, ContextService, SessionManagementService, MediaImportService, NotificationService,
    StorageService, McpService, AgentService, PermissionModesService
{}
