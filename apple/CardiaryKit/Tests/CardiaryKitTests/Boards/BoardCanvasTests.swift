import XCTest
@testable import CardiaryKit

final class BoardCanvasTests: XCTestCase {
    private func item(_ id: String, x: Double, y: Double, width: Double = 240, height: Double = 160, pinned: Bool = false) -> BoardCanvasItem {
        BoardCanvasItem(
            id: id,
            cardId: "card-\(id)",
            frame: BoardRect(x: x, y: y, width: width, height: height),
            pinned: pinned
        )
    }

    // MARK: - 座標轉換

    func testScreenAndBoardPointsRoundTrip() {
        var canvas = BoardCanvas(items: [item("a", x: 100, y: 50)])
        canvas.setViewport(BoardCanvasPoint(x: 200, y: 150))
        canvas.scroll(toBoardPoint: BoardCanvasPoint(x: 100, y: 50))
        canvas.setZoom(2, anchorScreen: BoardCanvasPoint(x: 0, y: 0))

        let board = BoardCanvasPoint(x: 180, y: 130)
        let screen = canvas.screenPoint(forBoard: board)
        XCTAssertEqual(screen, BoardCanvasPoint(x: 160, y: 160))
        XCTAssertEqual(canvas.boardPoint(forScreen: screen), board)
    }

    func testZoomKeepsAnchorContentStill() {
        var canvas = BoardCanvas(items: [item("a", x: 100, y: 100)])
        canvas.setViewport(BoardCanvasPoint(x: 800, y: 600))
        let anchor = BoardCanvasPoint(x: 300, y: 220)
        let before = canvas.boardPoint(forScreen: anchor)

        canvas.zoom(by: 2, anchorScreen: anchor)

        let after = canvas.boardPoint(forScreen: anchor)
        XCTAssertEqual(before.x, after.x, accuracy: 0.0001)
        XCTAssertEqual(before.y, after.y, accuracy: 0.0001)
        XCTAssertEqual(canvas.zoom, 2)
    }

    func testZoomIsClamped() {
        var canvas = BoardCanvas()
        canvas.zoom(by: 100, anchorScreen: BoardCanvasPoint(x: 0, y: 0))
        XCTAssertEqual(canvas.zoom, BoardCanvas.maximumZoom)

        canvas.zoom(by: 0.0001, anchorScreen: BoardCanvasPoint(x: 0, y: 0))
        XCTAssertEqual(canvas.zoom, BoardCanvas.minimumZoom)
    }

    func testPanMovesVisibleRectAndClampsAtOrigin() {
        var canvas = BoardCanvas(items: [item("a", x: 0, y: 0), item("b", x: 2000, y: 1200)])
        canvas.setViewport(BoardCanvasPoint(x: 1000, y: 700))

        canvas.pan(byScreen: BoardCanvasPoint(x: -200, y: -100))
        XCTAssertEqual(canvas.origin.x, 200)
        XCTAssertEqual(canvas.origin.y, 100)

        canvas.pan(byScreen: BoardCanvasPoint(x: 5000, y: 5000))
        XCTAssertEqual(canvas.origin, BoardCanvasPoint(x: 0, y: 0))
    }

    func testScreenRectScalesWithZoom() {
        var canvas = BoardCanvas()
        canvas.setZoom(0.5, anchorScreen: BoardCanvasPoint(x: 0, y: 0))
        let rect = canvas.screenRect(forBoard: BoardRect(x: 20, y: 40, width: 100, height: 60))
        XCTAssertEqual(rect, BoardRect(x: 10, y: 20, width: 50, height: 30))
    }

    // MARK: - 命中與框選

    func testHitTestReturnsTopmostItem() {
        var canvas = BoardCanvas(items: [item("below", x: 0, y: 0), item("above", x: 40, y: 40)])
        XCTAssertEqual(canvas.hitTest(BoardCanvasPoint(x: 100, y: 100)), "above")
        XCTAssertNil(canvas.hitTest(BoardCanvasPoint(x: 1000, y: 1000)))
    }

    func testMarqueeSelectsIntersectingItemsOnly() {
        var canvas = BoardCanvas(items: [
            item("inside", x: 100, y: 100),
            item("edge", x: 320, y: 100),
            item("outside", x: 900, y: 900),
        ])
        canvas.beginMarquee(atScreen: BoardCanvasPoint(x: 0, y: 0))
        canvas.updateMarquee(toScreen: BoardCanvasPoint(x: 320, y: 260))
        let selected = canvas.endMarquee()

        XCTAssertEqual(selected, ["inside"])
        XCTAssertNil(canvas.marquee)
    }

