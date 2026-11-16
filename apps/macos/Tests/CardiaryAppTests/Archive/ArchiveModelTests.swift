import CardiaryKit
import Foundation
import XCTest

@testable import CardiaryApp

/// 封存區測試用的服務替身：`session.list` 回固定的一頁，
/// `session.deletion_preview`／`session.delete`／`session.unarchive` 的回應
/// 與失敗都由測試決定。
actor StubSessionService: ConversationService, SessionManagementService {
    enum StubError: Error, Equatable {
        case list
        case unarchive
        case preview
        case delete
    }

    private var page: SessionListResponsePayload
    private let previewPayload: SessionDeletionPreviewResponsePayload
    private let deletedIdsOnDelete: [String]
    let failList: Bool
    let failUnarchive: Bool
    let failPreview: Bool
    let failDelete: Bool

    private(set) var listCalls = 0
    private(set) var unarchivedIds: [String] = []
    private(set) var previewCalls: [String] = []
    private(set) var deleteCalls: [(sessionId: String, clientRequestId: String)] = []

    init(
        sessions: [SessionSummary],
        preview: SessionDeletionPreviewResponsePayload,
        deletedIdsOnDelete: [String]? = nil,
        failList: Bool = false,
        failUnarchive: Bool = false,
        failPreview: Bool = false,
        failDelete: Bool = false
    ) {
        self.page = SessionListResponsePayload(sessions: sessions)
        self.previewPayload = preview
        self.deletedIdsOnDelete = deletedIdsOnDelete ?? preview.subtreeSessionIds
        self.failList = failList
        self.failUnarchive = failUnarchive
        self.failPreview = failPreview
        self.failDelete = failDelete
    }

    func listSessions(cursor: String?, limit: Int?) async throws -> SessionListResponsePayload {
        listCalls += 1
        if failList { throw StubError.list }
        return page
    }

    func createSession(
        clientRequestId: String,
        title: String?
    ) async throws -> SessionCreateResponsePayload {
        throw StubError.list
    }

    func getHistory(
        sessionId: String,
        cursor: String?,
        limit: Int?
    ) async throws -> SessionGetHistoryResponsePayload {
        throw StubError.list
    }

    func sendMessage(
        sessionId: String,
        text: String,
        delivery: DeliveryMode,
        clientMessageId: String?
    ) async throws -> SessionSendMessageResponsePayload {
        throw StubError.list
    }

    func interruptSession(sessionId: String, reason: String?) async throws -> SessionInterruptResponsePayload {
        throw StubError.list
    }

    func subscribeSession(
        sessionId: String,
        historyLimit: Int?
    ) async throws -> SessionSubscribeResponsePayload {
        throw StubError.list
    }

    func unsubscribeSession(sessionId: String) async {}

    func archiveSession(
        sessionId: String,
        purgeAfterDays: Int?
    ) async throws -> SessionArchiveResponsePayload {
        throw StubError.list
    }

    func unarchiveSession(sessionId: String) async throws -> SessionUnarchiveResponsePayload {
        if failUnarchive { throw StubError.unarchive }
        unarchivedIds.append(sessionId)
        return SessionUnarchiveResponsePayload(sessionId: sessionId, unarchived: true)
    }

    func previewSessionDeletion(
        sessionId: String
    ) async throws -> SessionDeletionPreviewResponsePayload {
        if failPreview { throw StubError.preview }
        previewCalls.append(sessionId)
        return previewPayload
    }

    func deleteSession(
        sessionId: String,
        clientRequestId: String
    ) async throws -> SessionDeleteResponsePayload {
        if failDelete { throw StubError.delete }
        deleteCalls.append((sessionId, clientRequestId))
        return SessionDeleteResponsePayload(
            sessionId: sessionId,
            deletedSessionIds: deletedIdsOnDelete,
            deletedCards: previewPayload.exclusiveCards,
            deletedAssets: previewPayload.assets
        )
    }
}

@MainActor
final class ArchiveModelTests: XCTestCase {
    private let fixedNow = ArchiveModel.parseISO8601("2026-01-10T00:00:00Z")!

