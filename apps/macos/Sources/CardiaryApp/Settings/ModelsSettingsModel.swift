import CardiaryKit
import CardiaryShellCore
import Combine
import Foundation

/// 四個角色目前選了什麼。`unset` 與 `none` 不同：前者讓主機套用退回規則，
/// 後者明確表示「這個角色沒有模型」。
public struct RoleChoice: Hashable, Sendable, Identifiable {
    public enum Kind: String, Hashable, Sendable {
        case unset
        case none
        case model
    }

    public let kind: Kind
    public let providerId: String?
    public let modelId: String?

    public init(kind: Kind, providerId: String?, modelId: String?) {
        self.kind = kind
        self.providerId = providerId
        self.modelId = modelId
    }

    public static let unset = RoleChoice(kind: .unset, providerId: nil, modelId: nil)
    public static let none = RoleChoice(kind: .none, providerId: nil, modelId: nil)

    public static func model(providerId: String, modelId: String) -> RoleChoice {
        RoleChoice(kind: .model, providerId: providerId, modelId: modelId)
    }

    public var id: String {
        switch kind {
        case .unset: return "unset"
        case .none: return "none"
        case .model: return "model:\(providerId ?? "")/\(modelId ?? "")"
        }
    }

    public var label: String {
        switch kind {
        case .unset: return AppL10n.text(.settingsRoleUnset)
        case .none: return AppL10n.text(.settingsRoleNone)
        case .model:
            return "\(providerId ?? "") / \(modelId ?? "")"
        }
    }

    init(selection: ModelRoleSelection) {
        switch selection.mode {
        case .model:
            self = .model(
                providerId: selection.ref?.providerId ?? "",
                modelId: selection.ref?.modelId ?? ""
            )
        case .none:
            self = .none
        case .unset:
            self = .unset
        }
    }

    func selection(for role: ModelRole) -> ModelRoleSelection {
        switch kind {
        case .unset:
            return ModelRoleSelection(role: role, mode: .unset, ref: nil)
        case .none:
            return ModelRoleSelection(role: role, mode: .none, ref: nil)
        case .model:
            return ModelRoleSelection(
                role: role,
                mode: .model,
                ref: ModelRef(providerId: providerId ?? "", modelId: modelId ?? "")
            )
        }
    }
}

/// 設定頁的模型分頁：供應商、四個角色與金鑰寫入。
///
/// 金鑰只在殼的行程內從輸入框交給 `KeychainWriting`，寫入後立刻清空輸入框；
/// 協定只帶 `credentialRef`（帳號名），不帶金鑰值。
@MainActor
public final class ModelsSettingsModel: ObservableObject {
    @Published public private(set) var providers: [ModelProviderInfo] = []
    @Published public private(set) var resolved: [ResolvedModelRole] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var isSaving = false
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?

    /// 四個角色目前的選擇（儲存前的編輯狀態）。
    @Published public var choices: [ModelRole: RoleChoice] = ModelRole.allCases.reduce(into: [:]) {
        $0[$1] = .unset
    }

    /// 正在輸入金鑰的供應商。一次只有一個，避免多把金鑰同時留在記憶體。
    @Published public private(set) var credentialProviderId: String?
    /// 金鑰輸入框。寫入鑰匙圈後立刻清空，不留在任何畫面狀態裡。
    @Published public var credentialInput: String = ""

    // 新增供應商的表單。
    @Published public var newProviderId = ""
    @Published public var newProviderName = ""
    @Published public var newProviderKind: ModelProviderKind = .apiKey
    @Published public var newProviderBaseURL = ""
    @Published public var newProviderModels = ""

    private var service: (any ModelSettingsService)?
    private let keychain: (any KeychainWriting)?
    private let language: AppLanguage

    /// - Parameter language: 這個模型產生訊息時用的介面語言。預設跟著 App 目前的語言，
    ///   測試可以指定，讓結果不受系統語言影響。
    public init(keychain: (any KeychainWriting)? = nil, language: AppLanguage = AppL10n.language) {
        self.keychain = keychain
        self.language = language
    }

    public func attach(service: any ModelSettingsService) {
        self.service = service
    }

