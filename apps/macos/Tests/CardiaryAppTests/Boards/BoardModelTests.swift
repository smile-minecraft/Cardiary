import CardiaryKit
import Foundation
import XCTest

@testable import CardiaryApp

@MainActor
final class BoardModelTests: XCTestCase {
    private func makeBoard(updatedAt: String = "2026-11-16T00:00:00.000Z") -> BoardDocument {
        BoardDocument(
            id: "board-1",
            title: "測試白板",
            createdAt: "2026-11-15T00:00:00.000Z",
            updatedAt: updatedAt,
            items: [
                BoardItem(
                    id: "item-1",
                    cardId: "card-1",
                    position: BoardPoint(x: 100, y: 80),
                    size: BoardSize(width: 240, height: 160),
                    pinned: true,
                    origin: .canvas,
                    projectedBy: .user,
                    groupId: nil
                ),
            ],
            inbox: [],
            edges: [],
            groups: []
        )
    }

    private func makeItem(_ id: String, pinned: Bool = false, groupId: String? = nil) -> BoardItem {
        BoardItem(
            id: id,
            cardId: "card-\(id)",
            position: BoardPoint(x: 100, y: 80),
            size: BoardSize(width: 240, height: 160),
            pinned: pinned,
            origin: .canvas,
            projectedBy: .user,
            groupId: groupId
        )
    }

    private func makeBoard(
        items: [BoardItem],
        updatedAt: String = "2026-11-16T00:00:00.000Z"
    ) -> BoardDocument {
        BoardDocument(
            id: "board-1",
            title: "測試白板",
            createdAt: "2026-11-15T00:00:00.000Z",
            updatedAt: updatedAt,
            items: items,
            inbox: [],
            edges: [],
            groups: []
        )
    }

    private func event(board: BoardDocument, change: BoardChange = .updated) -> ServerFrame {
        .boardChangedEvent(BoardChangedEvent(
            stream: "board",
            seq: 1,
            emittedAt: "2026-11-16T00:00:01.000Z",
            payload: BoardChangedEventPayload(
                boardId: board.id,
                change: change,
                board: board
            )
        ))
    }

    func testLoadBoardBuildsCanvasWithPinnedProjection() async {
        let fake = FakeBoardService(board: makeBoard())
        let model = BoardModel(boardService: fake)
        await model.reload()

        XCTAssertEqual(model.selectedBoardId, "board-1")
        XCTAssertEqual(model.board?.title, "測試白板")
        XCTAssertEqual(model.canvas.items.count, 1)
        XCTAssertEqual(model.canvas.items[0].frame.minX, 100)
        XCTAssertTrue(model.canvas.items[0].pinned)
        XCTAssertEqual(model.canvas.visibleItems.count, 1)
    }

    func testSaveCanvasWritesRoundedPositionsAndKeepsOriginalMetadata() async {
        let fake = FakeBoardService(board: makeBoard())
        let model = BoardModel(boardService: fake)
        await model.reload()

        model.canvas.select("item-1")
        model.canvas.moveSelected(by: BoardCanvasPoint(x: 20.4, y: -10.6))
        await model.saveCanvas()

        let saved = try? XCTUnwrap(fake.savedBoard)
        XCTAssertEqual(saved?.items[0].position.x, 120)
        XCTAssertEqual(saved?.items[0].position.y, 69)
        XCTAssertEqual(saved?.items[0].origin, .canvas)
        XCTAssertEqual(saved?.items[0].projectedBy, .user)
        XCTAssertTrue(saved?.items[0].pinned ?? false)
    }

    func testStaleBaseUpdatedAtShowsConflictAndReloadsServerBoard() async {
        let fake = FakeBoardService(board: makeBoard())
        fake.conflictsOnSave = true
        let model = BoardModel(boardService: fake)
        await model.reload()

        model.canvas.select("item-1")
        model.canvas.moveSelected(by: BoardCanvasPoint(x: 40, y: 0))
        await model.saveCanvas()

        XCTAssertEqual(model.conflictMessage, BoardL10n.text(.boardsConflict))
        XCTAssertEqual(model.canvas.items[0].frame.minX, 100, "失敗的移動不能覆蓋主機版本")
        XCTAssertNil(model.errorMessage)
    }

