import CardiaryKit
import Combine
import Foundation

/// 一則通知在流裡的樣子。
public struct NotificationPresentation: Identifiable, Codable, Equatable, Sendable {
    public let notificationId: String
    public let kind: NotificationKind
    public let title: String
    public let body: String
    public let createdAt: String
    public let readAt: String?
    public let sourceScheduleId: String?
    public let cardId: String?

    public var id: String { notificationId }
    public var isUnread: Bool { readAt == nil }

    public init(record: CardiaryNotification, cardId: String? = nil) {
        self.notificationId = record.notificationId
        self.kind = record.kind
        self.title = record.title
        self.body = record.body
        self.createdAt = record.createdAt
        self.readAt = record.readAt
        self.sourceScheduleId = record.sourceScheduleId
        self.cardId = cardId
    }

    /// 保留原本的卡片識別碼，只更新通知內容（事件可能還沒帶 cardId）。
    public func updating(record: CardiaryNotification) -> NotificationPresentation {
        NotificationPresentation(record: record, cardId: cardId)
    }

    public func withCardId(_ cardId: String) -> NotificationPresentation {
        NotificationPresentation(
            notificationId: notificationId,
            kind: kind,
            title: title,
            body: body,
            createdAt: createdAt,
            readAt: readAt,
            sourceScheduleId: sourceScheduleId,
            cardId: cardId
        )
    }

    private init(
        notificationId: String,
        kind: NotificationKind,
        title: String,
        body: String,
        createdAt: String,
        readAt: String?,
        sourceScheduleId: String?,
        cardId: String?
    ) {
        self.notificationId = notificationId
        self.kind = kind
        self.title = title
        self.body = body
        self.createdAt = createdAt
        self.readAt = readAt
        self.sourceScheduleId = sourceScheduleId
        self.cardId = cardId
    }
}

/// 通知流：清單、未讀計數、標已讀、轉卡與加入對話。
///
/// `notification.changed` 事件即時更新清單；所有寫操作走 `NotificationService`，
/// 介面不碰協定 frame。卡片去重由主機負責，介面另外擋住重複提交。
///
/// 「加入對話」會先轉成卡片（已有卡片就重用），再用 `context.add_card_to_context`
/// 加到選中的對話。
@MainActor
public final class NotificationModel: ObservableObject {
    public let scheduler = SchedulerModel()

    @Published public private(set) var notifications: [NotificationPresentation] = []
    @Published public private(set) var totalUnread = 0
    @Published public private(set) var isKnown = false
    @Published public private(set) var isLoading = false
    @Published public private(set) var actingIds: Set<String> = []
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?
    @Published public private(set) var conversations: [SessionSummary] = []
    @Published public private(set) var isLoadingConversations = false

    private var service: (any NotificationService)?
    private var contextService: (any ContextService)?
    private var conversationService: (any ConversationService)?
    private var systemCenter: (any NotificationSystemCenter)?
    private var systemCenterSettings: (any NotificationSystemCenterSettings)?
    private let language: AppLanguage

    public init(language: AppLanguage = AppL10n.language) {
        self.language = language
    }

    public func attach(service: any NotificationService) {
        self.service = service
        contextService = service as? any ContextService
        conversationService = service as? any ConversationService
        // 有設定服務時才接 `UNUserNotificationCenter`，避免測試的假服務誤觸系統通知。
        let isRunningUnderXCTest = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
        if let settings = service as? any SettingsService {
            systemCenterSettings = SettingsNotificationSystemCenter(service: settings)
            #if canImport(UserNotifications)
            if !isRunningUnderXCTest {
                systemCenter = UserNotificationSystemCenter()
            }
            #endif
        } else {
            systemCenterSettings = nil
            systemCenter = nil
        }
        if let sender = service as? any ModuleRequestSending {
            scheduler.attach(service: ModuleSchedulerAdminService(sender: sender))
        } else {
            scheduler.detach()
        }
    }

    /// 注入假的系統通知中心，給測試用。
    public func attachSystemCenter(_ center: (any NotificationSystemCenter)?) {
        systemCenter = center
    }

    /// 注入假的設定來源，給測試用。
    public func attachSystemCenterSettings(_ settings: (any NotificationSystemCenterSettings)?) {
        systemCenterSettings = settings
    }

    public func detach() {
        service = nil
        contextService = nil
        conversationService = nil
        systemCenter = nil
        systemCenterSettings = nil
        scheduler.detach()
        notifications = []
        conversations = []
        totalUnread = 0
        isKnown = false
        actingIds = []
    }

    /// 殼推來的完整通知清單；`nil` 代表還沒連上服務。
    public func update(notifications: NotificationListResponsePayload?) {
        guard let payload = notifications else {
            self.notifications = []
            totalUnread = 0
            isKnown = false
            return
        }
        // 轉卡後主機可能還沒把 cardId 帶進事件；保留本機已知的 cardId。
        let knownCards = Dictionary(
            uniqueKeysWithValues: self.notifications.compactMap { item in
                item.cardId.map { (item.notificationId, $0) }
            }
        )
        self.notifications = payload.notifications
            .map { record in
                NotificationPresentation(record: record, cardId: knownCards[record.notificationId])
            }
            .sorted { ($0.createdAt, $0.notificationId) > ($1.createdAt, $1.notificationId) }
        totalUnread = payload.totalUnread
        isKnown = true
        actingIds.formIntersection(Set(self.notifications.map(\.notificationId)))
    }

