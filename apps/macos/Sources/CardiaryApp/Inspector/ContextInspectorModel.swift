import CardiaryKit
import Combine
import Foundation

public enum ContextInspectorMode: String, CaseIterable, Sendable {
    case treemap
    case heatGrid
}

/// 檢視欄的上下文模型：兩種檢視都使用同一份 `ContextView`，順序與 token 全部
/// 來自主機；模型只負責選取、加入、移除與壓縮的請求。
@MainActor
public final class ContextInspectorModel: ObservableObject {
    @Published public private(set) var sessionId: String?
    @Published public private(set) var context: ContextView?
    @Published public private(set) var isLoading = false
    @Published public private(set) var isCompacting = false
    @Published public private(set) var lastCompaction: ContextCompactedEventPayload?
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?
    @Published public private(set) var mode: ContextInspectorMode = .treemap
    @Published public var selectedEntryId: String?

    /// 壓縮沒有在時限內收到 `context.compacted` 時，解除等待，畫面不再停用。
    /// 主機完成後畫面仍會由壓縮完成事件更新。
    public var compactionTimeout: TimeInterval = 120

    public let freshness: CardFreshnessStore
    /// M1 沒有發牌；介面保留欄位但不顯示機率。
    public let showsDealProbability = false

    private var service: (any ContextService)?
    private var cardService: (any CardService)?
    private var loadGeneration = 0
    private var compactGeneration = 0

    public init(freshness: CardFreshnessStore) {
        self.freshness = freshness
    }

    public func attach(service: (any ContextService)?, cardService: (any CardService)?) {
        self.service = service
        self.cardService = cardService
    }

    public var entries: [ContextEntry] { context?.entries ?? [] }
    public var usedTokens: Int { context?.usedTokens ?? 0 }
    public var budgetTokens: Int { context?.budgetTokens ?? 0 }
    public var contextWindow: Int { context?.contextWindow ?? 0 }
    public var compactionThreshold: Double { context?.compactionThreshold ?? 0 }
    public var hasContext: Bool { context != nil }

    /// 拖放能否加入：目前要有一場保留著的對話掛在檢視欄上。這是
    /// `dropDestination` 唯一能同步知道的條件；主機拒絕的話錯誤會顯示在橫幅上。
    public var canAddCards: Bool { service != nil && sessionId != nil }

    public var selectedEntry: ContextEntry? {
        guard let selectedEntryId else { return nil }
        return entries.first { $0.entryId == selectedEntryId }
    }

    // MARK: - 開啟與載入

    /// 導覽同步：對話 → 開啟該場對話；卡片庫、封存、設定等入口 → 保留最後一場
    /// 對話（檢視欄還掛著它的上下文，拖卡片進來才有加入的目標）；沒有選取 → 關閉。
    public func syncSelection(_ selection: AppSelection) async {
        switch selection {
        case .conversation(let id):
            await open(sessionId: id)
        case .slot:
            break
        case .none:
            close()
        }
    }

    /// 跟著目前選取的對話換內容；同一場對話再次出現時仍向主機重讀一次。
    public func open(sessionId: String) async {
        if self.sessionId != sessionId {
            loadGeneration += 1
            compactGeneration += 1
            context = nil
            selectedEntryId = nil
            isCompacting = false
            lastCompaction = nil
            errorMessage = nil
            noticeMessage = nil
        }
        self.sessionId = sessionId
        await reload()
    }

    public func close() {
        loadGeneration += 1
        compactGeneration += 1
        sessionId = nil
        context = nil
        selectedEntryId = nil
        isCompacting = false
        lastCompaction = nil
        errorMessage = nil
        noticeMessage = nil
    }

    /// 向主機重讀目前對話；內容過期後的重整要保留已更新提示。
    public func reload(preservingNotice: Bool = false) async {
        if !preservingNotice { noticeMessage = nil }
        guard let service, let sessionId else { return }
        loadGeneration += 1
        compactGeneration += 1
        isCompacting = false
        let current = loadGeneration
        isLoading = true
        defer {
            if current == loadGeneration { isLoading = false }
        }
        do {
            let response = try await service.getContext(sessionId: sessionId)
            guard current == loadGeneration, self.sessionId == sessionId else { return }
            apply(response.context)
            errorMessage = nil
            await loadFreshness(for: response.context)
        } catch {
            guard current == loadGeneration else { return }
            errorMessage = CardL10n.format(.inspectorLoadFailed, value: errorText(error))
        }
    }

    private func apply(_ view: ContextView) {
        // 畫面只顯示目前對話的內容；切換對話後晚到的舊回應一律丟棄。
        guard view.sessionId == sessionId else { return }
        if let current = context, view.version < current.version {
            return
        }
        context = view
        if let selectedEntryId, !view.entries.contains(where: { $0.entryId == selectedEntryId }) {
            self.selectedEntryId = nil
        }
    }

    private func loadFreshness(for view: ContextView) async {
        guard let cardService else { return }
        var seen = Set<String>()
        for entry in view.entries {
            guard let cardId = entry.cardId, seen.insert(cardId).inserted else { continue }
            if freshness.value(for: cardId) != nil { continue }
            guard let response = try? await cardService.getCard(cardId: cardId) else { continue }
            freshness.update(cardId: cardId, freshness: response.card.freshness)
        }
    }