    private func summary(
        _ id: String,
        title: String? = nil,
        archive: SessionArchive? = nil
    ) -> SessionSummary {
        SessionSummary(
            id: id,
            title: title ?? "對話 \(id)",
            status: .idle,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            messageCount: 3,
            archive: archive
        )
    }

    private func preview(
        _ sessionId: String,
        subtree: [String],
        exclusiveCards: Int = 4,
        sharedCards: Int = 2,
        assets: Int = 1
    ) -> SessionDeletionPreviewResponsePayload {
        SessionDeletionPreviewResponsePayload(
            sessionId: sessionId,
            subtreeSessionIds: subtree,
            exclusiveCards: exclusiveCards,
            sharedCards: sharedCards,
            assets: assets
        )
    }

    private func makeModel(
        _ service: StubSessionService,
        now: Date? = nil
    ) -> ArchiveModel {
        let model = ArchiveModel(now: { now ?? self.fixedNow })
        model.attach(management: service, sessions: service)
        return model
    }

    func testReloadListsOnlyArchivedSessionsAndCountsDays() async {
        let service = StubSessionService(
            sessions: [
                summary("s-normal"),
                summary(
                    "s-archived",
                    title: "整理行程",
                    archive: SessionArchive(
                        archivedAt: "2026-01-08T00:00:00Z",
                        purgeAt: "2026-01-13T00:00:00Z"
                    )
                ),
            ],
            preview: preview("s-archived", subtree: ["s-archived"])
        )
        let model = makeModel(service)

        await model.reload()

        XCTAssertEqual(model.items.map(\.id), ["s-archived"])
        XCTAssertEqual(model.items.first?.title, "整理行程")
        XCTAssertEqual(model.remainingDays(for: model.items[0]), 3)
        XCTAssertNil(model.errorMessage)
    }

    func testRemainingDaysRoundsUpAndExpiresAtZero() async {
        let service = StubSessionService(
            sessions: [],
            preview: preview("s", subtree: ["s"])
        )
        let model = makeModel(service)

        let half: ArchiveEntry = ArchiveEntry(
            id: "s1",
            title: "s1",
            archivedAt: "2026-01-10T00:00:00Z",
            purgeAt: "2026-01-12T12:00:00Z"
        )
        XCTAssertEqual(model.remainingDays(for: half), 3, "2.5 天向上取整顯示 3 天")

        let exact: ArchiveEntry = ArchiveEntry(
            id: "s2",
            title: "s2",
            archivedAt: "2026-01-10T00:00:00Z",
            purgeAt: "2026-01-13T00:00:00Z"
        )
        XCTAssertEqual(model.remainingDays(for: exact), 3)

        let past: ArchiveEntry = ArchiveEntry(
            id: "s3",
            title: "s3",
            archivedAt: "2026-01-01T00:00:00Z",
            purgeAt: "2026-01-09T00:00:00Z"
        )
        XCTAssertEqual(model.remainingDays(for: past), 0)

        let unknown: ArchiveEntry = ArchiveEntry(
            id: "s4",
            title: "s4",
            archivedAt: "2026-01-01T00:00:00Z",
            purgeAt: "不是時間"
        )
        XCTAssertNil(model.remainingDays(for: unknown))
    }

    func testArchivedEventAddsEntryUsingListedTitle() async {
        // 主機的 session.list 不帶 archive 時，封存靠事件進清單；
        // 標題從上次列出的摘要補上。
        let service = StubSessionService(
            sessions: [summary("s1", title: "舊對話")],
            preview: preview("s1", subtree: ["s1"])
        )
        let model = makeModel(service)
        await model.reload()
        XCTAssertTrue(model.items.isEmpty, "沒有 archive 資訊時清單是空的")

        model.handle(frame: .sessionArchivedEvent(SessionArchivedEvent(
            stream: "system",
            seq: 7,
            emittedAt: "2026-01-10T01:00:00Z",
            payload: SessionArchivedEventPayload(
                sessionId: "s1",
                archive: SessionArchive(
                    archivedAt: "2026-01-10T01:00:00Z",
                    purgeAt: "2026-01-17T01:00:00Z"
                )
            )
        )))

        XCTAssertEqual(model.items.map(\.id), ["s1"])
        XCTAssertEqual(model.items.first?.title, "舊對話")
        XCTAssertEqual(model.remainingDays(for: model.items[0]), 8)

        // 重新載入時以主機摘要為準，不保留已過期的事件狀態。
        await model.reload()
        XCTAssertTrue(model.items.isEmpty)
    }

