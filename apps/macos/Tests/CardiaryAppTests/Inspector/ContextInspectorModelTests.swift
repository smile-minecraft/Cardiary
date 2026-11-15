import CardiaryKit
import Foundation
import XCTest

@testable import CardiaryApp

/// 檢視欄測試用的上下文服務：加入、移除與壓縮都會改手上的 `ContextView`，
/// 讓模型收到跟真主機形狀相同的回應。
actor MutableContextService: ContextService {
    private var view: ContextView
    private(set) var addedCards: [(sessionId: String, cardId: String)] = []
    private(set) var removedCards: [(sessionId: String, cardId: String)] = []
    private(set) var compactCalls: [String] = []

    init(view: ContextView) {
        self.view = view
    }

    func getContext(sessionId: String) async throws -> ContextGetResponsePayload {
        ContextGetResponsePayload(context: view)
    }

    func addCardToContext(
        sessionId: String,
        cardId: String
    ) async throws -> ContextAddCardResponsePayload {
        addedCards.append((sessionId, cardId))
        var entries = view.entries
        if let existing = entries.first(where: { $0.cardId == cardId }) {
            entries.removeAll { $0.entryId == existing.entryId }
        }
        let insertAt = entries.firstIndex { $0.layer == .workingContext } ?? entries.count
        entries.insert(ContextEntry(
            entryId: "entry-\(cardId)",
            layer: .otherCards,
            cardId: cardId,
            title: "卡片 \(cardId)",
            tokenEstimate: 100,
            state: .active,
            position: insertAt
        ), at: insertAt)
        view = ContextView(
            sessionId: view.sessionId,
            version: view.version + 1,
            entries: entries,
            usedTokens: view.usedTokens + 100,
            budgetTokens: view.budgetTokens,
            contextWindow: view.contextWindow,
            compactionThreshold: view.compactionThreshold,
            lastCompactedAt: view.lastCompactedAt
        )
        return ContextAddCardResponsePayload(context: view)
    }

    func removeCardFromContext(
        sessionId: String,
        cardId: String
    ) async throws -> ContextRemoveCardResponsePayload {
        removedCards.append((sessionId, cardId))
        let entries = view.entries.map { entry in
            guard entry.cardId == cardId else { return entry }
            return ContextEntry(
                entryId: entry.entryId,
                layer: entry.layer,
                cardId: entry.cardId,
                title: entry.title,
                tokenEstimate: entry.tokenEstimate,
                state: .pendingRemoval,
                position: entry.position
            )
        }
        view = ContextView(
            sessionId: view.sessionId,
            version: view.version + 1,
            entries: entries,
            usedTokens: view.usedTokens,
            budgetTokens: view.budgetTokens,
            contextWindow: view.contextWindow,
            compactionThreshold: view.compactionThreshold,
            lastCompactedAt: view.lastCompactedAt
        )
        return ContextRemoveCardResponsePayload(context: view)
    }

    func compactContext(
        sessionId: String,
        instructions: String?
    ) async throws -> ContextCompactResponsePayload {
        compactCalls.append(sessionId)
        return ContextCompactResponsePayload(sessionId: sessionId, scheduled: true)
    }

    /// 模擬壓縮完成：工作上下文換成一張短期記憶卡，並回傳新版本。
    func completeCompaction(beforeTokens: Int, afterTokens: Int) -> ContextView {
        var entries = view.entries.filter { $0.layer != .workingContext }
        entries.append(ContextEntry(
            entryId: "entry-summary",
            layer: .shortTermMemory,
            cardId: "card-summary",
            title: "壓縮摘要",
            tokenEstimate: afterTokens,
            state: .active,
            position: entries.count
        ))
        view = ContextView(
            sessionId: view.sessionId,
            version: view.version + 1,
            entries: entries,
            usedTokens: afterTokens,
            budgetTokens: view.budgetTokens,
            contextWindow: view.contextWindow,
            compactionThreshold: view.compactionThreshold,
            lastCompactedAt: "2026-01-01T00:10:00Z"
        )
        return view
    }
}

