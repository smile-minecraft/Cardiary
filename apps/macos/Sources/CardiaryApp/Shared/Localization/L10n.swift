import Foundation

/// 介面語言。產品只有繁體中文與英文，兩邊都要完整。
public enum AppLanguage: String, CaseIterable, Sendable {
    case zhHant = "zh-Hant"
    case en

    /// 依系統偏好挑語言；沒有對應的語言就用英文。
    public static func systemDefault(preferred: [String] = Locale.preferredLanguages) -> AppLanguage {
        for identifier in preferred {
            let lower = identifier.lowercased()
            if lower.hasPrefix("zh-hant") || lower.hasPrefix("zh-tw") || lower.hasPrefix("zh-hk") {
                return .zhHant
            }
            if lower.hasPrefix("zh") {
                // 簡中也先給繁中：M1 沒有簡中字串。
                return .zhHant
            }
            if lower.hasPrefix("en") {
                return .en
            }
        }
        return .en
    }
}

/// 一個 `.xcstrings` 字串表。
public enum StringCatalogName: String, CaseIterable, Sendable {
    /// 產品介面共用的字串。
    case localizable = "Localizable"
    /// 殼（選單列、主視窗標題）用的字串。
    case shell = "Shell"
}

/// 可以在地化的一組 key。每個 key 自己知道在哪一個字串表。
public protocol LocalizedKey: RawRepresentable, CaseIterable, Sendable where RawValue == String {
    static var catalog: StringCatalogName { get }
}

