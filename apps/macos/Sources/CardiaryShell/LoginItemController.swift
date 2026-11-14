import Foundation
import CardiaryShellCore
import ServiceManagement

/// 開機自啟。發行版把 App 放在 `/Applications`，以 `SMAppService.mainApp` 註冊；
/// 開發時在 worktree 也能註冊（spike 已驗證）。
final class LoginItemController {
    var isEnabled: Bool {
        SMAppService.mainApp.status == .enabled
    }

    func setEnabled(_ enabled: Bool) throws {
        if enabled {
            if SMAppService.mainApp.status != .enabled {
                try SMAppService.mainApp.register()
            }
        } else {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            }
        }
    }
}