    func testBoardChangedEventSyncsAnotherWindow() async {
        let fake = FakeBoardService(board: makeBoard())
        let model = BoardModel(boardService: fake)
        await model.reload()

        let base = makeBoard(updatedAt: "2026-11-16T01:00:00.000Z")
        let original = base.items[0]
        let newer = BoardDocument(
            id: base.id,
            title: base.title,
            createdAt: base.createdAt,
            updatedAt: base.updatedAt,
            items: [BoardItem(
                id: original.id,
                cardId: original.cardId,
                position: BoardPoint(x: 500, y: 200),
                size: original.size,
                pinned: original.pinned,
                origin: original.origin,
                projectedBy: original.projectedBy,
                groupId: original.groupId
            )],
            inbox: [],
            edges: [],
            groups: []
        )
        model.handle(event: event(board: newer))

        XCTAssertEqual(model.board?.updatedAt, newer.updatedAt)
        XCTAssertEqual(model.canvas.items[0].frame.minX, 500)

        model.handle(event: event(board: newer, change: .deleted))
        XCTAssertNil(model.board)
        XCTAssertTrue(model.canvas.items.isEmpty)
    }

    func testMoveInboxItemToCanvasUsesHumanProjection() async {
        let base = makeBoard()
        let board = BoardDocument(
            id: base.id,
            title: base.title,
            createdAt: base.createdAt,
            updatedAt: base.updatedAt,
            items: base.items,
            inbox: [
                BoardItem(
                    id: "inbox-1",
                    cardId: "card-2",
                    position: BoardPoint(x: 10, y: 10),
                    size: BoardSize(width: 240, height: 160),
                    pinned: false,
                    origin: .inbox,
                    projectedBy: .agent,
                    groupId: nil
                ),
            ],
            edges: [],
            groups: []
        )
        let fake = FakeBoardService(board: board)
        let model = BoardModel(boardService: fake)
        await model.reload()

        await model.moveInboxItemToCanvas(itemId: "inbox-1")

        let saved = try? XCTUnwrap(fake.savedBoard)
        XCTAssertEqual(saved?.items.count, 2)
        XCTAssertTrue(saved?.inbox.isEmpty ?? false)
        XCTAssertEqual(saved?.items[1].origin, .canvas)
        XCTAssertEqual(saved?.items[1].projectedBy, .user)
    }

    func testCreateCardFromSelectionRecordsAllSelectedCardIds() async {
        let fake = FakeBoardService(board: makeBoard())
        let model = BoardModel(boardService: fake)
        await model.reload()
        model.canvas.setSelection(["item-1"])

        await model.createCardFromSelection(title: "整理過的卡", body: "重點")

        XCTAssertEqual(fake.createdFromSelection?.cardIds, ["card-1"])
        XCTAssertEqual(fake.createdFromSelection?.title, "整理過的卡")
        XCTAssertEqual(fake.createdFromSelection?.body, "重點")
        XCTAssertEqual(model.board?.items.count, 2)
        XCTAssertEqual(model.noticeMessage, BoardL10n.text(.boardsCardCreated))
    }

    func testUndoRedoAndPinnedAppearance() async {
        let fake = FakeBoardService(board: makeBoard())
        let model = BoardModel(boardService: fake)
        await model.reload()
        model.canvas.setSelection(["item-1"])

        model.canvas.moveSelected(by: BoardCanvasPoint(x: 30, y: 0))
        XCTAssertTrue(model.canvas.canUndo)
        XCTAssertTrue(model.canvas.undo())
        XCTAssertEqual(model.canvas.items[0].frame.minX, 100)
        XCTAssertTrue(model.canvas.redo())
        XCTAssertEqual(model.canvas.items[0].frame.minX, 130)

        XCTAssertEqual(
            BoardCanvas.opacity(pinned: model.canvas.items[0].pinned, freshness: 0),
            1
        )
    }

    // MARK: - 連線與分組

