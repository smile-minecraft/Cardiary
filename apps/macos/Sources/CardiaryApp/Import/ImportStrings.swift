import Foundation

/// 匯入介面的字串 key。
///
/// 這一份字串表屬於 `Import` 目錄：翻譯來源檔是
/// `Resources/Import.xcstrings`，執行時用編譯進程式的字典（與 `AppL10n`
/// 同一個做法，殼以 SPM 建置後不一定有資源 bundle）。`ImportStringsTests`
/// 會逐 key 比對兩邊。
public enum ImportString: String, CaseIterable, Sendable {
    case importTitle
    case importSubtitle
    case importSources
    case importSourceUnavailable
    case importSourceUnverified
    case importChooseFolder
    case importNeedsConnection
    case importCategoriesTitle
    case importCategoryPersona
    case importCategoryUser
    case importCategoryMemory
    case importCategoryRule
    case importCategorySkill
    case importCategoryConversation
    case importPersonaProvided
    case importPersonaPlaceholder
    case importIncludeConversations
    case importRangeStart
    case importRangeEnd
    case importRangeRequired
    case importEstimateTitle
    case importEstimateConversations
    case importEstimateTokens
    case importEstimateExisting
    case importPreview
    case importPreviewing
    case importWriting
    case importWrite
    case importNothingSelected
    case importSelectAll
    case importDeselectAll
    case importCoreMemory
    case importDuplicate
    case importReimport
    case importReimportDetail
    case importNewCards
    case importDuplicates
    case importSkippedTitle
    case importNotesTitle
    case importWarningsTitle
    case importResultTitle
    case importResultCards
    case importResultSkills
    case importFailed
    case importClose
    case importUnsupported
    case importProgress
}

