import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 通知流：未讀計數、標已讀、即時事件與轉卡去重。
/// 字串固定用繁體中文，不跟著 CI runner 的系統語言。
@MainActor
final class NotificationModelTests: XCTestCase {
    private func makeModel() -> NotificationModel {
        NotificationModel(language: .zhHant)
    }

    private func record(
        id: String = "n-1",
        readAt: String? = nil,
        createdAt: String = "2026-01-01T00:00:00Z"
    ) -> CardiaryNotification {
        CardiaryNotification(
            notificationId: id,
            kind: .schedule,
            title: "每日摘要",
            body: "今天有 3 則新訊息",
            createdAt: createdAt,
            readAt: readAt,
            payload: [:]
        )
    }

    private func payload(_ records: [CardiaryNotification], unread: Int) -> NotificationListResponsePayload {
        NotificationListResponsePayload(notifications: records, totalUnread: unread)
    }

    func testUpdateCountsUnreadAndSortsNewestFirst() {
        let model = makeModel()
        model.update(notifications: payload([
            record(id: "old", createdAt: "2026-01-01T00:00:00Z"),
            record(id: "new", createdAt: "2026-01-02T00:00:00Z"),
        ], unread: 2))

        XCTAssertTrue(model.isKnown)
        XCTAssertEqual(model.notifications.map(\.notificationId), ["new", "old"])
        XCTAssertEqual(model.totalUnread, 2)
        XCTAssertTrue(model.notifications.allSatisfy(\.isUnread))
    }

    func testUpdateNilMarksUnknown() {
        let model = makeModel()
        model.update(notifications: payload([record()], unread: 1))
        model.update(notifications: nil)

        XCTAssertFalse(model.isKnown)
        XCTAssertTrue(model.notifications.isEmpty)
        XCTAssertEqual(model.totalUnread, 0)
    }

    func testMarkReadUpdatesItemAndUnreadCount() async {
        let fake = FakeNotificationService()
        let model = makeModel()
        model.attach(service: fake)
        model.update(notifications: payload([record(id: "n-1"), record(id: "n-2")], unread: 2))

        await model.markRead(model.notifications.first { $0.notificationId == "n-1" }!)

        let calls = await fake.markReadCalls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.ids, ["n-1"])
        XCTAssertEqual(model.notifications.first { $0.notificationId == "n-1" }?.isUnread, false)
        XCTAssertEqual(model.totalUnread, 1)
    }

    func testMarkReadSkipsAlreadyRead() async {
        let fake = FakeNotificationService()
        let model = makeModel()
        model.attach(service: fake)
        let read = record(id: "n-1", readAt: "2026-01-01T01:00:00Z")
        model.update(notifications: payload([read], unread: 0))

        await model.markRead(model.notifications[0])

        let calls = await fake.markReadCalls
        XCTAssertTrue(calls.isEmpty)
    }

    func testNotificationChangedAddsUnreadAndUpdatesExisting() {
        let model = makeModel()

        let event = NotificationChangedEvent(
            stream: "system",
            seq: 1,
            emittedAt: "2026-01-01T00:00:00Z",
            payload: NotificationChangedEventPayload(notification: record(id: "n-1"))
        )
        model.handle(change: event)
        XCTAssertEqual(model.notifications.count, 1)
        XCTAssertEqual(model.totalUnread, 1)

        // 同一則重複事件不應累加未讀。
        model.handle(change: event)
        XCTAssertEqual(model.notifications.count, 1)
        XCTAssertEqual(model.totalUnread, 1)

        let readEvent = NotificationChangedEvent(
            stream: "system",
            seq: 2,
            emittedAt: "2026-01-01T00:01:00Z",
            payload: NotificationChangedEventPayload(
                notification: record(id: "n-1", readAt: "2026-01-01T00:01:00Z")
            )
        )
        model.handle(change: readEvent)
        XCTAssertEqual(model.totalUnread, 0)
    }

    func testCreateCardSetsCardIdAndDeduplicates() async {
        let fake = FakeNotificationService()
        let model = makeModel()
        model.attach(service: fake)
        model.update(notifications: payload([record()], unread: 1))
        let item = model.notifications[0]

        let first = await model.createCard(for: item)
        XCTAssertTrue(first)
        XCTAssertEqual(model.notifications[0].cardId, "card-1")
        XCTAssertEqual(model.noticeMessage, "已建立卡片。")

        // 同一則通知已有 cardId，再轉一次只回報重用，不重送建立請求。
        let second = await model.createCard(for: model.notifications[0])
        XCTAssertFalse(second)
        let calls = await fake.createCardCalls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first, "n-1")
    }

    func testCreateCardFailureKeepsNoCardId() async {
        let fake = FakeNotificationService()
        await fake.setFailCreateCard(true)
        let model = makeModel()
        model.attach(service: fake)
        model.update(notifications: payload([record()], unread: 1))

        let ok = await model.createCard(for: model.notifications[0])

        XCTAssertFalse(ok)
        XCTAssertNil(model.notifications[0].cardId)
        XCTAssertNotNil(model.errorMessage)
    }
}

private actor FakeNotificationService: NotificationService {
    private(set) var markReadCalls: [(ids: [String]?, all: Bool?)] = []
    private(set) var createCardCalls: [String] = []
    private var failCreateCard = false

    func setFailCreateCard(_ value: Bool) { failCreateCard = value }

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
        markReadCalls.append((ids, all))
        // 兩則通知標一則已讀後，主机回報的全域未讀數是 1。
        return NotificationMarkReadResponsePayload(updated: ids?.count ?? 2, totalUnread: 1)
    }

    func createCardFromNotification(
        notificationId: String
    ) async throws -> NotificationCreateCardResponsePayload {
        if failCreateCard { throw FakeError.failed }
        createCardCalls.append(notificationId)
        return NotificationCreateCardResponsePayload(
            card: CardSummary(
                cardId: "card-1",
                kind: .note,
                title: "每日摘要",
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

private enum FakeError: LocalizedError {
    case failed
    var errorDescription: String? { "測試錯誤" }
}