    func testMarqueeAdditiveKeepsExistingSelection() {
        var canvas = BoardCanvas(items: [
            item("a", x: 0, y: 0),
            item("b", x: 500, y: 0),
        ])
        canvas.select("a")
        canvas.beginMarquee(atScreen: BoardCanvasPoint(x: 480, y: -10), additive: true)
        canvas.updateMarquee(toScreen: BoardCanvasPoint(x: 800, y: 200))
        _ = canvas.endMarquee(additive: true)

        XCTAssertEqual(canvas.selectedIds, ["a", "b"])
    }

    func testEmptySpaceTapClearsSelection() {
        var canvas = BoardCanvas(items: [item("a", x: 0, y: 0)])
        canvas.select("a")
        canvas.beginMarquee(atScreen: BoardCanvasPoint(x: 700, y: 700))
        _ = canvas.endMarquee()
        XCTAssertTrue(canvas.selectedIds.isEmpty)
    }

    // MARK: - 多選、對齊與移動

    func testAdditiveSelectionTogglesAndRemoves() {
        var canvas = BoardCanvas(items: [item("a", x: 0, y: 0), item("b", x: 300, y: 0)])
        canvas.select("a")
        canvas.select("b", additive: true)
        XCTAssertEqual(canvas.selectedIds, ["a", "b"])

        canvas.select("a", additive: true)
        XCTAssertEqual(canvas.selectedIds, ["b"])

        canvas.select("nope", additive: true)
        XCTAssertEqual(canvas.selectedIds, ["b"])
    }

    func testAlignSelectedToSharedBounds() {
        var canvas = BoardCanvas(items: [
            item("a", x: 10, y: 10, width: 100, height: 100),
            item("b", x: 300, y: 200, width: 100, height: 100),
        ])
        canvas.setSelection(["a", "b"])
        XCTAssertTrue(canvas.alignSelected(.left))

        let a = canvas.items[0].frame
        let b = canvas.items[1].frame
        XCTAssertEqual(a.minX, b.minX)
        XCTAssertEqual(b.minX, 10)
    }

    func testAlignCenterXAndMiddleY() {
        var canvas = BoardCanvas(items: [
            item("a", x: 0, y: 0, width: 100, height: 100),
            item("b", x: 100, y: 100, width: 50, height: 50),
        ])
        canvas.setSelection(["a", "b"])
        _ = canvas.alignSelected(.centerX)
        _ = canvas.alignSelected(.middleY)

        let a = canvas.items[0].frame
        let b = canvas.items[1].frame
        XCTAssertEqual(a.midX, b.midX)
        XCTAssertEqual(a.midY, b.midY)
    }

    func testAlignNeedsAtLeastTwoItems() {
        var canvas = BoardCanvas(items: [item("a", x: 10, y: 10)])
        canvas.select("a")
        XCTAssertFalse(canvas.alignSelected(.left))
        XCTAssertFalse(canvas.canUndo)
    }

    func testMoveSelectedNeverGoesNegative() {
        var canvas = BoardCanvas(items: [item("a", x: 30, y: 20), item("b", x: 500, y: 500)])
        canvas.select("a")
        canvas.moveSelected(by: BoardCanvasPoint(x: -100, y: -100))

        XCTAssertEqual(canvas.items[0].frame.minX, 0)
        XCTAssertEqual(canvas.items[0].frame.minY, 0)
        XCTAssertEqual(canvas.items[1].frame.minX, 500)
    }

    // MARK: - 復原重做

    func testSetPinnedTouchesOnlyGivenItemsAndUndoes() {
        var canvas = BoardCanvas(items: [
            item("a", x: 0, y: 0),
            item("b", x: 300, y: 0),
            item("c", x: 600, y: 0),
        ])

        XCTAssertTrue(canvas.setPinned(["a", "b"], pinned: true))
        XCTAssertEqual(canvas.items.map(\.pinned), [true, true, false])

        XCTAssertTrue(canvas.undo())
        XCTAssertEqual(canvas.items.map(\.pinned), [false, false, false])
        XCTAssertFalse(canvas.canUndo, "沒有實際變更時不記錄復原點")
    }

