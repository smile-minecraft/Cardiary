import CardiaryKit
import Foundation
import XCTest

@testable import CardiaryApp

@MainActor
final class CardLibraryModelTests: XCTestCase {
    func testLoadsOnlyTheFirstPageUntilTheVisibleEnd() async {
        var pages: [CardListResponsePayload] = []
        let pageSize = 100
        let total = 10_000
        for page in 0..<(total / pageSize) {
            let start = page * pageSize
            let summaries = (start..<(start + pageSize)).map { makeSummary("card-\($0)") }
            pages.append(CardListResponsePayload(
                cards: summaries,
                nextCursor: page == (total / pageSize) - 1 ? nil : "cursor-\(page + 1)"
            ))
        }
        let service = PagedCardService(pages: pages)
        let model = CardLibraryModel(freshness: CardFreshnessStore(), pageSize: pageSize)
        model.attach(service: service)

        await model.loadFirstPage()
        XCTAssertEqual(model.items.count, 100, "一開始只載入一頁，不是一萬張")
        XCTAssertTrue(model.hasMore)

        await model.loadMoreIfNeeded(current: model.items[0])
        XCTAssertEqual(model.items.count, 100, "第一筆可見時不載入下一頁")

        await model.loadMoreIfNeeded(current: model.items[99])
        XCTAssertEqual(model.items.count, 200, "捲到後段才載入下一頁")
        let listCallCount = await service.listCalls.count
        XCTAssertEqual(listCallCount, 2)
    }

    func testSearchUsesFullTextEndpointAndKeepsSnippet() async {
        let card = makeCard("card-hit", title: "會議筆記", body: "討論排程")
        let searchPage = CardSearchResponsePayload(
            hits: [CardSearchHit(card: makeSummary("card-hit", title: "會議筆記"), score: 1.5, snippet: "…會議…")],
            nextCursor: nil
        )
        let service = PagedCardService(searchPages: [searchPage], cards: [card])
        let model = CardLibraryModel(freshness: CardFreshnessStore())
        model.attach(service: service)
        model.query = "會議"

        await model.loadFirstPage()
        XCTAssertEqual(model.items.map(\.id), ["card-hit"])
        XCTAssertEqual(model.items.first?.snippet, "…會議…")
        let searchQuery = await service.searchCalls.first?.query
        let listCalls = await service.listCalls
        XCTAssertEqual(searchQuery, "會議")
        XCTAssertTrue(listCalls.isEmpty, "有搜尋字串時走 card.search")
    }

    func testSelectKeepsNewestCardWhenResponsesArriveOutOfOrder() async {
        let service = PagedCardService(cards: [
            makeCard("card-a", title: "卡片 A", freshness: 11),
            makeCard("card-b", title: "卡片 B", freshness: 22),
        ])
        await service.setGetCardDelay("card-a", delay: 0.3)
        let model = CardLibraryModel(freshness: CardFreshnessStore())
        model.attach(service: service)

        async let first: Void = model.select(cardId: "card-a")
        try? await Task.sleep(nanoseconds: 20_000_000)
        await model.select(cardId: "card-b")
        await first

        XCTAssertEqual(model.selectedCardId, "card-b")
        XCTAssertEqual(model.selectedCard?.cardId, "card-b", "慢回應不能蓋掉後選的卡")
        XCTAssertEqual(model.editingBody, "舊內文")
    }

    func testClearSelectionDiscardsLateResponses() async {
        let service = PagedCardService(cards: [makeCard("card-a", title: "卡片 A")])
        await service.setGetCardDelay("card-a", delay: 0.2)
        let model = CardLibraryModel(freshness: CardFreshnessStore())
        model.attach(service: service)

        async let pending: Void = model.select(cardId: "card-a")
        try? await Task.sleep(nanoseconds: 20_000_000)
        model.clearSelection()
        await pending

        XCTAssertNil(model.selectedCard, "清除選取之後，慢回應不能再把卡片放回來")
        XCTAssertNil(model.selectedCardId)
    }

