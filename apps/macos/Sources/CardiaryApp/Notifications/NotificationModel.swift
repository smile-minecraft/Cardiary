import CardiaryKit
import Combine
import Foundation

/// 一則通知在流裡的樣子。
public struct NotificationPresentation: Identifiable, Equatable, Sendable {
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

/// 通知流：清單、未讀計數、標已讀與轉卡。
///
/// `notification.changed` 事件即時更新清單；所有寫操作走 `NotificationService`，
/// 介面不碰協定 frame。卡片去重由主机負責，介面另外擋住重複提交。
@MainActor
public final class NotificationModel: ObservableObject {
    @Published public private(set) var notifications: [NotificationPresentation] = []
    @Published public private(set) var totalUnread = 0
    @Published public private(set) var isKnown = false
    @Published public private(set) var isLoading = false
    @Published public private(set) var actingIds: Set<String> = []
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?

    private var service: (any NotificationService)?
    private let language: AppLanguage

    public init(language: AppLanguage = AppL10n.language) {
        self.language = language
    }

    public func attach(service: any NotificationService) {
        self.service = service
    }

    public func detach() {
        service = nil
        notifications = []
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
        // 轉卡後主机可能還沒把 cardId 帶進事件；保留本機已知的 cardId。
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
        if let index = notifications.firstIndex(where: { $0.notificationId == record.notificationId }) {
            notifications[index] = notifications[index].updating(record: record)
        } else {
            notifications.insert(presentation, at: 0)
        }
        // 未讀計數一律由目前清單重算，重複事件才不會累加。
        recountUnread()
        isKnown = true
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

    /// 轉卡：主机去重，介面也擋住同一則的重複提交，成功後記下 cardId。
    @discardableResult
    public func createCard(for item: NotificationPresentation) async -> Bool {
        guard !actingIds.contains(item.notificationId) else { return false }
        if item.cardId != nil {
            noticeMessage = NotificationL10n.text(.notificationCardReused, language: language)
            return false
        }
        guard let service else {
            errorMessage = NotificationL10n.text(.notificationServiceUnavailable, language: language)
            return false
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
            return true
        } catch {
            errorMessage = NotificationL10n.format(
                .notificationActionFailed, value: Self.errorText(error), language: language
            )
            return false
        }
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