    func testUnarchivedAndDeletedEventsRemoveEntries() async {
        let service = StubSessionService(
            sessions: [summary("s1"), summary("s2")],
            preview: preview("s1", subtree: ["s1"])
        )
        let model = makeModel(service)
        await model.reload()
        for id in ["s1", "s2"] {
            model.handle(frame: .sessionArchivedEvent(SessionArchivedEvent(
                stream: "system",
                seq: 1,
                emittedAt: "2026-01-10T01:00:00Z",
                payload: SessionArchivedEventPayload(
                    sessionId: id,
                    archive: SessionArchive(
                        archivedAt: "2026-01-10T01:00:00Z",
                        purgeAt: "2026-01-17T01:00:00Z"
                    )
                )
            )))
        }
        XCTAssertEqual(model.items.count, 2)

        model.handle(frame: .sessionUnarchivedEvent(SessionUnarchivedEvent(
            stream: "system",
            seq: 2,
            emittedAt: "2026-01-10T02:00:00Z",
            payload: SessionUnarchivedEventPayload(sessionId: "s1")
        )))
        XCTAssertEqual(model.items.map(\.id), ["s2"])

        model.handle(frame: .sessionDeletedEvent(SessionDeletedEvent(
            stream: "system",
            seq: 3,
            emittedAt: "2026-01-10T03:00:00Z",
            payload: SessionDeletedEventPayload(
                sessionId: "s2",
                deletedSessionIds: ["s2", "s2-branch"],
                deletedCards: 3,
                deletedAssets: 1
            )
        )))
        XCTAssertTrue(model.items.isEmpty)
    }

    func testUnarchiveCallsServiceAndRemovesEntry() async {
        let service = StubSessionService(
            sessions: [
                summary(
                    "s1",
                    archive: SessionArchive(
                        archivedAt: "2026-01-09T00:00:00Z",
                        purgeAt: "2026-01-16T00:00:00Z"
                    )
                ),
            ],
            preview: preview("s1", subtree: ["s1"])
        )
        let model = makeModel(service)
        await model.reload()

        await model.unarchive(sessionId: "s1")

        XCTAssertEqual(model.items.count, 0)
        XCTAssertEqual(model.noticeMessage, CardL10n.text(.archiveUnarchived))
        let unarchived = await service.unarchivedIds
        XCTAssertEqual(unarchived, ["s1"])
    }

    func testBeginDeleteRequiresPreviewBeforeShowingConfirmation() async {
        let service = StubSessionService(
            sessions: [
                summary(
                    "s1",
                    title: "要刪的對話",
                    archive: SessionArchive(
                        archivedAt: "2026-01-09T00:00:00Z",
                        purgeAt: "2026-01-16T00:00:00Z"
                    )
                ),
            ],
            preview: preview("s1", subtree: ["s1", "s1-branch"], exclusiveCards: 4, sharedCards: 2, assets: 1)
        )
        let model = makeModel(service)
        await model.reload()
        XCTAssertNil(model.deletionTarget, "還沒拿 preview 不能顯示確認視窗")

        await model.beginDelete(sessionId: "s1")

        let target = try? XCTUnwrap(model.deletionTarget)
        XCTAssertEqual(target?.sessionId, "s1")
        XCTAssertEqual(target?.sessionTitle, "要刪的對話")
        XCTAssertEqual(target?.subtreeSessionIds, ["s1", "s1-branch"])
        XCTAssertEqual(target?.exclusiveCards, 4)
        XCTAssertEqual(target?.sharedCards, 2)
        XCTAssertEqual(target?.assets, 1)
        let previewCalls = await service.previewCalls
        XCTAssertEqual(previewCalls, ["s1"])
    }