    func testCreateEdgeRejectsInvalidEndpointsWithoutSaving() async {
        let fake = FakeBoardService(board: makeBoard())
        let model = BoardModel(boardService: fake)
        await model.reload()

        let unknown = await model.createEdge(from: "item-1", to: "missing")
        XCTAssertFalse(unknown)
        XCTAssertEqual(model.errorMessage, BoardL10n.text(.boardsEdgeInvalid))

        let selfLoop = await model.createEdge(from: "item-1", to: "item-1")
        XCTAssertFalse(selfLoop)
        XCTAssertEqual(model.errorMessage, BoardL10n.text(.boardsEdgeInvalid))
        XCTAssertEqual(fake.saveCount, 0, "被拒絕的連線不能送到主機")
    }

    func testCreateEdgeBetweenSelectionSavesOnceAndRejectsDuplicates() async {
        let fake = FakeBoardService(board: makeBoard(items: [makeItem("item-1"), makeItem("item-2")]))
        let model = BoardModel(boardService: fake)
        await model.reload()
        model.canvas.setSelection(["item-1", "item-2"])

        let created = await model.createEdgeBetweenSelection()
        XCTAssertTrue(created)
        let saved = try? XCTUnwrap(fake.savedBoard)
        XCTAssertEqual(saved?.edges.count, 1)
        XCTAssertEqual(
            Set([saved?.edges.first?.from, saved?.edges.first?.to].compactMap { $0 }),
            ["item-1", "item-2"]
        )
        XCTAssertEqual(model.noticeMessage, BoardL10n.text(.boardsEdgeCreated))

        let duplicate = await model.createEdgeBetweenSelection()
        XCTAssertFalse(duplicate)
        XCTAssertEqual(model.errorMessage, BoardL10n.text(.boardsEdgeDuplicate))
        XCTAssertEqual(fake.saveCount, 1, "重複的連線不再送主機")

        let removed = await model.deleteEdge(saved?.edges.first?.id ?? "")
        XCTAssertTrue(removed)
        XCTAssertEqual(fake.savedBoard?.edges.count, 0)
        XCTAssertEqual(model.noticeMessage, BoardL10n.text(.boardsEdgeDeleted))
    }

    func testCreateGroupAssignsSelectionAndDeleteKeepsCards() async {
        let fake = FakeBoardService(board: makeBoard(items: [
            makeItem("item-1"), makeItem("item-2"), makeItem("item-3"),
        ]))
        let model = BoardModel(boardService: fake)
        await model.reload()
        model.canvas.setSelection(["item-1", "item-2"])

        let created = await model.createGroup(label: "主題")
        XCTAssertTrue(created)
        let groupId = fake.savedBoard?.groups.first?.id
        XCTAssertEqual(fake.savedBoard?.groups.first?.label, "主題")
        XCTAssertEqual(fake.savedBoard?.items.filter { $0.groupId == groupId }.count, 2)
        XCTAssertEqual(model.selectionGroupId, groupId)
        XCTAssertEqual(
            model.noticeMessage,
            BoardL10n.format(.boardsGroupCreated, ["count": "2", "label": "主題"])
        )

        model.canvas.setSelection(["item-3"])
        let assigned = await model.assignItems(["item-3"], toGroup: groupId ?? "")
        XCTAssertTrue(assigned)
        XCTAssertEqual(fake.savedBoard?.items.filter { $0.groupId == groupId }.count, 3)
        XCTAssertEqual(model.selectionGroupId, groupId)

        let removed = await model.removeSelectionFromGroup()
        XCTAssertTrue(removed)
        XCTAssertEqual(fake.savedBoard?.items.filter { $0.groupId == groupId }.count, 2)
        XCTAssertEqual(fake.savedBoard?.items.count, 3)

        let deleted = await model.deleteGroup(groupId ?? "")
        XCTAssertTrue(deleted)
        XCTAssertEqual(fake.savedBoard?.groups.count, 0)
        XCTAssertEqual(fake.savedBoard?.items.count, 3, "刪除分組不能刪掉卡片")
        XCTAssertTrue(fake.savedBoard?.items.allSatisfy { $0.groupId == nil } ?? false)
    }

