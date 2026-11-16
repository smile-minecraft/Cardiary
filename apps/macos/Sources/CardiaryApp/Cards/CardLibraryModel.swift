import CardiaryKit
import Combine
import Foundation

public enum CardLibraryMode: String, CaseIterable, Sendable {
    case list
    case overview
}

/// 卡片庫的狀態與請求。清單只載入游標分頁的一頁，捲到後段才要下一頁；
/// 選中的卡片才讀完整內文，總覽只用已載入的摘要畫一格一張卡。
@MainActor
public final class CardLibraryModel: ObservableObject {
    public struct Item: Identifiable, Equatable, Sendable {
        public let id: String
        public let kind: CardKind
        public var title: String
        public var summary: String?
        public var tags: [String]
        public let createdAt: String
        public var updatedAt: String?
        public var freshness: Int
        public let lifecycle: CardLifecycle
        public var asset: CardAsset?
        public let broken: Bool
        public var snippet: String?

        public init(
            id: String,
            kind: CardKind,
            title: String,
            summary: String?,
            tags: [String],
            createdAt: String,
            updatedAt: String?,
            freshness: Int,
            lifecycle: CardLifecycle,
            asset: CardAsset?,
            broken: Bool,
            snippet: String?
        ) {
            self.id = id
            self.kind = kind
            self.title = title
            self.summary = summary
            self.tags = tags
            self.createdAt = createdAt
            self.updatedAt = updatedAt
            self.freshness = freshness
            self.lifecycle = lifecycle
            self.asset = asset
            self.broken = broken
            self.snippet = snippet
        }

        init(summary: CardSummary, snippet: String?) {
            self.init(
                id: summary.cardId,
                kind: summary.kind,
                title: summary.title,
                summary: summary.summary,
                tags: summary.tags,
                createdAt: summary.createdAt,
                updatedAt: summary.updatedAt,
                freshness: summary.freshness,
                lifecycle: summary.lifecycle,
                asset: summary.asset,
                broken: summary.broken ?? false,
                snippet: snippet
            )
        }

        init(card: Card, snippet: String? = nil) {
            self.init(
                id: card.cardId,
                kind: card.kind,
                title: card.title,
                summary: card.summary,
                tags: card.tags,
                createdAt: card.createdAt,
                updatedAt: card.updatedAt,
                freshness: card.freshness,
                lifecycle: card.lifecycle,
                asset: card.asset,
                broken: false,
                snippet: snippet
            )
        }
    }

    @Published public private(set) var items: [Item] = []
    @Published public private(set) var tags: [String] = []
    @Published public private(set) var mode: CardLibraryMode = .list
    @Published public private(set) var isLoading = false
    @Published public private(set) var isLoadingMore = false
    @Published public private(set) var selectedCardId: String?
    @Published public private(set) var selectedCard: Card?
    @Published public private(set) var selectedImageData: Data?
    @Published public private(set) var isEditing = false
    @Published public var editingBody = ""
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?
    @Published public private(set) var isImporting = false
    @Published public var query = ""
    @Published public var tagFilter: String?

    /// 一次向主機要幾筆；一萬張卡也不會一次全部載入。
    public let pageSize: Int
    public private(set) var nextCursor: String?
    public private(set) var pageCount = 0

    public let freshness: CardFreshnessStore
    public var hasMore: Bool { nextCursor != nil }
    public var isServiceAvailable: Bool { service != nil }

    private var service: (any CardService)?
    private let mediaProvider: () -> (any MediaService)?
    private var generation = 0
    private var selectionGeneration = 0

    public init(
        freshness: CardFreshnessStore,
        pageSize: Int = 100,
        mediaProvider: @escaping () -> (any MediaService)? = { nil }
    ) {
        self.freshness = freshness
        self.pageSize = max(1, pageSize)
        self.mediaProvider = mediaProvider
    }

    public func attach(service: (any CardService)?) {
        self.service = service
    }

    // MARK: - 清單與搜尋

