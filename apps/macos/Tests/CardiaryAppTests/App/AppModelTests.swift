import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 殼推來的狀態如何決定畫面，以及左側欄的選取與重新載入。
@MainActor
final class AppModelTests: XCTestCase {
    func testFirstRunShowsBeforeFolderChosen() {
        let model = AppModel()
        XCTAssertEqual(model.screen, .firstRun)
    }

    func testFirstRunSurvivesFolderReadyUntilSetupDone() {
        let model = AppModel()
        model.update(folder: folder(.ready))
        XCTAssertEqual(model.screen, .firstRun, "設定還沒完成時，選好資料夾不該直接進主畫面")
        XCTAssertEqual(model.firstRun.step, .model)

        model.firstRun.markComplete()
        model.update(folder: folder(.ready))
        XCTAssertEqual(model.screen, .main)
    }

    func testReturningUserGoesStraightToMain() {
        let model = AppModel(setupCompleted: true)
        model.update(folder: folder(.ready))
        XCTAssertEqual(model.screen, .main)

        model.update(connection: .connected(epoch: "epoch-1"))
        XCTAssertEqual(model.screen, .main)
    }

    func testFolderUnavailableWinsOverConnection() {
        let model = AppModel(setupCompleted: true)
        model.update(folder: folder(.ready))
        model.update(connection: .needsUpdate)
        XCTAssertEqual(model.screen, .needsUpdate)

        model.update(folder: folder(.unavailable))
        XCTAssertEqual(model.screen, .unavailable(.unavailable))
        model.update(folder: folder(.mismatch))
        XCTAssertEqual(model.screen, .unavailable(.mismatch))
    }

    func testConnectionNeedsUpdateShowsUpdateScreen() {
        let model = AppModel(setupCompleted: true)
        model.update(folder: folder(.ready))
        model.update(connection: .needsUpdate)
        XCTAssertEqual(model.screen, .needsUpdate)

        model.update(connection: .connected(epoch: "epoch-2"))
        XCTAssertEqual(model.screen, .main)
    }

    func testApprovalsAreForwardedToBridgeAndInspector() {
        let model = AppModel()
        model.update(approvals: [Fixtures.approval(), Fixtures.approval(approvalId: "approval-2")])
        XCTAssertEqual(model.bridge.approvalCount, 2)
        XCTAssertEqual(model.approvals.requests.map(\.approvalId), ["approval-1", "approval-2"])

        model.update(approvals: nil)
        XCTAssertNil(model.bridge.approvalCount, "還沒連上服務時數量未知，不是 0")
        XCTAssertTrue(model.approvals.requests.isEmpty)
    }

    func testImportEntryRunsRegisteredCommand() {
        let model = AppModel()
        var calls = 0
        model.installImportUI(ImportUIEntry(commands: [
            AppCommand(id: "import.open", titleKey: .commandGroupImport) { calls += 1 },
        ]))
        model.openImport()
        XCTAssertEqual(calls, 1)
        XCTAssertNotEqual(model.commands.group(AppRegistry.importCommandsGroupId)?.titleKey, .commandGroupImport)
    }

    func testPendingApprovalsOpenInspector() {
        let model = AppModel()
        model.toggleInspector()
        model.showApprovals()
        XCTAssertFalse(model.isInspectorVisible)
        model.update(approvals: [Fixtures.approval()])
        model.showApprovals()
        XCTAssertTrue(model.isInspectorVisible)
        XCTAssertEqual(model.approvals.count, 1)
    }

    func testShellActionsAreForwarded() {
        var chooseFolderCalls = 0
        var retryCalls = 0
        var pauseCalls = 0
        let actions = ShellActions(
            chooseFolder: { chooseFolderCalls += 1 },
            retry: { retryCalls += 1 },
            pauseAllApprovals: { pauseCalls += 1 }
        )
        let bridge = ShellBridge(actions: actions)
        let model = AppModel(bridge: bridge)

        model.chooseFolder()
        model.retry()
        model.pauseAllApprovals()

        XCTAssertEqual(chooseFolderCalls, 1)
        XCTAssertEqual(retryCalls, 1)
        XCTAssertEqual(pauseCalls, 1)
    }

