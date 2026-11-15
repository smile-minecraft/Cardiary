import CardiaryKit
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

/// 審批需要的請求。檢視欄與選單列共用同一條路徑。
public protocol ApprovalService: Sendable {
    func decideApproval(
        approvalId: String,
        optionId: String,
        note: String?
    ) async throws -> ApprovalDecideResponsePayload
    func pauseAllApprovals(reason: String) async throws
}

public typealias CardiaryService =
    ConversationService & ModelSettingsService & SettingsService & ModulesService & ApprovalService

extension CardiaryClient:
    ConversationService, ModelSettingsService, SettingsService, ModulesService, ApprovalService {}
