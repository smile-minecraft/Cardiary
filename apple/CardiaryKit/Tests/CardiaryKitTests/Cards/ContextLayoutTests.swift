import XCTest

@testable import CardiaryKit

final class ContextLayoutTests: XCTestCase {
    private func entry(
        _ id: String,
        tokens: Int,
        layer: ContextLayer = .otherCards,
        position: Int = 0,
        state: ContextEntryState = .active,
        cardId: String? = nil
    ) -> ContextEntry {
        ContextEntry(
            entryId: id,
            layer: layer,
            cardId: cardId ?? "card-\(id)",
            title: "卡片 \(id)",
            tokenEstimate: tokens,
            state: state,
            position: position
        )
    }

    // MARK: - 矩形樹狀圖

    func testTreemapAreaMatchesTokenShare() {
        let entries = [
            entry("a", tokens: 100, position: 0),
            entry("b", tokens: 200, position: 1),
            entry("c", tokens: 700, position: 2),
        ]
        let items = ContextTreemap.layout(
            entries: entries,
            in: ContextLayoutSize(width: 1000, height: 600)
        )
        XCTAssertEqual(items.map(\.entryIds), [["a"], ["b"], ["c"]], "版面順序等於上下文順序")
        let totalArea = 1000.0 * 600.0
        XCTAssertEqual(items[0].rect.area / totalArea, 0.1, accuracy: 1e-9)
        XCTAssertEqual(items[1].rect.area / totalArea, 0.2, accuracy: 1e-9)
        XCTAssertEqual(items[2].rect.area / totalArea, 0.7, accuracy: 1e-9)
    }

    func testTreemapLayersGoLeftToRight() {
        let entries = [
            entry("bedrock", tokens: 100, layer: .bedrock, position: 0),
            entry("working", tokens: 300, layer: .workingContext, position: 1, cardId: nil),
        ]
        let items = ContextTreemap.layout(
            entries: entries,
            in: ContextLayoutSize(width: 1000, height: 400)
        )
        XCTAssertEqual(items.count, 2)
        XCTAssertLessThanOrEqual(items[0].rect.maxX, items[1].rect.x + 1e-9)
        XCTAssertEqual(items[0].tokens, 100)
        XCTAssertEqual(items[1].tokens, 300)
    }

    func testTreemapMergesSmallCardsIntoSingleAggregate() {
        let entries = [
            entry("big-1", tokens: 500, position: 0),
            entry("tiny-1", tokens: 3, position: 1),
            entry("tiny-2", tokens: 4, position: 2),
            entry("big-2", tokens: 500, position: 3),
        ]
        let items = ContextTreemap.layout(
            entries: entries,
            in: ContextLayoutSize(width: 900, height: 400),
            minimumShare: 0.01
        )
        XCTAssertEqual(items.count, 3)
        XCTAssertEqual(items.map(\.entryIds), [["big-1"], ["tiny-1", "tiny-2"], ["big-2"]])
        XCTAssertEqual(items[1].aggregateCount, 2)
        XCTAssertEqual(items[1].tokens, 7)
        XCTAssertEqual(items[1].aggregateTitles, ["卡片 tiny-1", "卡片 tiny-2"])
    }

    func testTreemapRectsStayInsideAndDoNotOverlap() {
        let entries = (1...6).map { entry("e\($0)", tokens: $0 * 37, position: $0 - 1) }
        let size = ContextLayoutSize(width: 800, height: 500)
        let items = ContextTreemap.layout(entries: entries, in: size, minimumShare: 0)
        XCTAssertEqual(items.count, entries.count)
        for item in items {
            XCTAssertGreaterThanOrEqual(item.rect.x, -1e-9)
            XCTAssertGreaterThanOrEqual(item.rect.y, -1e-9)
            XCTAssertLessThanOrEqual(item.rect.maxX, size.width + 1e-6)
            XCTAssertLessThanOrEqual(item.rect.maxY, size.height + 1e-6)
        }
        for first in items.indices {
            for second in items.indices where second > first {
                let a = items[first].rect
                let b = items[second].rect
                let overlapWidth = max(0, min(a.maxX, b.maxX) - max(a.x, b.x))
                let overlapHeight = max(0, min(a.maxY, b.maxY) - max(a.y, b.y))
                XCTAssertEqual(overlapWidth * overlapHeight, 0, accuracy: 1e-6)
            }
        }
    }