    public func detach() {
        service = nil
        providers = []
        resolved = []
        credentialProviderId = nil
        credentialInput = ""
    }

    // MARK: - 讀取

    public func load() async {
        guard let service else {
            errorMessage = AppL10n.text(.settingsServiceUnavailable, language: language)
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            apply(try await service.getModels())
            errorMessage = nil
        } catch {
            errorMessage = SettingsMessages.error(error, language: language)
        }
    }

    // MARK: - 供應商

    /// 目前所有可選的角色組合：未設定、無，以及每個供應商的每個模型。
    public var availableChoices: [RoleChoice] {
        var result: [RoleChoice] = [.unset, .none]
        for provider in providers {
            for model in provider.models {
                result.append(.model(providerId: provider.providerId, modelId: model.modelId))
            }
        }
        return result
    }

    /// Picker 的選項。現值若已不在供應商清單裡（例如供應商被移除），
    /// 仍要放進選項，否則 Picker 會顯示空白。
    public func choices(for role: ModelRole) -> [RoleChoice] {
        let options = availableChoices
        let current = choices[role] ?? .unset
        return options.contains(current) ? options : options + [current]
    }

    public func beginCredentialEntry(for providerId: String) {
        credentialProviderId = providerId
        credentialInput = ""
        errorMessage = nil
        noticeMessage = nil
    }

    public func cancelCredentialEntry() {
        credentialProviderId = nil
        credentialInput = ""
    }

    /// 金鑰寫給哪個帳號：供應商已指定就用它，否則用預設帳號。
    public func keychainAccount(for provider: ModelProviderInfo) -> String {
        provider.credentialRef ?? Self.defaultAccount(provider.providerId)
    }

    public var canAddProvider: Bool {
        !newProviderId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !newProviderModels.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isSaving
    }

    /// 把金鑰寫進殼的鑰匙圈，並在需要時把帳號名記到供應商設定。
    public func storeCredential(for providerId: String) async {
        guard let keychain else {
            errorMessage = AppL10n.text(.settingsCredentialFailed, language: language)
            return
        }
        guard let provider = providers.first(where: { $0.providerId == providerId }) else { return }

        let value = credentialInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else {
            errorMessage = AppL10n.text(.settingsCredentialMissingKey, language: language)
            return
        }

        let account = keychainAccount(for: provider)
        guard keychain.store(account: account, value: value) else {
            errorMessage = AppL10n.text(.settingsCredentialFailed, language: language)
            return
        }
        credentialInput = ""
        credentialProviderId = nil
        errorMessage = nil
        noticeMessage = AppL10n.text(.settingsCredentialStored, language: language)

        // 協定只記帳號名；金鑰值沒有離開這個行程。
        guard provider.credentialRef == nil, let service else { return }
        var updated = providers
        guard let index = updated.firstIndex(where: { $0.providerId == providerId }) else { return }
        let current = updated[index]
        updated[index] = ModelProviderInfo(
            providerId: current.providerId,
            kind: current.kind,
            displayName: current.displayName,
            baseUrl: current.baseUrl,
            credentialRef: account,
            models: current.models
        )
        do {
            apply(try await service.setModels(
                providers: updated,
                roles: nil,
                clientRequestId: ClientRequestID.next("models")
            ), resetChoices: false)
        } catch {
            errorMessage = SettingsMessages.error(error, language: language)
        }
    }

    public func addProvider() async {
        guard let service else {
            errorMessage = AppL10n.text(.settingsServiceUnavailable, language: language)
            return
        }
        let id = newProviderId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.isValidProviderId(id) else {
            errorMessage = AppL10n.text(.settingsProviderInvalidID, language: language)
            return
        }
        guard !providers.contains(where: { $0.providerId == id }) else {
            errorMessage = AppL10n.text(.settingsProviderDuplicateID, language: language)
            return
        }
        let models = Self.parseModels(newProviderModels)
        guard !models.isEmpty else {
            errorMessage = AppL10n.text(.settingsProviderInvalid, language: language)
            return
        }
        let baseURL = newProviderBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = newProviderName.trimmingCharacters(in: .whitespacesAndNewlines)
        let provider = ModelProviderInfo(
            providerId: id,
            kind: newProviderKind,
            displayName: name.isEmpty ? id : name,
            baseUrl: baseURL.isEmpty ? nil : baseURL,
            models: models
        )

        isSaving = true
        defer { isSaving = false }
        do {
            apply(try await service.setModels(
                providers: providers + [provider],
                roles: nil,
                clientRequestId: ClientRequestID.next("models")
            ), resetChoices: false)
            newProviderId = ""
            newProviderName = ""
            newProviderBaseURL = ""
            newProviderModels = ""
            errorMessage = nil
            noticeMessage = AppL10n.text(.settingsSaved, language: language)
        } catch {
            errorMessage = SettingsMessages.error(error, language: language)
        }
    }

