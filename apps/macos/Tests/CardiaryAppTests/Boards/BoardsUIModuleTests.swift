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
}