    func testTreemapWithoutTokensIsEmpty() {
        XCTAssertTrue(ContextTreemap.layout(entries: [], in: ContextLayoutSize(width: 100, height: 100)).isEmpty)
        XCTAssertTrue(
            ContextTreemap.layout(
                entries: [entry("zero", tokens: 0)],
                in: ContextLayoutSize(width: 100, height: 100)
            ).isEmpty
        )
    }

    // MARK: - 比例熱力格

    func testHeatGridCellCountStaysBetween200And300() {
        for budget in [32_000, 200_000, 1_000_000] {
            let count = ContextHeatGrid.cellCount(budgetTokens: budget)
            XCTAssertGreaterThanOrEqual(count, 200, "budget \(budget)")
            XCTAssertLessThanOrEqual(count, 300, "budget \(budget)")
        }
    }

    func testHeatGridAllocatesCellsProportionally() {
        let entries = [
            entry("a", tokens: 120, position: 0),
            entry("b", tokens: 400, layer: .workingContext, position: 1, cardId: nil),
        ]
        let layout = ContextHeatGrid.layout(entries: entries, usedTokens: 520, budgetTokens: 1000)
        XCTAssertGreaterThanOrEqual(layout.totalCells, 200)
        XCTAssertLessThanOrEqual(layout.totalCells, 300)
        XCTAssertEqual(layout.usedCells, 104, "520 / 1000 的容量用掉約 52%，104 格")
        XCTAssertEqual(layout.cells.filter { $0.entryId == "a" }.count, 24)
        XCTAssertEqual(layout.cells.filter { $0.entryId == "b" }.count, 80)
        XCTAssertEqual(layout.cells.filter { $0.entryId == nil }.count, layout.totalCells - 104)
    }

    func testHeatGridOrderAndFirstCellNumbers() {
        let entries = [
            entry("a", tokens: 10, layer: .bedrock, position: 0),
            entry("b", tokens: 20, layer: .persona, position: 1),
            entry("c", tokens: 30, layer: .otherCards, position: 2),
        ]
        let layout = ContextHeatGrid.layout(entries: entries, usedTokens: 60, budgetTokens: 1000)
        let used = layout.cells.filter { $0.entryId != nil }
        XCTAssertEqual(used.map(\.entryId).uniqued(), ["a", "b", "c"], "格子順序等於上下文順序")

        let firstCells = used.filter(\.isFirstCell)
        XCTAssertEqual(firstCells.map(\.ordinal), [1, 2, 3])
        XCTAssertEqual(firstCells.map(\.entryId), ["a", "b", "c"])
        XCTAssertEqual(used.first?.ordinal, 1)
    }

    func testHeatGridKeepsPendingRemovalMarker() {
        let entries = [
            entry("a", tokens: 10, state: .pendingRemoval)
        ]
        let layout = ContextHeatGrid.layout(entries: entries, usedTokens: 10, budgetTokens: 1000)
        XCTAssertEqual(layout.cells.first?.state, .pendingRemoval)
    }

    func testHeatGridWithoutEntriesIsAllEmpty() {
        let layout = ContextHeatGrid.layout(entries: [], usedTokens: 0, budgetTokens: 1000)
        XCTAssertEqual(layout.usedCells, 0)
        XCTAssertEqual(layout.cells.count, layout.totalCells)
        XCTAssertTrue(layout.cells.allSatisfy { $0.entryId == nil })
    }
}

extension Array where Element: Hashable {
    fileprivate func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}