    /// 重新載入第一頁。搜尋字串或標籤改變時也走這裡。
    public func loadFirstPage() async {
        guard let service else {
            errorMessage = CardL10n.text(.cardsServiceUnavailable)
            return
        }
        generation += 1
        let current = generation
        isLoading = true
        isLoadingMore = false
        defer {
            if current == generation { isLoading = false }
        }

        do {
            let page = try await fetchPage(service: service, cursor: nil)
            guard current == generation else { return }
            apply(page.items, reset: true)
            nextCursor = page.nextCursor
            pageCount = 1
            errorMessage = nil
        } catch {
            guard current == generation else { return }
            errorMessage = CardL10n.format(.cardsLoadFailed, value: errorText(error))
        }
    }

    public func reload() async {
        await loadFirstPage()
    }

    /// 捲到後段時載入下一頁。同一時間只送一個請求；沒有下一頁就不送。
    public func loadMoreIfNeeded(current item: Item) async {
        guard let service, hasMore, !isLoading, !isLoadingMore else { return }
        guard let index = items.firstIndex(where: { $0.id == item.id }) else { return }
        guard index >= items.count - 5 else { return }

        isLoadingMore = true
        let current = generation
        defer { isLoadingMore = false }
        do {
            let page = try await fetchPage(service: service, cursor: nextCursor)
            guard current == generation else { return }
            apply(page.items, reset: false)
            nextCursor = page.nextCursor
            pageCount += 1
            errorMessage = nil
        } catch {
            errorMessage = CardL10n.format(.cardsLoadFailed, value: errorText(error))
        }
    }

    public func toggleMode() {
        mode = mode == .list ? .overview : .list
    }

    public func setMode(_ mode: CardLibraryMode) {
        self.mode = mode
    }

    private struct Page {
        let items: [Item]
        let nextCursor: String?
    }

    private func fetchPage(service: any CardService, cursor: String?) async throws -> Page {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let tags = tagFilter.map { [$0] }
        if trimmed.isEmpty {
            let response = try await service.listCards(
                kinds: nil,
                tags: tags,
                persona: nil,
                lifecycle: .all,
                query: nil,
                includeSuperseded: nil,
                cursor: cursor,
                limit: pageSize
            )
            return Page(
                items: response.cards.map { Item(summary: $0, snippet: nil) },
                nextCursor: response.nextCursor
            )
        }
        let response = try await service.searchCards(
            query: trimmed,
            kinds: nil,
            tags: tags,
            includeSuperseded: nil,
            limit: pageSize,
            cursor: cursor
        )
        return Page(
            items: response.hits.map { Item(summary: $0.card, snippet: $0.snippet) },
            nextCursor: response.nextCursor
        )
    }

    private func apply(_ newItems: [Item], reset: Bool) {
        if reset {
            items = []
        }
        var seen = Set(items.map(\.id))
        for item in newItems where !seen.contains(item.id) {
            items.append(item)
            seen.insert(item.id)
            freshness.update(cardId: item.id, freshness: item.freshness)
        }
        for item in newItems {
            for tag in item.tags where !tags.contains(tag) {
                tags.append(tag)
            }
        }
        tags.sort()
    }

    // MARK: - 讀取與選取

    public func select(cardId: String) async {
        guard let service else { return }
        selectionGeneration += 1
        let current = selectionGeneration
        selectedCardId = cardId
        selectedImageData = nil
        isEditing = false
        do {
            let response = try await service.getCard(cardId: cardId)
            // 後選的卡不能被先選的卡的慢回應蓋掉；過期的回應整段丟棄。
            guard current == selectionGeneration else { return }
            selectedCard = response.card
            editingBody = response.card.body
            freshness.update(cardId: response.card.cardId, freshness: response.card.freshness)
            upsert(Item(card: response.card))
            errorMessage = nil
            await loadImage(for: response.card)
        } catch {
            guard current == selectionGeneration else { return }
            selectedCard = nil
            errorMessage = CardL10n.format(.cardsLoadFailed, value: errorText(error))
        }
    }

