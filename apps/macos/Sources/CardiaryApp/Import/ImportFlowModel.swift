import Foundation

/// 匯入介面的狀態機。
///
/// 流程固定：選來源 →（通用來源）逐檔指定類別 → 預覽 → 逐項勾選 →
/// 標記核心記憶候選 → 寫入 → 結果。所有請求都經過注入的 `ImportService`，
/// view model 不認識連線、Token 或 `CardiaryClient`。訊息語言由注入的
/// `language` 決定（預設 `AppL10n.language`），測試因而可以不依賴系統語言。
///
/// 預設勾選規則（規格書第 16 章）：人格卡要使用者過目（預設不勾）、記憶與
/// 使用者資料逐條勾、操作規則勾、技能勾、對話預設不匯入。重複的項目不能勾。
@MainActor
public final class ImportFlowModel: ObservableObject {
    public enum Phase: Equatable {
        case idle
        case loadingSources
        case ready
        case previewing
        case previewed
        case writing
        case completed
        case failed(String)
    }

    @Published public private(set) var phase: Phase = .idle
    @Published public private(set) var sources: [ImportSourceAvailability] = []
    @Published public private(set) var files: [ImportFileEntry] = []
    @Published public private(set) var preview: ImportPreview?
    @Published public private(set) var result: ImportWriteResult?
    @Published public private(set) var progress: ImportProgress?
    @Published public private(set) var errorMessage: String?

    @Published public private(set) var sourceKind: ImportSourceKind = .generic
    @Published public private(set) var sourcePath: String = ""
    @Published public private(set) var categories: [String: ImportCategory] = [:]
    @Published public private(set) var selectedKeys: Set<String> = []
    @Published public private(set) var coreMemoryKeys: Set<String> = []
    @Published public private(set) var range: ClosedRange<Date>?

    @Published public var includeConversations = false
    @Published public var personaText = ""
    @Published public var allowReimport = false

    private let service: any ImportService
    private let language: AppLanguage

    public init(service: any ImportService, language: AppLanguage = AppL10n.language) {
        self.service = service
        self.language = language
    }

    // MARK: - 查詢

    /// 這次會建立幾張卡（含對話摘要，不含技能）。
    public var selectedCardCount: Int {
        guard let preview else { return 0 }
        let cards = preview.items.filter { item in
            item.category != .skill
                && (item.duplicateCardId == nil || allowReimport)
                && selectedKeys.contains(item.key)
        }
        let conversations = preview.conversations.filter { selectedKeys.contains($0.key) }.count
        return cards.count + conversations
    }

    public var selectedSkillCount: Int {
        guard let preview else { return 0 }
        return preview.skills.filter { $0.existingSkillPath == nil && selectedKeys.contains($0.key) }.count
    }