    // MARK: - 加入、移除、壓縮

    @discardableResult
    public func addCard(cardId: String) async -> Bool {
        guard let service, let sessionId else {
            errorMessage = CardL10n.text(.inspectorNoSession)
            return false
        }
        do {
            let response = try await service.addCardToContext(sessionId: sessionId, cardId: cardId)
            guard self.sessionId == sessionId else { return false }
            apply(response.context)
            selectedEntryId = response.context.entries.last { $0.cardId == cardId }?.entryId
            errorMessage = nil
            return true
        } catch {
            guard self.sessionId == sessionId else { return false }
            errorMessage = CardL10n.format(.inspectorAddFailed, value: errorText(error))
            return false
        }
    }

    public func removeSelected() async {
        guard let service, let sessionId, let entry = selectedEntry, let cardId = entry.cardId else {
            return
        }
        do {
            let response = try await service.removeCardFromContext(sessionId: sessionId, cardId: cardId)
            guard self.sessionId == sessionId else { return }
            apply(response.context)
            errorMessage = nil
        } catch {
            guard self.sessionId == sessionId else { return }
            if isContextNotFound(error) {
                await markContextStaleAndReload()
                return
            }
            errorMessage = CardL10n.format(.inspectorRemoveFailed, value: errorText(error))
        }
    }

    private func markContextStaleAndReload() async {
        noticeMessage = CardL10n.text(.inspectorRemoveStale)
        errorMessage = nil
        await reload(preservingNotice: true)
    }

    public func compact() async {
        guard let service, let sessionId, !isCompacting else { return }
        isCompacting = true
        lastCompaction = nil
        noticeMessage = nil
        compactGeneration += 1
        let current = compactGeneration
        do {
            let response = try await service.compactContext(sessionId: sessionId, instructions: nil)
            guard self.sessionId == sessionId else { return }
            if !response.scheduled {
                isCompacting = false
                noticeMessage = CardL10n.text(.inspectorNothingToCompact)
                return
            }
            errorMessage = nil
        } catch {
            guard self.sessionId == sessionId else { return }
            isCompacting = false
            errorMessage = CardL10n.format(.inspectorCompactFailed, value: errorText(error))
            return
        }
        // 排定之後等主機送 `context.compacted`；主機失敗時只記 log，
        // 沒有逾時的話畫面會永遠停在壓縮中。
        let timeout = compactionTimeout
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(max(timeout, 0.01) * 1_000_000_000))
            self?.finishCompactionTimeout(generation: current)
        }
    }

    private func finishCompactionTimeout(generation: Int) {
        guard generation == compactGeneration, isCompacting else { return }
        isCompacting = false
        noticeMessage = CardL10n.text(.inspectorCompactTimedOut)
    }

    /// 只有「主機找不到這個上下文項目」才當成畫面過期；協定錯誤與連線錯誤仍視為真正的失敗。
    private func isContextNotFound(_ error: any Error) -> Bool {
        guard case .server(let frame) = error as? CardiaryClientError else { return false }
        return frame.code == .notFound
    }

    // MARK: - 事件

    public func handle(frame: ServerFrame) {
        switch frame {
        case .contextChangedEvent(let event):
            guard event.payload.sessionId == sessionId else { return }
            apply(event.payload.context)
        case .contextCompactedEvent(let event):
            guard event.payload.sessionId == sessionId else { return }
            compactGeneration += 1
            isCompacting = false
            lastCompaction = event.payload
        case .cardChangedEvent(let event):
            if let value = event.payload.freshness {
                freshness.update(cardId: event.payload.cardId, freshness: value)
            }
        case .sessionDeletedEvent(let event):
            guard let sessionId else { return }
            if event.payload.deletedSessionIds.contains(sessionId) || event.stream == "session:\(sessionId)" {
                close()
            }
        default:
            break
        }
    }

    // MARK: - 呈現

    public func setMode(_ mode: ContextInspectorMode) {
        self.mode = mode
    }

    /// 卡片區塊的新鮮度；靜態層與對話內容沒有卡片新鮮度，回 nil。
    public func appearance(for entry: ContextEntry) -> CardFreshnessAppearance? {
        guard let cardId = entry.cardId else { return nil }
        guard let value = freshness.value(for: cardId) else { return nil }
        return CardFreshnessStyle.appearance(for: value)
    }

    public func layerTitle(_ layer: ContextLayer) -> String {
        CardL10n.text(layer.semanticKey)
    }

    private func errorText(_ error: any Error) -> String {
        (error as? CardiaryClientError)?.errorDescription ?? "\(error)"
    }
}

extension ContextLayer {
    /// 檢視欄和主機共用的四種可見語意；第 2/3/5、6、7/8 層分別歸併。
    var semanticKey: InspectorString {
        switch self {
        case .bedrock, .persona: return .inspectorLayerBedrock
        case .coreMemory, .openingMemory, .shortTermMemory: return .inspectorLayerCoreMemory
        case .otherCards: return .inspectorLayerOtherCards
        case .workingContext, .volatileState: return .inspectorLayerWorkingContext
        }
    }
}