@MainActor
final class ContextInspectorModelTests: XCTestCase {
    private func entry(
        _ id: String,
        layer: ContextLayer,
        cardId: String? = nil,
        tokens: Int,
        state: ContextEntryState = .active,
        position: Int
    ) -> ContextEntry {
        ContextEntry(
            entryId: id,
            layer: layer,
            cardId: cardId,
            title: "區塊 \(id)",
            tokenEstimate: tokens,
            state: state,
            position: position
        )
    }

    private func view(
        _ entries: [ContextEntry],
        version: Int = 1,
        usedTokens: Int? = nil,
        budgetTokens: Int = 200_000
    ) -> ContextView {
        ContextView(
            sessionId: "s1",
            version: version,
            entries: entries,
            usedTokens: usedTokens ?? entries.reduce(0) { $0 + $1.tokenEstimate },
            budgetTokens: budgetTokens,
            contextWindow: 220_000,
            compactionThreshold: 0.75,
            lastCompactedAt: nil
        )
    }

    func testOpenLoadsContextAndFreshnessFromHost() async {
        let base = view([
            entry("entry-a", layer: .otherCards, cardId: "card-a", tokens: 120, position: 0),
            entry("entry-working", layer: .workingContext, tokens: 400, position: 1),
        ])
        let contextService = MutableContextService(view: base)
        let cardService = PagedCardService(cards: [makeCard("card-a", freshness: 50)])
        let store = CardFreshnessStore()
        let model = ContextInspectorModel(freshness: store)
        model.attach(service: contextService, cardService: cardService)

        await model.open(sessionId: "s1")

        XCTAssertEqual(model.entries.map(\.entryId), ["entry-a", "entry-working"])
        XCTAssertEqual(model.usedTokens, 520)
        XCTAssertEqual(store.value(for: "card-a"), 50, "新鮮度來自主機卡片")
        XCTAssertEqual(
            model.appearance(for: model.entries[0]),
            CardFreshnessStyle.appearance(for: 50)
        )
        XCTAssertFalse(model.showsDealProbability, "M1 不顯示發牌機率")
    }

    func testAddCardAppearsBeforeWorkingContextAndIsSelected() async {
        let base = view([
            entry("entry-persona", layer: .persona, cardId: "card-persona", tokens: 60, position: 0),
            entry("entry-working", layer: .workingContext, tokens: 300, position: 1),
        ])
        let contextService = MutableContextService(view: base)
        let model = ContextInspectorModel(freshness: CardFreshnessStore())
        model.attach(service: contextService, cardService: PagedCardService())
        await model.open(sessionId: "s1")

        await model.addCard(cardId: "card-new")

        XCTAssertEqual(model.entries.map(\.entryId), ["entry-persona", "entry-card-new", "entry-working"])
        XCTAssertEqual(model.selectedEntry?.cardId, "card-new")
        let added = await contextService.addedCards
        XCTAssertEqual(added.first?.cardId, "card-new")
    }

    func testRemoveOnlyMarksPendingRemoval() async {
        let base = view([
            entry("entry-a", layer: .otherCards, cardId: "card-a", tokens: 120, position: 0),
            entry("entry-working", layer: .workingContext, tokens: 300, position: 1),
        ])
        let contextService = MutableContextService(view: base)
        let model = ContextInspectorModel(freshness: CardFreshnessStore())
        model.attach(service: contextService, cardService: PagedCardService())
        await model.open(sessionId: "s1")
        model.selectedEntryId = "entry-a"

        await model.removeSelected()

        XCTAssertEqual(model.entries.count, 2, "移除只改狀態，等下次壓縮才拿掉")
        XCTAssertEqual(model.entries.first?.state, .pendingRemoval)
        let removed = await contextService.removedCards
        XCTAssertEqual(removed.first?.cardId, "card-a")
    }