    func testBeginDeleteFailureKeepsDialogClosedAndShowsError() async {
        let service = StubSessionService(
            sessions: [
                summary(
                    "s1",
                    archive: SessionArchive(
                        archivedAt: "2026-01-09T00:00:00Z",
                        purgeAt: "2026-01-16T00:00:00Z"
                    )
                ),
            ],
            preview: preview("s1", subtree: ["s1"]),
            failPreview: true
        )
        let model = makeModel(service)
        await model.reload()

        await model.beginDelete(sessionId: "s1")

        XCTAssertNil(model.deletionTarget, "preview 失敗時不能顯示確認視窗")
        XCTAssertNotNil(model.errorMessage)
    }

    func testConfirmDeleteRemovesSubtreeAndReportsActualDeletion() async {
        let service = StubSessionService(
            sessions: [
                summary(
                    "s-parent",
                    title: "主對話",
                    archive: SessionArchive(
                        archivedAt: "2026-01-09T00:00:00Z",
                        purgeAt: "2026-01-16T00:00:00Z"
                    )
                ),
                summary(
                    "s-branch",
                    title: "支線對話",
                    archive: SessionArchive(
                        archivedAt: "2026-01-09T00:00:00Z",
                        purgeAt: "2026-01-16T00:00:00Z"
                    )
                ),
            ],
            preview: preview("s-parent", subtree: ["s-parent", "s-branch"], exclusiveCards: 4, sharedCards: 2, assets: 1),
            deletedIdsOnDelete: ["s-parent", "s-branch"]
        )
        let model = makeModel(service)
        await model.reload()
        XCTAssertEqual(model.items.count, 2)

        await model.beginDelete(sessionId: "s-parent")
        await model.confirmDelete()

        XCTAssertTrue(model.items.isEmpty, "刪除整個子樹：主線與支線都從封存區消失")
        XCTAssertNil(model.deletionTarget)
        XCTAssertEqual(model.noticeMessage, CardL10n.text(.archiveDeleted))
        let deleteCalls = await service.deleteCalls
        XCTAssertEqual(deleteCalls.count, 1)
        XCTAssertEqual(deleteCalls.first?.sessionId, "s-parent")
        XCTAssertFalse(deleteCalls.first?.clientRequestId.isEmpty ?? true)
    }

    func testConfirmDeleteFailureKeepsEntriesAndTarget() async {
        let service = StubSessionService(
            sessions: [
                summary(
                    "s1",
                    archive: SessionArchive(
                        archivedAt: "2026-01-09T00:00:00Z",
                        purgeAt: "2026-01-16T00:00:00Z"
                    )
                ),
            ],
            preview: preview("s1", subtree: ["s1"]),
            failDelete: true
        )
        let model = makeModel(service)
        await model.reload()
        await model.beginDelete(sessionId: "s1")

        await model.confirmDelete()

        XCTAssertEqual(model.items.count, 1, "刪除失敗不能把列從封存區拿掉")
        XCTAssertNotNil(model.deletionTarget, "失敗時確認視窗保持開啟，可以重試")
        XCTAssertNotNil(model.errorMessage)
    }

    func testReloadWithoutServiceShowsUnavailableMessage() async {
        let model = ArchiveModel(now: { self.fixedNow })

        await model.reload()

        XCTAssertEqual(model.errorMessage, CardL10n.text(.archiveServiceUnavailable))
    }

    func testReloadFailureShowsLoadError() async {
        let service = StubSessionService(
            sessions: [],
            preview: preview("s", subtree: ["s"]),
            failList: true
        )
        let model = makeModel(service)

        await model.reload()

        XCTAssertNotNil(model.errorMessage)
        XCTAssertTrue(model.items.isEmpty)
    }
}