    func testAttachLoadsSessionsAndOpensFirstConversation() async {
        let sessions = [
            Fixtures.summary("s2", updatedAt: "2026-01-03T00:00:00Z"),
            Fixtures.summary("s1", updatedAt: "2026-01-02T00:00:00Z"),
        ]
        let fake = FakeCardiaryService(
            sessions: sessions,
            historyPages: [nil: Fixtures.historyPage(["a", "b"])]
        )
        let model = AppModel(setupCompleted: true)

        await model.attach(service: fake)

        XCTAssertEqual(model.conversations.sessions.map(\.id), ["s2", "s1"], "最新的對話排在前面")
        XCTAssertEqual(model.selection, .conversation("s2"))
        XCTAssertEqual(model.conversation.sessionId, "s2")
        XCTAssertEqual(model.conversation.items.map(\.id), ["a", "b"])
        let subscribed = await fake.subscribedSessions
        XCTAssertEqual(subscribed, ["s2"])
    }

    func testAttachReusesSelectedConversationAcrossReconnect() async {
        let sessions = [Fixtures.summary("s1")]
        let historyPages: [String?: SessionGetHistoryResponsePayload] = [
            nil: Fixtures.historyPage(["a", "b"]),
        ]
        let first = FakeCardiaryService(sessions: sessions, historyPages: historyPages)
        let model = AppModel(setupCompleted: true)
        await model.attach(service: first)
        model.handle(sessionEvent: Fixtures.completed("第一版", id: "x"))

        // 服務換行程：新的客戶端連上來，殼會再 attach 一次。
        let second = FakeCardiaryService(sessions: sessions, historyPages: historyPages)
        await model.attach(service: second)

        XCTAssertEqual(model.selection, .conversation("s1"))
        XCTAssertEqual(model.conversation.items.map(\.id), ["a", "b"], "重新載入後不應保留上一段連線的項目")
    }

    func testEpochChangeReloadsWithoutDuplicates() async {
        let sessions = [Fixtures.summary("s1")]
        let history = SessionGetHistoryResponsePayload(
            entries: [Fixtures.assistantEntry("a", text: "第一則"), Fixtures.assistantEntry("b", text: "第二則")],
            nextCursor: nil
        )
        let fake = FakeCardiaryService(sessions: sessions, historyPages: [nil: history])
        let model = AppModel(setupCompleted: true)
        await model.attach(service: fake)

        model.handle(sessionEvent: Fixtures.completed("剛剛送出的回覆", id: "c"))
        XCTAssertEqual(model.conversation.items.map(\.id), ["a", "b", "c"])

        await model.handleEpochChange(epoch: "epoch-2")
        XCTAssertEqual(model.conversation.items.map(\.id), ["a", "b"], "換 epoch 後以主機的快照為準")
        XCTAssertNil(model.conversation.streamingText)
        let historyCalls = await fake.historyCursors
        XCTAssertEqual(historyCalls, [nil, nil])
    }

    func testCreatedConversationRefreshesTitleAfterSending() async {
        let initial = Fixtures.summary("s1", title: "新對話")
        let titled = Fixtures.summary("s1", title: "規劃旅行")
        let fake = FakeCardiaryService(
            listPages: [
                SessionListResponsePayload(sessions: []),
                SessionListResponsePayload(sessions: []),
                SessionListResponsePayload(sessions: [initial]),
                SessionListResponsePayload(sessions: [titled]),
            ],
            createSummary: initial
        )
        let model = AppModel(setupCompleted: true)
        await model.attach(service: fake)
        _ = await model.createConversation()
        model.conversation.composerText = "規劃旅行"
        await model.conversation.send()
        XCTAssertEqual(model.conversations.sessions.first?.title, "規劃旅行")
    }