    // MARK: - 角色

    public func saveRoles() async {
        guard let service else {
            errorMessage = AppL10n.text(.settingsServiceUnavailable, language: language)
            return
        }
        let selections = ModelRole.allCases.map { role in
            (choices[role] ?? .unset).selection(for: role)
        }
        isSaving = true
        defer { isSaving = false }
        do {
            apply(try await service.setModels(
                providers: nil,
                roles: selections,
                clientRequestId: ClientRequestID.next("models")
            ))
            errorMessage = nil
            noticeMessage = AppL10n.text(.settingsRoleSaved, language: language)
        } catch {
            errorMessage = SettingsMessages.error(error, language: language)
        }
    }

    public func resolved(for role: ModelRole) -> ResolvedModelRole? {
        resolved.first { $0.role == role }
    }

    public static func resolvedLabel(_ resolved: ResolvedModelRole?) -> String {
        guard let resolved else { return AppL10n.text(.settingsRoleUnset) }
        switch resolved.source {
        case .none:
            return AppL10n.text(.settingsResolvedSourceNone)
        case .configured:
            return refLabel(resolved.ref)
        case .fallbackMain:
            return "\(AppL10n.text(.settingsResolvedSourceFallbackMain))：\(refLabel(resolved.ref))"
        case .fallbackSmall:
            return "\(AppL10n.text(.settingsResolvedSourceFallbackSmall))：\(refLabel(resolved.ref))"
        }
    }

    public func dismissMessages() {
        errorMessage = nil
        noticeMessage = nil
    }

    // MARK: - 內部

    /// 套用主機回來的狀態。只改供應商時保留使用者還沒儲存角色選擇，
    /// 免得只是輸入一把金鑰就丟掉編輯中的設定。
    private func apply(_ state: SystemModelsState, resetChoices: Bool = true) {
        providers = state.providers
        resolved = state.resolved
        guard resetChoices else { return }
        var next: [ModelRole: RoleChoice] = [:]
        for role in ModelRole.allCases {
            if let selection = state.roles.first(where: { $0.role == role }) {
                next[role] = RoleChoice(selection: selection)
            } else {
                next[role] = .unset
            }
        }
        choices = next
    }

    static func defaultAccount(_ providerId: String) -> String {
        "cardiary/provider/\(providerId)"
    }

    /// 供應商識別碼會成為鑰匙圈帳號的一段：只允許小寫、數字、句點、底線與連字號。
    static func isValidProviderId(_ id: String) -> Bool {
        guard !id.isEmpty, id.count <= 64 else { return false }
        return id.range(of: "^[a-z0-9][a-z0-9._-]*$", options: .regularExpression) != nil
    }

    /// 一行一個模型或逗號分隔；重複的模型只留一個。
    static func parseModels(_ text: String) -> [ModelInfo] {
        var seen = Set<String>()
        var models: [ModelInfo] = []
        let pieces = text.split(whereSeparator: { $0 == "\n" || $0 == "," })
        for piece in pieces {
            let id = piece.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !id.isEmpty, seen.insert(id).inserted else { continue }
            models.append(ModelInfo(
                modelId: id,
                displayName: nil,
                contextWindow: 128_000,
                maxOutputTokens: nil,
                input: [.text]
            ))
        }
        return models
    }

    private static func refLabel(_ ref: ModelRef?) -> String {
        guard let ref else { return AppL10n.text(.settingsRoleUnset) }
        return "\(ref.providerId) / \(ref.modelId)"
    }
}
