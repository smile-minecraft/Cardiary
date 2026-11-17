import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 側欄拖放：先選取對話，再加入通知，並把結果轉成看得懂的訊息。
@MainActor
final class NotificationDropTargetTests: XCTestCase {
    private func drag(_ id: String) -> NotificationDrag {
        NotificationDrag(notificationId: id)
    }

    func testDropSelectsConversationBeforeAdding() async {
        var events: [String] = []
        let target = NotificationDropTarget(
            language: .zhHant,
            selectConversation: { id in events.append("select:\(id)") },
            addNotifications: { drags, id, title in
                events.append("add:\(id):\(title ?? "-"):\(drags.map(\.notificationId).joined(separator: ","))")
                return NotificationDropTarget.AddOutcome(added: drags.count)
            }
        )

        let added = await target.performDrop(
            [drag("n-1"), drag("n-2")],
            conversationId: "session-1",
            conversationTitle: "晚餐聊聊",
            displayTitle: "晚餐聊聊"
        )

        XCTAssertEqual(events, ["select:session-1", "add:session-1:晚餐聊聊:n-1,n-2"])
        XCTAssertEqual(added, 2)
        XCTAssertEqual(target.message, "已加入「晚餐聊聊」。")
        XCTAssertFalse(target.isError)
    }

    func testEmptyTitleIsPassedAsNilAndCompletedMessageUsesDisplayTitle() async {
        var receivedTitle: String? = "unset"
        let target = NotificationDropTarget(
            language: .zhHant,
            selectConversation: { _ in },
            addNotifications: { drags, _, title in
                receivedTitle = title
                return NotificationDropTarget.AddOutcome(added: drags.count)
            }
        )

        _ = await target.performDrop(
            [drag("n-1")],
            conversationId: "session-1",
            conversationTitle: "",
            displayTitle: "未命名對話"
        )

        XCTAssertNil(receivedTitle)
        XCTAssertEqual(target.message, "已加入「未命名對話」。")
    }

    func testEmptyDropDoesNothing() async {
        var selected = false
        let target = NotificationDropTarget(
            selectConversation: { _ in selected = true },
            addNotifications: { _, _, _ in NotificationDropTarget.AddOutcome(added: 0) }
        )

        let added = await target.performDrop(
            [],
            conversationId: "session-1",
            conversationTitle: nil,
            displayTitle: "晚餐聊聊"
        )

        XCTAssertEqual(added, 0)
        XCTAssertFalse(selected)
        XCTAssertNil(target.message)
    }

    func testZeroAddedUsesModelErrorMessage() async {
        let target = NotificationDropTarget(
            language: .zhHant,
            selectConversation: { _ in },
            addNotifications: { _, _, _ in
                NotificationDropTarget.AddOutcome(added: 0, errorMessage: "主機忙線")
            }
        )

        _ = await target.performDrop(
            [drag("n-1")],
            conversationId: "session-1",
            conversationTitle: "晚餐聊聊",
            displayTitle: "晚餐聊聊"
        )

        XCTAssertEqual(target.message, "主機忙線")
        XCTAssertTrue(target.isError)
    }

    func testZeroAddedWithoutMessageFallsBackToNotFound() async {
        let target = NotificationDropTarget(
            language: .zhHant,
            selectConversation: { _ in },
            addNotifications: { _, _, _ in NotificationDropTarget.AddOutcome(added: 0) }
        )

        _ = await target.performDrop(
            [drag("n-1")],
            conversationId: "session-1",
            conversationTitle: nil,
            displayTitle: "晚餐聊聊"
        )

        XCTAssertEqual(target.message, "找不到這則通知，請重新整理後再試。")
        XCTAssertTrue(target.isError)
    }

    func testPartialSuccessReportsCount() async {
        let target = NotificationDropTarget(
            language: .zhHant,
            selectConversation: { _ in },
            addNotifications: { _, _, _ in
                NotificationDropTarget.AddOutcome(added: 1, errorMessage: "其餘失敗")
            }
        )

        _ = await target.performDrop(
            [drag("n-1"), drag("n-2")],
            conversationId: "session-1",
            conversationTitle: "晚餐聊聊",
            displayTitle: "晚餐聊聊"
        )

        XCTAssertEqual(target.message, "已加入 1 則，其餘沒加入。")
        XCTAssertTrue(target.isError)
    }

    func testDismissClearsMessage() async {
        let target = NotificationDropTarget(
            language: .zhHant,
            selectConversation: { _ in },
            addNotifications: { _, _, _ in NotificationDropTarget.AddOutcome(added: 1) }
        )
        _ = await target.performDrop(
            [drag("n-1")],
            conversationId: "session-1",
            conversationTitle: "晚餐聊聊",
            displayTitle: "晚餐聊聊"
        )

        target.dismiss()

        XCTAssertNil(target.message)
        XCTAssertFalse(target.isError)
    }
}
