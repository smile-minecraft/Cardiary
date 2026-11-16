import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 對話清單：列出、排序、選取、建立與分頁。
@MainActor
final class ConversationListModelTests: XCTestCase {
    func testReloadPreservesHostOrder() async {
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

        XCTAssertEqual(list.sessions.map(\.id), ["old", "new"])
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

    func testArchiveActionAndEventsUpdateListAndArchive() async {
        let service = FakeCardiaryService(sessions: [Fixtures.summary("s1")])
        let list = ConversationListModel()
        let archive = ArchiveModel(now: { Date(timeIntervalSince1970: 1_767_225_600) })
        list.attach(service: service)
        archive.attach(management: service, sessions: service)
        await list.reload()
        await archive.reload()

        await list.archive(sessionId: "s1", using: service)
        let calls = await service.archivedSessions
        XCTAssertEqual(calls.map(\.0), ["s1"])

        let archived = ServerFrame.sessionArchivedEvent(SessionArchivedEvent(
            stream: "system", seq: 1, emittedAt: "2026-01-01T00:00:00Z",
            payload: SessionArchivedEventPayload(sessionId: "s1", archive: SessionArchive(
                archivedAt: "2026-01-01T00:00:00Z", purgeAt: "2026-01-31T00:00:00Z"
            ))
        ))
        list.handle(frame: archived)
        archive.handle(frame: archived)
        XCTAssertEqual(list.sessions.first?.status, .archived)
        XCTAssertEqual(archive.items.map(\.id), ["s1"])
        XCTAssertEqual(archive.remainingDays(for: archive.items[0]), 30)

        await archive.unarchive(sessionId: "s1")
        let unarchived = ServerFrame.sessionUnarchivedEvent(SessionUnarchivedEvent(
            stream: "system", seq: 2, emittedAt: "2026-01-02T00:00:00Z",
            payload: SessionUnarchivedEventPayload(sessionId: "s1")
        ))
        list.handle(frame: unarchived)
        archive.handle(frame: unarchived)
        XCTAssertEqual(list.sessions.first?.status, .idle)
        XCTAssertTrue(archive.items.isEmpty)
        let unarchiveCalls = await service.unarchivedSessions
        XCTAssertEqual(unarchiveCalls, ["s1"])

        list.handle(frame: archived)
        await list.reload()
        XCTAssertEqual(list.sessions.first?.status, .idle, "重新載入以主機摘要為準")
    }

    func testReloadMarksArchivedSummary() async {
        let summary = SessionSummary(
            id: "s1", title: "對話", status: .idle,
            createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", messageCount: 0,
            archive: SessionArchive(archivedAt: "2026-01-01T00:00:00Z", purgeAt: "2026-01-31T00:00:00Z")
        )
        let list = ConversationListModel()
        list.attach(service: FakeCardiaryService(sessions: [summary]))
        await list.reload()
        XCTAssertEqual(list.sessions.first?.status, .archived)
    }

    func testUpsertKeepsListSorted() {
        let list = ConversationListModel()
        list.upsert(Fixtures.summary("a", updatedAt: "2026-01-01T00:00:00Z"))
        list.upsert(Fixtures.summary("b", updatedAt: "2026-01-04T00:00:00Z"))
        list.upsert(Fixtures.summary("a", updatedAt: "2026-01-05T00:00:00Z"))

        XCTAssertEqual(list.sessions.map(\.id), ["a", "b"])
    }
}