/// 產品介面的字串。新增字串時，`Localizable.xcstrings` 也要同時補上兩個語言，
/// `LocalizationTests` 會逐 key 比對。
public enum AppString: String, CaseIterable, LocalizedKey {
    case appTitle
    case sidebarSectionSession
    case sidebarSectionLibrary
    case sidebarSectionTools
    case sidebarSectionArchive
    case sidebarSectionComingSoon
    case destinationConversations
    case destinationNotifications
    case destinationWhiteboard
    case destinationDocuments
    case destinationCards
    case destinationArchive
    case placeholderComingSoon
    case placeholderCards
    case placeholderArchive
    case placeholderInspector
    case inspectorTitle
    case inspectorShow
    case inspectorHide
    case inspectorApprovalsTitle
    case inspectorApprovalsEmpty
    case approvalAlways
    case approvalAlwaysHelp
    case approvalAlwaysSchedule
    case approvalAlwaysSettings
    case approvalAlwaysTool
    case approvalApprove
    case approvalApproved
    case approvalDeciding
    case approvalOptionUnavailable
    case approvalPauseAll
    case approvalPauseAllBody
    case approvalPauseAllConfirm
    case approvalPauseUnavailable
    case approvalPaused
    case approvalReject
    case approvalRejected
    case approvalServiceUnavailable
    case approvalSourceSchedule
    case approvalTool
    case inspectorAgentsTitle
    case inspectorAgentsEmpty
    case agentsUnavailable
    case agentKindOpencode
    case agentKindClaudeCode
    case agentClaudeTokenTitle
    case agentClaudeTokenPlaceholder
    case agentClaudeTokenHint
    case agentClaudeTokenSave
    case agentClaudeTokenSaved
    case agentClaudeTokenEmpty
    case agentClaudeTokenUnavailable
    case agentClaudeTokenSaveFailed
    case agentStatusStarting
    case agentStatusRunning
    case agentStatusWaitingApproval
    case agentStatusStopped
    case agentStatusFailed
    case agentResultUnknown
    case agentResultUnknownHelp
    case agentWorkingDirectory
    case agentPermissionTitle
    case agentProgressStep
    case agentServiceUnavailable
    case agentStartTitle
    case agentStartKind
    case agentStartDirectory
    case agentStartPrompt
    case agentStartPromptPlaceholder
    case agentStartAction
    case agentStartNeedsApproval
    case agentStartInvalidDirectory
    case agentStartedNotice
    case agentStopAction
    case agentStoppedNotice
    case agentStopNotAppliedNotice
    case connectionConnecting
    case connectionDisconnected
    case connectionRetry
    case unavailableTitle
    case unavailableBody
    case unavailableChooseFolder
    case unavailableRetry
    case updateRequiredTitle
    case updateRequiredBody
    case folderLabel
    case firstRunTitle
    case firstRunBody
    case firstRunStepFolder
    case firstRunStepModel
    case firstRunStepConversation
    case firstRunFolderBody
    case firstRunFolderChosen
    case firstRunImportAction
    case firstRunImportHint
    case firstRunModelBody
    case firstRunProvider
    case firstRunModel
    case firstRunSaveModel
    case firstRunModelSaved
    case firstRunSkipModel
    case firstRunStartConversation
    case conversationNew
    case conversationUntitled
    case conversationArchive
    case conversationListEmpty
    case conversationSelectPrompt
    case conversationInputPlaceholder
    case conversationSend
    case conversationDeliveryQueue
    case conversationDeliverySteer
    case conversationInterrupt
    case conversationLoadOlder
    case conversationLoadingOlder
    case conversationNoMoreHistory
    case conversationResend
    case conversationResending
    case conversationToolCall
    case conversationToolResult
    case conversationToolRunning
    case conversationToolComplete
    case conversationToolFailed
    case conversationStreaming
    case conversationError
    case conversationEmptyInput
    case statusWaitingApproval
    case statusRunning
    case statusIdle
    case settingsTitle
    case settingsRemoteTab
    case settingsPermissionsTab
    case settingsModelsTab
    case settingsGeneralTab
    case settingsAddProvider
    case settingsCredentialAccount
    case settingsCredentialFailed
    case settingsCredentialMissingKey
    case settingsCredentialPlaceholder
    case settingsCredentialSave
    case settingsCredentialSet
    case settingsCredentialStored
    case settingsGeneralEmpty
    case settingsLevelApproval
    case settingsLevelFree
    case settingsLevelHumanOnly
    case settingsSummaryMaxOutputTokensBody
    case settingsSummaryMaxOutputTokensTitle
    case settingsRequestFailed
    case settingsLoading
    case settingsModuleEnabled
    case settingsModuleFailed
    case settingsModuleStateActive
    case settingsModuleStateFailed
    case settingsModuleStateInactive
    case settingsModuleStateLoaded
    case settingsModuleVersion
    case settingsModulesEmpty
    case settingsMcpTab
    case settingsModulesTab
    case settingsStorageTab
    case settingsProviderAdd
    case settingsProviderBaseURL
    case settingsProviderDuplicateID
    case settingsProviderId
    case settingsProviderInvalid
    case settingsProviderInvalidID
    case settingsProviderKind
    case settingsProviderKindAPIKey
    case settingsProviderKindAggregator
    case settingsProviderKindLocal
    case settingsProviderModelCount
    case settingsProviderModels
    case settingsProviderName
    case settingsProviders
    case settingsProvidersEmpty
    case settingsResolved
    case settingsResolvedSourceFallbackMain
    case settingsResolvedSourceFallbackSmall
    case settingsResolvedSourceNone
    case settingsRoleMain
    case settingsRoleNone
    case settingsRoleSave
    case settingsRoleSaved
    case settingsRoleSmall
    case settingsRoleSystemOne
    case settingsRoleUnset
    case settingsRoleWriting
    case settingsRoles
    case settingsSave
    case settingsSaved
    case settingsServiceUnavailable
    case settingsValueInvalid
    case settingsValuePlaceholder
    case storageCategoryAssets
    case storageCategoryCache
    case storageCategoryCards
    case storageCategoryLogs
    case storageCategoryShellState
    case storageCategoryState
    case storageCategoryTmp
    case storageCleanable
    case storageCleanupApply
    case storageCleanupCategoryIndexes
    case storageCleanupDone
    case storageCleanupNothing
    case storageCleanupPreview
    case storageCleanupTitle
    case storageOutsideAbsent
    case storageOutsideToolClaudeCode
    case storageOutsideUnavailable
    case storageOutsideWritesNote
    case storageOutsideWritesTitle
    case storagePreviewItems
    case storagePreviewTotal
    case storageShellStateNote
    case storageUsageEmpty
    case storageUsageTitle
    case genericRetry
    case genericCancel
    case genericClose
    case messageRoleUser
    case messageRoleAssistant
    case commandGroupCards
    case commandGroupImport
    case commandGroupView
    case commandToggleInspector
    case markdownCopyCode
    case markdownCopied
    case markdownCodeBlock
    case viewZoomIn
    case viewZoomOut
    case viewActualSize
    case settingsDisplaySection
    case settingsZoomLabel
    case settingsZoomHint
    case settingsZoomReset