    func testCompactionShowsProgressThenSummaryCard() async {
        let base = view([
            entry("entry-working", layer: .workingContext, tokens: 600, position: 0),
        ])
        let contextService = MutableContextService(view: base)
        let model = ContextInspectorModel(freshness: CardFreshnessStore())
        model.attach(service: contextService, cardService: PagedCardService())
        await model.open(sessionId: "s1")

        await model.compact()
        XCTAssertTrue(model.isCompacting)
        let compactCalls = await contextService.compactCalls
        XCTAssertEqual(compactCalls, ["s1"])

        let compacted = await contextService.completeCompaction(beforeTokens: 600, afterTokens: 80)
        model.handle(frame: .contextChangedEvent(ContextChangedEvent(
            stream: "session:s1",
            seq: 2,
            emittedAt: "2026-01-01T00:10:00Z",
            payload: ContextChangedEventPayload(sessionId: "s1", context: compacted)
        )))
        XCTAssertEqual(model.entries.last?.layer, .shortTermMemory)
        XCTAssertTrue(model.isCompacting, "壓縮事件完成前仍顯示進行中")

        model.handle(frame: .contextCompactedEvent(ContextCompactedEvent(
            stream: "session:s1",
            seq: 3,
            emittedAt: "2026-01-01T00:10:01Z",
            payload: ContextCompactedEventPayload(
                sessionId: "s1",
                summaryCardId: "card-summary",
                beforeTokens: 600,
                afterTokens: 80,
                compactedAt: "2026-01-01T00:10:00Z"
            )
        )))
        XCTAssertFalse(model.isCompacting)
        XCTAssertEqual(model.lastCompaction?.beforeTokens, 600)
        XCTAssertEqual(model.lastCompaction?.afterTokens, 80)
    }

    func testReloadClearsCompactingState() async {
        let base = view([
            entry("entry-working", layer: .workingContext, tokens: 600, position: 0),
        ])
        let contextService = MutableContextService(view: base)
        let model = ContextInspectorModel(freshness: CardFreshnessStore())
        model.attach(service: contextService, cardService: PagedCardService())
        await model.open(sessionId: "s1")

        await model.compact()
        XCTAssertTrue(model.isCompacting)

        // 主機失敗時沒有壓縮完成事件；重新載入要解除等待，畫面不能永遠停用。
        await model.reload()
        XCTAssertFalse(model.isCompacting)
    }

    func testCompactionTimeoutLiftsCompactingState() async {
        let base = view([
            entry("entry-working", layer: .workingContext, tokens: 600, position: 0),
        ])
        let contextService = MutableContextService(view: base)
        let model = ContextInspectorModel(freshness: CardFreshnessStore())
        model.attach(service: contextService, cardService: PagedCardService())
        model.compactionTimeout = 0.05
        await model.open(sessionId: "s1")

        await model.compact()
        XCTAssertTrue(model.isCompacting)

        try? await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertFalse(model.isCompacting, "逾時後要解除等待")
        XCTAssertEqual(model.noticeMessage, CardL10n.text(.inspectorCompactTimedOut))
    }

    func testStaleCompactionTimeoutDoesNotLiftNewerCompaction() async {
        let base = view([
            entry("entry-working", layer: .workingContext, tokens: 600, position: 0),
        ])
        let contextService = MutableContextService(view: base)
        let model = ContextInspectorModel(freshness: CardFreshnessStore())
        model.attach(service: contextService, cardService: PagedCardService())
        model.compactionTimeout = 0.05
        await model.open(sessionId: "s1")

        await model.compact()
        // 重新載入讓第一次的逾時失效，再壓縮一次並放長逾時。
        await model.reload()
        model.compactionTimeout = 0.5
        await model.compact()
        XCTAssertTrue(model.isCompacting)

        try? await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertTrue(model.isCompacting, "第一次壓縮的逾時不能解除後來的壓縮")
    }

    func testStaleContextVersionIsIgnored() async {
        let base = view([
            entry("entry-a", layer: .otherCards, cardId: "card-a", tokens: 100, position: 0),
        ], version: 5)
        let contextService = MutableContextService(view: base)
        let model = ContextInspectorModel(freshness: CardFreshnessStore())
        model.attach(service: contextService, cardService: PagedCardService())
        await model.open(sessionId: "s1")

        let stale = view([
            entry("entry-old", layer: .bedrock, tokens: 10, position: 0),
        ], version: 4)
        model.handle(frame: .contextChangedEvent(ContextChangedEvent(
            stream: "session:s1",
            seq: 1,
            emittedAt: "2026-01-01T00:00:00Z",
            payload: ContextChangedEventPayload(sessionId: "s1", context: stale)
        )))
        XCTAssertEqual(model.entries.map(\.entryId), ["entry-a"])
    }