    /// `notification.changed` 事件：新增或更新一則通知，並同步未讀計數。
    public func handle(change event: NotificationChangedEvent) {
        let record = event.payload.notification
        let presentation = NotificationPresentation(record: record)
        let isNew = notifications.allSatisfy { $0.notificationId != record.notificationId }
        if let index = notifications.firstIndex(where: { $0.notificationId == record.notificationId }) {
            notifications[index] = notifications[index].updating(record: record)
        } else {
            notifications.insert(presentation, at: 0)
        }
        // 未讀計數一律由目前清單重算，重複事件才不會累加。
        recountUnread()
        isKnown = true
        if isNew, record.readAt == nil {
            let item = notifications.first { $0.notificationId == record.notificationId } ?? presentation
            Task { await presentSystemNotification(for: item) }
        }
    }

    public func reload() async {
        guard let service else {
            errorMessage = NotificationL10n.text(.notificationServiceUnavailable, language: language)
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            update(notifications: try await service.listNotifications(limit: nil, before: nil, unreadOnly: nil))
            errorMessage = nil
        } catch {
            errorMessage = NotificationL10n.format(
                .notificationActionFailed, value: Self.errorText(error), language: language
            )
        }
    }

    /// 標單則已讀。同一則重複呼叫只送一次。
    public func markRead(_ item: NotificationPresentation) async {
        guard !actingIds.contains(item.notificationId) else { return }
        guard item.isUnread else { return }
        guard let service else {
            errorMessage = NotificationL10n.text(.notificationServiceUnavailable, language: language)
            return
        }
        actingIds.insert(item.notificationId)
        defer { actingIds.remove(item.notificationId) }
        do {
            let response = try await service.markNotificationsRead(ids: [item.notificationId], all: nil)
            applyMarkRead(ids: [item.notificationId], totalUnread: response.totalUnread)
            errorMessage = nil
        } catch {
            errorMessage = NotificationL10n.format(
                .notificationActionFailed, value: Self.errorText(error), language: language
            )
        }
    }

    public func markAllRead() async {
        guard let service else {
            errorMessage = NotificationL10n.text(.notificationServiceUnavailable, language: language)
            return
        }
        do {
            let response = try await service.markNotificationsRead(ids: nil, all: true)
            applyMarkRead(ids: Set(notifications.map(\.notificationId)), totalUnread: response.totalUnread)
            errorMessage = nil
        } catch {
            errorMessage = NotificationL10n.format(
                .notificationActionFailed, value: Self.errorText(error), language: language
            )
        }
    }

    /// 轉卡：主機去重，介面也擋住同一則的重複提交，成功後記下 cardId。
    @discardableResult
    public func createCard(for item: NotificationPresentation) async -> Bool {
        if item.cardId != nil {
            noticeMessage = NotificationL10n.text(.notificationCardReused, language: language)
            return false
        }
        return await ensureCard(for: item) != nil
    }

    /// 取得通知對應的卡片；沒有卡片就請主機轉一張，成功後更新載入中的清單。
    ///
    /// 拖曳帶來的通知可能不在 `notifications` 裡，所以回傳值不能從清單重新讀取。
    private func ensureCard(for item: NotificationPresentation) async -> String? {
        if let cardId = item.cardId { return cardId }
        guard !actingIds.contains(item.notificationId) else { return nil }
        guard let service else {
            errorMessage = NotificationL10n.text(.notificationServiceUnavailable, language: language)
            return nil
        }
        actingIds.insert(item.notificationId)
        defer { actingIds.remove(item.notificationId) }
        do {
            let response = try await service.createCardFromNotification(notificationId: item.notificationId)
            if let index = notifications.firstIndex(where: { $0.notificationId == item.notificationId }) {
                notifications[index] = notifications[index].withCardId(response.card.cardId)
            }
            noticeMessage = response.deduped
                ? NotificationL10n.text(.notificationCardReused, language: language)
                : NotificationL10n.text(.notificationCardCreated, language: language)
            errorMessage = nil
            return response.card.cardId
        } catch {
            errorMessage = NotificationL10n.format(
                .notificationActionFailed, value: Self.errorText(error), language: language
            )
            return nil
        }
    }

    /// 載入可加入通知卡片的對話（最近 20 筆）。
    public func loadConversations() async {
        guard let conversationService else {
            errorMessage = NotificationL10n.text(.notificationServiceUnavailable, language: language)
            return
        }
        guard !isLoadingConversations else { return }
        isLoadingConversations = true
        defer { isLoadingConversations = false }
        do {
            let payload = try await conversationService.listSessions(cursor: nil, limit: 20)
            conversations = payload.sessions
            errorMessage = nil
        } catch {
            errorMessage = NotificationL10n.format(
                .notificationActionFailed, value: Self.errorText(error), language: language
            )
        }
    }

