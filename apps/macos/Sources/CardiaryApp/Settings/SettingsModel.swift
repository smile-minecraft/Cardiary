import CardiaryKit
import CardiaryShellCore
import Combine
import Foundation

/// 設定頁的根狀態：模型、一般設定與模組三個分頁共用一條服務連線。
///
/// 分頁各自維護自己的資料，只有在畫面出現時才載入；連線換掉時一起換掉服務，
/// 不保留上一條連線的資料。
@MainActor
public final class SettingsModel: ObservableObject {
    public let models: ModelsSettingsModel
    public let general: GeneralSettingsModel
    public let modules: ModulesSettingsModel

    public init(
        keychain: (any KeychainWriting)? = nil,
        language: AppLanguage = AppL10n.language
    ) {
        self.models = ModelsSettingsModel(keychain: keychain, language: language)
        self.general = GeneralSettingsModel(language: language)
        self.modules = ModulesSettingsModel(language: language)
    }

    public func attach(service: any CardiaryService) {
        models.attach(service: service)
        general.attach(service: service)
        modules.attach(service: service)
    }

    public func detach() {
        models.detach()
        general.detach()
        modules.detach()
    }
}

/// 三個分頁共用的錯誤與提示文字。
enum SettingsMessages {
    static func error(_ error: any Error, language: AppLanguage) -> String {
        let detail = (error as? CardiaryClientError)?.errorDescription ?? "\(error)"
        return AppL10n.format(.settingsRequestFailed, value: detail, language: language)
    }
}
