import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 白板頁籤也要沿用最後選取的對話當送出目標。
@MainActor
final class BoardsUIModuleTests: XCTestCase {
    func testBoardsTabKeepsLastSelectedConversationAsSendTarget() async {
        let app = AppModel()
        let service = FakeCardiaryService(sessions: [
            Fixtures.summary("s1"),
            Fixtures.summary("s2"),
        ])
        app.conversations.attach(service: service)
        await app.conversations.reload()
        app.conversations.select("s2")

        // 切到白板頁籤後，selection 不再是對話，但清單仍記得最後選取的對話。
        app.selectSlot(AppRegistry.boardsSlotId)
        BoardsUIModule.install(app)
        let model = app.contentModels.compactMap { $0 as? BoardModel }.first

        XCTAssertEqual(model?.currentConversationId, "s2")
        XCTAssertEqual(model?.currentConversationTitle, "對話 s2")
    }

    func testBoardsTabWithoutConversationHasNoSendTarget() async {
        let app = AppModel()
        let service = FakeCardiaryService()
        app.conversations.attach(service: service)
        await app.conversations.reload()
        app.selectSlot(AppRegistry.boardsSlotId)
        BoardsUIModule.install(app)
        let model = app.contentModels.compactMap { $0 as? BoardModel }.first

        XCTAssertNil(model?.currentConversationId, "沒有對話時畫面要提示先選一場對話")
    }

    func testDeletingConversationRemovesItFromTheList() async {
        let app = AppModel()
        let service = FakeCardiaryService(sessions: [
            Fixtures.summary("s1"),
            Fixtures.summary("s2"),
        ])
        await app.attach(service: service)
        app.selectSlot(AppRegistry.boardsSlotId)
        BoardsUIModule.install(app)
        let model = app.contentModels.compactMap { $0 as? BoardModel }.first

        await model?.deleteConversation("s2")

        XCTAssertEqual(app.conversations.sessions.map(\.id), ["s1"])
        let deleted = await service.deletedSessions
        XCTAssertEqual(deleted, ["s2"])
    }

    func testFailedSendToNewConversationReturnsToBoardAndRestoresTarget() async {
        let app = AppModel()
        let service = FakeCardiaryService(sessions: [
            Fixtures.summary("s1"),
            Fixtures.summary("s2"),
        ])
        await app.attach(service: service)
        app.conversations.select("s2")
        app.selectSlot(AppRegistry.boardsSlotId)
        BoardsUIModule.install(app)
        let model = app.contentModels.compactMap { $0 as? BoardModel }.first

        // 「送到新對話」先建立對話，主區域會切過去。
        let created = await model?.createConversation()
        XCTAssertEqual(created, "session-new")
        XCTAssertEqual(app.selection, .conversation("session-new"))

        // 送出失敗，收回對話。
        await model?.deleteConversation("session-new")

        XCTAssertEqual(app.selection, .slot(AppRegistry.boardsSlotId), "要回到白板，錯誤訊息才看得到")
        XCTAssertFalse(app.conversations.sessions.contains { $0.id == "session-new" })
        XCTAssertEqual(model?.currentConversationId, "s2", "送出目標還原成原本選的對話")
    }

    func testFailedSendReturnsToBoardEvenWhenDeletedEventArrivesFirst() async {
        let app = AppModel()
        let service = FakeCardiaryService(sessions: [
            Fixtures.summary("s1"),
            Fixtures.summary("s2"),
        ])
        await app.attach(service: service)
        app.conversations.select("s2")
        app.selectSlot(AppRegistry.boardsSlotId)
        BoardsUIModule.install(app)
        let model = app.contentModels.compactMap { $0 as? BoardModel }.first
        _ = await model?.createConversation()

        // 打包版實測的順序：主機的 session.deleted 事件先到，AppModel 已改選清單第一場。
        app.handle(sessionEvent: .sessionDeletedEvent(SessionDeletedEvent(
            stream: "system", seq: 1, emittedAt: "2026-01-10T03:00:00Z",
            payload: SessionDeletedEventPayload(
                sessionId: "session-new", deletedSessionIds: ["session-new"], deletedCards: 0, deletedAssets: 0
            )
        )))
        XCTAssertEqual(app.selection, .conversation("s1"))

        await model?.deleteConversation("session-new")

        XCTAssertEqual(app.selection, .slot(AppRegistry.boardsSlotId))
        XCTAssertEqual(model?.currentConversationId, "s2")
    }

    func testSuccessfulSendToNewConversationStaysOnTheNewConversation() async {
        let app = AppModel()
        let service = FakeCardiaryService(sessions: [Fixtures.summary("s1")])
        await app.attach(service: service)
        app.selectSlot(AppRegistry.boardsSlotId)
        BoardsUIModule.install(app)
        let model = app.contentModels.compactMap { $0 as? BoardModel }.first

        let created = await model?.createConversation()

        // 送出成功不會呼叫 deleteConversation；照舊停在新對話。
        XCTAssertEqual(created, "session-new")
        XCTAssertEqual(app.selection, .conversation("session-new"))
        let deleted = await service.deletedSessions
        XCTAssertTrue(deleted.isEmpty)
    }
}