    public func clearSelection() {
        selectionGeneration += 1
        selectedCardId = nil
        selectedCard = nil
        selectedImageData = nil
        isEditing = false
    }

    public func beginEditing() {
        guard let selectedCard else { return }
        editingBody = selectedCard.body
        isEditing = true
        noticeMessage = nil
    }

    public func cancelEditing() {
        editingBody = selectedCard?.body ?? ""
        isEditing = false
    }

    private func loadImage(for card: Card) async {
        guard card.kind == .image, let asset = card.asset, let media = mediaProvider() else { return }
        do {
            let data = try await media.download(blobId: asset.blobId, variant: .thumb)
            if selectedCardId == card.cardId {
                selectedImageData = data
            }
        } catch {
            if selectedCardId == card.cardId {
                noticeMessage = CardL10n.text(.cardsImageFailed)
            }
        }
    }

    // MARK: - 建立、編輯、刪除、保鮮

    @discardableResult
    public func createNote(title: String, body: String, tags: [String]) async -> Bool {
        guard let service else {
            errorMessage = CardL10n.text(.cardsServiceUnavailable)
            return false
        }
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else { return false }
        do {
            let response = try await service.createCard(
                kind: .note,
                title: trimmedTitle,
                body: body,
                summary: nil,
                tags: tags.isEmpty ? nil : tags,
                persona: nil,
                sources: nil,
                supersedes: nil,
                assetBlobId: nil,
                clientRequestId: ClientRequestID.next("card")
            )
            let item = Item(summary: response.card, snippet: nil)
            upsert(item)
            freshness.update(cardId: item.id, freshness: item.freshness)
            noticeMessage = CardL10n.text(.cardsCreated)
            errorMessage = nil
            await select(cardId: item.id)
            return true
        } catch {
            errorMessage = CardL10n.format(.cardsLoadFailed, value: errorText(error))
            return false
        }
    }

    /// 只送內文的統一 diff；標題與 frontmatter 不在 M1 的編輯範圍。
    @discardableResult
    public func save() async -> Bool {
        guard let service, let card = selectedCard else { return false }
        if editingBody == card.body {
            isEditing = false
            return true
        }
        let diff = UnifiedDiff.make(original: card.body, updated: editingBody)
        guard !diff.isEmpty else {
            isEditing = false
            return true
        }
        do {
            let response = try await service.patchCard(
                cardId: card.cardId,
                baseRevision: card.revision,
                patch: CardPatch(format: .unified, text: diff),
                clientRequestId: ClientRequestID.next("card-patch")
            )
            selectedCard = response.card
            editingBody = response.card.body
            isEditing = false
            freshness.update(cardId: response.card.cardId, freshness: response.card.freshness)
            upsert(Item(card: response.card))
            noticeMessage = CardL10n.text(.cardsSaved)
            errorMessage = nil
            return true
        } catch {
            if let clientError = error as? CardiaryClientError,
                case .server(let frame) = clientError,
                frame.code == .conflict
            {
                isEditing = false
                noticeMessage = CardL10n.text(.cardsConflictReloaded)
                await select(cardId: card.cardId)
                return false
            }
            errorMessage = CardL10n.format(.cardsLoadFailed, value: errorText(error))
            return false
        }
    }

    @discardableResult
    public func deleteSelected() async -> Bool {
        guard let service, let card = selectedCard else { return false }
        do {
            _ = try await service.deleteCard(
                cardId: card.cardId,
                clientRequestId: ClientRequestID.next("card-delete")
            )
            items.removeAll { $0.id == card.cardId }
            freshness.remove(cardId: card.cardId)
            clearSelection()
            noticeMessage = CardL10n.text(.cardsDeleted)
            errorMessage = nil
            return true
        } catch {
            errorMessage = CardL10n.format(.cardsLoadFailed, value: errorText(error))
            return false
        }
    }

