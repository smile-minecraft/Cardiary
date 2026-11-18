import Combine
import Foundation

/// 側欄對話列接受通知拖曳：先選取該對話，再把通知加入對話。
///
/// 單一視窗一次只顯示一個入口，通知面板與對話稿不會同時出現，所以拖曳的放置目標
/// 放在一直看得到的左側欄。選取與加入抽成注入的閉包，檢視只轉發拖放事件並顯示
/// `message`；測試驗證兩步的順序、參數與訊息，不需要真的啟動拖放。
@MainActor
public final class NotificationDropTarget: ObservableObject {
    /// 加入的結果。`errorMessage` 是模型層已經整理好的訊息，沒有就由這裡補上。
    public struct AddOutcome: Equatable, Sendable {
        public let added: Int
        public let errorMessage: String?

        public init(added: Int, errorMessage: String? = nil) {
            self.added = added
            self.errorMessage = errorMessage
        }
    }

    public typealias SelectConversation = @MainActor (_ conversationId: String) async -> Void
    public typealias AddNotifications = @MainActor (
        _ drags: [NotificationDrag], _ conversationId: String, _ conversationTitle: String?
    ) async -> AddOutcome

    /// 側欄要顯示的結果；成功是「已加入」，失敗是可理解的錯誤。
    @Published public private(set) var message: String?
    @Published public private(set) var isError = false

    private let language: AppLanguage
    private let clearDelay: Duration
    private let selectConversation: SelectConversation
    private let addNotifications: AddNotifications
    private var clearTask: Task<Void, Never>?
    /// 訊息被新的拖放取代時，舊的清除工作不能再把新訊息清掉。
    private var messageToken = UUID()

    public init(
        language: AppLanguage = AppL10n.language,
        clearDelay: Duration = .seconds(8),
        selectConversation: @escaping SelectConversation,
        addNotifications: @escaping AddNotifications
    ) {
        self.language = language
        self.clearDelay = clearDelay
        self.selectConversation = selectConversation
        self.addNotifications = addNotifications
    }

    deinit {
        clearTask?.cancel()
    }

    /// 把通知拖到一個對話列：先選取對話，再加入通知。回傳加入的則數。
    @discardableResult
    public func performDrop(
        _ drags: [NotificationDrag],
        conversationId: String,
        conversationTitle: String?,
        displayTitle: String
    ) async -> Int {
        guard !drags.isEmpty else { return 0 }
        clearTask?.cancel()
        await selectConversation(conversationId)
        let outcome = await addNotifications(
            drags,
            conversationId,
            conversationTitle?.isEmpty == true ? nil : conversationTitle
        )
        show(outcome, displayTitle: displayTitle)
        return outcome.added
    }

    /// 使用者按掉結果或訊息自己消失。
    public func dismiss() {
        clearTask?.cancel()
        messageToken = UUID()
        message = nil
        isError = false
    }

    private func show(_ outcome: AddOutcome, displayTitle: String) {
        messageToken = UUID()
        let token = messageToken
        let delay = clearDelay
        if outcome.added > 0, outcome.errorMessage == nil {
            message = NotificationL10n.format(
                .notificationAddedToConversation,
                value: displayTitle,
                language: language
            )
            isError = false
        } else if outcome.added > 0 {
            message = NotificationL10n.count(
                .notificationPartiallyAdded,
                count: outcome.added,
                language: language
            )
            isError = true
        } else {
            message = outcome.errorMessage
                ?? NotificationL10n.text(.notificationNotFound, language: language)
            isError = true
        }
        clearTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled, let self, self.messageToken == token else { return }
            self.message = nil
            self.isError = false
        }
    }
}
