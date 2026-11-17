import Foundation

/// 介面字串。繁體中文與英文從第一天就都有；缺任何一邊會被測試擋下。
///
/// 用程式內的雙語表而不是 `.strings`，是因為這個殼以 SPM 建置、再手動組成
/// `.app`，資源 bundle 的路徑不穩；字串表讓兩邊的內容都能被單元測試覆蓋。
public enum L10n {
    public enum Language: String, CaseIterable, Sendable {
        case zhHant = "zh-Hant"
        case en
    }

    public enum Key: String, CaseIterable, Sendable {
        case appName
        case menuStatus
        case menuApprovals
        case menuApprovalsNone
        case menuApprovalsCount
        case menuPauseAll
        case menuStopService
        case menuChooseFolder
        case menuOpenFolder
        case menuLaunchAtLogin
        case menuQuit
        case menuFolderSection
        case menuServiceSection

        case menuEdit
        case menuUndo
        case menuRedo
        case menuCut
        case menuCopy
        case menuPaste
        case menuSelectAll

        case serviceIdle
        case serviceStarting
        case serviceRunning
        case servicePaused
        case serviceUnavailable
        case serviceFailed
        case serviceStopping
        case serviceStopped

        case folderUnselected
        case folderVerifying
        case folderReady
        case folderPaused
        case folderUnavailable
        case folderMismatch
        case folderMigrating
        case folderMigrationFailed

        case unavailableTitle
        case unavailableBody
        case unavailableChooseFolder
        case unavailableRetry
        case unavailableVersionMismatch

        case nonAPFSWarningTitle
        case nonAPFSWarningBody

        case firstRunTitle
        case firstRunBody
        case firstRunChooseFolder

        case storageShellState
        case statusRestarts
        case statusLastError
        case statusApprovalsUnavailable
        case serviceBusyBody
        case selectFolderPrompt
    }

    /// 目前使用的語言。預設依系統偏好；測試會直接指定。
    public static var language: Language = defaultLanguage()

    public static func defaultLanguage(preferred: [String] = Locale.preferredLanguages) -> Language {
        for identifier in preferred {
            let lower = identifier.lowercased()
            if lower.hasPrefix("zh-hant") || lower.hasPrefix("zh-tw") || lower.hasPrefix("zh-hk") {
                return .zhHant
            }
            if lower.hasPrefix("zh") {
                // 簡中也先給繁中，M0 沒有簡中字串。
                return .zhHant
            }
            if lower.hasPrefix("en") {
                return .en
            }
        }
        return .en
    }

    public static func text(_ key: Key, language: Language? = nil) -> String {
        let chosen = language ?? self.language
        return table(chosen)[key] ?? table(.en)[key] ?? key.rawValue
    }

    /// 帶一個 `{count}` 佔位字串的版本。
    public static func count(_ key: Key, count: Int, language: Language? = nil) -> String {
        text(key, language: language).replacingOccurrences(of: "{count}", with: "\(count)")
    }

    /// 把 `{count}` 換成任意字串（用來放錯誤訊息）。
    public static func format(_ key: Key, value: String, language: Language? = nil) -> String {
        text(key, language: language).replacingOccurrences(of: "{count}", with: value)
    }

    public static func table(_ language: Language) -> [Key: String] {
        switch language {
        case .zhHant: return zhHant
        case .en: return en
        }
    }

