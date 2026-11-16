import CardiaryKit
import Combine
import Foundation

/// 白板畫面需要的請求。`CardiaryClient` 已經實作；測試換成假的即可。
public protocol BoardService: Sendable {
    func listBoards() async throws -> BoardListResponsePayload
    func getBoard(boardId: String) async throws -> BoardGetResponsePayload
    func createBoard(
        boardId: String,
        title: String,
        clientRequestId: String
    ) async throws -> BoardCreateResponsePayload
    func saveBoard(
        board: BoardDocument,
        baseUpdatedAt: String,
        clientRequestId: String?
    ) async throws -> BoardSaveResponsePayload
    func deleteBoard(boardId: String) async throws -> BoardDeleteResponsePayload
    func projectCardOnBoard(
        boardId: String,
        itemId: String,
        cardId: String,
        position: BoardPoint,
        size: BoardSize?,
        groupId: String?,
        pinned: Bool?
    ) async throws -> BoardProjectCardResponsePayload
    func unprojectCardOnBoard(
        boardId: String,
        itemId: String
    ) async throws -> BoardUnprojectCardResponsePayload
    func createCardFromSelection(
        boardId: String,
        cardIds: [String],
        title: String,
        body: String,
        itemId: String,
        position: BoardPoint,
        clientRequestId: String
    ) async throws -> BoardCreateCardFromSelectionResponsePayload
}

extension CardiaryClient: BoardService {}

/// 產生 ULID 形式的識別碼；只用在沒有主機配號的地方（新白板、新投影）。
public enum BoardIdentifiers {
    private static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")
    private static let lock = NSLock()

    public static func make(at date: Date = Date()) -> String {
        lock.lock()
        defer { lock.unlock() }
        var time = UInt64(date.timeIntervalSince1970 * 1000)
        var timeCharacters = [Character](repeating: "0", count: 10)
        for index in (0..<10).reversed() {
            timeCharacters[index] = alphabet[Int(time % 32)]
            time = time / 32
        }
        var random = [UInt8](repeating: 0, count: 16)
        for index in random.indices {
            random[index] = UInt8.random(in: 0...255)
        }
        var randomCharacters: [Character] = []
        var buffer: UInt32 = 0
        var bits = 0
        for byte in random {
            buffer = (buffer << 8) | UInt32(byte)
            bits += 8
            while bits >= 5 {
                bits -= 5
                randomCharacters.append(alphabet[Int((buffer >> UInt32(bits)) & 0x1F)])
            }
        }
        if bits > 0 {
            randomCharacters.append(alphabet[Int((buffer << UInt32(5 - bits)) & 0x1F)])
        }
        return String(timeCharacters + randomCharacters.prefix(16))
    }
}

/// 白板畫面的狀態：清單、目前白板、收件區、畫布與存回。
///
/// 畫布只保存本機手勢的復原堆疊；每次手勢結束就整份存回主機。主機回報
/// `conflict` 時不覆蓋主機版本，改為重新載入並提示使用者。
@MainActor
public final class BoardModel: ObservableObject, AppContentModel {
    public struct CardInfo: Equatable, Sendable {
        public let title: String
        public let kind: CardKind
        public let freshness: Int
    }

    @Published public private(set) var boards: [BoardSummary] = []
    @Published public private(set) var selectedBoardId: String?
    @Published public private(set) var board: BoardDocument?
    @Published public var canvas = BoardCanvas()
    @Published public private(set) var cardInfo: [String: CardInfo] = [:]
    @Published public private(set) var isLoading = false
    @Published public private(set) var isSaving = false
    @Published public private(set) var isCreatingCard = false
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?
    @Published public private(set) var conflictMessage: String?

    /// 目前選取的對話；由掛載點提供，白板不自己管對話選擇。
    public var selectedConversationId: @MainActor () -> String? = { nil }

    private var service: (any BoardService)?
    private var cardService: (any CardService)?
    private var contextService: (any ContextService)?
    private var baseUpdatedAt: String?
    private var loadGeneration = 0

    public init(
        boardService: (any BoardService)? = nil,
        cardService: (any CardService)? = nil,
        contextService: (any ContextService)? = nil
    ) {
        self.service = boardService
        self.cardService = cardService
        self.contextService = contextService
    }

    public var inbox: [BoardItem] { board?.inbox ?? [] }
    public var isServiceAvailable: Bool { service != nil }
    public var selectedCardIds: [String] {
        canvas.selectedItems.map(\.cardId)
    }
    public var selectionCount: Int { canvas.selectedIds.count }

    // MARK: - AppContentModel