    func testEventsForAnotherSessionAreIgnored() async {
        let base = view([
            entry("entry-a", layer: .otherCards, cardId: "card-a", tokens: 100, position: 0),
        ])
        let contextService = MutableContextService(view: base)
        let model = ContextInspectorModel(freshness: CardFreshnessStore())
        model.attach(service: contextService, cardService: PagedCardService())
        await model.open(sessionId: "s1")

        let other = view([
            entry("entry-x", layer: .bedrock, tokens: 10, position: 0),
        ], version: 9)
        model.handle(frame: .contextChangedEvent(ContextChangedEvent(
            stream: "session:s2",
            seq: 1,
            emittedAt: "2026-01-01T00:00:00Z",
            payload: ContextChangedEventPayload(sessionId: "s2", context: other)
        )))
        XCTAssertEqual(model.entries.map(\.entryId), ["entry-a"])
    }

    func testLayoutsUseContextOrderAndGridCellRange() async {
        let base = view([
            entry("entry-bedrock", layer: .bedrock, cardId: "card-b", tokens: 100, position: 0),
            entry("entry-tiny", layer: .otherCards, cardId: "card-tiny", tokens: 2, position: 1),
            entry("entry-tiny-2", layer: .otherCards, cardId: "card-tiny-2", tokens: 3, position: 2),
            entry("entry-card", layer: .otherCards, cardId: "card-c", tokens: 300, position: 3),
            entry("entry-working", layer: .workingContext, tokens: 1200, position: 4),
        ])
        let model = ContextInspectorModel(freshness: CardFreshnessStore())
        model.attach(
            service: MutableContextService(view: base),
            cardService: PagedCardService(cards: [
                makeCard("card-b", freshness: 100),
                makeCard("card-tiny", freshness: 0),
                makeCard("card-tiny-2", freshness: 20),
                makeCard("card-c", freshness: 50),
            ])
        )
        await model.open(sessionId: "s1")

        let grid = ContextHeatGrid.layout(
            entries: model.entries,
            usedTokens: model.usedTokens,
            budgetTokens: model.budgetTokens
        )
        XCTAssertGreaterThanOrEqual(grid.totalCells, 200)
        XCTAssertLessThanOrEqual(grid.totalCells, 300)
        let ordered = grid.cells.compactMap(\.entryId).uniqued()
        XCTAssertEqual(ordered, model.entries.map(\.entryId), "格子順序等於 ContextView 順序")

        let treemap = ContextTreemap.layout(
            entries: model.entries,
            in: ContextLayoutSize(width: 800, height: 400),
            minimumShare: 0.02
        )
        XCTAssertTrue(treemap.contains { $0.isAggregate }, "面積過小的卡合併")
        XCTAssertEqual(treemap[0].entryIds, ["entry-bedrock"])
    }

    func testCardChangedUpdatesFreshnessStore() async {
        let base = view([
            entry("entry-a", layer: .otherCards, cardId: "card-a", tokens: 100, position: 0),
        ])
        let store = CardFreshnessStore()
        let model = ContextInspectorModel(freshness: store)
        model.attach(
            service: MutableContextService(view: base),
            cardService: PagedCardService(cards: [makeCard("card-a", freshness: 100)])
        )
        await model.open(sessionId: "s1")
        XCTAssertEqual(store.value(for: "card-a"), 100)

        model.handle(frame: .cardChangedEvent(CardChangedEvent(
            stream: "system",
            seq: 4,
            emittedAt: "2026-01-01T00:00:04Z",
            payload: CardChangedEventPayload(cardId: "card-a", change: .refreshed, freshness: 0)
        )))
        XCTAssertEqual(store.value(for: "card-a"), 0)
        XCTAssertEqual(model.appearance(for: model.entries[0]), CardFreshnessStyle.appearance(for: 0))
    }

