import CardiaryKit
import CardiaryShellCore
import Combine
import Foundation

/// 一場外部代理會話在檢視欄裡的樣子。
///
/// 資料來自 `agent.list` 的快照與 `agent.state_changed` 事件；事件沒有工作目錄與
/// 開始時間，更新既有會話時保留快照的值。
public struct AgentSessionPresentation: Identifiable, Equatable, Sendable {
    public let agentSessionId: String
    public let agentKind: AgentKind
    public let status: AgentStatus
    public let workingDirectory: String
    public let progress: AgentProgress?
    public let message: String?
    /// 代理在回報結果前結束；介面要明說結果無法確認，不能當成成功。
    public let resultUnknown: Bool
    public let pendingPermission: AgentPendingPermission?
    public let startedAt: String

    public var id: String { agentSessionId }

    public init(info: AgentSessionInfo) {
        self.agentSessionId = info.agentSessionId
        self.agentKind = info.agentKind
        self.status = info.status
        self.workingDirectory = info.workingDirectory
        self.progress = info.progress
        self.message = info.message
        self.resultUnknown = info.resultUnknown ?? false
        self.pendingPermission = info.pendingPermission
        self.startedAt = info.startedAt
    }

    public init(payload: AgentStateChangedEventPayload, startedAt: String, previous: Self?) {
        self.agentSessionId = payload.agentSessionId
        self.agentKind = payload.agentKind
        self.status = payload.status
        self.workingDirectory = previous?.workingDirectory ?? ""
        self.progress = payload.progress
        self.message = payload.message
        self.resultUnknown = payload.resultUnknown ?? false
        self.pendingPermission = payload.pendingPermission
        self.startedAt = previous?.startedAt ?? startedAt
    }

    /// 完整欄位的初始化；本機更新（例如清掉待核准）用得到。
    public init(
        agentSessionId: String,
        agentKind: AgentKind,
        status: AgentStatus,
        workingDirectory: String,
        progress: AgentProgress?,
        message: String?,
        resultUnknown: Bool,
        pendingPermission: AgentPendingPermission?,
        startedAt: String
    ) {
        self.agentSessionId = agentSessionId
        self.agentKind = agentKind
        self.status = status
        self.workingDirectory = workingDirectory
        self.progress = progress
        self.message = message
        self.resultUnknown = resultUnknown
        self.pendingPermission = pendingPermission
        self.startedAt = startedAt
    }

    /// 決定送給 `approval.decide`，成功後本機先清掉待核准，等事件再確認。
    public func clearingPermission() -> Self {
        Self(
            agentSessionId: agentSessionId,
            agentKind: agentKind,
            status: status,
            workingDirectory: workingDirectory,
            progress: progress,
            message: message,
            resultUnknown: resultUnknown,
            pendingPermission: nil,
            startedAt: startedAt
        )
    }

    public func kindText(language: AppLanguage? = nil) -> String {
        switch agentKind {
        case .opencode: return AppL10n.text(.agentKindOpencode, language: language)
        case .claudeCode: return AppL10n.text(.agentKindClaudeCode, language: language)
        }
    }

    public func statusText(language: AppLanguage? = nil) -> String {
        switch status {
        case .starting: return AppL10n.text(.agentStatusStarting, language: language)
        case .running: return AppL10n.text(.agentStatusRunning, language: language)
        case .waitingApproval: return AppL10n.text(.agentStatusWaitingApproval, language: language)
        case .stopped: return AppL10n.text(.agentStatusStopped, language: language)
        case .failed: return AppL10n.text(.agentStatusFailed, language: language)
        }
    }

    /// 主機的完成步數除以總步數；總步數不是正數時沒有比例可畫。
    public var progressFraction: Double? {
        guard let progress, progress.total > 0 else { return nil }
        let value = Double(progress.completed) / Double(progress.total)
        return min(max(value, 0), 1)
    }

    public func progressText(language: AppLanguage? = nil) -> String? {
        guard let progress else { return nil }
        return AppL10n.format(
            .agentProgressStep,
            value: "\(progress.completed)/\(progress.total)",
            language: language
        )
    }
}

/// 檢視欄的外部代理清單：快照、事件更新、待核准的決定。
@MainActor
public final class AgentModel: ObservableObject {
    /// 外部代理權杖在鑰匙圈的帳號。
    public static let claudeTokenAccount = "external-agent/claude-code"

