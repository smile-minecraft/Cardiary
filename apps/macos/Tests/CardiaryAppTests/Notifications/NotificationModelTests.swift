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

    func testLoadConversationsListsRecentSessions() async {
        let fake = FakeNotificationAndContextService()
        await fake.setSessions([
            SessionSummary(
                id: "session-1",
                title: "晚餐聊聊",
                status: .idle,
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
                messageCount: 3
            ),
        ])
        let model = makeModel()
        model.attach(service: fake)

        await model.loadConversations()

        XCTAssertEqual(model.conversations.map(\.id), ["session-1"])
    }

    func testAddToConversationCreatesCardThenAddsToSession() async {
        let fake = FakeNotificationAndContextService()
        await fake.setSessions([
            SessionSummary(
                id: "session-1",
                title: "晚餐聊聊",
                status: .idle,
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
                messageCount: 1
            ),
        ])
        let model = makeModel()
        model.attach(service: fake)
        model.update(notifications: payload([record(id: "n-1")], unread: 1))

        let ok = await model.addToConversation(
            model.notifications[0],
            sessionId: "session-1",
            conversationTitle: "晚餐聊聊"
        )

        XCTAssertTrue(ok)
        XCTAssertEqual(model.noticeMessage, "已加入「晚餐聊聊」。")
        let added = await fake.addCardCalls
        XCTAssertEqual(added.count, 1)
        XCTAssertEqual(added.first?.sessionId, "session-1")
        XCTAssertEqual(added.first?.cardId, "card-1")
        XCTAssertEqual(model.notifications[0].cardId, "card-1")
    }

    func testAddToConversationFailureDoesNotKeepCardCreatedNotice() async {
        let fake = FakeNotificationAndContextService()
        await fake.setFailAddCard(true)
        let model = makeModel()
        model.attach(service: fake)
        model.update(notifications: payload([record(id: "n-1")], unread: 1))

        // 轉卡成功（會留下「已轉成卡片」），接著加入對話失敗。
        let ok = await model.addToConversation(
            model.notifications[0],
            sessionId: "session-1",
            conversationTitle: "晚餐聊聊"
        )

        XCTAssertFalse(ok)
        XCTAssertNotNil(model.errorMessage)
        XCTAssertNil(model.noticeMessage, "失敗時不能同時顯示成功提示")
        XCTAssertEqual(model.notifications[0].cardId, "card-1", "卡片已轉好，重試時重用")
    }

    func testDismissMessagesClearsLeftoversBeforePickerOpens() async {
        let fake = FakeNotificationAndContextService()
        let model = makeModel()
        model.attach(service: fake)
        model.update(notifications: payload([record(id: "n-1")], unread: 1))
        // 先在通知面板轉卡，留下提示；選對話的 sheet 打開時會呼叫 dismissMessages。
        _ = await model.createCard(for: model.notifications[0])
        XCTAssertNotNil(model.noticeMessage)

        model.dismissMessages()

        XCTAssertNil(model.noticeMessage)
        XCTAssertNil(model.errorMessage)
    }

    func testAddToConversationByDragIdsResolvesLoadedNotifications() async {
        let fake = FakeNotificationAndContextService()
        await fake.setListed([record(id: "n-1"), record(id: "n-2")])
        let model = makeModel()
        model.attach(service: fake)
        model.update(notifications: payload([record(id: "n-1"), record(id: "n-2")], unread: 2))

        // 拖曳只帶識別碼：已知的加入、找不到的重新整理後仍沒有就回報部分失敗。
        let added = await model.addToConversation(
            notificationIds: ["n-2", "n-missing"],
            sessionId: "session-1",
            conversationTitle: "晚餐聊聊"
        )

        XCTAssertEqual(added, 1)
        XCTAssertEqual(model.errorMessage, "已加入 1 則，其餘沒加入。")
        let calls = await fake.addCardCalls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first?.sessionId, "session-1")
        XCTAssertEqual(calls.first?.cardId, "card-1")
        XCTAssertEqual(model.notifications.first { $0.notificationId == "n-2" }?.cardId, "card-1")
        XCTAssertNil(model.notifications.first { $0.notificationId == "n-1" }?.cardId)
    }

    func testAddToConversationByDragIdsIgnoresUnknownOnly() async {
        let fake = FakeNotificationAndContextService()
        let model = makeModel()
        model.attach(service: fake)
        model.update(notifications: payload([record(id: "n-1")], unread: 1))

        let added = await model.addToConversation(
            notificationIds: ["n-missing"], sessionId: "session-1"
        )

        XCTAssertEqual(added, 0)
        XCTAssertEqual(model.errorMessage, "找不到這則通知，請重新整理後再試。")
        let calls = await fake.addCardCalls
        XCTAssertTrue(calls.isEmpty)
    }

    func testAddToConversationReloadsWhenNotificationNotLoaded() async {
        let fake = FakeNotificationAndContextService()
        await fake.setListed([record(id: "n-9")])
        let model = makeModel()
        model.attach(service: fake)
        model.update(notifications: payload([record(id: "n-1")], unread: 1))

        let added = await model.addToConversation(
            drags: [NotificationDrag(notificationId: "n-9")],
            sessionId: "session-1",
            conversationTitle: "晚餐聊聊"
        )

        XCTAssertEqual(added, 1)
        let listCalls = await fake.listCalls
        XCTAssertEqual(listCalls, 1)
        XCTAssertEqual(model.notifications.first { $0.notificationId == "n-9" }?.cardId, "card-1")
        let calls = await fake.addCardCalls
        XCTAssertEqual(calls.map(\.sessionId), ["session-1"])
    }

    func testAddToConversationUsesDragPayloadWithoutReload() async {
        let fake = FakeNotificationAndContextService()
        let model = makeModel()
        model.attach(service: fake)
        model.update(notifications: payload([], unread: 0))
        let drag = NotificationDrag(
            notificationId: "n-5",
            notification: NotificationPresentation(record: record(id: "n-5"))
        )

        let added = await model.addToConversation(
            drags: [drag],
            sessionId: "session-1",
            conversationTitle: "晚餐聊聊"
        )

        XCTAssertEqual(added, 1)
        let listCalls = await fake.listCalls
        XCTAssertEqual(listCalls, 0)
        let calls = await fake.addCardCalls
        XCTAssertEqual(calls.map(\.cardId), ["card-1"])
    }

    func testAddToConversationByDragIdsDeduplicates() async {
        let fake = FakeNotificationAndContextService()
        let model = makeModel()
        model.attach(service: fake)
        model.update(notifications: payload([record(id: "n-1")], unread: 1))

        let added = await model.addToConversation(
            notificationIds: ["n-1", "n-1"], sessionId: "session-1"
        )

        XCTAssertEqual(added, 1)
        let calls = await fake.addCardCalls
        XCTAssertEqual(calls.count, 1)
    }

    func testPresentSystemNotificationShowsWhenEnabledAndAuthorized() async {
        let center = FakeSystemCenter(authorize: true, failShow: false)
        let settings = FakeSystemCenterSettings(enabled: true)
        let model = makeModel()
        model.attachSystemCenter(center)
        model.attachSystemCenterSettings(settings)

        await model.presentSystemNotification(for: NotificationPresentation(record: record()))

        let shows = await center.showCalls
        XCTAssertEqual(shows.map(\.id), ["n-1"])
    }

    func testPresentSystemNotificationSkipsWhenSettingDisabled() async {
        let center = FakeSystemCenter(authorize: true, failShow: false)
        let settings = FakeSystemCenterSettings(enabled: false)
        let model = makeModel()
        model.attachSystemCenter(center)
        model.attachSystemCenterSettings(settings)

        await model.presentSystemNotification(for: NotificationPresentation(record: record()))

        let shows = await center.showCalls
        XCTAssertTrue(shows.isEmpty)
    }

    func testPresentSystemNotificationSkipsWhenNotAuthorized() async {
        let center = FakeSystemCenter(authorize: false, failShow: false)
        let settings = FakeSystemCenterSettings(enabled: true)
        let model = makeModel()
        model.attachSystemCenter(center)
        model.attachSystemCenterSettings(settings)

        await model.presentSystemNotification(for: NotificationPresentation(record: record()))

        let shows = await center.showCalls
        XCTAssertTrue(shows.isEmpty)
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
        // 兩則通知標一則已讀後，主機回報的全域未讀數是 1。
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

private actor FakeNotificationAndContextService: NotificationService, ContextService,
    ConversationService
{
    private(set) var addCardCalls: [(sessionId: String, cardId: String)] = []
    private(set) var createCardCalls: [String] = []
    private(set) var listCalls = 0
    private var sessions: [SessionSummary] = []
    private var listed: [CardiaryNotification] = []

    func setSessions(_ list: [SessionSummary]) { sessions = list }
    func setListed(_ list: [CardiaryNotification]) { listed = list }
    func setFailAddCard(_ fail: Bool) { failAddCard = fail }
    private var failAddCard = false

    func listNotifications(
        limit: Int?,
        before: String?,
        unreadOnly: Bool?
    ) async throws -> NotificationListResponsePayload {
        listCalls += 1
        return NotificationListResponsePayload(
            notifications: listed,
            totalUnread: listed.filter { $0.readAt == nil }.count
        )
    }

    func markNotificationsRead(
        ids: [String]?,
        all: Bool?
    ) async throws -> NotificationMarkReadResponsePayload {
        NotificationMarkReadResponsePayload(updated: ids?.count ?? 0, totalUnread: 0)
    }

    func createCardFromNotification(
        notificationId: String
    ) async throws -> NotificationCreateCardResponsePayload {
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

    func getContext(sessionId: String) async throws -> ContextGetResponsePayload {
        ContextGetResponsePayload(context: contextView(sessionId: sessionId))
    }

    func addCardToContext(
        sessionId: String,
        cardId: String
    ) async throws -> ContextAddCardResponsePayload {
        addCardCalls.append((sessionId, cardId))
        if failAddCard { throw CardiaryClientError.timeout }
        return ContextAddCardResponsePayload(context: contextView(sessionId: sessionId))
    }

    func removeCardFromContext(
        sessionId: String,
        cardId: String
    ) async throws -> ContextRemoveCardResponsePayload {
        ContextRemoveCardResponsePayload(context: contextView(sessionId: sessionId))
    }

    func compactContext(
        sessionId: String,
        instructions: String?
    ) async throws -> ContextCompactResponsePayload {
        ContextCompactResponsePayload(sessionId: sessionId, scheduled: true)
    }

    func listSessions(cursor: String?, limit: Int?) async throws -> SessionListResponsePayload {
        SessionListResponsePayload(sessions: sessions, nextCursor: nil)
    }

    func createSession(
        clientRequestId: String,
        title: String?
    ) async throws -> SessionCreateResponsePayload {
        SessionCreateResponsePayload(session: sessions.first ?? SessionSummary(
            id: "session-default",
            title: title ?? "預設對話",
            status: .idle,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            messageCount: 0
        ))
    }

    func getHistory(
        sessionId: String,
        cursor: String?,
        limit: Int?
    ) async throws -> SessionGetHistoryResponsePayload {
        SessionGetHistoryResponsePayload(entries: [], nextCursor: nil)
    }

    func sendMessage(
        sessionId: String,
        text: String,
        delivery: DeliveryMode,
        clientMessageId: String?
    ) async throws -> SessionSendMessageResponsePayload {
        SessionSendMessageResponsePayload(
            sessionId: sessionId,
            userMessageId: clientMessageId ?? "msg-1",
            turnId: "turn-1",
            disposition: .started
        )
    }

    func interruptSession(
        sessionId: String,
        reason: String?
    ) async throws -> SessionInterruptResponsePayload {
        SessionInterruptResponsePayload(sessionId: sessionId, interrupted: true)
    }

    func subscribeSession(
        sessionId: String,
        historyLimit: Int?
    ) async throws -> SessionSubscribeResponsePayload {
        SessionSubscribeResponsePayload(
            sessionId: sessionId,
            stream: "session:\(sessionId)",
            seq: 1,
            epoch: "epoch-1",
            resyncRequired: false
        )
    }

    func unsubscribeSession(sessionId: String) async {}

    private func contextView(sessionId: String) -> ContextView {
        ContextView(
            sessionId: sessionId,
            version: 1,
            entries: [],
            usedTokens: 0,
            budgetTokens: 1000,
            contextWindow: 2000,
            compactionThreshold: 0.75
        )
    }
}

private actor FakeSystemCenter: NotificationSystemCenter {
    private(set) var showCalls: [(id: String, title: String, body: String)] = []
    private let authorize: Bool
    private let failShow: Bool

    init(authorize: Bool, failShow: Bool) {
        self.authorize = authorize
        self.failShow = failShow
    }

    func requestAuthorization() async -> Bool { authorize }

    func show(id: String, title: String, body: String) async throws {
        if failShow { throw FakeError.failed }
        showCalls.append((id, title, body))
    }
}

private actor FakeSystemCenterSettings: NotificationSystemCenterSettings {
    private let enabled: Bool
    init(enabled: Bool) { self.enabled = enabled }
    func isEnabled() async throws -> Bool { enabled }
}

private enum FakeError: LocalizedError {
    case failed
    var errorDescription: String? { "測試錯誤" }
}