    private static let zhHant: [Key: String] = [
        .appName: "Cardiary",
        .menuStatus: "狀態",
        .menuApprovals: "待審批",
        .menuApprovalsNone: "沒有待審批",
        .menuApprovalsCount: "{count} 件待審批",
        .menuPauseAll: "緊急全部暫停",
        .menuStopService: "結束背景服務",
        .menuChooseFolder: "選擇資料夾…",
        .menuOpenFolder: "在 Finder 中開啟資料夾",
        .menuLaunchAtLogin: "登入時啟動",
        .menuQuit: "結束 Cardiary",
        .menuFolderSection: "資料夾",
        .menuServiceSection: "背景服務",
        .menuEdit: "編輯",
        .menuUndo: "復原",
        .menuRedo: "重做",
        .menuCut: "剪下",
        .menuCopy: "複製",
        .menuPaste: "貼上",
        .menuSelectAll: "全選",

        .serviceIdle: "未啟動",
        .serviceStarting: "啟動中…",
        .serviceRunning: "執行中",
        .servicePaused: "已暫停",
        .serviceUnavailable: "資料不可用",
        .serviceFailed: "服務無法啟動",
        .serviceStopping: "正在結束…",
        .serviceStopped: "已停止",

        .folderUnselected: "尚未選擇資料夾",
        .folderVerifying: "正在確認資料夾…",
        .folderReady: "資料夾可用",
        .folderPaused: "資料夾已暫停",
        .folderUnavailable: "資料夾不在",
        .folderMismatch: "這不是同一個 Cardiary 資料夾",
        .folderMigrating: "正在搬移資料夾…",
        .folderMigrationFailed: "資料夾搬移失敗",

        .unavailableTitle: "資料不可用",
        .unavailableBody: "Cardiary 找不到你的資料夾。它可能所在的磁碟沒有接上，或資料夾被移走了。接回磁碟後會自動繼續；Cardiary 不會建立新的空資料夾。",
        .unavailableChooseFolder: "選擇資料夾…",
        .unavailableRetry: "再試一次",
        .unavailableVersionMismatch: "背景服務的版本與這個 App 不符，請更新 Cardiary。",

        .nonAPFSWarningTitle: "這個磁碟不是 APFS",
        .nonAPFSWarningBody: "資料夾所在的磁碟格式是 {format}。資料庫在非 APFS 的磁碟上比較容易損毀，建議把資料夾放在 APFS 磁碟。",
        .firstRunTitle: "選擇 Cardiary 資料夾",
        .firstRunBody: "Cardiary 會把卡片、快取與設定放在你選的資料夾。選好之後，下次啟動會自動接上同一個資料夾。",
        .firstRunChooseFolder: "選擇資料夾…",

        .storageShellState: "殼狀態",
        .statusRestarts: "已重啟 {count} 次",
        .statusLastError: "最近錯誤：{count}",
        .statusApprovalsUnavailable: "待審批數量需要連上服務",
        .serviceBusyBody: "背景服務正在處理上一個操作（暫停、恢復或刪除）。請稍後再試一次。",
        .selectFolderPrompt: "選擇 Cardiary 資料夾",
    ]

    private static let en: [Key: String] = [
        .appName: "Cardiary",
        .menuStatus: "Status",
        .menuApprovals: "Approvals",
        .menuApprovalsNone: "No pending approvals",
        .menuApprovalsCount: "{count} pending",
        .menuPauseAll: "Pause all now",
        .menuStopService: "Stop background service",
        .menuChooseFolder: "Choose Folder…",
        .menuOpenFolder: "Reveal Folder in Finder",
        .menuLaunchAtLogin: "Launch at Login",
        .menuQuit: "Quit Cardiary",
        .menuFolderSection: "Folder",
        .menuServiceSection: "Background Service",
        .menuEdit: "Edit",
        .menuUndo: "Undo",
        .menuRedo: "Redo",
        .menuCut: "Cut",
        .menuCopy: "Copy",
        .menuPaste: "Paste",
        .menuSelectAll: "Select All",

        .serviceIdle: "Not started",
        .serviceStarting: "Starting…",
        .serviceRunning: "Running",
        .servicePaused: "Paused",
        .serviceUnavailable: "Data unavailable",
        .serviceFailed: "Service failed",
        .serviceStopping: "Stopping…",
        .serviceStopped: "Stopped",

        .folderUnselected: "No folder selected",
        .folderVerifying: "Checking folder…",
        .folderReady: "Folder available",
        .folderPaused: "Folder paused",
        .folderUnavailable: "Folder not found",
        .folderMismatch: "Not the same Cardiary folder",
        .folderMigrating: "Moving folder…",
        .folderMigrationFailed: "Folder move failed",

        .unavailableTitle: "Data unavailable",
        .unavailableBody: "Cardiary cannot find your folder. The disk may not be connected, or the folder was moved. It resumes automatically when the disk is back; Cardiary never creates an empty folder.",
        .unavailableChooseFolder: "Choose Folder…",
        .unavailableRetry: "Try Again",
        .unavailableVersionMismatch: "The background service version does not match this app. Please update Cardiary.",

        .nonAPFSWarningTitle: "This disk is not APFS",
        .nonAPFSWarningBody: "The folder is on a {format} disk. Databases are more likely to be damaged on non-APFS disks; consider moving the folder to an APFS disk.",
        .firstRunTitle: "Choose a Cardiary folder",
        .firstRunBody: "Cardiary keeps cards, caches and settings in the folder you choose. Next launch it reconnects to the same folder automatically.",
        .firstRunChooseFolder: "Choose Folder…",

        .storageShellState: "Shell state",
        .statusRestarts: "Restarted {count} times",
        .statusLastError: "Last error: {count}",
        .statusApprovalsUnavailable: "Approvals need a service connection",
        .serviceBusyBody: "The background service is finishing another operation (pause, resume or delete). Try again in a moment.",
        .selectFolderPrompt: "Choose a Cardiary folder",
    ]
}