    func testUnpinnedOpacityFollowsFreshness() {
        XCTAssertEqual(BoardCanvas.opacity(pinned: true, freshness: 0), 1)
        XCTAssertEqual(BoardCanvas.opacity(pinned: false, freshness: 100), 1)
        XCTAssertEqual(
            BoardCanvas.opacity(pinned: false, freshness: 40),
            CardFreshnessStyle.appearance(for: 40).opacity
        )
        XCTAssertLessThan(BoardCanvas.opacity(pinned: false, freshness: 0), 1)
    }

    func testUndoRedoMove() {
        var canvas = BoardCanvas(items: [item("a", x: 100, y: 100)])
        canvas.select("a")
        canvas.moveSelected(by: BoardCanvasPoint(x: 40, y: 20))
        XCTAssertEqual(canvas.items[0].frame.x, 140)

        XCTAssertTrue(canvas.undo())
        XCTAssertEqual(canvas.items[0].frame.x, 100)
        XCTAssertFalse(canvas.canUndo)

        XCTAssertTrue(canvas.redo())
        XCTAssertEqual(canvas.items[0].frame.x, 140)
    }

    func testNewEditClearsRedo() {
        var canvas = BoardCanvas(items: [item("a", x: 100, y: 100)])
        canvas.select("a")
        canvas.moveSelected(by: BoardCanvasPoint(x: 10, y: 0))
        _ = canvas.undo()
        XCTAssertTrue(canvas.canRedo)

        canvas.moveSelected(by: BoardCanvasPoint(x: 0, y: 15))
        XCTAssertFalse(canvas.canRedo)
    }

    func testUndoAlignmentAndMoveTogether() {
        var canvas = BoardCanvas(items: [
            item("a", x: 10, y: 10),
            item("b", x: 400, y: 200),
        ])
        canvas.setSelection(["a", "b"])
        _ = canvas.alignSelected(.top)
        canvas.moveSelected(by: BoardCanvasPoint(x: 5, y: 5))

        _ = canvas.undo()
        XCTAssertEqual(canvas.items[1].frame.minY, 10)
        XCTAssertEqual(canvas.items[1].frame.minX, 400)

        _ = canvas.undo()
        XCTAssertEqual(canvas.items[1].frame.minY, 200)
    }

    // MARK: - 五百物件只畫可見範圍

    func testFiveHundredItemsDrawOnlyVisibleOnes() {
        var items: [BoardCanvasItem] = []
        for row in 0..<20 {
            for column in 0..<25 {
                items.append(item(
                    "item-\(row)-\(column)",
                    x: Double(column) * 300,
                    y: Double(row) * 220
                ))
            }
        }
        var canvas = BoardCanvas(items: items)
        canvas.setViewport(BoardCanvasPoint(x: 600, y: 400))

        let visible = canvas.visibleItems
        XCTAssertEqual(items.count, 500)
        XCTAssertTrue(visible.contains(where: { $0.id == "item-0-0" }))
        XCTAssertFalse(visible.contains(where: { $0.id == "item-19-24" }))
        XCTAssertLessThan(visible.count, 20)

        canvas.scroll(toBoardPoint: BoardCanvasPoint(x: 6900, y: 4200))
        XCTAssertTrue(canvas.visibleItems.contains(where: { $0.id == "item-19-24" }))
        XCTAssertFalse(canvas.visibleItems.contains(where: { $0.id == "item-0-0" }))
    }

    // MARK: - 釘選不褪色

    func testPinnedItemDoesNotFade() {
        XCTAssertEqual(BoardCanvas.opacity(pinned: true, freshness: 0), 1)
        XCTAssertEqual(BoardCanvas.opacity(pinned: true, freshness: 100), 1)
        XCTAssertLessThan(BoardCanvas.opacity(pinned: false, freshness: 0), 0.25)
        XCTAssertGreaterThan(BoardCanvas.opacity(pinned: false, freshness: 100), 0.9)
    }

    func testPinnedFlagSurvivesCanvasReplacement() {
        let canvas = BoardCanvas(items: [item("a", x: 0, y: 0, pinned: true)])
        XCTAssertTrue(canvas.items[0].pinned)
    }

    // MARK: - 縮放至全部

    func testZoomToFitShowsAllItems() {
        var canvas = BoardCanvas(items: [
            item("a", x: 0, y: 0),
            item("b", x: 4000, y: 3000),
        ])
        canvas.setViewport(BoardCanvasPoint(x: 800, y: 600))
        canvas.zoomToFit()

        XCTAssertGreaterThan(canvas.zoom, 0)
        let visible = canvas.visibleBoardRect
        XCTAssertTrue(visible.intersects(canvas.items[0].frame))
        XCTAssertTrue(visible.intersects(canvas.items[1].frame))
    }
}
