import CardiaryKit
import Combine
import Foundation

/// 工具呼叫在畫面上的樣子：名稱、輸入摘要、結果與狀態。
public struct ToolCallPresentation: Equatable, Sendable {
    public let toolCallId: String
    public let name: String
    public var title: String?
    public var inputSummary: String
    public var outputText: String?
    public var status: MessageStatus
    public var diagnosticCount: Int

    public init(
        toolCallId: String,
        name: String,
        title: String? = nil,
        inputSummary: String = "",
        outputText: String? = nil,
        status: MessageStatus = .streaming,
        diagnosticCount: Int = 0
    ) {
        self.toolCallId = toolCallId
        self.name = name
        self.title = title
        self.inputSummary = inputSummary
        self.outputText = outputText
        self.status = status
        self.diagnosticCount = diagnosticCount
    }
}

/// `stream.ui` 帶來的結構化資料。畫面依 `renderer` 選一個原生呈現方式。
public struct UiBlockPresentation: Equatable, Sendable {
    public let id: String
    public let renderer: String
    public let data: JSONValue
    /// 產生這份內容的工具。工具結果送達（或回合結束）前不掛載網頁。
    public let sourceToolCallId: String?
    /// 來源串流是否完成。只有完成才把 HTML 掛進 WebView。
    public let isReady: Bool

    public init(
        id: String,
        renderer: String,
        data: JSONValue,
        sourceToolCallId: String? = nil,
        isReady: Bool = true
    ) {
        self.id = id
        self.renderer = renderer
        self.data = data
        self.sourceToolCallId = sourceToolCallId
        self.isReady = isReady
    }
}

/// 對話流的一列。訊息與工具結果依伺服器送來的順序排列。
public struct ConversationItem: Identifiable, Equatable, Sendable {
    public enum Kind: Equatable, Sendable {
        case userText(String)
        case assistantText(String, status: MessageStatus)
        case tool(ToolCallPresentation)
        case ui(UiBlockPresentation)
    }

    public let id: String
    public var kind: Kind

    public init(id: String, kind: Kind) {
        self.id = id
        self.kind = kind
    }
}

/// 一場對話的畫面狀態：可見範圍的訊息、進行中的文字、工具呼叫、待審批與分頁。
///
/// 規則：
/// - 開一場對話只載入最新一頁（`pageSize`），往回捲動才用 `nextCursor` 取得更早的訊息。
/// - 文字 delta 不推進游標、也不寫進歷史；`message_completed` 才把完整訊息放進列表。
/// - 重連時 `CardiaryClient` 會補送事件；epoch 換代則由 `reloadAfterEpoch` 重新載入。
@MainActor
public final class ConversationModel: ObservableObject {
    @Published public private(set) var sessionId: String?
    @Published public private(set) var title: String = ""
    @Published public private(set) var items: [ConversationItem] = []
    @Published public private(set) var streamingText: String?
    @Published public private(set) var streamingMessageId: String?
    /// 進行中助理訊息所屬的回合。引擎的增量訊息識別碼可能和完成後的訊息識別碼
    /// 不同（目前 Pi 轉接層就是如此），完成時用回合對回同一段草稿。
    private var streamingTurnId: String?
    @Published public private(set) var activeTurn: TurnState?
    @Published public private(set) var pendingApproval: ApprovalRequest?
    @Published public private(set) var isLoadingInitial = false
    @Published public private(set) var isLoadingOlder = false
    @Published public private(set) var hasMoreHistory = false
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?
    @Published public var composerText: String = ""
    @Published public var delivery: DeliveryMode = .queue
    @Published public private(set) var isSending = false
    @Published public private(set) var isResending = false

    public let pageSize: Int

    private var service: (any CardiaryService)?
    private var nextCursor: String?
    var onMessageSent: (@MainActor () async -> Void)?

    public init(pageSize: Int = 50) {
        self.pageSize = pageSize
    }

    public func attach(service: any CardiaryService) {
        self.service = service
    }

    public var isBusy: Bool {
        guard let activeTurn else { return false }
        return [.queued, .running, .waitingApproval].contains(activeTurn.state)
    }

    // MARK: - 開啟與分頁

    /// 開啟一場對話：訂閱事件、載入最新一頁，並記住更早訊息的游標。
    public func open(sessionId: String, title: String? = nil, service: (any CardiaryService)? = nil) async {
        if let service { self.service = service }
        guard let active = self.service else { return }

        self.sessionId = sessionId
        if let title, !title.isEmpty { self.title = title }
        resetVolatile()
        items = []
        nextCursor = nil
        hasMoreHistory = false
        errorMessage = nil
        isLoadingInitial = true
        defer { isLoadingInitial = false }

        do {
            let subscription = try await active.subscribeSession(sessionId: sessionId, historyLimit: nil)
            if let snapshot = subscription.snapshot, snapshot.session.id == sessionId {
                apply(snapshot: snapshot)
            }
        } catch {
            errorMessage = AppL10n.format(.conversationError, value: errorText(error))
        }

        await loadVisiblePage(service: active)
    }