    func testCardChangedDoesNotInsertCardsOutsideTheCurrentFilter() async {
        let service = PagedCardService(
            searchPages: [CardSearchResponsePayload(
                hits: [CardSearchHit(card: makeSummary("card-1", freshness: 50), score: 1.0, snippet: "…")],
                nextCursor: nil
            )],
            cards: [
                makeCard("card-1", freshness: 50),
                makeCard("card-2", title: "不符合的卡", freshness: 66),
            ]
        )
        let store = CardFreshnessStore()
        let model = CardLibraryModel(freshness: store)
        model.attach(service: service)
        model.query = "會議"
        await model.loadFirstPage()
        XCTAssertEqual(model.items.map(\.id), ["card-1"])

        await model.handleCardChanged(CardChangedEventPayload(
            cardId: "card-2",
            change: .refreshed,
            revision: nil,
            freshness: 66
        ))
        XCTAssertEqual(model.items.map(\.id), ["card-1"], "不符合搜尋條件的卡不能被插入清單")
        XCTAssertEqual(store.value(for: "card-2"), 66, "新鮮度仍要同步進 store")

        await service.setCard(makeCard("card-1", freshness: 77))
        await model.handleCardChanged(CardChangedEventPayload(
            cardId: "card-1",
            change: .refreshed,
            revision: nil,
            freshness: 77
        ))
        XCTAssertEqual(model.items.first?.freshness, 77, "已在清單裡的卡要更新")
    }

    func testSelectLoadsFullCardAndEditingSendsUnifiedDiff() async {
        let card = makeCard("card-1", title: "筆記", body: "舊內文")
        let service = PagedCardService(
            pages: [CardListResponsePayload(cards: [makeSummary("card-1", title: "筆記")])],
            cards: [card]
        )
        let model = CardLibraryModel(freshness: CardFreshnessStore())
        model.attach(service: service)

        await model.loadFirstPage()
        await model.select(cardId: "card-1")
        XCTAssertEqual(model.selectedCard?.body, "舊內文")

        model.beginEditing()
        model.editingBody = "新的內文"
        let saved = await model.save()

        XCTAssertTrue(saved)
        XCTAssertFalse(model.isEditing)
        let patch = await service.patches.first
        XCTAssertEqual(patch?.cardId, "card-1")
        XCTAssertEqual(patch?.baseRevision, "rev-card-1")
        XCTAssertEqual(patch?.patch.format, .unified)
        XCTAssertEqual(patch?.patch.text, """
        @@ -1,1 +1,1 @@
        -舊內文
        +新的內文
        """)
    }

    func testDeleteRemovesItemAndSelection() async {
        let service = PagedCardService(
            pages: [CardListResponsePayload(cards: [makeSummary("card-1")])],
            cards: [makeCard("card-1")]
        )
        let model = CardLibraryModel(freshness: CardFreshnessStore())
        model.attach(service: service)
        await model.loadFirstPage()
        await model.select(cardId: "card-1")

        let deleted = await model.deleteSelected()
        XCTAssertTrue(deleted)
        XCTAssertTrue(model.items.isEmpty)
        XCTAssertNil(model.selectedCard)
        XCTAssertNil(model.selectedCardId)
        let deletedIds = await service.deletedIds
        XCTAssertEqual(deletedIds, ["card-1"])
    }

    func testRefreshUpdatesFreshnessFromHost() async {
        let service = PagedCardService(
            pages: [CardListResponsePayload(cards: [makeSummary("card-1", freshness: 50)])],
            cards: [makeCard("card-1", freshness: 50)]
        )
        let store = CardFreshnessStore()
        let model = CardLibraryModel(freshness: store)
        model.attach(service: service)
        await model.loadFirstPage()
        XCTAssertEqual(store.value(for: "card-1"), 50)

        await model.refresh(cardId: "card-1")
        XCTAssertEqual(store.value(for: "card-1"), 100, "保鮮後使用主機回報的新鮮度")
        XCTAssertEqual(model.items.first?.freshness, 100)
    }

    func testCreatePrependsAndSelectsTheNewCard() async {
        let service = PagedCardService(cards: [])
        let model = CardLibraryModel(freshness: CardFreshnessStore())
        model.attach(service: service)

        let created = await model.createNote(title: "新筆記", body: "內容", tags: ["工作"])
        XCTAssertTrue(created)
        let createdTitles = await service.createdTitles
        XCTAssertEqual(createdTitles, ["新筆記"])
        XCTAssertEqual(model.items.first?.title, "新筆記")
        XCTAssertEqual(model.selectedCardId, "created-1")
        XCTAssertEqual(model.selectedCard?.body, "內容")
    }