    func testArchivedEventMarksConversation() async {
        let model = AppModel(setupCompleted: true)
        await model.attach(service: FakeCardiaryService(sessions: [Fixtures.summary("s1")]))
        model.handle(sessionEvent: .sessionArchivedEvent(SessionArchivedEvent(
            stream: "system", seq: 1, emittedAt: "2026-01-10T01:00:00Z",
            payload: SessionArchivedEventPayload(sessionId: "s1", archive: SessionArchive(
                archivedAt: "2026-01-10T01:00:00Z", purgeAt: "2026-01-17T01:00:00Z"
            ))
        )))
        XCTAssertEqual(model.conversations.sessions.first?.status, .archived)
        model.handle(sessionEvent: .sessionUnarchivedEvent(SessionUnarchivedEvent(
            stream: "system", seq: 2, emittedAt: "2026-01-10T02:00:00Z",
            payload: SessionUnarchivedEventPayload(sessionId: "s1")
        )))
        XCTAssertEqual(model.conversations.sessions.first?.status, .idle)
        model.handle(sessionEvent: .sessionDeletedEvent(SessionDeletedEvent(
            stream: "system", seq: 3, emittedAt: "2026-01-10T03:00:00Z",
            payload: SessionDeletedEventPayload(
                sessionId: "s1", deletedSessionIds: ["s1"], deletedCards: 0, deletedAssets: 0
            )
        )))
        XCTAssertTrue(model.conversations.sessions.isEmpty)
    }

    func testCreateConversationSelectsAndOpensIt() async {
        let fake = FakeCardiaryService(
            sessions: [Fixtures.summary("s1")],
            historyPages: [nil: Fixtures.historyPage([])],
            createSummary: Fixtures.summary("s2", updatedAt: "2026-01-02T00:00:00Z")
        )
        let model = AppModel(setupCompleted: true)
        await model.attach(service: fake)

        let id = await model.createConversation()

        XCTAssertEqual(id, "s2")
        XCTAssertEqual(model.selection, .conversation("s2"))
        XCTAssertEqual(model.conversation.sessionId, "s2")
        XCTAssertEqual(model.conversations.sessions.map(\.id), ["s2", "s1"])
    }

    func testStartFirstConversationFinishesSetup() async {
        let fake = FakeCardiaryService(
            sessions: [],
            historyPages: [nil: Fixtures.historyPage([])],
            createSummary: Fixtures.summary("s-first")
        )
        let model = AppModel()
        model.update(folder: folder(.ready))
        XCTAssertEqual(model.screen, .firstRun)
        await model.attach(service: fake)

        await model.startFirstConversation()

        XCTAssertTrue(model.firstRun.isComplete)
        XCTAssertEqual(model.screen, .main)
        XCTAssertEqual(model.selection, .conversation("s-first"))
    }

    func testInjectedLanguageReachesNestedModels() async {
        let previous = AppL10n.language
        defer { AppL10n.language = previous }

        let model = AppModel(language: .en)
        await model.approvals.approve(ApprovalPresentation(request: Fixtures.approval()))
        XCTAssertEqual(model.approvals.errorMessage, "Not connected; cannot send the decision.")

        await model.settingsModel.general.load()
        XCTAssertEqual(
            model.settingsModel.general.errorMessage,
            "Settings need a service connection."
        )
    }

    func testSelectingSlotDoesNotLoseConversation() async {
        let fake = FakeCardiaryService(
            sessions: [Fixtures.summary("s1")],
            historyPages: [nil: Fixtures.historyPage(["a"])]
        )
        let model = AppModel(setupCompleted: true)
        await model.attach(service: fake)

        model.selectSlot("cards")
        XCTAssertEqual(model.selection, .slot("cards"))
        XCTAssertEqual(model.conversations.selectedId, "s1", "換到其他入口時不該忘掉原本選的對話")

        await model.selectConversation("s1")
        XCTAssertEqual(model.selection, .conversation("s1"))
    }

    private func folder(_ availability: FolderPresentation.Availability) -> FolderPresentation {
        FolderPresentation(
            availability: availability,
            displayName: availability == .ready ? "Cardiary" : nil,
            path: availability == .ready ? "/Volumes/Test/Cardiary" : nil
        )
    }
}