    /// epoch 換代：丟掉只有舊 epoch 才有效的狀態，重新訂閱並載入最新一頁。
    public func reloadAfterEpoch(service: (any CardiaryService)? = nil) async {
        guard let sessionId else { return }
        if let service { self.service = service }
        await open(sessionId: sessionId)
    }

    /// 往回捲動：用上一次回應的游標取得更早的一頁，放在目前內容前面。
    public func loadOlder(service: (any CardiaryService)? = nil) async {
        if let service { self.service = service }
        guard let active = self.service, let sessionId, let cursor = nextCursor, !isLoadingOlder else { return }

        isLoadingOlder = true
        defer { isLoadingOlder = false }
        do {
            let page = try await active.getHistory(sessionId: sessionId, cursor: cursor, limit: pageSize)
            prepend(page.entries)
            nextCursor = page.nextCursor
            hasMoreHistory = page.nextCursor != nil
        } catch {
            errorMessage = AppL10n.format(.conversationError, value: errorText(error))
        }
    }

    private func loadVisiblePage(service: any CardiaryService) async {
        guard let sessionId else { return }
        do {
            let page = try await service.getHistory(sessionId: sessionId, cursor: nil, limit: pageSize)
            items = page.entries.map(Self.makeItem(from:))
            nextCursor = page.nextCursor
            hasMoreHistory = page.nextCursor != nil
        } catch {
            errorMessage = AppL10n.format(.conversationError, value: errorText(error))
        }
    }

    // MARK: - 送出、插話與中斷

    /// 送出輸入框的文字。成功後清空輸入框；失敗時保留文字，讓使用者重試。
    public func send(service: (any CardiaryService)? = nil) async {
        if let service { self.service = service }
        guard let active = self.service, let sessionId else { return }
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            noticeMessage = AppL10n.text(.conversationEmptyInput)
            return
        }