    public func attach(service: any CardiaryService) {
        self.service = service as? any BoardService
        self.cardService = service as? any CardService
        self.contextService = service as? any ContextService
        Task { await reload() }
    }

    public func detach() {
        service = nil
        cardService = nil
        contextService = nil
    }

    public func handle(event frame: ServerFrame) {
        guard case .boardChangedEvent(let event) = frame else { return }
        apply(event: event.payload)
    }

    public func handleEpochChange(epoch: String) async {
        await reload()
    }

    public func refresh() async {
        await reload()
    }

    // MARK: - 載入

    public func reload() async {
        guard let service else {
            errorMessage = BoardL10n.text(.boardsServiceUnavailable)
            return
        }
        loadGeneration += 1
        let generation = loadGeneration
        isLoading = true
        defer { if generation == loadGeneration { isLoading = false } }
        do {
            let response = try await service.listBoards()
            guard generation == loadGeneration else { return }
            boards = response.boards.sorted { $0.updatedAt > $1.updatedAt }
            if let selectedBoardId, boards.contains(where: { $0.id == selectedBoardId }) {
                await open(selectedBoardId, generation: generation)
            } else if let first = boards.first {
                await open(first.id, generation: generation)
            } else {
                self.selectedBoardId = nil
                board = nil
                baseUpdatedAt = nil
                canvas = BoardCanvas()
            }
            errorMessage = nil
        } catch {
            guard generation == loadGeneration else { return }
            errorMessage = BoardL10n.format(.boardsLoadFailed, value: error.localizedDescription)
        }
    }

    public func open(_ boardId: String) async {
        loadGeneration += 1
        await open(boardId, generation: loadGeneration)
    }

    private func open(_ boardId: String, generation: Int) async {
        guard let service else { return }
        do {
            let response = try await service.getBoard(boardId: boardId)
            guard generation == loadGeneration else { return }
            selectedBoardId = boardId
            apply(document: response.board)
            errorMessage = nil
        } catch {
            guard generation == loadGeneration else { return }
            errorMessage = BoardL10n.format(.boardsLoadFailed, value: error.localizedDescription)
        }
    }

    // MARK: - 建立與刪除