/// `Import.xcstrings` 的內容；測試逐 key 比對。
enum ImportStrings {
    static let table: [AppLanguage: [String: String]] = [
        .zhHant: [
            "importTitle": "匯入",
            "importSubtitle": "從其他工具搬進 Cardiary：先預覽，再勾選要建立的卡片。",
            "importSources": "來源",
            "importSourceUnavailable": "這個來源目前無法讀取",
            "importSourceUnverified": "未驗證：{value}",
            "importChooseFolder": "選擇資料夾",
            "importNeedsConnection": "需要連上主機服務才能匯入。",
            "importCategoriesTitle": "每個檔案的類別",
            "importCategoryPersona": "人格",
            "importCategoryUser": "使用者資料",
            "importCategoryMemory": "記憶",
            "importCategoryRule": "操作規則",
            "importCategorySkill": "技能",
            "importCategoryConversation": "對話",
            "importPersonaProvided": "人格由你提供；Alma 沒有可匯入的人格檔。",
            "importPersonaPlaceholder": "貼上你的語氣、偏好與工作方式",
            "importIncludeConversations": "匯入對話摘要",
            "importRangeStart": "開始日期",
            "importRangeEnd": "結束日期",
            "importRangeRequired": "匯入對話要先指定時間範圍。",
            "importEstimateTitle": "預估用量",
            "importEstimateConversations": "{count} 段對話",
            "importEstimateTokens": "預估模型輸入 {count} 個 token",
            "importEstimateExisting": "{count} 段使用來源既有的摘要",
            "importPreview": "預覽",
            "importPreviewing": "正在預覽…",
            "importWriting": "正在寫入…",
            "importWrite": "寫入 {count} 張卡",
            "importNothingSelected": "先勾選要建立的項目。",
            "importSelectAll": "全選",
            "importDeselectAll": "取消全選",
            "importCoreMemory": "核心記憶候選",
            "importDuplicate": "已匯入過",
            "importReimport": "重新匯入已存在的卡片",
            "importReimportDetail": "打開後，標記為重複的項目可以勾選，再建立一份。",
            "importNewCards": "新卡片 {count} 張",
            "importDuplicates": "重複 {count} 張",
            "importSkippedTitle": "跳過的項目",
            "importNotesTitle": "來源觀察",
            "importWarningsTitle": "提醒",
            "importResultTitle": "匯入完成",
            "importResultCards": "建立了 {count} 張卡",
            "importResultSkills": "複製了 {count} 個技能",
            "importFailed": "匯入失敗：{value}",
            "importClose": "關閉",
            "importUnsupported": "不支援的格式",
            "importProgress": "第 {value} 項",
        ],
        .en: [
            "importTitle": "Import",
            "importSubtitle": "Bring your data from other tools: preview first, then choose what to create.",
            "importSources": "Sources",
            "importSourceUnavailable": "This source is not readable right now",
            "importSourceUnverified": "Unverified: {value}",
            "importChooseFolder": "Choose Folder",
            "importNeedsConnection": "Connect to the host service before importing.",
            "importCategoriesTitle": "Category for each file",
            "importCategoryPersona": "Persona",
            "importCategoryUser": "User Profile",
            "importCategoryMemory": "Memory",
            "importCategoryRule": "Operating Rule",
            "importCategorySkill": "Skill",
            "importCategoryConversation": "Conversation",
            "importPersonaProvided": "You provide the persona; Alma has no importable persona file.",
            "importPersonaPlaceholder": "Paste your tone, preferences and way of working",
            "importIncludeConversations": "Import conversation summaries",
            "importRangeStart": "Start date",
            "importRangeEnd": "End date",
            "importRangeRequired": "Choose a date range before importing conversations.",
            "importEstimateTitle": "Estimated usage",
            "importEstimateConversations": "{count} conversations",
            "importEstimateTokens": "Estimated model input: {count} tokens",
            "importEstimateExisting": "{count} use summaries already in the source",
            "importPreview": "Preview",
            "importPreviewing": "Previewing…",
            "importWriting": "Writing…",
            "importWrite": "Create {count} cards",
            "importNothingSelected": "Select at least one item.",
            "importSelectAll": "Select All",
            "importDeselectAll": "Deselect All",
            "importCoreMemory": "Core memory candidate",
            "importDuplicate": "Already imported",
            "importReimport": "Re-import existing cards",
            "importReimportDetail": "When on, items marked as duplicates can be selected to create another copy.",
            "importNewCards": "{count} new cards",
            "importDuplicates": "{count} duplicates",
            "importSkippedTitle": "Skipped",
            "importNotesTitle": "Source notes",
            "importWarningsTitle": "Warnings",
            "importResultTitle": "Import complete",
            "importResultCards": "Created {count} cards",
            "importResultSkills": "Copied {count} skills",
            "importFailed": "Import failed: {value}",
            "importClose": "Close",
            "importUnsupported": "Unsupported format",
            "importProgress": "Item {value}",
        ],
    ]
}

/// 匯入字串的查詢；介面語言跟 `AppL10n` 一致。
public enum ImportL10n {
    public static func text(_ key: ImportString, language: AppLanguage? = nil) -> String {
        let chosen = language ?? AppL10n.language
        return ImportStrings.table[chosen]?[key.rawValue]
            ?? ImportStrings.table[.en]?[key.rawValue]
            ?? key.rawValue
    }

    public static func count(_ key: ImportString, count: Int, language: AppLanguage? = nil) -> String {
        text(key, language: language)
            .replacingOccurrences(of: "{count}", with: "\(count)")
    }

    public static func format(
        _ key: ImportString,
        value: String,
        language: AppLanguage? = nil
    ) -> String {
        text(key, language: language)
            .replacingOccurrences(of: "{value}", with: value)
    }
}

/// 每一類中介格式的介面字串。
public extension ImportCategory {
    var titleKey: ImportString {
        switch self {
        case .persona: return .importCategoryPersona
        case .user: return .importCategoryUser
        case .memory: return .importCategoryMemory
        case .rule: return .importCategoryRule
        case .skill: return .importCategorySkill
        case .conversation: return .importCategoryConversation
        }
    }
}