    public static let catalog = StringCatalogName.localizable
}

/// 殼的字串：選單列新增的項目與主視窗標題。
public enum ShellString: String, CaseIterable, LocalizedKey {
    case mainWindowTitle
    case menuOpenMainWindow
    case menuApprovalsCount
    case menuApprovalsNone
    case menuApprovalsUnavailable
    case menuPauseAll

    public static let catalog = StringCatalogName.shell
}

/// 字串查詢。字串表編譯進執行檔（`StringTables`），執行時不讀資源 bundle：
/// 殼以 SPM 建置再手動組成 `.app`，資源 bundle 不一定在執行檔旁邊。
/// `.xcstrings` 仍是翻譯的來源檔，`LocalizationTests` 會逐 key 比對兩邊。
public enum AppL10n {
    /// 目前介面語言。預設依系統偏好；殼可以跟著系統語言設定一次。
    public static var language: AppLanguage = .systemDefault()

    public static func text(_ key: AppString, language: AppLanguage? = nil) -> String {
        resolve(key.rawValue, table: StringTables.localizable, language: language)
    }

    public static func text(_ key: ShellString, language: AppLanguage? = nil) -> String {
        resolve(key.rawValue, table: StringTables.shell, language: language)
    }

    /// 帶 `{count}` 佔位符的版本。
    public static func count(_ key: AppString, count: Int, language: AppLanguage? = nil) -> String {
        text(key, language: language).replacingOccurrences(of: "{count}", with: "\(count)")
    }

    public static func count(_ key: ShellString, count: Int, language: AppLanguage? = nil) -> String {
        text(key, language: language).replacingOccurrences(of: "{count}", with: "\(count)")
    }

    /// 帶 `{value}` 佔位符的版本。
    public static func format(_ key: AppString, value: String, language: AppLanguage? = nil) -> String {
        text(key, language: language).replacingOccurrences(of: "{value}", with: value)
    }

    public static func format(_ key: ShellString, value: String, language: AppLanguage? = nil) -> String {
        text(key, language: language).replacingOccurrences(of: "{value}", with: value)
    }

    /// 一份語言的字串表，給逐 key 比對的測試用。
    public static func table(_ name: StringCatalogName, language: AppLanguage) -> [String: String] {
        switch name {
        case .localizable: return StringTables.localizable[language] ?? [:]
        case .shell: return StringTables.shell[language] ?? [:]
        }
    }

    /// 測試替換用；傳 nil 回到內建的字串表。
    static func useTables(_ table: [String: String]?) {
        overrideTable = table
    }

    private static var overrideTable: [String: String]?

    private static func resolve(
        _ key: String,
        table: [AppLanguage: [String: String]],
        language: AppLanguage?
    ) -> String {
        if let overrideTable { return overrideTable[key] ?? key }
        let chosen = language ?? self.language
        return table[chosen]?[key] ?? table[.en]?[key] ?? key
    }
}