    public var canPreview: Bool {
        if phase == .previewing || phase == .writing { return false }
        if (sourceKind == .generic || sourceKind == .claude) && sourcePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return false
        }
        if includeConversations && range == nil { return false }
        return true
    }

    public var canWrite: Bool {
        guard preview != nil else { return false }
        if phase == .writing { return false }
        return !selectedKeys.isEmpty
    }

    /// 選了對話但還沒指定範圍時，介面要提示並停用寫入。
    public var requiresRange: Bool {
        includeConversations && range == nil
    }

    public var isCompleted: Bool {
        if case .completed = phase { return true }
        return false
    }

    // MARK: - 動作

    /// 列出來源；只 stat 預設位置，不讀內容。
    public func load() async {
        switch phase {
        case .loadingSources, .previewing, .writing:
            return
        case .idle, .ready, .previewed, .completed, .failed:
            break
        }
        phase = .loadingSources
        errorMessage = nil
        do {
            sources = try await service.sources()
            if let alma = sources.first(where: { $0.kind == .alma && $0.available }) {
                sourceKind = .alma
                sourcePath = alma.path
            }
            phase = .ready
        } catch {
            fail(error)
        }
    }

    /// 選一個來源。通用來源要另外列檔案，讓使用者逐檔指定類別。
    public func chooseSource(kind: ImportSourceKind, path: String) async {
        sourceKind = kind
        sourcePath = path
        if kind == .claude { includeConversations = true }
        preview = nil
        result = nil
        progress = nil
        selectedKeys = []
        coreMemoryKeys = []
        categories = [:]
        files = []
        errorMessage = nil
        if kind == .generic {
            guard !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                phase = .ready
                return
            }
            await loadFiles()
            return
        }
        phase = .ready
    }

    public func loadFiles() async {
        guard !sourcePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        errorMessage = nil
        do {
            let listing = try await service.listFiles(path: sourcePath)
            files = listing.files
            phase = .ready
        } catch {
            fail(error)
        }
    }

    /// 指定一個檔案的類別；通用來源的預覽用它決定每一類怎麼處理。
    public func setCategory(_ category: ImportCategory?, for file: String) {
        if let category {
            categories[file] = category
        } else {
            categories.removeValue(forKey: file)
        }
    }

    public func category(for file: String) -> ImportCategory? {
        categories[file]
    }

    /// 對話的時間範圍；`nil` 代表還沒指定。
    public func setRange(start: Date, end: Date) {
        let lower = min(start, end)
        let upper = max(start, end)
        range = lower...upper
    }

    public func clearRange() {
        range = nil
    }

    public func toggle(_ key: String) {
        if selectedKeys.contains(key) {
            selectedKeys.remove(key)
        } else {
            selectedKeys.insert(key)
        }
    }

    public func setSelected(_ key: String, _ selected: Bool) {
        if selected {
            selectedKeys.insert(key)
        } else {
            selectedKeys.remove(key)
        }
    }

    public func setCoreMemory(_ key: String, _ selected: Bool) {
        if selected {
            coreMemoryKeys.insert(key)
        } else {
            coreMemoryKeys.remove(key)
        }
    }

    public func selectAll() {
        guard let preview else { return }
        selectedKeys = Set(selectableKeys(of: preview))
    }

    public func deselectAll() {
        selectedKeys = []
        coreMemoryKeys = []
    }

    public func preview() async {
        guard canPreview else {
            if requiresRange {
                errorMessage = ImportL10n.text(.importRangeRequired, language: language)
            } else {
                errorMessage = ImportL10n.text(.importNothingSelected, language: language)
            }
            return
        }
        phase = .previewing
        errorMessage = nil
        result = nil
        progress = nil
        let range = range
        let persona = personaText.trimmingCharacters(in: .whitespacesAndNewlines)
        let request = ImportPreviewRequest(
            sourceKind: sourceKind,
            sourcePath: sourcePath.isEmpty ? nil : sourcePath,
            categories: sourceKind == .generic && !categories.isEmpty ? categories : nil,
            defaultCategory: nil,
            includeConversations: includeConversations ? true : nil,
            rangeStart: range.map { ImportTimestamp.string(from: $0.lowerBound) },
            rangeEnd: range.map { ImportTimestamp.string(from: $0.upperBound) },
            providedPersona: persona.isEmpty
                ? nil
                : ImportPreviewRequest.Persona(title: "人格", body: persona)
        )
        do {
            let preview = try await service.preview(request)
            self.preview = preview
            let projectKeys = Set(preview.items.filter { $0.category == .memory && $0.origin == "project" }.map(\.key))
            selectedKeys = Set(selectableKeys(of: preview)).subtracting(projectKeys)
            coreMemoryKeys = Set(
                preview.items
                    .filter { $0.category == .user && $0.duplicateCardId == nil }
                    .map(\.key)
            )
            phase = .previewed
        } catch {
            fail(error)
        }
    }

    public func write() async {
        guard let preview else { return }
        guard !selectedKeys.isEmpty else {
            errorMessage = ImportL10n.text(.importNothingSelected, language: language)
            return
        }
        let hasConversation = preview.conversations.contains { selectedKeys.contains($0.key) }
        if hasConversation && range == nil {
            errorMessage = ImportL10n.text(.importRangeRequired, language: language)
            return
        }
        phase = .writing
        errorMessage = nil
        let request = ImportWriteRequest(
            jobId: preview.jobId,
            itemKeys: selectedKeys.sorted(),
            coreMemoryItemKeys: coreMemoryKeys.intersection(selectedKeys).sorted(),
            reimport: allowReimport ? true : nil
        )
        do {
            let result = try await service.write(request)
            self.result = result
            phase = .completed
        } catch {
            fail(error)
        }
    }

    /// 主機送來的進度事件；只套用在這一次的工作上。
    public func apply(progress: ImportProgress) {
        guard progress.jobId == preview?.jobId else { return }
        self.progress = progress
    }

    // MARK: - 內部

    private func selectableKeys(of preview: ImportPreview) -> [String] {
        var keys: [String] = preview.items
            .filter { item in
                item.category != .skill && item.category != .persona && item.duplicateCardId == nil
            }
            .map(\.key)
        keys += preview.skills.filter { $0.existingSkillPath == nil }.map(\.key)
        // 對話預設不匯入，要使用者自己勾。
        return keys
    }

    private func fail(_ error: Error) {
        let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        errorMessage = message
        phase = .failed(message)
    }
}
