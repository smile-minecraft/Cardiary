import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 對話流：可見範圍分頁、串流、工具呼叫、待審批與送出。
@MainActor
final class ConversationModelTests: XCTestCase {
    private func makeConversation() -> ConversationModel {
        ConversationModel()
    }

    func testOpenLoadsOnlyLatestPageOf1000() async {
        let all = (0..<1000).map { "e\($0)" }
        let newest = Array(all.suffix(50))
        let fake = FakeCardiaryService(
            historyPages: [nil: Fixtures.historyPage(newest, nextCursor: "cursor-older")]
        )
        let conversation = makeConversation()

        await conversation.open(sessionId: "s1", title: "千則對話", service: fake)

        XCTAssertEqual(conversation.items.count, 50, "開一場對話只載入最新一頁")
        XCTAssertEqual(conversation.items.map(\.id), newest)
        XCTAssertTrue(conversation.hasMoreHistory)
        XCTAssertEqual(conversation.title, "千則對話")
        let cursors = await fake.historyCursors
        XCTAssertEqual(cursors, [nil])
    }

    func testLoadOlderPrependsEarlierMessages() async {
        let all = (0..<100).map { "e\($0)" }
        let fake = FakeCardiaryService(
            historyPages: [
                nil: Fixtures.historyPage(Array(all[50...]), nextCursor: "cursor-older"),
                "cursor-older": Fixtures.historyPage(Array(all[0..<50]), nextCursor: nil),
            ]
        )
        let conversation = makeConversation()
        await conversation.open(sessionId: "s1", service: fake)

        await conversation.loadOlder()

        XCTAssertEqual(conversation.items.map(\.id), all)
        XCTAssertFalse(conversation.hasMoreHistory)
        let cursors = await fake.historyCursors
        XCTAssertEqual(cursors, [nil, "cursor-older"])
    }

    func testLoadOlderSkipsDuplicateEntries() async {
        let fake = FakeCardiaryService(
            historyPages: [
                nil: Fixtures.historyPage(["a", "b"], nextCursor: "cursor-older"),
                // 上一頁的最後一筆在這一頁又回來一次
                "cursor-older": Fixtures.historyPage(["a", "older"], nextCursor: nil),
            ]
        )
        let conversation = makeConversation()
        await conversation.open(sessionId: "s1", service: fake)

        await conversation.loadOlder()

        XCTAssertEqual(conversation.items.map(\.id), ["older", "a", "b"])
    }

    func testStreamingDeltaThenCompletionReplaces() async {
        let conversation = makeConversation()
        let fake = FakeCardiaryService(historyPages: [nil: Fixtures.historyPage([])])
        await conversation.open(sessionId: "s1", service: fake)

        conversation.apply(frame: Fixtures.turnStarted())
        XCTAssertNil(conversation.streamingText)
        XCTAssertEqual(conversation.activeTurn?.state, .running)

        conversation.apply(frame: Fixtures.delta("規格"))
        conversation.apply(frame: Fixtures.delta("書裡"))
        XCTAssertEqual(conversation.streamingText, "規格書裡")

        conversation.apply(frame: Fixtures.completed("規格書裡寫得很清楚。", id: "msg-1"))
        XCTAssertNil(conversation.streamingText)
        XCTAssertEqual(conversation.items.last?.id, "msg-1")
        guard case .assistantText(let text, let status)? = conversation.items.last?.kind else {
            return XCTFail("最後一列應該是助理訊息")
        }
        XCTAssertEqual(text, "規格書裡寫得很清楚。")
        XCTAssertEqual(status, .complete)
    }

    func testCompletionClearsStreamingDraftWhenEngineMessageIdDiffers() async {
        let conversation = makeConversation()
        let fake = FakeCardiaryService(historyPages: [nil: Fixtures.historyPage([])])
        await conversation.open(sessionId: "s1", service: fake)

        conversation.apply(frame: Fixtures.turnStarted())
        // Pi 轉接層用 msg_<turnId> 當增量識別碼，完成訊息則用引擎的訊息編號。
        conversation.apply(frame: Fixtures.delta("規格", messageId: "msg_turn-2"))
        conversation.apply(frame: Fixtures.completed("規格書裡寫得很清楚。", id: "14"))

        XCTAssertNil(conversation.streamingText, "完成訊息要用回合對回草稿，不能留下重複的一段")
        XCTAssertNil(conversation.streamingMessageId)
        XCTAssertEqual(conversation.items.count, 1)
        XCTAssertEqual(conversation.items.last?.id, "14")
    }