    public func createBoard(title: String) async {
        guard let service else { return }
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            let response = try await service.createBoard(
                boardId: BoardIdentifiers.make(),
                title: trimmed,
                clientRequestId: BoardIdentifiers.make()
            )
            selectedBoardId = response.board.id
            apply(document: response.board)
            await reload()
            noticeMessage = BoardL10n.text(.boardsCreated)
            errorMessage = nil
        } catch {
            errorMessage = BoardL10n.format(.boardsLoadFailed, value: error.localizedDescription)
        }
    }

    public func deleteCurrentBoard() async {
        guard let service, let board else { return }
        do {
            _ = try await service.deleteBoard(boardId: board.id)
            self.board = nil
            baseUpdatedAt = nil
            selectedBoardId = nil
            canvas = BoardCanvas()
            noticeMessage = BoardL10n.text(.boardsDeleted)
            await reload()
        } catch {
            errorMessage = BoardL10n.format(.boardsLoadFailed, value: error.localizedDescription)
        }
    }

    // MARK: - 存回

    /// 把畫布上的位置、大小與釘選寫回整份白板。手勢結束時呼叫一次。
    public func saveCanvas() async {
        guard let service, let current = board, let baseUpdatedAt else { return }
        let items = current.items.compactMap { original -> BoardItem? in
            guard let value = canvas.item(original.id) else { return nil }
            return BoardItem(
                id: original.id,
                cardId: original.cardId,
                position: BoardPoint(
                    x: max(0, Int(value.frame.minX.rounded())),
                    y: max(0, Int(value.frame.minY.rounded()))
                ),
                size: BoardSize(
                    width: max(1, Int(value.frame.width.rounded())),
                    height: max(1, Int(value.frame.height.rounded()))
                ),
                pinned: value.pinned,
                origin: original.origin,
                projectedBy: original.projectedBy,
                groupId: original.groupId
            )
        }
        let document = BoardDocument(
            id: current.id,
            title: current.title,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt,
            items: items,
            inbox: current.inbox,
            edges: current.edges,
            groups: current.groups
        )
        isSaving = true
        defer { isSaving = false }
        do {
            let response = try await service.saveBoard(
                board: document,
                baseUpdatedAt: baseUpdatedAt,
                clientRequestId: BoardIdentifiers.make()
            )
            apply(document: response.board, preserveSelection: true)
            conflictMessage = nil
            errorMessage = nil
        } catch {
            if Self.isConflict(error), let boardId = board?.id {
                conflictMessage = BoardL10n.text(.boardsConflict)
                await open(boardId)
            } else {
                errorMessage = BoardL10n.format(.boardsProjectFailed, value: error.localizedDescription)
            }
        }
    }

    // MARK: - 投影與收件區

    /// 把卡片庫的卡片投影到畫布；拖放與選單都走這裡。
    public func project(cardIds: [String], at point: BoardPoint? = nil) async {
        guard let service, let board else { return }
        let origin = point ?? BoardPoint(
            x: max(0, Int(canvas.visibleBoardRect.minX.rounded()) + 40),
            y: max(0, Int(canvas.visibleBoardRect.minY.rounded()) + 40)
        )
        do {
            var latest = board
            for (offset, cardId) in cardIds.enumerated() {
                let response = try await service.projectCardOnBoard(
                    boardId: board.id,
                    itemId: BoardIdentifiers.make(),
                    cardId: cardId,
                    position: BoardPoint(x: origin.x, y: origin.y + offset * 180),
                    size: nil,
                    groupId: nil,
                    pinned: false
                )
                latest = response.board
            }
            apply(document: latest)
            errorMessage = nil
        } catch {
            errorMessage = BoardL10n.format(.boardsProjectFailed, value: error.localizedDescription)
        }
    }

    public func unproject(itemId: String) async {
        guard let service, let board else { return }
        do {
            let response = try await service.unprojectCardOnBoard(boardId: board.id, itemId: itemId)
            apply(document: response.board, preserveSelection: true)
            errorMessage = nil
        } catch {
            errorMessage = BoardL10n.format(.boardsProjectFailed, value: error.localizedDescription)
        }
    }

    /// 收件區的投影移到畫布；這是人類的整理動作，所以投影者改成使用者。
    public func moveInboxItemToCanvas(itemId: String) async {
        guard let current = board, let item = current.inbox.first(where: { $0.id == itemId }) else { return }
        let moved = BoardItem(
            id: item.id,
            cardId: item.cardId,
            position: BoardPoint(x: item.position.x, y: item.position.y),
            size: item.size,
            pinned: item.pinned,
            origin: .canvas,
            projectedBy: .user,
            groupId: item.groupId
        )
        board = BoardDocument(
            id: current.id,
            title: current.title,
            createdAt: current.createdAt,
            updatedAt: current.updatedAt,
            items: current.items + [moved],
            inbox: current.inbox.filter { $0.id != itemId },
            edges: current.edges,
            groups: current.groups
        )
        applyCanvasItems()
        await saveCanvas()
    }

    // MARK: - 畫布動作

    public func align(_ alignment: BoardCanvas.Alignment) {
        guard canvas.alignSelected(alignment) else { return }
        Task { await saveCanvas() }
    }

    public func togglePinSelected() {
        guard let first = canvas.selectedItems.first else { return }
        _ = canvas.togglePinned(first.id)
        Task { await saveCanvas() }
    }

    public func undo() {
        guard canvas.undo() else { return }
        Task { await saveCanvas() }
    }

    public func redo() {
        guard canvas.redo() else { return }
        Task { await saveCanvas() }
    }

    public func zoomIn() {
        canvas.zoom(by: 1.25, anchorScreen: BoardCanvasPoint(x: canvas.viewport.x / 2, y: canvas.viewport.y / 2))
    }

    public func zoomOut() {
        canvas.zoom(by: 0.8, anchorScreen: BoardCanvasPoint(x: canvas.viewport.x / 2, y: canvas.viewport.y / 2))
    }

    public func zoomToFit() {
        canvas.zoomToFit()
    }

    // MARK: - 圈選後的行動

    public func sendSelectionToConversation() async {
        guard let contextService else { return }
        guard let conversationId = selectedConversationId() else {
            errorMessage = BoardL10n.text(.boardsSendUnavailable)
            return
        }
        let cardIds = selectedCardIds
        guard !cardIds.isEmpty else { return }
        do {
            for cardId in cardIds {
                _ = try await contextService.addCardToContext(sessionId: conversationId, cardId: cardId)
            }
            noticeMessage = BoardL10n.count(.boardsSentToConversation, count: cardIds.count)
            errorMessage = nil
        } catch {
            errorMessage = BoardL10n.format(.boardsProjectFailed, value: error.localizedDescription)
        }
    }

    /// 用圈選的卡片生成一張新卡，血緣由主機記錄。
    public func createCardFromSelection(title: String, body: String) async {
        guard let service, let board else { return }
        let cardIds = selectedCardIds
        guard !cardIds.isEmpty else { return }
        isCreatingCard = true
        defer { isCreatingCard = false }
        let bounds = canvas.selectedItems.reduce(canvas.visibleBoardRect) { partial, item in
            partial.union(item.frame)
        }
        do {
            let response = try await service.createCardFromSelection(
                boardId: board.id,
                cardIds: cardIds,
                title: title,
                body: body,
                itemId: BoardIdentifiers.make(),
                position: BoardPoint(
                    x: max(0, Int(bounds.minX.rounded())),
                    y: max(0, Int(bounds.maxY.rounded()) + 40)
                ),
                clientRequestId: BoardIdentifiers.make()
            )
            apply(document: response.board, preserveSelection: true)
            noticeMessage = BoardL10n.text(.boardsCardCreated)
            errorMessage = nil
        } catch {
            errorMessage = BoardL10n.format(.boardsProjectFailed, value: error.localizedDescription)
        }
    }

    // MARK: - 套用主機資料

    private func apply(document: BoardDocument, preserveSelection: Bool = false) {
        board = document
        baseUpdatedAt = document.updatedAt
        selectedBoardId = document.id
        if let summaryIndex = boards.firstIndex(where: { $0.id == document.id }) {
            boards[summaryIndex] = BoardSummary(
                id: document.id,
                title: document.title,
                updatedAt: document.updatedAt,
                itemCount: document.items.count
            )
        }
        applyCanvasItems()
        Task { await loadCardInfoIfNeeded() }
    }

    private func apply(event payload: BoardChangedEventPayload) {
        if payload.change == .deleted {
            boards.removeAll { $0.id == payload.boardId }
            if selectedBoardId == payload.boardId {
                selectedBoardId = nil
                board = nil
                baseUpdatedAt = nil
                canvas = BoardCanvas()
            }
            return
        }
        guard let document = payload.board else {
            Task { await reload() }
            return
        }
        if let index = boards.firstIndex(where: { $0.id == document.id }) {
            boards[index] = BoardSummary(
                id: document.id,
                title: document.title,
                updatedAt: document.updatedAt,
                itemCount: document.items.count
            )
        } else {
            boards.append(BoardSummary(
                id: document.id,
                title: document.title,
                updatedAt: document.updatedAt,
                itemCount: document.items.count
            ))
        }
        guard document.id == selectedBoardId else { return }
        apply(document: document)
    }

    private func applyCanvasItems() {
        guard let board else {
            canvas = BoardCanvas()
            return
        }
        let selected = canvas.selectedIds
        canvas = BoardCanvas(
            items: board.items.map(Self.canvasItem),
            viewport: canvas.viewport
        )
        canvas.setSelection(selected)
        canvas.zoomToFit()
    }

    private static func canvasItem(_ item: BoardItem) -> BoardCanvasItem {
        BoardCanvasItem(
            id: item.id,
            cardId: item.cardId,
            frame: BoardRect(
                x: Double(item.position.x),
                y: Double(item.position.y),
                width: Double(item.size.width),
                height: Double(item.size.height)
            ),
            pinned: item.pinned
        )
    }

    private func loadCardInfoIfNeeded() async {
        guard let cardService else { return }
        let missing = canvas.items.map(\.cardId).filter { cardInfo[$0] == nil }
        guard !missing.isEmpty else { return }
        do {
            let page = try await cardService.listCards(
                kinds: nil,
                tags: nil,
                persona: nil,
                lifecycle: nil,
                query: nil,
                includeSuperseded: nil,
                cursor: nil,
                limit: 500
            )
            var updated = cardInfo
            for summary in page.cards {
                updated[summary.cardId] = CardInfo(
                    title: summary.title,
                    kind: summary.kind,
                    freshness: summary.freshness
                )
            }
            cardInfo = updated
        } catch {
            // 卡片標題載不到不影響白板本身；維持顯示識別碼。
        }
    }

    public func title(for item: BoardCanvasItem) -> String {
        cardInfo[item.cardId]?.title ?? String(item.cardId.suffix(6))
    }

    public func freshness(for item: BoardCanvasItem) -> Int {
        cardInfo[item.cardId]?.freshness ?? 100
    }

    public func kind(for item: BoardCanvasItem) -> CardKind {
        cardInfo[item.cardId]?.kind ?? .note
    }

    private static func isConflict(_ error: Error) -> Bool {
        guard let clientError = error as? CardiaryClientError,
              case .server(let frame) = clientError
        else { return false }
        return frame.code == .conflict
    }
}
