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

    /// 白板上可以送進的對話清單；由掛載點讀目前看得到的對話。
    public var conversationTargets: @MainActor () -> [ConversationTarget] = { [] }

    /// 建立一場新對話並回傳識別碼；由掛載點接到 `AppModel.createConversation()`。
    public var createConversation: @MainActor () async -> String? = { nil }

    /// 刪掉剛剛建立、還沒送成內容的對話；由掛載點接到主機的刪除流程。
    public var deleteConversation: @MainActor (String) async -> Void = { _ in }

    /// 白板頁面可以選擇的對話。
    public struct ConversationTarget: Identifiable, Equatable, Sendable {
        public let id: String
        public let title: String

        public init(id: String, title: String) {
            self.id = id
            self.title = title
        }
    }

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
        await commitCanvas { $0 }
    }

    /// 把目前的畫布狀態併進整份文件，交給 `transform` 調整後存回主機。
    ///
    /// 連線與分組沒有獨立的協定指令，只能在這裡跟著整份文件送回去；
    /// 衝突與失敗沿用 `saveCanvas` 既有的處理。回傳是否存成功。
    @discardableResult
    private func commitCanvas(_ transform: (BoardDocument) -> BoardDocument) async -> Bool {
        guard let service, let baseUpdatedAt, let current = board else { return false }
        let items = current.items.compactMap { original -> BoardItem? in
            guard let value = canvas.item(original.id) else { return nil }
            return Self.updatedItem(original, frame: value.frame, pinned: value.pinned)
        }
        let document = transform(
            BoardDocument(
                schema: current.schema,
                id: current.id,
                title: current.title,
                createdAt: current.createdAt,
                updatedAt: current.updatedAt,
                items: items,
                inbox: current.inbox,
                edges: current.edges,
                groups: current.groups
            )
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
            return true
        } catch {
            if Self.isConflict(error), let boardId = board?.id {
                conflictMessage = BoardL10n.text(.boardsConflict)
                await open(boardId)
            } else {
                errorMessage = BoardL10n.format(.boardsProjectFailed, value: error.localizedDescription)
            }
            return false
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

    public func togglePinSelected() async {
        guard !canvas.selectedIds.isEmpty else { return }
        // 混合狀態時先全部釘選；全部已釘選才一起取消。
        let pinned = !canvas.selectedItems.allSatisfy(\.pinned)
        guard canvas.setPinned(canvas.selectedIds, pinned: pinned) else { return }
        await saveCanvas()
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

    // MARK: - 連線與分組

    /// 在畫布上的兩個投影之間建立連線。端點必須是這張白板的畫布投影，
    /// 同一個方向的連線不重複建立；被拒絕時不送主機。
    @discardableResult
    public func createEdge(from: String, to: String) async -> Bool {
        guard from != to,
              let current = board,
              current.items.contains(where: { $0.id == from }),
              current.items.contains(where: { $0.id == to })
        else {
            errorMessage = BoardL10n.text(.boardsEdgeInvalid)
            return false
        }
        if current.edges.contains(where: { Self.connects($0, from: from, to: to) }) {
            errorMessage = BoardL10n.text(.boardsEdgeDuplicate)
            return false
        }
        let edge = BoardEdge(id: BoardIdentifiers.make(), from: from, to: to)
        let saved = await commitCanvas { document in
            Self.updated(document, edges: document.edges + [edge])
        }
        if saved {
            noticeMessage = BoardL10n.text(.boardsEdgeCreated)
        }
        return saved
    }

    /// 圈選剛好兩張卡時建立連線。
    @discardableResult
    public func createEdgeBetweenSelection() async -> Bool {
        let ids = Array(canvas.selectedIds)
        guard ids.count == 2 else {
            errorMessage = BoardL10n.text(.boardsEdgeNeedsSelection)
            return false
        }
        return await createEdge(from: ids[0], to: ids[1])
    }

    @discardableResult
    public func deleteEdge(_ edgeId: String) async -> Bool {
        guard let current = board, current.edges.contains(where: { $0.id == edgeId }) else {
            return false
        }
        let saved = await commitCanvas { document in
            Self.updated(document, edges: document.edges.filter { $0.id != edgeId })
        }
        if saved {
            noticeMessage = BoardL10n.text(.boardsEdgeDeleted)
        }
        return saved
    }

    /// 建立分組並把指定的投影歸進去；沒指定就用目前的選取。
    @discardableResult
    public func createGroup(label: String, itemIds: [String]? = nil) async -> Bool {
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = BoardL10n.text(.boardsGroupNameRequired)
            return false
        }
        guard let current = board else { return false }
        let ids = Set(itemIds ?? Array(canvas.selectedIds))
        guard ids.count >= 2 else {
            errorMessage = BoardL10n.text(.boardsGroupNeedsSelection)
            return false
        }
        guard ids.isSubset(of: Set(current.items.map(\.id))) else {
            errorMessage = BoardL10n.text(.boardsGroupInvalidItems)
            return false
        }
        let group = BoardGroup(id: BoardIdentifiers.make(), label: trimmed)
        let saved = await commitCanvas { document in
            Self.updated(
                document,
                items: document.items.map { ids.contains($0.id) ? Self.assigning(group.id, to: $0) : $0 },
                groups: document.groups + [group]
            )
        }
        if saved {
            noticeMessage = BoardL10n.format(
                .boardsGroupCreated,
                ["count": "\(ids.count)", "label": trimmed]
            )
        }
        return saved
    }

    /// 把指定的投影歸進既有分組。
    @discardableResult
    public func assignItems(_ itemIds: [String], toGroup groupId: String) async -> Bool {
        guard let current = board,
              let group = current.groups.first(where: { $0.id == groupId })
        else {
            errorMessage = BoardL10n.text(.boardsGroupInvalidItems)
            return false
        }
        let ids = Set(itemIds)
        guard !ids.isEmpty, ids.isSubset(of: Set(current.items.map(\.id))) else {
            errorMessage = BoardL10n.text(.boardsGroupInvalidItems)
            return false
        }
        let saved = await commitCanvas { document in
            Self.updated(
                document,
                items: document.items.map { ids.contains($0.id) ? Self.assigning(groupId, to: $0) : $0 }
            )
        }
        if saved {
            noticeMessage = BoardL10n.format(
                .boardsGroupCreated,
                ["count": "\(ids.count)", "label": group.label]
            )
        }
        return saved
    }

    /// 把目前選取的投影移出它們所屬的分組；卡片留在畫布上。
    @discardableResult
    public func removeSelectionFromGroup() async -> Bool {
        await removeItemsFromGroup(Array(canvas.selectedIds))
    }

    /// 把指定的投影移出分組；卡片留在畫布上。
    @discardableResult
    public func removeItemsFromGroup(_ itemIds: [String]) async -> Bool {
        guard let current = board else { return false }
        let ids = Set(itemIds).intersection(current.items.map(\.id))
        guard !ids.isEmpty else { return false }
        let saved = await commitCanvas { document in
            Self.updated(
                document,
                items: document.items.map { ids.contains($0.id) ? Self.assigning(nil, to: $0) : $0 }
            )
        }
        if saved {
            noticeMessage = BoardL10n.count(.boardsRemovedFromGroup, count: ids.count)
        }
        return saved
    }

    /// 移除分組：卡片留在畫布上，只解除歸屬；子分組改掛回最上層。
    @discardableResult
    public func deleteGroup(_ groupId: String) async -> Bool {
        guard let current = board, current.groups.contains(where: { $0.id == groupId }) else {
            return false
        }
        let saved = await commitCanvas { document in
            Self.updated(
                document,
                items: document.items.map { $0.groupId == groupId ? Self.assigning(nil, to: $0) : $0 },
                groups: document.groups
                    .filter { $0.id != groupId }
                    .map { $0.parentId == groupId ? BoardGroup(id: $0.id, label: $0.label, parentId: nil) : $0 }
            )
        }
        if saved {
            noticeMessage = BoardL10n.text(.boardsGroupDeleted)
        }
        return saved
    }

    /// 選取某個分組在畫布上的所有投影。
    public func selectItems(inGroup groupId: String) {
        guard let current = board else { return }
        canvas.setSelection(Set(current.items.filter { $0.groupId == groupId }.map(\.id)))
    }

    /// 目前選取的投影是否全部屬於同一個分組；是的話回傳那個分組。
    public var selectionGroupId: String? {
        guard let current = board, !canvas.selectedIds.isEmpty else { return nil }
        let selected = current.items.filter { canvas.selectedIds.contains($0.id) }
        guard !selected.isEmpty, selected.allSatisfy({ $0.groupId != nil }) else { return nil }
        let ids = Set(selected.compactMap(\.groupId))
        return ids.count == 1 ? ids.first : nil
    }

    /// 連線端點的顯示名稱；端點不在畫布上時退回識別碼尾段。
    public func itemTitle(forItemId itemId: String) -> String {
        guard let item = canvas.item(itemId) else { return String(itemId.suffix(6)) }
        return title(for: item)
    }

    // MARK: - 圈選後的行動

    public var currentConversationId: String? { selectedConversationId() }

    public var currentConversationTitle: String? {
        guard let id = currentConversationId else { return nil }
        return conversationTargets().first { $0.id == id }?.title
    }

    /// 把圈選的卡片加入指定對話的上下文。沒有選取時不送，也不建立任何東西。
    @discardableResult
    public func sendSelection(to conversationId: String) async -> Bool {
        guard let contextService else { return false }
        let cardIds = selectedCardIds
        guard !cardIds.isEmpty else {
            errorMessage = BoardL10n.text(.boardsNothingSelected)
            return false
        }
        do {
            for cardId in cardIds {
                _ = try await contextService.addCardToContext(sessionId: conversationId, cardId: cardId)
            }
            noticeMessage = BoardL10n.count(.boardsSentToConversation, count: cardIds.count)
            errorMessage = nil
            return true
        } catch {
            errorMessage = BoardL10n.format(.boardsProjectFailed, value: error.localizedDescription)
            return false
        }
    }

    /// 送進目前打開的對話；沒有選對話時提示先選一場。
    public func sendSelectionToConversation() async {
        guard let conversationId = selectedConversationId() else {
            errorMessage = BoardL10n.text(.boardsSendUnavailable)
            return
        }
        await sendSelection(to: conversationId)
    }

    /// 建立一場新對話再送進去；沒有選取任何卡片時不建立空對話。
    @discardableResult
    public func sendSelectionToNewConversation() async -> Bool {
        guard !selectedCardIds.isEmpty else {
            errorMessage = BoardL10n.text(.boardsNothingSelected)
            return false
        }
        guard let conversationId = await createConversation() else {
            errorMessage = BoardL10n.text(.boardsNewConversationFailed)
            return false
        }
        let sent = await sendSelection(to: conversationId)
        if !sent {
            // 對話是為了這次送出才建立的；失敗就收回，不留下空對話。
            await deleteConversation(conversationId)
        }
        return sent
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

    // MARK: - 文件組裝

    private static func updated(
        _ document: BoardDocument,
        items: [BoardItem]? = nil,
        edges: [BoardEdge]? = nil,
        groups: [BoardGroup]? = nil
    ) -> BoardDocument {
        BoardDocument(
            schema: document.schema,
            id: document.id,
            title: document.title,
            createdAt: document.createdAt,
            updatedAt: document.updatedAt,
            items: items ?? document.items,
            inbox: document.inbox,
            edges: edges ?? document.edges,
            groups: groups ?? document.groups
        )
    }

    /// 把畫布上的位置、大小與釘選併回原本的投影，其餘欄位保持主機給的值。
    private static func updatedItem(_ original: BoardItem, frame: BoardRect, pinned: Bool) -> BoardItem {
        BoardItem(
            id: original.id,
            cardId: original.cardId,
            position: BoardPoint(
                x: max(0, Int(frame.minX.rounded())),
                y: max(0, Int(frame.minY.rounded()))
            ),
            size: BoardSize(
                width: max(1, Int(frame.width.rounded())),
                height: max(1, Int(frame.height.rounded()))
            ),
            pinned: pinned,
            origin: original.origin,
            projectedBy: original.projectedBy,
            groupId: original.groupId
        )
    }

    /// 換掉投影的分組歸屬，其餘欄位不動。
    private static func assigning(_ groupId: String?, to item: BoardItem) -> BoardItem {
        BoardItem(
            id: item.id,
            cardId: item.cardId,
            position: item.position,
            size: item.size,
            pinned: item.pinned,
            origin: item.origin,
            projectedBy: item.projectedBy,
            groupId: groupId
        )
    }

    /// 同一對端點不分方向都算同一條連線。
    private static func connects(_ edge: BoardEdge, from: String, to: String) -> Bool {
        (edge.from == from && edge.to == to) || (edge.from == to && edge.to == from)
    }

    private static func isConflict(_ error: Error) -> Bool {
        guard let clientError = error as? CardiaryClientError,
              case .server(let frame) = clientError
        else { return false }
        return frame.code == .conflict
    }
}
