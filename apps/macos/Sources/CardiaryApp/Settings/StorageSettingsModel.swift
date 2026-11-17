import CardiaryKit
import Combine
import Foundation

/// 一類可以清理的空間。只有後端接受的這四類可以送出，介面沒有辦法指定其他類別。
public enum StorageCleanupCategory: String, CaseIterable, Sendable {
    case cache
    case temp
    case indexes
    case logs

    /// 選單上的名稱。
    public var titleKey: AppString {
        switch self {
        case .cache: return .storageCategoryCache
        case .temp: return .storageCategoryTmp
        case .indexes: return .storageCleanupCategoryIndexes
        case .logs: return .storageCategoryLogs
        }
    }

    /// 對應的用量類別；可重建索引沒有獨立的用量列，大小只在預覽裡看得到。
    var usageCategory: StorageUsageCategory? {
        switch self {
        case .cache: return .cache
        case .temp: return .tmp
        case .indexes: return nil
        case .logs: return .logs
        }
    }
}

/// 儲存空間分頁：顯示各類別用量，清理照「選類別、預覽、確認」三步走。
///
/// 預覽之後才允許實際清除，而且實際清除送出的類別就是預覽時送出的那一組，
/// 不會因為使用者在預覽後又勾選別的類別而和預覽不一致。
@MainActor
public final class StorageSettingsModel: ObservableObject {
    @Published public private(set) var usage: [StorageCategoryUsage] = []
    @Published public private(set) var outsideWrites: [StorageOutsideWriteEntry] = []
    @Published public private(set) var selected: Set<StorageCleanupCategory> = []
    @Published public private(set) var preview: StorageCleanupPreviewResponsePayload?
    @Published public private(set) var isLoading = false
    @Published public private(set) var isPreviewing = false
    @Published public private(set) var isApplying = false
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?

    private var service: (any CardiaryService)?
    private var previewCategories: [String] = []
    private let language: AppLanguage

    /// - Parameter language: 這個模型產生訊息時用的介面語言。預設跟著 App 目前的語言，
    ///   測試可以指定，讓結果不受系統語言影響。
    public init(language: AppLanguage = AppL10n.language) {
        self.language = language
    }

    public func attach(service: any CardiaryService) {
        self.service = service
    }

    public func detach() {
        service = nil
        usage = []
        outsideWrites = []
        selected = []
        preview = nil
        previewCategories = []
    }

    public func load() async {
        guard let service else {
            errorMessage = AppL10n.text(.settingsServiceUnavailable, language: language)
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await service.getStorageUsage()
            usage = response.usage
            outsideWrites = response.outsideWrites ?? []
            errorMessage = nil
        } catch {
            errorMessage = SettingsMessages.error(error, language: language)
        }
    }

    /// 選取或取消一類。換了選取範圍就作廢既有的預覽，使用者必須重新預覽。
    public func toggle(_ category: StorageCleanupCategory) {
        if selected.contains(category) {
            selected.remove(category)
        } else {
            selected.insert(category)
        }
        discardPreview()
    }

    public func previewCleanup() async {
        guard let service else {
            errorMessage = AppL10n.text(.settingsServiceUnavailable, language: language)
            return
        }
        let categories = Self.ordered(selected)
        guard !categories.isEmpty else {
            errorMessage = AppL10n.text(.storageCleanupNothing, language: language)
            return
        }
        isPreviewing = true
        defer { isPreviewing = false }
        do {
            let payload = try await service.previewStorageCleanup(categories: categories)
            preview = payload
            previewCategories = categories
            errorMessage = nil
        } catch {
            preview = nil
            previewCategories = []
            errorMessage = SettingsMessages.error(error, language: language)
        }
    }

    /// 執行預覽過的清理。沒有預覽時什麼都不做，介面也就不能跳過確認這一步。
    public func applyCleanup() async {
        guard let service else {
            errorMessage = AppL10n.text(.settingsServiceUnavailable, language: language)
            return
        }
        guard preview != nil, !previewCategories.isEmpty else { return }
        isApplying = true
        defer { isApplying = false }
        do {
            let payload = try await service.applyStorageCleanup(categories: previewCategories)
            noticeMessage = AppL10n.format(
                .storageCleanupDone,
                value: Self.formattedBytes(payload.totalBytes),
                language: language
            )
            errorMessage = nil
            selected = []
            discardPreview()
            await load()
        } catch {
            errorMessage = SettingsMessages.error(error, language: language)
        }
    }

    public func cancelPreview() {
        discardPreview()
    }

    public func dismissMessages() {
        errorMessage = nil
        noticeMessage = nil
    }

    /// 用量列的固定順序：正本、快取、暫存、日誌、殼狀態（規格書第 13 章）。
    public static let usageOrder: [StorageUsageCategory] = [
        .cards, .assets, .state, .cache, .tmp, .logs, .shellState,
    ]

    /// 用量列上的名稱。
    public static func titleKey(_ category: StorageUsageCategory) -> AppString {
        switch category {
        case .cards: return .storageCategoryCards
        case .assets: return .storageCategoryAssets
        case .cache: return .storageCategoryCache
        case .state: return .storageCategoryState
        case .logs: return .storageCategoryLogs
        case .tmp: return .storageCategoryTmp
        case .shellState: return .storageCategoryShellState
        }
    }

    /// 這一類現在佔多少空間。
    public func allocatedBytes(_ category: StorageCleanupCategory) -> Int? {
        guard let usageCategory = category.usageCategory else { return nil }
        return usage.first { $0.category == usageCategory }?.bytes
    }

    /// 某一類的用量；後端沒有回報這一類時是 nil。
    public func usageRow(_ category: StorageUsageCategory) -> StorageCategoryUsage? {
        usage.first { $0.category == category }
    }

    public static func formattedBytes(_ bytes: Int) -> String {
        bytes.formatted(.byteCount(style: .file))
    }

    /// 外部明細的大小文字。未知大小不能報 0：absent 顯示不存在，
    /// unavailable 或 measured 缺 bytes 顯示無法取得大小。
    public static func outsideWriteSize(
        _ entry: StorageOutsideWriteEntry,
        language: AppLanguage? = nil
    ) -> String {
        switch entry.status {
        case .measured:
            guard let bytes = entry.bytes else {
                return AppL10n.text(.storageOutsideUnavailable, language: language)
            }
            return formattedBytes(bytes)
        case .absent:
            return AppL10n.text(.storageOutsideAbsent, language: language)
        case .unavailable:
            return AppL10n.text(.storageOutsideUnavailable, language: language)
        }
    }

    /// 外部明細的工具名稱。目前只有 Claude Code 有對應文案，其照原字串顯示。
    public static func outsideWriteToolName(
        _ tool: String,
        language: AppLanguage? = nil
    ) -> String {
        tool == "claude-code"
            ? AppL10n.text(.storageOutsideToolClaudeCode, language: language)
            : tool
    }

    /// 固定順序，讓請求和訊息可預期。
    static func ordered(_ categories: Set<StorageCleanupCategory>) -> [String] {
        StorageCleanupCategory.allCases
            .filter { categories.contains($0) }
            .map(\.rawValue)
    }

    private func discardPreview() {
        preview = nil
        previewCategories = []
    }
}
