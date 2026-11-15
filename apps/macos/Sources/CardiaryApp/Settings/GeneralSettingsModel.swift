import CardiaryKit
import Combine
import Foundation

/// 一般設定分頁：列出主機的設定與分級，逐項編輯。
///
/// 值一律是 JSON；畫面依原本的型別決定編輯方式（布林用開關、數字與文字用輸入框）。
/// 分級只顯示，不改變：`human-only` 的鍵只有人的介面看得到，代理的工具沒有路徑。
@MainActor
public final class GeneralSettingsModel: ObservableObject {
    @Published public private(set) var items: [SettingItem] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var savingKeys: Set<String> = []
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?
    /// 每一項的編輯中文字；值的型別以主機回來的為準。
    @Published public var drafts: [String: String] = [:]

    private var service: (any CardiaryService)?
    private let language: AppLanguage

    /// 由模型分頁擁有的設定鍵；一般設定不顯示、也不送出。
    static let modelOwnedKeys: Set<String> = ["models.providers", "models.roles"]

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
        items = []
        drafts = [:]
    }

    public func load() async {
        guard let service else {
            errorMessage = AppL10n.text(.settingsServiceUnavailable, language: language)
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let payload = try await service.getSettings()
            // 模型供應商與角色由模型分頁編輯；一般設定只列出其餘設定，
            // 不顯示一個存了也會被主機拒絕的欄位。
            items = payload.settings.filter { !Self.modelOwnedKeys.contains($0.key) }
            drafts = items.reduce(into: [:]) { result, item in
                result[item.key] = Self.editableText(item.value)
            }
            errorMessage = nil
        } catch {
            errorMessage = SettingsMessages.error(error, language: language)
        }
    }

    public func isBool(_ item: SettingItem) -> Bool {
        if case .bool = item.value { return true }
        return false
    }

    public func boolValue(_ item: SettingItem) -> Bool {
        if case .bool(let value) = item.value { return value }
        return false
    }

    /// 布林值切換後直接儲存；其他型別由使用者按「儲存這項」。
    public func toggle(_ item: SettingItem) async {
        guard case .bool(let value) = item.value else { return }
        await save(key: item.key, value: .bool(!value))
    }

    public func save(key: String) async {
        guard let item = items.first(where: { $0.key == key }) else { return }
        let text = drafts[key] ?? ""
        guard let value = Self.parse(text, like: item.value) else {
            errorMessage = AppL10n.text(.settingsValueInvalid, language: language)
            return
        }
        await save(key: key, value: value)
    }

    public func dismissMessages() {
        errorMessage = nil
        noticeMessage = nil
    }

    public static func levelKey(_ level: SettingLevel) -> AppString {
        switch level {
        case .free: return .settingsLevelFree
        case .approval: return .settingsLevelApproval
        case .humanOnly: return .settingsLevelHumanOnly
        }
    }

    /// 主機目錄的標題與說明是中文；介面語言是英文時換成在地化文字，
    /// 沒有對應字串的鍵顯示鍵名，不把中文帶進英文介面。
    public func title(for item: SettingItem) -> String {
        if let key = Self.localizedTitleKey(item.key) {
            return AppL10n.text(key, language: language)
        }
        if language == .zhHant, let title = item.title, !title.isEmpty {
            return title
        }
        return item.key
    }

    public func description(for item: SettingItem) -> String? {
        if let key = Self.localizedDescriptionKey(item.key) {
            return AppL10n.text(key, language: language)
        }
        guard language == .zhHant, let description = item.description, !description.isEmpty else {
            return nil
        }
        return description
    }

    static func localizedTitleKey(_ key: String) -> AppString? {
        switch key {
        case "models.summary.maxOutputTokens": return .settingsSummaryMaxOutputTokensTitle
        default: return nil
        }
    }

    static func localizedDescriptionKey(_ key: String) -> AppString? {
        switch key {
        case "models.summary.maxOutputTokens": return .settingsSummaryMaxOutputTokensBody
        default: return nil
        }
    }

    // MARK: - 內部

    private func save(key: String, value: JSONValue) async {
        guard let service else {
            errorMessage = AppL10n.text(.settingsServiceUnavailable, language: language)
            return
        }
        guard !savingKeys.contains(key) else { return }
        savingKeys.insert(key)
        defer { savingKeys.remove(key) }
        do {
            let payload = try await service.setSettings(
                changes: [SettingChange(key: key, value: value)],
                clientRequestId: ClientRequestID.next("settings")
            )
            for item in payload.applied {
                if let index = items.firstIndex(where: { $0.key == item.key }) {
                    items[index] = item
                } else {
                    items.append(item)
                }
                drafts[item.key] = Self.editableText(item.value)
            }
            errorMessage = nil
            noticeMessage = AppL10n.text(.settingsSaved, language: language)
        } catch {
            errorMessage = SettingsMessages.error(error, language: language)
        }
    }

    private static func editableText(_ value: JSONValue) -> String {
        switch value {
        case .bool(let value):
            return value ? "true" : "false"
        case .number(let value):
            return value == value.rounded() ? String(Int(value)) : String(value)
        case .string(let value):
            return value
        case .null:
            return ""
        case .array, .object:
            return JSONText.compact(value, limit: 2_000)
        }
    }

    /// 依原本的型別解析輸入；格式不對回 nil，讓畫面顯示錯誤而不是送錯值。
    static func parse(_ text: String, like original: JSONValue) -> JSONValue? {
        switch original {
        case .bool:
            switch text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "true", "1": return .bool(true)
            case "false", "0": return .bool(false)
            default: return nil
            }
        case .number:
            guard let value = Double(text.trimmingCharacters(in: .whitespacesAndNewlines)) else {
                return nil
            }
            return .number(value)
        case .string:
            return .string(text)
        case .null:
            return text.isEmpty ? .null : .string(text)
        case .array, .object:
            guard let data = text.data(using: .utf8),
                let value = try? JSONDecoder().decode(JSONValue.self, from: data)
            else {
                return nil
            }
            return value
        }
    }
}
