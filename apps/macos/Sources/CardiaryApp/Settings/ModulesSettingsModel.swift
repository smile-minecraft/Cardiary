import CardiaryKit
import Combine
import Foundation

/// 模組分頁：模組清單、狀態與啟停。停用不刪資料，立即生效。
@MainActor
public final class ModulesSettingsModel: ObservableObject {
    @Published public private(set) var modules: [ModuleInfo] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var updatingIds: Set<String> = []
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?

    private var service: (any CardiaryService)?
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
        modules = []
        updatingIds = []
    }

    public func load() async {
        guard let service else {
            errorMessage = AppL10n.text(.settingsServiceUnavailable, language: language)
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            modules = try await service.getModules().modules
            errorMessage = nil
        } catch {
            errorMessage = SettingsMessages.error(error, language: language)
        }
    }

    public func setEnabled(_ module: ModuleInfo, enabled: Bool) async {
        guard let service else {
            errorMessage = AppL10n.text(.settingsServiceUnavailable, language: language)
            return
        }
        guard !updatingIds.contains(module.moduleId) else { return }
        updatingIds.insert(module.moduleId)
        defer { updatingIds.remove(module.moduleId) }
        do {
            let payload = try await service.setModuleEnabled(
                moduleId: module.moduleId,
                enabled: enabled,
                clientRequestId: ClientRequestID.next("modules")
            )
            if let index = modules.firstIndex(where: { $0.moduleId == payload.module.moduleId }) {
                modules[index] = payload.module
            }
            errorMessage = nil
            noticeMessage = AppL10n.text(.settingsSaved, language: language)
        } catch {
            errorMessage = SettingsMessages.error(error, language: language)
        }
    }

    public func dismissMessages() {
        errorMessage = nil
        noticeMessage = nil
    }

    public static func stateKey(_ state: ModuleState) -> AppString {
        switch state {
        case .loaded: return .settingsModuleStateLoaded
        case .active: return .settingsModuleStateActive
        case .inactive: return .settingsModuleStateInactive
        case .failed: return .settingsModuleStateFailed
        }
    }
}
