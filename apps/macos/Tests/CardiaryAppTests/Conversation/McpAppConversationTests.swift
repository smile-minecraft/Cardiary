import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 產品接線的掛載時機：MCP App 區塊在串流完成前不掛起，完成才載入，
/// 同一份內容重複送達也不产生第二個 WebView。這是對話模型這一側的開關；
/// WebView 本身的 loadedHTML 去重由 McpAppWebViewTests 覆蓋。
@MainActor
final class McpAppConversationTests: XCTestCase {
    private func makeConversation() async -> ConversationModel {
        let model = ConversationModel()
        let fake = FakeCardiaryService(historyPages: [nil: Fixtures.historyPage([])])
        await model.open(sessionId: "s1", service: fake)
        return model
    }

    func testUiBlockFromStreamingToolIsNotReady() async {
        let conversation = await makeConversation()

        conversation.apply(frame: Fixtures.toolCall(toolCallId: "call-app"))
        conversation.apply(frame: uiFrame(toolCallId: "call-app", renderer: McpAppBlockContent.renderer))

        let block = appBlock(in: conversation)
        XCTAssertNotNil(block, "串流中的 MCP App 區塊仍要在畫面上")
        XCTAssertEqual(block?.isReady, false, "工具還在串流，不能掛載 WebView")
        XCTAssertEqual(block?.sourceToolCallId, "call-app")
    }

    func testToolResultFlipsUiBlockToReady() async {
        let conversation = await makeConversation()

        conversation.apply(frame: Fixtures.toolCall(toolCallId: "call-app"))
        conversation.apply(frame: uiFrame(toolCallId: "call-app", renderer: McpAppBlockContent.renderer))
        XCTAssertEqual(appBlock(in: conversation)?.isReady, false)

        conversation.apply(frame: Fixtures.toolResult(toolCallId: "call-app", status: .ok, text: "done"))

        XCTAssertEqual(appBlock(in: conversation)?.isReady, true, "工具結果送達才掛載")
    }

    func testTurnCompletionAlsoMarksAppBlockReady() async {
        let conversation = await makeConversation()

        // 沒有 toolCallId 的區塊靠回合完成解鎖。
        conversation.apply(frame: uiFrame(toolCallId: nil, renderer: McpAppBlockContent.renderer))
        XCTAssertEqual(appBlock(in: conversation)?.isReady, false)

        conversation.apply(frame: Fixtures.turnStarted())
        conversation.apply(frame: Fixtures.turnState(.completed))

        XCTAssertEqual(appBlock(in: conversation)?.isReady, true)
    }

    func testToolResultArrivingBeforeUiEventStillProducesReadyBlock() async {
        let conversation = await makeConversation()

        // 主機 genuine 順序是先 tool_result 再 stream.ui，
        // 所以 ui 事件送達時工具已完成，區塊應該直接是可掛載狀態。
        conversation.apply(frame: Fixtures.toolCall(toolCallId: "call-app"))
        conversation.apply(frame: Fixtures.toolResult(toolCallId: "call-app", status: .ok, text: "done"))
        conversation.apply(frame: uiFrame(toolCallId: "call-app", renderer: McpAppBlockContent.renderer))

        let block = appBlock(in: conversation)
        XCTAssertNotNil(block)
        XCTAssertEqual(block?.isReady, true, "工具已完成的 ui 區塊不該卡在載入中")
    }

    /// 非 MCP App renderer 不受影響，維持原本 isReady 預設值。
    func testNonAppUiBlockKeepsDefaultReady() async {
        let conversation = await makeConversation()

        conversation.apply(frame: uiFrame(toolCallId: nil, renderer: "table"))

        guard case .ui(let block)? = conversation.items.first?.kind else {
            return XCTFail("應該有一列 UI 區塊")
        }
        XCTAssertTrue(block.isReady, "原生 renderer 不受串流門檻影響")
    }

    // MARK: - 輔助

    private func appBlock(in conversation: ConversationModel) -> UiBlockPresentation? {
        for item in conversation.items {
            if case .ui(let block) = item.kind, block.renderer == McpAppBlockContent.renderer {
                return block
            }
        }
        return nil
    }

    private func uiFrame(
        toolCallId: String?,
        renderer: String,
        seq: Int = 8,
        html: String = "<!doctype html><html><body>app</body></html>"
    ) -> ServerFrame {
        let data: JSONValue = .object([
            "html": .string(html),
            "allowedHosts": .array([.string("api.example.com")]),
        ])
        return .streamUiEvent(StreamUiEvent(
            stream: "session:s1",
            seq: seq,
            emittedAt: "2026-01-01T00:00:08Z",
            payload: StreamUiEventPayload(
                sessionId: "s1",
                turnId: "turn-2",
                toolCallId: toolCallId,
                renderer: renderer,
                data: data
            )
        ))
    }
}
