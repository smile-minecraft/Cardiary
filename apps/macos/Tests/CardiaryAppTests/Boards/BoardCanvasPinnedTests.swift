import CardiaryKit
import XCTest

/// 釘選的復原點只在投影狀態真的改變時記錄。
final class BoardCanvasPinnedTests: XCTestCase {
    func testSetPinnedToSameStateDoesNotRecordUndo() {
        var canvas = BoardCanvas(items: [
            BoardCanvasItem(
                id: "item-1",
                cardId: "card-1",
                frame: BoardRect(x: 0, y: 0, width: 240, height: 160),
                pinned: true
            ),
        ])
        XCTAssertFalse(canvas.canUndo)

        let changed = canvas.setPinned(["item-1"], pinned: true)

        XCTAssertFalse(changed)
        XCTAssertFalse(canvas.canUndo, "狀態沒變就不該留下復原點")
    }

    func testSetPinnedMixedSelectionRecordsOnlyOneUndo() {
        var canvas = BoardCanvas(items: [
            BoardCanvasItem(
                id: "item-a",
                cardId: "card-a",
                frame: BoardRect(x: 0, y: 0, width: 240, height: 160),
                pinned: true
            ),
            BoardCanvasItem(
                id: "item-b",
                cardId: "card-b",
                frame: BoardRect(x: 320, y: 0, width: 240, height: 160),
                pinned: false
            ),
        ])

        XCTAssertTrue(canvas.setPinned(["item-a", "item-b"], pinned: true))
        XCTAssertFalse(canvas.setPinned(["item-a", "item-b"], pinned: true), "第二次已符合狀態")
        XCTAssertTrue(canvas.canUndo)
        XCTAssertEqual(canvas.items.map(\.pinned), [true, true])

        XCTAssertTrue(canvas.undo())
        XCTAssertEqual(canvas.items.map(\.pinned), [true, false], "只還原一次，回到原本的混合狀態")
        XCTAssertFalse(canvas.canUndo, "兩次呼叫只該留下一個復原點")
    }

    func testSetPinnedWithoutSelectionDoesNotRecordUndo() {
        var canvas = BoardCanvas(items: [
            BoardCanvasItem(
                id: "item-1",
                cardId: "card-1",
                frame: BoardRect(x: 0, y: 0, width: 240, height: 160),
                pinned: false
            ),
        ])

        XCTAssertFalse(canvas.setPinned([], pinned: true))

        XCTAssertFalse(canvas.canUndo)
    }
}