    @Published public private(set) var sessions: [AgentSessionPresentation] = []
    /// 是否拿過主機的完整清單。事件可能先到，但沒有快照就不知道還有哪些會話。
    @Published public private(set) var isKnown = false
    @Published public private(set) var decidingIds: Set<String> = []
    @Published public private(set) var isStarting = false
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?

    private var agents: (any AgentService)?
    private var approvals: (any ApprovalService)?
    private let language: AppLanguage
    private let keychain: (any KeychainWriting)?

    /// 上次沒拿到成功回應的啟動要求。重試相同內容沿用請求 id，讓主機去重不要重跑任務。
    private struct PendingStartAttempt {
        let agentKind: AgentKind
        let workingDirectory: String
        let prompt: String?
        let clientRequestId: String

        /// 只比較內容，不比較請求 id。
        func matches(kind: AgentKind, directory: String, prompt: String?) -> Bool {
            agentKind == kind && workingDirectory == directory && self.prompt == prompt
        }
    }

    private var pendingStartAttempt: PendingStartAttempt?

    /// - Parameter language: 這個模型產生訊息時用的介面語言；測試可以指定。
    /// - Parameter keychain: 用來存放外部代理權杖的鑰匙圈；測試可以指定替身。
    public init(language: AppLanguage = AppL10n.language, keychain: (any KeychainWriting)? = nil) {
        self.language = language
        self.keychain = keychain
    }

    public func attach(service: any AgentService, approvals: any ApprovalService) {
        self.agents = service
        self.approvals = approvals
    }