    func testToolCallAndResultBecomeOneCard() async {
        let conversation = makeConversation()
        let fake = FakeCardiaryService(historyPages: [nil: Fixtures.historyPage([])])
        await conversation.open(sessionId: "s1", service: fake)

        conversation.apply(frame: Fixtures.toolCall(toolCallId: "call-1"))
        conversation.apply(frame: Fixtures.toolResult(toolCallId: "call-1", status: .ok, text: "內容"))

        let tools = conversation.items.compactMap { item -> ToolCallPresentation? in
            if case .tool(let tool) = item.kind { return tool }
            return nil
        }
        XCTAssertEqual(tools.count, 1)
        XCTAssertEqual(tools.first?.status, .complete)
        XCTAssertEqual(tools.first?.outputText, "內容")
        XCTAssertEqual(tools.first?.inputSummary, #"{"path":"/notes.md"}"#)
    }

    func testToolResultCanFail() async {
        let conversation = makeConversation()
        let fake = FakeCardiaryService(historyPages: [nil: Fixtures.historyPage([])])
        await conversation.open(sessionId: "s1", service: fake)

        conversation.apply(frame: Fixtures.toolCall(toolCallId: "call-9"))
        conversation.apply(frame: Fixtures.toolResult(toolCallId: "call-9", status: .error, text: "讀不到檔案"))

        guard case .tool(let tool)? = conversation.items.first?.kind else {
            return XCTFail("應該有一列工具卡")
        }
        XCTAssertEqual(tool.status, .failed)
    }

    func testApprovalRequestedThenDecidedClears() async {
        let conversation = makeConversation()
        let fake = FakeCardiaryService(historyPages: [nil: Fixtures.historyPage([])])
        await conversation.open(sessionId: "s1", service: fake)

        let approval = Fixtures.approval()
        conversation.apply(frame: Fixtures.approvalRequested(approval))
        XCTAssertEqual(conversation.pendingApproval?.approvalId, "approval-1")

        conversation.apply(frame: Fixtures.approvalDecided(approval))
        XCTAssertNil(conversation.pendingApproval)
    }

    func testApprovalFromAnotherSessionIsIgnored() async {
        let conversation = makeConversation()
        let fake = FakeCardiaryService(historyPages: [nil: Fixtures.historyPage([])])
        await conversation.open(sessionId: "s1", service: fake)

        let approval = Fixtures.approval(sessionId: "other")
        conversation.apply(frame: Fixtures.approvalRequested(approval))
        XCTAssertNil(conversation.pendingApproval)
    }

    func testEventsFromAnotherSessionAreIgnored() async {
        let conversation = makeConversation()
        let fake = FakeCardiaryService(historyPages: [nil: Fixtures.historyPage([])])
        await conversation.open(sessionId: "s1", service: fake)

        conversation.apply(frame: Fixtures.delta("別的對話", sessionId: "other"))
        XCTAssertNil(conversation.streamingText)
    }

    func testSendClearsComposerAndAppendsUserMessage() async {
        let conversation = makeConversation()
        let fake = FakeCardiaryService(historyPages: [nil: Fixtures.historyPage([])])
        await conversation.open(sessionId: "s1", service: fake)

        conversation.composerText = "  我的筆記在哪裡？  "
        conversation.delivery = .steer
        await conversation.send()

        let sends = await fake.sends
        XCTAssertEqual(sends.map(\.delivery), [.steer])
        XCTAssertEqual(sends.map(\.text), ["我的筆記在哪裡？"])
        XCTAssertEqual(conversation.composerText, "")
        XCTAssertEqual(conversation.items.last?.id, "user-sent")
    }

    func testSendKeepsComposerOnFailure() async {
        let conversation = makeConversation()
        let fake = FakeCardiaryService(failure: .send)
        await conversation.open(sessionId: "s1", service: fake)

        conversation.composerText = "還沒送出的文字"
        await conversation.send()

        XCTAssertEqual(conversation.composerText, "還沒送出的文字")
        XCTAssertNotNil(conversation.errorMessage)
    }

    func testSendWithEmptyInputShowsNotice() async {
        let conversation = makeConversation()
        let fake = FakeCardiaryService()
        await conversation.open(sessionId: "s1", service: fake)

        conversation.composerText = "   "
        await conversation.send()

        XCTAssertNotNil(conversation.noticeMessage)
        let sends = await fake.sends
        XCTAssertTrue(sends.isEmpty)
    }

    func testInterruptCallsService() async {
        let conversation = makeConversation()
        let fake = FakeCardiaryService()
        await conversation.open(sessionId: "s1", service: fake)

        await conversation.interrupt()

        let count = await fake.interruptCalls
        XCTAssertEqual(count, 1)
    }

    func testSnapshotAppliesTitleStreamingAndApproval() async {
        let conversation = makeConversation()
        let summary = Fixtures.summary("s1", title: "從快照來的標題")
        let approval = Fixtures.approval()
        let streaming = StreamingMessage(
            messageId: "msg-9",
            turnId: "turn-2",
            text: "還沒寫完",
            startedAt: "2026-01-01T00:00:09Z"
        )
        let fake = FakeCardiaryService(
            snapshot: Fixtures.snapshot(
                session: summary,
                streaming: streaming,
                pendingApproval: approval
            )
        )

        await conversation.open(sessionId: "s1", service: fake)

        XCTAssertEqual(conversation.title, "從快照來的標題")
        XCTAssertEqual(conversation.streamingText, "還沒寫完")
        XCTAssertEqual(conversation.pendingApproval?.approvalId, "approval-1")
    }

    func testMarkDisconnectedDropsStreamingState() {
        let conversation = makeConversation()
        conversation.apply(frame: Fixtures.turnStarted())
        conversation.apply(frame: Fixtures.delta("寫到一半"))

        conversation.markDisconnected()

        XCTAssertNil(conversation.streamingText)
        XCTAssertNil(conversation.activeTurn)
    }

    func testHistoryToolEntriesRoundTrip() async {
        let fake = FakeCardiaryService(
            historyPages: [nil: SessionGetHistoryResponsePayload(
                entries: [Fixtures.toolEntry("t1", toolCallId: "call-1", output: "檔案內容")]
            )]
        )
        let conversation = makeConversation()
        await conversation.open(sessionId: "s1", service: fake)

        guard case .tool(let tool)? = conversation.items.first?.kind else {
            return XCTFail("歷史裡的工具訊息應該還原成工具卡")
        }
        XCTAssertEqual(tool.name, "read_file")
        XCTAssertEqual(tool.outputText, "檔案內容")
        XCTAssertEqual(tool.status, .complete)
    }
}
