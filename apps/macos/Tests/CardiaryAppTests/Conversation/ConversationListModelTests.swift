import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 對話清單：列出、排序、選取、建立與分頁。
@MainActor
final class ConversationListModelTests: XCTestCase {
    func testReloadSortsNewestFirst() async {
        let fake = FakeCardiaryService(
            listPages: [
                SessionListResponsePayload(
                    sessions: [
                        Fixtures.summary("old", updatedAt: "2026-01-01T00:00:00Z"),
                        Fixtures.summary("new", updatedAt: "2026-01-05T00:00:00Z"),
                    ]
                ),
            ]
        )
        let list = ConversationListModel()
        list.attach(service: fake)
        await list.reload()

        XCTAssertEqual(list.sessions.map(\.id), ["new", "old"])
    }

    func testReloadKeepsExistingSelection() async {
        let fake = FakeCardiaryService(
            listPages: [
                SessionListResponsePayload(sessions: [Fixtures.summary("a"), Fixtures.summary("b")]),
                SessionListResponsePayload(sessions: [Fixtures.summary("a"), Fixtures.summary("b")]),
            ]
        )
        let list = ConversationListModel()
        list.attach(service: fake)
        await list.reload()
        list.select("b")
        await list.reload()

        XCTAssertEqual(list.selectedId, "b")
    }

    func testReloadFallsBackToFirstWhenSelectionDisappeared() async {
        let fake = FakeCardiaryService(
            sessions: [Fixtures.summary("a"), Fixtures.summary("b")]
        )
        let list = ConversationListModel()
        list.attach(service: fake)
        await list.reload()
        list.select("missing")

        await list.reload()

        XCTAssertEqual(list.selectedId, "a")
    }

    func testCreateInsertsAndSelectsTheNewSession() async {
        let fake = FakeCardiaryService(
            sessions: [Fixtures.summary("old", updatedAt: "2026-01-01T00:00:00Z")],
            createSummary: Fixtures.summary("new", updatedAt: "2026-01-06T00:00:00Z")
        )
        let list = ConversationListModel()
        list.attach(service: fake)
        await list.reload()

        let id = await list.create(title: "新對話")

        XCTAssertEqual(id, "new")
        XCTAssertEqual(list.selectedId, "new")
        XCTAssertEqual(list.sessions.map(\.id), ["new", "old"])
    }

    func testPagesThroughSessionListUntilCursorIsNil() async {
        let fake = FakeCardiaryService(
            listPages: [
                SessionListResponsePayload(
                    sessions: [Fixtures.summary("p1", updatedAt: "2026-01-03T00:00:00Z")],
                    nextCursor: "next"
                ),
                SessionListResponsePayload(
                    sessions: [Fixtures.summary("p2", updatedAt: "2026-01-02T00:00:00Z")],
                    nextCursor: nil
                ),
            ]
        )
        let list = ConversationListModel()
        list.attach(service: fake)
        await list.reload()

        XCTAssertEqual(list.sessions.map(\.id), ["p1", "p2"])
        let calls = await fake.listCalls
        XCTAssertEqual(calls, 2)
    }

    func testUpsertKeepsListSorted() {
        let list = ConversationListModel()
        list.upsert(Fixtures.summary("a", updatedAt: "2026-01-01T00:00:00Z"))
        list.upsert(Fixtures.summary("b", updatedAt: "2026-01-04T00:00:00Z"))
        list.upsert(Fixtures.summary("a", updatedAt: "2026-01-05T00:00:00Z"))

        XCTAssertEqual(list.sessions.map(\.id), ["a", "b"])
    }
}