    /// 把 Claude Code 權杖寫入鑰匙圈。回傳是否成功，讓表單只在成功時清空欄位。
    /// 權杖只交給鑰匙圈，不進 log 也不寫入任何檔案。
    @discardableResult
    public func storeClaudeToken(_ token: String) -> Bool {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = AppL10n.text(.agentClaudeTokenEmpty, language: language)
            return false
        }
        guard let keychain else {
            errorMessage = AppL10n.text(.agentClaudeTokenUnavailable, language: language)
            return false
        }
        guard keychain.store(account: Self.claudeTokenAccount, value: trimmed) else {
            errorMessage = AppL10n.text(.agentClaudeTokenSaveFailed, language: language)
            return false
        }
        noticeMessage = AppL10n.text(.agentClaudeTokenSaved, language: language)
        errorMessage = nil
        return true
    }

    /// 從主機重新載入完整清單；事件更新過的內容以這份快照為準。
    public func reload() async {
        guard let agents else { return }
        do {
            let payload = try await agents.listAgents()
            update(sessions: payload.agents)
            errorMessage = nil
        } catch {
            errorMessage = AppL10n.format(
                .conversationError,
                value: errorText(error),
                language: language
            )
        }
    }

    /// 主機送來的完整清單。`nil` 代表還沒連上服務。
    public func update(sessions: [AgentSessionInfo]?) {
        isKnown = sessions != nil
        self.sessions = (sessions ?? [])
            .map(AgentSessionPresentation.init)
            .sorted { ($0.startedAt, $0.agentSessionId) < ($1.startedAt, $1.agentSessionId) }
        if self.sessions.isEmpty {
            decidingIds = []
        } else {
            decidingIds.formIntersection(Set(self.sessions.map(\.agentSessionId)))
        }
    }

    public func handle(frame: ServerFrame) {
        guard case .agentStateChangedEvent(let event) = frame else { return }
        apply(event.payload, startedAt: event.emittedAt)
    }

    /// 套用一筆狀態變更；沒有對應的會話就新增。
    public func apply(_ payload: AgentStateChangedEventPayload, startedAt: String) {
        let existing = sessions.first { $0.agentSessionId == payload.agentSessionId }
        let updated = AgentSessionPresentation(
            payload: payload,
            startedAt: startedAt,
            previous: existing
        )
        if let index = sessions.firstIndex(where: { $0.agentSessionId == payload.agentSessionId }) {
            sessions[index] = updated
        } else {
            sessions.append(updated)
        }
        sessions.sort { ($0.startedAt, $0.agentSessionId) < ($1.startedAt, $1.agentSessionId) }
    }

    public func markDisconnected() {
        update(sessions: nil)
        errorMessage = nil
        noticeMessage = nil
    }

    /// 啟動外部代理。先在本機檢查工作目錄，避免送出注定被主機拒絕的請求。
    /// 回傳是否成功，讓表單只在成功時清空。
    @discardableResult
    public func start(
        agentKind: AgentKind,
        workingDirectory: String,
        prompt: String?
    ) async -> Bool {
        noticeMessage = nil
        let directory = workingDirectory.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPrompt = prompt?.trimmingCharacters(in: .whitespacesAndNewlines)
        let finalPrompt = trimmedPrompt?.isEmpty == true ? nil : trimmedPrompt
        guard !directory.isEmpty else {
            errorMessage = AppL10n.text(.agentStartInvalidDirectory, language: language)
            return false
        }
        guard let agents else {
            errorMessage = AppL10n.text(.agentServiceUnavailable, language: language)
            return false
        }
        guard !isStarting else { return false }

        let clientRequestId: String
        if let attempt = pendingStartAttempt,
           attempt.matches(kind: agentKind, directory: directory, prompt: finalPrompt) {
            clientRequestId = attempt.clientRequestId
        } else {
            clientRequestId = UUID().uuidString
            pendingStartAttempt = PendingStartAttempt(
                agentKind: agentKind,
                workingDirectory: directory,
                prompt: finalPrompt,
                clientRequestId: clientRequestId
            )
        }

        isStarting = true
        defer { isStarting = false }
        do {
            _ = try await agents.startAgent(
                agentKind: agentKind,
                workingDirectory: directory,
                prompt: finalPrompt,
                clientRequestId: clientRequestId
            )
            pendingStartAttempt = nil
            errorMessage = nil
            noticeMessage = AppL10n.text(.agentStartedNotice, language: language)
            await reload()
            return true
        } catch {
            errorMessage = AppL10n.format(
                .conversationError,
                value: errorText(error),
                language: language
            )
            return false
        }
    }

    /// 停止外部代理；審批還沒決定時，主機會一併撤回，行程也會被收拾乾淨。
    public func stop(_ session: AgentSessionPresentation) async {
        noticeMessage = nil
        guard let agents else {
            errorMessage = AppL10n.text(.agentServiceUnavailable, language: language)
            return
        }
        do {
            let response = try await agents.stopAgent(agentSessionId: session.agentSessionId)
            errorMessage = nil
            noticeMessage = AppL10n.text(
                response.stopped ? .agentStoppedNotice : .agentStopNotAppliedNotice,
                language: language
            )
            await reload()
        } catch {
            errorMessage = AppL10n.format(
                .conversationError,
                value: errorText(error),
                language: language
            )
        }
    }

    public func approve(_ session: AgentSessionPresentation) async {
        await decide(session, optionId: "approve")
    }

    public func reject(_ session: AgentSessionPresentation) async {
        await decide(session, optionId: "deny")
    }

    /// 送出待核准的決定。成功後先在本機清掉，主機的 `agent.state_changed` 再確認一次。
    public func decide(_ session: AgentSessionPresentation, optionId: String) async {
        noticeMessage = nil
        guard let permission = session.pendingPermission else { return }
        guard !decidingIds.contains(session.agentSessionId) else { return }
        guard let approvals else {
            errorMessage = AppL10n.text(.agentServiceUnavailable, language: language)
            return
        }

        decidingIds.insert(session.agentSessionId)
        defer { decidingIds.remove(session.agentSessionId) }
        do {
            _ = try await approvals.decideApproval(
                approvalId: permission.approvalId,
                optionId: optionId,
                note: nil
            )
            if let index = sessions.firstIndex(where: { $0.agentSessionId == session.agentSessionId }) {
                sessions[index] = sessions[index].clearingPermission()
            }
            errorMessage = nil
            noticeMessage = AppL10n.text(
                optionId == "approve" ? .approvalApproved : .approvalRejected,
                language: language
            )
        } catch {
            errorMessage = AppL10n.format(
                .conversationError,
                value: errorText(error),
                language: language
            )
        }
    }

    public func dismissMessages() {
        errorMessage = nil
        noticeMessage = nil
    }

    private func errorText(_ error: any Error) -> String {
        (error as? CardiaryClientError)?.errorDescription ?? "\(error)"
    }
}
