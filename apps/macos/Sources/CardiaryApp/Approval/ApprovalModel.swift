import CardiaryKit
import Combine
import Foundation

/// 一筆待審批在檢視欄裡的樣子：工具名稱、輸入摘要與可用的決定。
///
/// 內容全部來自 `approval.requested`；介面不自己判斷「這個工具該不該問」，
/// 也不自己發明「一律允許」選項，只顯示主機提供的選項。
public struct ApprovalPresentation: Identifiable, Equatable, Sendable {
    public let approvalId: String
    public let sessionId: String
    public let turnId: String
    public let title: String
    public let summary: String?
    public let scope: ApprovalScope
    public let requestedAt: String
    public let expiresAt: String?
    public let options: [ApprovalOption]
    /// 來源排程的名稱；只有背景排程任務的審批才會帶。
    public let sourceScheduleName: String?

    public var id: String { approvalId }

    /// 工具名稱。M1 只有工具審批會帶 `scope.target`。
    public var toolName: String? {
        scope.kind == .toolCall ? scope.target : nil
    }

    public init(request: ApprovalRequest) {
        self.approvalId = request.approvalId
        self.sessionId = request.sessionId
        self.turnId = request.turnId
        self.title = request.title
        self.summary = request.summary
        self.scope = request.scope
        self.requestedAt = request.requestedAt
        self.expiresAt = request.expiresAt
        self.options = request.options
        self.sourceScheduleName = request.sourceScheduleName
    }

    public func option(for effect: ApprovalEffect) -> ApprovalOption? {
        options.first { $0.effect == effect }
    }

    /// 主機沒有提供「一律允許」時，介面不能顯示這個按鈕。
    public var supportsApproveAlways: Bool {
        option(for: .approveAlways) != nil
    }

    /// 「一律允許」的按鈕文字要說出主機給的範圍；不要把 tool_call 的目錄語意套到其他種類。
    public func approveAlwaysTitle(language: AppLanguage? = nil) -> String {
        switch scope.kind {
        case .toolCall:
            if !scope.target.isEmpty {
                return AppL10n.format(.approvalAlwaysTool, value: scope.target, language: language)
            }
        case .settingsChange:
            return AppL10n.text(.approvalAlwaysSettings, language: language)
        case .schedule:
            return AppL10n.text(.approvalAlwaysSchedule, language: language)
        }
        return AppL10n.text(.approvalAlways, language: language)
    }
}

/// 檢視欄的審批狀態：待審批清單、送出中的決定、緊急暫停。
///
/// 清單以主機為準：殼把 `CardiaryClient` 收到的完整清單推進來，決定成功後
/// 先在本機移除，主機的 `approval.decided` 事件再確認一次。
@MainActor
public final class ApprovalModel: ObservableObject {
    @Published public private(set) var requests: [ApprovalPresentation] = []
    /// 連線是否提供待審批清單。還沒連上服務時數量未知，不是 0。
    @Published public private(set) var isKnown = false
    @Published public private(set) var isPaused = false
    @Published public private(set) var decidingIds: Set<String> = []
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?

    private var service: (any ApprovalService)?
    private let language: AppLanguage

    /// - Parameter language: 這個模型產生訊息時用的介面語言。預設跟著 App 目前的語言，
    ///   測試可以指定，讓結果不受系統語言影響。
    public init(language: AppLanguage = AppL10n.language) {
        self.language = language
    }

    public var count: Int { requests.count }

    public func attach(service: any ApprovalService) {
        self.service = service
    }

    /// 殼推來的完整待審批清單；`nil` 代表還沒連上服務。
    public func update(requests: [ApprovalRequest]?) {
        isKnown = requests != nil
        self.requests = (requests ?? [])
            .map(ApprovalPresentation.init)
            .sorted {
                ($0.requestedAt, $0.approvalId) < ($1.requestedAt, $1.approvalId)
            }
        decidingIds.formIntersection(Set(self.requests.map(\.approvalId)))
        if self.requests.isEmpty {
            isPaused = false
        }
    }

    public func markDisconnected() {
        update(requests: nil)
        decidingIds = []
    }

    public func approve(_ approval: ApprovalPresentation) async {
        await decide(approval, effect: .approve)
    }

    public func reject(_ approval: ApprovalPresentation) async {
        await decide(approval, effect: .reject)
    }

    public func approveAlways(_ approval: ApprovalPresentation) async {
        await decide(approval, effect: .approveAlways)
    }

    /// 送出一筆決定。成功後從清單移除；失敗時保留，讓使用者再試一次。
    public func decide(_ approval: ApprovalPresentation, effect: ApprovalEffect) async {
        guard !decidingIds.contains(approval.approvalId) else { return }
        guard let service else {
            errorMessage = AppL10n.text(.approvalServiceUnavailable, language: language)
            return
        }
        guard let option = approval.option(for: effect) else {
            errorMessage = AppL10n.text(.approvalOptionUnavailable, language: language)
            return
        }

        decidingIds.insert(approval.approvalId)
        defer { decidingIds.remove(approval.approvalId) }
        do {
            _ = try await service.decideApproval(
                approvalId: approval.approvalId,
                optionId: option.id,
                note: nil
            )
            requests.removeAll { $0.approvalId == approval.approvalId }
            errorMessage = nil
            noticeMessage = notice(for: effect)
        } catch {
            errorMessage = AppL10n.format(
                .conversationError,
                value: errorText(error),
                language: language
            )
        }
    }

    /// 緊急全部暫停：中止所有進行中的回合。不是審批決定，清單可能仍有待審批。
    public func pauseAll() async {
        guard let service else {
            errorMessage = AppL10n.text(.approvalPauseUnavailable, language: language)
            return
        }
        do {
            try await service.pauseAllApprovals(reason: "user")
            isPaused = true
            errorMessage = nil
            noticeMessage = AppL10n.text(.approvalPaused, language: language)
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

    private func notice(for effect: ApprovalEffect) -> String {
        switch effect {
        case .approve, .approveAlways:
            return AppL10n.text(.approvalApproved, language: language)
        case .reject:
            return AppL10n.text(.approvalRejected, language: language)
        }
    }

    private func errorText(_ error: any Error) -> String {
        (error as? CardiaryClientError)?.errorDescription ?? "\(error)"
    }
}