    /// 把通知轉成卡片（已有卡片就重用），加到指定的對話。
    @discardableResult
    public func addToConversation(
        _ item: NotificationPresentation,
        sessionId: String,
        conversationTitle: String? = nil
    ) async -> Bool {
        guard !actingIds.contains(item.notificationId) else { return false }
        guard let contextService else {
            errorMessage = NotificationL10n.text(.notificationServiceUnavailable, language: language)
            return false
        }
        guard let cardId = await ensureCard(for: item) else { return false }
        actingIds.insert(item.notificationId)
        defer { actingIds.remove(item.notificationId) }
        do {
            _ = try await contextService.addCardToContext(sessionId: sessionId, cardId: cardId)
            noticeMessage = NotificationL10n.format(
                .notificationAddedToConversation,
                value: conversationTitle ?? sessionId,
                language: language
            )
            errorMessage = nil
            return true
        } catch {
            errorMessage = NotificationL10n.format(
                .notificationActionFailed, value: Self.errorText(error), language: language
            )
            return false
        }
    }

    /// 拖曳進對話：先從載入中的清單找通知，找不到就用拖曳帶來的內容；
    /// 兩者都沒有時重新整理通知流再找一次，避免因為分頁或尚未載入而靜默失敗。
    @discardableResult
    public func addToConversation(
        drags: [NotificationDrag],
        sessionId: String,
        conversationTitle: String? = nil
    ) async -> Int {
        let unique = Self.deduplicated(drags)
        guard !unique.isEmpty else { return 0 }
        errorMessage = nil

        var items: [NotificationPresentation] = []
        var missing: [String] = []
        for drag in unique {
            if let item = notifications.first(where: { $0.notificationId == drag.notificationId }) {
                items.append(item)
            } else if let item = drag.notification {
                items.append(item)
            } else {
                missing.append(drag.notificationId)
            }
        }
        if !missing.isEmpty, service != nil {
            await reload()
            for id in missing {
                if let item = notifications.first(where: { $0.notificationId == id }) {
                    items.append(item)
                }
            }
            missing = missing.filter { id in !items.contains { $0.notificationId == id } }
        }

        var added = 0
        var failures: [String] = []
        for item in items {
            if await addToConversation(item, sessionId: sessionId, conversationTitle: conversationTitle) {
                added += 1
            } else {
                failures.append(
                    errorMessage ?? NotificationL10n.text(.notificationNotFound, language: language)
                )
            }
        }
        if !missing.isEmpty {
            failures.append(NotificationL10n.text(.notificationNotFound, language: language))
        }

        if added == unique.count {
            errorMessage = nil
        } else if added > 0 {
            errorMessage = NotificationL10n.count(.notificationPartiallyAdded, count: added, language: language)
        } else {
            errorMessage = failures.first
        }
        return added
    }

    /// 只帶通知識別碼的版本；內容留給通知流查詢。
    @discardableResult
    public func addToConversation(
        notificationIds: [String],
        sessionId: String,
        conversationTitle: String? = nil
    ) async -> Int {
        await addToConversation(
            drags: notificationIds.map { NotificationDrag(notificationId: $0) },
            sessionId: sessionId,
            conversationTitle: conversationTitle
        )
    }

    private static func deduplicated(_ drags: [NotificationDrag]) -> [NotificationDrag] {
        var seen = Set<String>()
        return drags.filter { seen.insert($0.notificationId).inserted }
    }

    /// 有權限且設定允許時，送一則系統通知；失敗不擋住通知流程。
    public func presentSystemNotification(for item: NotificationPresentation) async {
        guard let systemCenter else { return }
        let enabled = (try? await systemCenterSettings?.isEnabled()) ?? true
        guard enabled else { return }
        guard await systemCenter.requestAuthorization() else { return }
        try? await systemCenter.show(id: item.notificationId, title: item.title, body: item.body)
    }

    public func dismissMessages() {
        errorMessage = nil
        noticeMessage = nil
    }

    private func applyMarkRead(ids: some Collection<String>, totalUnread: Int) {
        let idSet = Set(ids)
        let stamp = ISO8601DateFormatter().string(from: Date())
        notifications = notifications.map { item in
            guard idSet.contains(item.notificationId), item.readAt == nil else { return item }
            return NotificationPresentation(
                record: CardiaryNotification(
                    notificationId: item.notificationId,
                    kind: item.kind,
                    title: item.title,
                    body: item.body,
                    createdAt: item.createdAt,
                    readAt: stamp,
                    sourceScheduleId: item.sourceScheduleId,
                    payload: [:]
                ),
                cardId: item.cardId
            )
        }
        self.totalUnread = totalUnread
    }

    private func recountUnread() {
        totalUnread = notifications.filter(\.isUnread).count
    }

    private static func errorText(_ error: any Error) -> String {
        (error as? CardiaryClientError)?.errorDescription ?? "\(error)"
    }
}