    func testCreateGroupRequiresNameAndTwoItems() async {
        let fake = FakeBoardService(board: makeBoard(items: [makeItem("item-1"), makeItem("item-2")]))
        let model = BoardModel(boardService: fake)
        await model.reload()
        model.canvas.setSelection(["item-1"])

        let tooFew = await model.createGroup(label: "主題")
        XCTAssertFalse(tooFew)
        XCTAssertEqual(model.errorMessage, BoardL10n.text(.boardsGroupNeedsSelection))

        model.canvas.setSelection(["item-1", "item-2"])
        let unnamed = await model.createGroup(label: "   ")
        XCTAssertFalse(unnamed)
        XCTAssertEqual(model.errorMessage, BoardL10n.text(.boardsGroupNameRequired))
        XCTAssertEqual(fake.saveCount, 0)
    }

    func testDeleteGroupPromotesChildGroupsToTopLevel() async {
        let base = makeBoard(items: [makeItem("item-1"), makeItem("item-2")])
        let parent = BoardGroup(id: "group-parent", label: "父")
        let child = BoardGroup(id: "group-child", label: "子", parentId: parent.id)
        let board = BoardDocument(
            id: base.id,
            title: base.title,
            createdAt: base.createdAt,
            updatedAt: base.updatedAt,
            items: [
                makeItem("item-1", groupId: parent.id),
                makeItem("item-2", groupId: child.id),
            ],
            inbox: [],
            edges: [],
            groups: [parent, child]
        )
        let fake = FakeBoardService(board: board)
        let model = BoardModel(boardService: fake)
        await model.reload()

        let deleted = await model.deleteGroup(parent.id)
        XCTAssertTrue(deleted)
        XCTAssertEqual(fake.savedBoard?.groups.map(\.id), [child.id])
        XCTAssertNil(fake.savedBoard?.groups.first?.parentId)
        XCTAssertEqual(fake.savedBoard?.items.count, 2)
    }

    // MARK: - 圈選送進對話

    func testSendSelectionUsesChosenConversation() async {
        let fake = FakeBoardService(board: makeBoard())
        let context = FakeCardiaryService()
        let model = BoardModel(boardService: fake, contextService: context)
        await model.reload()
        model.canvas.setSelection(["item-1"])

        let sent = await model.sendSelection(to: "conv-other")

        XCTAssertTrue(sent)
        let adds = await context.contextAdds
        XCTAssertEqual(adds.map(\.sessionId), ["conv-other"])
        XCTAssertEqual(adds.map(\.cardId), ["card-1"])
        XCTAssertEqual(model.noticeMessage, BoardL10n.count(.boardsSentToConversation, count: 1))
    }

    func testSendSelectionToCurrentConversationKeepsExistingPath() async {
        let fake = FakeBoardService(board: makeBoard())
        let context = FakeCardiaryService()
        let model = BoardModel(boardService: fake, contextService: context)
        await model.reload()
        model.canvas.setSelection(["item-1"])
        model.selectedConversationId = { "conv-current" }

        await model.sendSelectionToConversation()

        let adds = await context.contextAdds
        XCTAssertEqual(adds.map(\.sessionId), ["conv-current"])
        XCTAssertEqual(adds.map(\.cardId), ["card-1"])
    }

    func testSendSelectionWithoutConversationKeepsExistingHint() async {
        let fake = FakeBoardService(board: makeBoard())
        let context = FakeCardiaryService()
        let model = BoardModel(boardService: fake, contextService: context)
        await model.reload()
        model.canvas.setSelection(["item-1"])

        await model.sendSelectionToConversation()

        XCTAssertEqual(model.errorMessage, BoardL10n.text(.boardsSendUnavailable))
        let adds = await context.contextAdds
        XCTAssertTrue(adds.isEmpty)
    }

    func testSendSelectionCreatesConversationOnlyWhenCardsSelected() async {
        let fake = FakeBoardService(board: makeBoard())
        let context = FakeCardiaryService()
        let model = BoardModel(boardService: fake, contextService: context)
        await model.reload()
        var created = 0
        model.createConversation = {
            created += 1
            return "conv-new"
        }

        let empty = await model.sendSelectionToNewConversation()
        XCTAssertFalse(empty)
        XCTAssertEqual(created, 0, "沒有選取卡片時不能建立空對話")
        XCTAssertEqual(model.errorMessage, BoardL10n.text(.boardsNothingSelected))

        model.canvas.setSelection(["item-1"])
        let sent = await model.sendSelectionToNewConversation()
        XCTAssertTrue(sent)
        XCTAssertEqual(created, 1)
        let adds = await context.contextAdds
        XCTAssertEqual(adds.map(\.sessionId), ["conv-new"])
        XCTAssertEqual(adds.map(\.cardId), ["card-1"])
    }