    func testCardsSlotKeepsLastConversationAndDropAddsToContextTail() async {
        let base = view([
            entry("entry-persona", layer: .persona, cardId: "card-persona", tokens: 60, position: 0),
            entry("entry-working", layer: .workingContext, tokens: 300, position: 1),
        ])
        let contextService = MutableContextService(view: base)
        let model = ContextInspectorModel(freshness: CardFreshnessStore())
        model.attach(service: contextService, cardService: PagedCardService())

        // 走 AppModel 的導覽狀態，而不是直接呼叫模型，才能抓到「切到卡片庫時被 close 掉」的回歸。
        let app = AppModel()
        await app.selectConversation("s1")
        await model.syncSelection(app.selection)
        XCTAssertEqual(model.sessionId, "s1")

        app.selectSlot(AppRegistry.cardsSlotId)
        await model.syncSelection(app.selection)
        XCTAssertEqual(model.sessionId, "s1", "切到卡片庫時保留最後一場對話")
        XCTAssertTrue(model.canAddCards, "檢視欄還掛著對話時，拖放要能接受卡片")

        // 檢視欄的 dropDestination 做的兩步：先查 canAddCards，再 addCard。
        let accepted = await model.addCard(cardId: "card-new")
        XCTAssertTrue(accepted)
        XCTAssertEqual(
            model.entries.map(\.entryId),
            ["entry-persona", "entry-card-new", "entry-working"],
            "加入的卡片出現在工作上下文前，也就是上下文後段"
        )
        XCTAssertEqual(model.selectedEntry?.cardId, "card-new")
        let added = await contextService.addedCards
        XCTAssertEqual(added.map(\.sessionId), ["s1"])
    }

    func testDropIsRejectedWithoutSession() async {
        let base = view([entry("entry-working", layer: .workingContext, tokens: 300, position: 0)])
        let model = ContextInspectorModel(freshness: CardFreshnessStore())
        model.attach(service: MutableContextService(view: base), cardService: PagedCardService())

        XCTAssertFalse(model.canAddCards, "還沒開過任何對話時不能接受拖放")
        let accepted = await model.addCard(cardId: "card-new")
        XCTAssertFalse(accepted)
        XCTAssertEqual(model.errorMessage, CardL10n.text(.inspectorNoSession))

        await model.syncSelection(.conversation("s1"))
        model.close()
        XCTAssertFalse(model.canAddCards, "對話被關閉後也不能再接受拖放")
        let acceptedAfterClose = await model.addCard(cardId: "card-new")
        XCTAssertFalse(acceptedAfterClose)
    }

    func testSyncSelectionWithoutChosenConversationClosesTheInspector() async {
        let base = view([entry("entry-a", layer: .bedrock, tokens: 10, position: 0)])
        let model = ContextInspectorModel(freshness: CardFreshnessStore())
        model.attach(service: MutableContextService(view: base), cardService: PagedCardService())
        await model.syncSelection(.conversation("s1"))
        XCTAssertEqual(model.sessionId, "s1")

        await model.syncSelection(.none)
        XCTAssertNil(model.sessionId)
        XCTAssertNil(model.context)
    }

    func testSessionDeletedClosesTheInspector() async {
        let base = view([entry("entry-a", layer: .bedrock, tokens: 10, position: 0)])
        let model = ContextInspectorModel(freshness: CardFreshnessStore())
        model.attach(
            service: MutableContextService(view: base),
            cardService: PagedCardService()
        )
        await model.open(sessionId: "s1")

        model.handle(frame: .sessionDeletedEvent(SessionDeletedEvent(
            stream: "session:s1",
            seq: 5,
            emittedAt: "2026-01-01T00:00:05Z",
            payload: SessionDeletedEventPayload(
                sessionId: "s1",
                deletedSessionIds: ["s1"],
                deletedCards: 1,
                deletedAssets: 0
            )
        )))
        XCTAssertNil(model.sessionId)
        XCTAssertNil(model.context)
    }
}

extension Array where Element: Hashable {
    fileprivate func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}