        isSending = true
        defer { isSending = false }
        let mode = delivery
        if await deliver(text: text, mode: mode, service: active, sessionId: sessionId) {
            composerText = ""
        }
    }

    /// 重送最後一則使用者訊息：原文、目前選的送達方式、新的 `clientMessageId`。
    /// 對話忙碌或正在送出時不做任何事。
    public func resendLastUserMessage(service: (any CardiaryService)? = nil) async {
        if let service { self.service = service }
        guard let active = self.service, let sessionId, canResendLastUserMessage else { return }
        guard let text = lastUserMessageText else { return }

        isResending = true
        defer { isResending = false }
        _ = await deliver(text: text, mode: delivery, service: active, sessionId: sessionId)
    }

    /// 最後一則使用者訊息的內容與列識別碼；重送使用者訊息的按鈕只掛在它旁邊。
    public var lastUserMessageText: String? {
        lastUserMessage.flatMap { item in
            if case .userText(let text) = item.kind {
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : trimmed
            }
            return nil
        }
    }

    public var lastUserMessageId: String? {
        lastUserMessage?.id
    }

    public var canResendLastUserMessage: Bool {
        !isBusy && !isSending && !isResending && lastUserMessageText != nil && service != nil && sessionId != nil
    }

    private var lastUserMessage: ConversationItem? {
        items.last { if case .userText = $0.kind { return true } else { return false } }
    }

    /// 送出一則訊息並更新畫面；成功回傳 true，失敗時保留錯誤訊息並回傳 false。
    private func deliver(
        text: String,
        mode: DeliveryMode,
        service active: any CardiaryService,
        sessionId: String
    ) async -> Bool {
        do {
            let response = try await active.sendMessage(
                sessionId: sessionId,
                text: text,
                delivery: mode,
                clientMessageId: ClientRequestID.next("msg")
            )
            noticeMessage = nil
            upsertUserMessage(id: response.userMessageId, text: text)
            await onMessageSent?()
            switch response.disposition {
            case .queued:
                noticeMessage = AppL10n.text(.conversationDeliveryQueue)
            case .interruptedThenStarted:
                noticeMessage = AppL10n.text(.conversationInterrupt)
            case .started:
                break
            }
            return true
        } catch {
            errorMessage = AppL10n.format(.conversationError, value: errorText(error))
            return false
        }
    }

    public func interrupt(service: (any CardiaryService)? = nil) async {
        if let service { self.service = service }
        guard let active = self.service, let sessionId else { return }
        do {
            _ = try await active.interruptSession(sessionId: sessionId, reason: "user")
        } catch {
            errorMessage = AppL10n.format(.conversationError, value: errorText(error))
        }
    }

    public func dismissMessages() {
        errorMessage = nil
        noticeMessage = nil
    }

    /// 連線中斷：進行中的狀態不再可信，等重連後由快照補回。
    public func markDisconnected() {
        streamingText = nil
        streamingMessageId = nil
        streamingTurnId = nil
        activeTurn = nil
    }

    public func clear() {
        sessionId = nil
        title = ""
        items = []
        nextCursor = nil
        hasMoreHistory = false
        resetVolatile()
        errorMessage = nil
        noticeMessage = nil
    }

    // MARK: - 事件

    /// 套用一則會話事件。不屬於目前對話的事件直接忽略。
    public func apply(frame: ServerFrame) {
        guard let sessionId, frame.sessionStream == "session:\(sessionId)" else { return }

        switch frame {
        case .streamTurnStartedEvent(let event):
            activeTurn = TurnState(
                turnId: event.payload.turnId,
                state: .running,
                startedAt: event.payload.startedAt
            )
            streamingText = nil
            streamingMessageId = nil
            streamingTurnId = nil

        case .streamTextDeltaEvent(let event):
            if streamingMessageId == event.payload.messageId {
                streamingText = (streamingText ?? "") + event.payload.delta
            } else {
                streamingMessageId = event.payload.messageId
                streamingText = event.payload.delta
            }
            streamingTurnId = event.payload.turnId

        case .streamMessageCompletedEvent(let event):
            let entry = event.payload.entry
            upsert(ConversationItem(
                id: entry.id,
                kind: .assistantText(entry.text, status: entry.status)
            ))
            if streamingMessageId == entry.id || streamingTurnId == event.payload.turnId {
                streamingText = nil
                streamingMessageId = nil
                streamingTurnId = nil
            }

        case .streamToolCallEvent(let event):
            let payload = event.payload
            upsert(ConversationItem(
                id: "tool:\(payload.toolCallId)",
                kind: .tool(ToolCallPresentation(
                    toolCallId: payload.toolCallId,
                    name: payload.name,
                    title: payload.title,
                    inputSummary: JSONText.compact(payload.input, limit: 320),
                    status: .streaming
                ))
            ))

        case .streamToolResultEvent(let event):
            let payload = event.payload
            let status: MessageStatus = payload.status == .ok ? .complete : .failed
            let output = payload.output.text ?? payload.output.data.map { JSONText.compact($0, limit: 800) }
            updateTool(toolCallId: payload.toolCallId) { tool in
                tool.status = status
                tool.outputText = output
                tool.diagnosticCount = payload.diagnostics.count
            }
            // 工具結果送達就代表串流完成；把綁在這個工具上的 UI 區塊標為可掛載。
            markUiReady(toolCallId: payload.toolCallId)

        case .streamTurnStateEvent(let event):
            activeTurn = event.payload
            // 回合結束也是一道保險：即使工具結果事件漏接，完成的回合不該留著空白佔位。
            if event.payload.state == .completed || event.payload.state == .failed {
                markUiReady(turnId: event.payload.turnId)
            }

        case .streamUiEvent(let event):
            let payload = event.payload
            let id = "ui:\(payload.toolCallId ?? payload.turnId):\(payload.renderer):\(items.count)"
            // 只有 MCP App 會掛載 WebView，才需要等串流完成。原生 renderer 立即顯示。
            let isApp = payload.renderer == McpAppBlockContent.renderer
            let ready = !isApp
                || toolIsComplete(toolCallId: payload.toolCallId)
                || (payload.toolCallId == nil && turnIsComplete(turnId: payload.turnId))
            upsert(ConversationItem(
                id: id,
                kind: .ui(UiBlockPresentation(
                    id: id,
                    renderer: payload.renderer,
                    data: payload.data,
                    sourceToolCallId: payload.toolCallId,
                    isReady: ready
                ))
            ))

        case .approvalRequestedEvent(let event):
            guard event.payload.sessionId == sessionId else { return }
            pendingApproval = event.payload

        case .approvalDecidedEvent(let event):
            if pendingApproval?.approvalId == event.payload.approvalId {
                pendingApproval = nil
            }

        default:
            break
        }
    }

    /// 訂閱回應帶來的快照：標題、進行中的文字、回合與待審批。
    public func apply(snapshot: SessionSnapshot) {
        if snapshot.session.id == sessionId {
            title = snapshot.session.title
        }
        activeTurn = snapshot.activeTurn
        pendingApproval = snapshot.pendingApproval
        if let streaming = snapshot.streaming {
            streamingMessageId = streaming.messageId
            streamingTurnId = streaming.turnId
            streamingText = streaming.text
        } else {
            streamingMessageId = nil
            streamingTurnId = nil
            streamingText = nil
        }
    }

    // MARK: - 內部

    private func resetVolatile() {
        streamingText = nil
        streamingMessageId = nil
        streamingTurnId = nil
        activeTurn = nil
        pendingApproval = nil
    }

    private func upsert(_ item: ConversationItem) {
        if let index = items.firstIndex(where: { $0.id == item.id }) {
            items[index] = item
        } else {
            items.append(item)
        }
    }

    private func upsertUserMessage(id: String, text: String) {
        upsert(ConversationItem(id: id, kind: .userText(text)))
    }

    private func updateTool(toolCallId: String, _ update: (inout ToolCallPresentation) -> Void) {
        guard let index = items.firstIndex(where: {
            if case .tool(let tool) = $0.kind { return tool.toolCallId == toolCallId }
            return false
        }) else { return }
        guard case .tool(var tool) = items[index].kind else { return }
        update(&tool)
        items[index].kind = .tool(tool)
    }

    private func toolIsComplete(toolCallId: String?) -> Bool {
        guard let toolCallId else { return false }
        return items.contains { item in
            if case .tool(let tool) = item.kind {
                return tool.toolCallId == toolCallId && tool.status == .complete
            }
            return false
        }
    }

    private func turnIsComplete(turnId: String) -> Bool {
        guard let activeTurn, activeTurn.turnId == turnId else { return false }
        return [.completed, .failed, .interrupted].contains(activeTurn.state)
    }

    /// 把綁在同一個工具（或回合）上的 UI 區塊標為可掛載。
    private func markUiReady(toolCallId: String? = nil, turnId: String? = nil) {
        for index in items.indices {
            guard case .ui(let block) = items[index].kind, !block.isReady else { continue }
            let matches: Bool
            if let toolCallId {
                matches = block.sourceToolCallId == toolCallId
            } else if let turnId {
                matches = block.sourceToolCallId == nil && block.id.hasPrefix("ui:\(turnId):")
            } else {
                matches = false
            }
            if matches {
                let ready = UiBlockPresentation(
                    id: block.id,
                    renderer: block.renderer,
                    data: block.data,
                    sourceToolCallId: block.sourceToolCallId,
                    isReady: true
                )
                items[index].kind = .ui(ready)
            }
        }
    }

    private func prepend(_ entries: [TranscriptEntry]) {
        let existing = Set(items.map(\.id))
        let older = entries.map(Self.makeItem(from:)).filter { !existing.contains($0.id) }
        guard !older.isEmpty else { return }
        items.insert(contentsOf: older, at: 0)
    }

    private func errorText(_ error: any Error) -> String {
        (error as? CardiaryClientError)?.errorDescription ?? "\(error)"
    }

    static func makeItem(from entry: TranscriptEntry) -> ConversationItem {
        switch entry {
        case .userTranscriptEntry(let value):
            return ConversationItem(id: value.id, kind: .userText(value.text))
        case .assistantTranscriptEntry(let value):
            return ConversationItem(id: value.id, kind: .assistantText(value.text, status: value.status))
        case .toolTranscriptEntry(let value):
            let output = value.output?.text ?? value.output?.data.map { JSONText.compact($0, limit: 800) }
            return ConversationItem(
                id: value.id,
                kind: .tool(ToolCallPresentation(
                    toolCallId: value.toolCallId,
                    name: value.name,
                    title: nil,
                    inputSummary: JSONText.compact(value.input, limit: 320),
                    outputText: output,
                    status: value.status,
                    diagnosticCount: value.diagnostics.count
                ))
            )
        }
    }
}

extension ServerFrame {
    /// 這一則事件屬於哪一個會話串流。回應與系統事件回 nil。
    var sessionStream: String? {
        switch self {
        case .streamTurnStartedEvent(let frame): return frame.stream
        case .streamTextDeltaEvent(let frame): return frame.stream
        case .streamMessageCompletedEvent(let frame): return frame.stream
        case .streamToolCallEvent(let frame): return frame.stream
        case .streamToolResultEvent(let frame): return frame.stream
        case .streamTurnStateEvent(let frame): return frame.stream
        case .streamUiEvent(let frame): return frame.stream
        case .approvalRequestedEvent(let frame): return frame.stream
        case .approvalDecidedEvent(let frame): return frame.stream
        case .sessionArchivedEvent(let frame): return frame.stream
        case .sessionUnarchivedEvent(let frame): return frame.stream
        case .sessionDeletedEvent(let frame): return frame.stream
        default: return nil
        }
    }
}