    /// 單張卡保鮮；列上的「即將歸零」提示與詳細頁都用這個方法。
    public func refresh(cardId: String) async {
        guard let service else { return }
        do {
            let response = try await service.refreshCard(cardId: cardId)
            freshness.update(cardId: response.cardId, freshness: response.freshness)
            if let index = items.firstIndex(where: { $0.id == response.cardId }) {
                items[index].freshness = response.freshness
            }
            if selectedCardId == response.cardId {
                noticeMessage = CardL10n.text(.cardsSaved)
            }
            errorMessage = nil
        } catch {
            errorMessage = CardL10n.format(.cardsLoadFailed, value: errorText(error))
        }
    }

    // MARK: - 拖放匯入

    /// 把拖進來的圖片或音訊先上傳成 blob，再走 `media.import` 建卡。
    public func importDropped(urls: [URL]) async {
        guard let media = mediaProvider() else {
            errorMessage = CardL10n.text(.cardsServiceUnavailable)
            return
        }
        let supported = urls.filter(MediaFileType.isSupported)
        guard !supported.isEmpty else {
            noticeMessage = CardL10n.text(.cardsImportUnsupported)
            return
        }

        isImporting = true
        defer { isImporting = false }
        for url in supported {
            guard let mediaType = MediaFileType.mediaType(for: url) else { continue }
            do {
                let response = try await media.importFile(
                    fileURL: url,
                    mediaType: mediaType,
                    title: url.deletingPathExtension().lastPathComponent
                )
                // 不要自行填新鮮度：等主機回傳的卡片再插入，數值全部來自主機。
                noticeMessage = CardL10n.format(.cardsImportCreated, value: url.lastPathComponent)
                errorMessage = nil
                await select(cardId: response.cardId)
            } catch {
                errorMessage = CardL10n.format(.cardsImportFailed, value: errorText(error))
            }
        }
    }

    // MARK: - 事件

    /// `card.changed` 掛在 system 串流：更新新鮮度、刪除項目，或重讀被改的卡。
    public func handleCardChanged(_ payload: CardChangedEventPayload) async {
        if payload.change == .deleted {
            items.removeAll { $0.id == payload.cardId }
            freshness.remove(cardId: payload.cardId)
            if selectedCardId == payload.cardId {
                clearSelection()
            }
            return
        }
        if let value = payload.freshness {
            freshness.update(cardId: payload.cardId, freshness: value)
            if let index = items.firstIndex(where: { $0.id == payload.cardId }) {
                items[index].freshness = value
            }
        }
        guard let service else { return }
        guard let response = try? await service.getCard(cardId: payload.cardId) else { return }
        freshness.update(cardId: response.card.cardId, freshness: response.card.freshness)
        // 只更新已在清單或已選取的卡；不符合目前搜尋／標籤條件的卡不插入。
        if let index = items.firstIndex(where: { $0.id == response.card.cardId }) {
            items[index] = Item(card: response.card, snippet: items[index].snippet)
        }
        if selectedCardId == response.card.cardId, !isEditing {
            selectedCard = response.card
            editingBody = response.card.body
        }
    }

    // MARK: - 呈現

    public func appearance(for item: Item) -> CardFreshnessAppearance {
        freshness.appearance(for: item.id, fallback: item.freshness)
    }

    private func upsert(_ item: Item) {
        if let index = items.firstIndex(where: { $0.id == item.id }) {
            items[index] = item
        } else {
            items.insert(item, at: 0)
        }
    }

    private func errorText(_ error: any Error) -> String {
        (error as? CardiaryClientError)?.errorDescription ?? "\(error)"
    }
}

extension CardKind {
    var cardStringKey: CardsString {
        switch self {
        case .note: return .cardsKindNote
        case .image: return .cardsKindImage
        case .audio: return .cardsKindAudio
        case .memory: return .cardsKindMemory
        case .summary: return .cardsKindSummary
        case .persona: return .cardsKindPersona
        case .bedrock: return .cardsKindBedrock
        }
    }
}

/// 標籤輸入的解析規則：逗號（半形、全形）與頓號都算分隔，去空白、去重。
enum CardTagInput {
    static func parse(_ text: String) -> [String] {
        var seen = Set<String>()
        return text
            .components(separatedBy: CharacterSet(charactersIn: ",，、"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }
}