    func testAppearanceComesFromHostFreshnessAndMatchesSharedScale() async {
        let summaries = [
            makeSummary("card-100", freshness: 100),
            makeSummary("card-50", freshness: 50),
            makeSummary("card-0", freshness: 0),
        ]
        let service = PagedCardService(pages: [CardListResponsePayload(cards: summaries)])
        let store = CardFreshnessStore()
        let model = CardLibraryModel(freshness: store)
        model.attach(service: service)
        await model.loadFirstPage()

        XCTAssertEqual(store.values, ["card-100": 100, "card-50": 50, "card-0": 0])
        let appearances = model.items.map { model.appearance(for: $0) }
        XCTAssertEqual(appearances.map(\.value), [100, 50, 0])
        XCTAssertGreaterThan(appearances[0].opacity, appearances[1].opacity)
        XCTAssertGreaterThan(appearances[1].opacity, appearances[2].opacity)
        XCTAssertEqual(appearances[1], CardFreshnessStyle.appearance(for: 50))
    }

    func testCardChangedDeletesOrUpdatesItems() async {
        let service = PagedCardService(
            pages: [CardListResponsePayload(cards: [makeSummary("card-1", freshness: 50)])],
            cards: [makeCard("card-1", freshness: 50)]
        )
        let store = CardFreshnessStore()
        let model = CardLibraryModel(freshness: store)
        model.attach(service: service)
        await model.loadFirstPage()

        await service.setCard(makeCard("card-1", freshness: 100))
        await model.handleCardChanged(CardChangedEventPayload(
            cardId: "card-1",
            change: .refreshed,
            revision: nil,
            freshness: 100
        ))
        XCTAssertEqual(model.items.first?.freshness, 100)
        XCTAssertEqual(store.value(for: "card-1"), 100)

        await model.handleCardChanged(CardChangedEventPayload(
            cardId: "card-1",
            change: .deleted,
            revision: nil,
            freshness: nil
        ))
        XCTAssertTrue(model.items.isEmpty)
        XCTAssertNil(store.value(for: "card-1"))
    }

    func testDroppingAnImageUploadsAndAddsAnImageCard() async {
        // 匯入回應不帶新鮮度；清單裡的卡片資料（含新鮮度）全部來自主機。
        let importedTitle = "匯入的圖片"
        let service = PagedCardService(cards: [
            makeCard("card-image", title: importedTitle, kind: .image, freshness: 33),
        ])
        let media = FakeMediaService()
        let model = CardLibraryModel(
            freshness: CardFreshnessStore(),
            mediaProvider: { media }
        )
        model.attach(service: service)

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("卡片圖片-\(UUID().uuidString).png")
        try? Data([0x89, 0x50, 0x4E, 0x47]).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        await model.importDropped(urls: [url])

        let uploads = await media.uploads
        let importedBlobIds = await media.importedBlobIds
        XCTAssertEqual(uploads.count, 1)
        XCTAssertEqual(uploads.first?.mediaType, "image/png")
        XCTAssertEqual(importedBlobIds.count, 1)
        XCTAssertEqual(model.items.first?.kind, .image)
        XCTAssertEqual(model.items.first?.title, importedTitle)
        XCTAssertEqual(model.items.first?.freshness, 33, "新鮮度來自主機，不是客戶端填的")
        XCTAssertEqual(model.noticeMessage, CardL10n.format(.cardsImportCreated, value: url.lastPathComponent))
    }

    func testDroppingAnUnsupportedFileDoesNotUpload() async {
        let media = FakeMediaService()
        let model = CardLibraryModel(
            freshness: CardFreshnessStore(),
            mediaProvider: { media }
        )
        model.attach(service: PagedCardService())

        await model.importDropped(urls: [URL(fileURLWithPath: "/tmp/notes.md")])
        let uploads = await media.uploads
        XCTAssertTrue(uploads.isEmpty)
        XCTAssertEqual(model.noticeMessage, CardL10n.text(.cardsImportUnsupported))
    }
}