    func testSendSelectionReportsConversationCreationFailure() async {
        let fake = FakeBoardService(board: makeBoard())
        let context = FakeCardiaryService()
        let model = BoardModel(boardService: fake, contextService: context)
        await model.reload()
        model.canvas.setSelection(["item-1"])
        model.createConversation = { nil }

        let sent = await model.sendSelectionToNewConversation()

        XCTAssertFalse(sent)
        XCTAssertEqual(model.errorMessage, BoardL10n.text(.boardsNewConversationFailed))
        let adds = await context.contextAdds
        XCTAssertTrue(adds.isEmpty)
    }
}

// MARK: - 假服務

private final class FakeBoardService: BoardService, @unchecked Sendable {
    private var board: BoardDocument
    private(set) var savedBoard: BoardDocument?
    private(set) var saveCount = 0
    private(set) var createdFromSelection: (
        cardIds: [String],
        title: String,
        body: String
    )?
    var conflictsOnSave = false

    init(board: BoardDocument) {
        self.board = board
    }

    func listBoards() async throws -> BoardListResponsePayload {
        BoardListResponsePayload(boards: [
            BoardSummary(
                id: board.id,
                title: board.title,
                updatedAt: board.updatedAt,
                itemCount: board.items.count
            ),
        ])
    }

    func getBoard(boardId: String) async throws -> BoardGetResponsePayload {
        BoardGetResponsePayload(board: board)
    }

    func createBoard(boardId: String, title: String, clientRequestId: String) async throws -> BoardCreateResponsePayload {
        let created = BoardDocument(
            id: boardId,
            title: title,
            createdAt: board.createdAt,
            updatedAt: board.updatedAt,
            items: [],
            inbox: [],
            edges: [],
            groups: []
        )
        board = created
        return BoardCreateResponsePayload(board: created)
    }

    func saveBoard(board: BoardDocument, baseUpdatedAt: String, clientRequestId: String?) async throws -> BoardSaveResponsePayload {
        if conflictsOnSave {
            throw CardiaryClientError.server(ErrorFrame(
                code: .conflict,
                message: "過期",
                retryable: false
            ))
        }
        self.board = board
        savedBoard = board
        saveCount += 1
        return BoardSaveResponsePayload(board: board)
    }

    func deleteBoard(boardId: String) async throws -> BoardDeleteResponsePayload {
        BoardDeleteResponsePayload(deleted: true)
    }

    func projectCardOnBoard(
        boardId: String,
        itemId: String,
        cardId: String,
        position: BoardPoint,
        size: BoardSize?,
        groupId: String?,
        pinned: Bool?
    ) async throws -> BoardProjectCardResponsePayload {
        BoardProjectCardResponsePayload(board: board)
    }

    func unprojectCardOnBoard(boardId: String, itemId: String) async throws -> BoardUnprojectCardResponsePayload {
        BoardUnprojectCardResponsePayload(board: board)
    }

    func createCardFromSelection(
        boardId: String,
        cardIds: [String],
        title: String,
        body: String,
        itemId: String,
        position: BoardPoint,
        clientRequestId: String
    ) async throws -> BoardCreateCardFromSelectionResponsePayload {
        createdFromSelection = (cardIds, title, body)
        let updated = BoardDocument(
            id: board.id,
            title: board.title,
            createdAt: board.createdAt,
            updatedAt: board.updatedAt,
            items: board.items + [BoardItem(
                id: itemId,
                cardId: "new-card",
                position: position,
                size: BoardSize(width: 240, height: 160),
                pinned: false,
                origin: .canvas,
                projectedBy: .user,
                groupId: nil
            )],
            inbox: board.inbox,
            edges: board.edges,
            groups: board.groups
        )
        board = updated
        return BoardCreateCardFromSelectionResponsePayload(board: updated, cardId: "new-card")
    }
}
