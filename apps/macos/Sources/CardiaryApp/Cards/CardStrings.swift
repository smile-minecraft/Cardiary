// 由 Cards.xcstrings、Inspector.xcstrings、Archive.xcstrings 整理而成的執行期字串表。
// 執行時不讀 bundle；`CardStringCatalogTests` 會逐 key 比對兩邊是否一致。
import Foundation

/// 卡片介面的三個字串表。
public enum CardStringCatalog: String, CaseIterable, Sendable {
    case cards = "Cards"
    case inspector = "Inspector"
    case archive = "Archive"
}

/// 可以在地化的一個 key。
public protocol CardLocalizedKey: CaseIterable, RawRepresentable, Sendable where RawValue == String {
    static var catalog: CardStringCatalog { get }
}

public enum CardsString: String, CaseIterable, CardLocalizedKey {
    case cardsAudioCard
    case cardsBacklinks
    case cardsBodyPlaceholder
    case cardsBroken
    case cardsConflictReloaded
    case cardsCount
    case cardsCreateAction
    case cardsCreated
    case cardsDeleteConfirmBody
    case cardsDeleteConfirmTitle
    case cardsDeleted
    case cardsDetailCancel
    case cardsDetailDelete
    case cardsDetailEdit
    case cardsDetailEmpty
    case cardsDetailFreshness
    case cardsDetailRefresh
    case cardsDetailSave
    case cardsDropHint
    case cardsEmpty
    case cardsExpired
    case cardsFreshnessHelp
    case cardsImageFailed
    case cardsImageLoading
    case cardsImportCreated
    case cardsImportFailed
    case cardsImportUnsupported
    case cardsImporting
    case cardsKindAudio
    case cardsKindBedrock
    case cardsKindImage
    case cardsKindMemory
    case cardsKindNote
    case cardsKindPersona
    case cardsKindSummary
    case cardsLinksNone
    case cardsLoadFailed
    case cardsLoading
    case cardsLoadingMore
    case cardsModeList
    case cardsModeOverview
    case cardsNearZero
    case cardsNew
    case cardsNewBody
    case cardsNewTags
    case cardsNewTitle
    case cardsNoResults
    case cardsOverviewHint
    case cardsRefresh
    case cardsSaved
    case cardsSearchAction
    case cardsSearchClear
    case cardsSearchPlaceholder
    case cardsServiceUnavailable
    case cardsSources
    case cardsTagAll
    case cardsTagLabel
    case cardsTitle
    public static let catalog: CardStringCatalog = .cards
}

public enum InspectorString: String, CaseIterable, CardLocalizedKey {
    case inspectorAddFailed
    case inspectorCompact
    case inspectorCompactFailed
    case inspectorCompacted
    case inspectorCompacting
    case inspectorCompactTimedOut
    case inspectorContextTitle
    case inspectorContextWindow
    case inspectorDealByRetrieval
    case inspectorDealPossiblyRelated
    case inspectorDealProbability
    case inspectorDealSmallModelQuality
    case inspectorDropHint
    case inspectorDropping
    case inspectorEmpty
    case inspectorEstimated
    case inspectorHeatGrid
    case inspectorLayerBedrock
    case inspectorLayerCoreMemory
    case inspectorLayerOtherCards
    case inspectorLayerWorkingContext
    case inspectorRemoveStale
    case inspectorLegendFresh
    case inspectorLegendStale
    case inspectorLegendStatic
    case inspectorLoadFailed
    case inspectorNoSession
    case inspectorNothingToCompact
    case inspectorOtherCards
    case inspectorPendingRemoval
    case inspectorRemove
    case inspectorRemoveFailed
    case inspectorSelectedTitle
    case inspectorTokens
    case inspectorTreemap
    case inspectorUsage
    case inspectorUsageNoBudget
    public static let catalog: CardStringCatalog = .inspector
}

public enum ArchiveString: String, CaseIterable, CardLocalizedKey {
    case archiveArchivedAt
    case archiveCount
    case archiveDaysUnknown
    case archiveDelete
    case archiveDeleteAssets
    case archiveDeleteCancel
    case archiveDeleteConfirm
    case archiveDeleteConfirmBody
    case archiveDeleteConfirmTitle
    case archiveDeleteExclusiveCards
    case archiveDeleteFailed
    case archiveDeleteSessions
    case archiveDeleteSharedCards
    case archiveDeleted
    case archiveDeleting
    case archiveEmpty
    case archiveLoadFailed
    case archivePreviewFailed
    case archivePreviewLoading
    case archivePreviewTitle
    case archivePurgeAt
    case archiveRefresh
    case archiveRemainingDays
    case archiveServiceUnavailable
    case archiveTitle
    case archiveUnarchive
    case archiveUnarchiveFailed
    case archiveUnarchived
    public static let catalog: CardStringCatalog = .archive
}

enum CardStringTables {
    static let cards: [AppLanguage: [String: String]] = [
        .zhHant: [
            "cardsAudioCard": "音訊卡",
            "cardsBacklinks": "反向連結",
            "cardsBodyPlaceholder": "在這裡編輯卡片內文…",
            "cardsBroken": "格式不符",
            "cardsConflictReloaded": "卡片在別處被改過，已重新載入最新版本。",
            "cardsCount": "共 {count} 張",
            "cardsCreateAction": "建立",
            "cardsCreated": "已建立卡片。",
            "cardsDeleteConfirmBody": "刪除後無法復原；仍有其他卡片使用的原檔會保留。",
            "cardsDeleteConfirmTitle": "刪除這張卡片？",
            "cardsDeleted": "已刪除卡片。",
            "cardsDetailCancel": "取消編輯",
            "cardsDetailDelete": "刪除卡片",
            "cardsDetailEdit": "編輯內文",
            "cardsDetailEmpty": "選一張卡片。",
            "cardsDetailFreshness": "新鮮度 {value}",
            "cardsDetailRefresh": "保鮮",
            "cardsFreshnessHelp": "新鮮度 {value}：越低越舊，歸零後按「保鮮」回到 100。",
            "cardsDetailSave": "儲存",
            "cardsDropHint": "把圖片或音訊拖進來建立卡片",
            "cardsEmpty": "還沒有卡片。",
            "cardsExpired": "已歸零",
            "cardsImageFailed": "圖片載入失敗。",
            "cardsImageLoading": "正在載入圖片…",
            "cardsImportCreated": "已匯入 {value}。",
            "cardsImportFailed": "匯入失敗：{value}",
            "cardsImportUnsupported": "只支援圖片與音訊檔。",
            "cardsImporting": "正在匯入 {value}…",
            "cardsKindAudio": "音訊",
            "cardsKindBedrock": "基岩",
            "cardsKindImage": "圖片",
            "cardsKindMemory": "記憶",
            "cardsKindNote": "筆記",
            "cardsKindPersona": "人格",
            "cardsKindSummary": "摘要",
            "cardsLinksNone": "沒有連結。",
            "cardsLoadFailed": "卡片載入失敗：{value}",
            "cardsLoading": "正在載入卡片…",
            "cardsLoadingMore": "正在載入更多…",
            "cardsModeList": "列表",
            "cardsModeOverview": "總覽",
            "cardsNearZero": "即將歸零",
            "cardsNew": "新卡片",
            "cardsNewBody": "內文",
            "cardsNewTags": "標籤（以逗號或頓號分隔）",
            "cardsNewTitle": "標題",
            "cardsNoResults": "沒有符合的卡片。",
            "cardsOverviewHint": "一格一張卡，顏色越淡代表越舊。",
            "cardsRefresh": "重新整理",
            "cardsSaved": "已儲存卡片。",
            "cardsSearchAction": "搜尋",
            "cardsSearchClear": "清除搜尋",
            "cardsSearchPlaceholder": "搜尋卡片",
            "cardsServiceUnavailable": "還沒連上服務，卡片庫需要連線。",
            "cardsSources": "來源卡片",
            "cardsTagAll": "全部標籤",
            "cardsTagLabel": "標籤",
            "cardsTitle": "卡片庫",
        ],
        .en: [
            "cardsAudioCard": "Audio card",
            "cardsBacklinks": "Backlinks",
            "cardsBodyPlaceholder": "Edit the card body here…",
            "cardsBroken": "Broken",
            "cardsConflictReloaded": "The card changed elsewhere; the latest revision is loaded.",
            "cardsCount": "{count} cards",
            "cardsCreateAction": "Create",
            "cardsCreated": "Card created.",
            "cardsDeleteConfirmBody": "This cannot be undone. Assets still referenced by other cards are kept.",
            "cardsDeleteConfirmTitle": "Delete this card?",
            "cardsDeleted": "Card deleted.",
            "cardsDetailCancel": "Cancel Editing",
            "cardsDetailDelete": "Delete Card",
            "cardsDetailEdit": "Edit Body",
            "cardsDetailEmpty": "Select a card.",
            "cardsDetailFreshness": "Freshness {value}",
            "cardsDetailRefresh": "Refresh",
            "cardsFreshnessHelp": "Freshness {value}: lower is older; press Refresh to return to 100.",
            "cardsDetailSave": "Save",
            "cardsDropHint": "Drop images or audio to create cards",
            "cardsEmpty": "No cards yet.",
            "cardsExpired": "Expired",
            "cardsImageFailed": "Could not load the image.",
            "cardsImageLoading": "Loading image…",
            "cardsImportCreated": "Imported {value}.",
            "cardsImportFailed": "Import failed: {value}",
            "cardsImportUnsupported": "Only images and audio are supported.",
            "cardsImporting": "Importing {value}…",
            "cardsKindAudio": "Audio",
            "cardsKindBedrock": "Bedrock",
            "cardsKindImage": "Image",
            "cardsKindMemory": "Memory",
            "cardsKindNote": "Note",
            "cardsKindPersona": "Persona",
            "cardsKindSummary": "Summary",
            "cardsLinksNone": "No links.",
            "cardsLoadFailed": "Could not load cards: {value}",
            "cardsLoading": "Loading cards…",
            "cardsLoadingMore": "Loading more…",
            "cardsModeList": "List",
            "cardsModeOverview": "Overview",
            "cardsNearZero": "Nearing zero",
            "cardsNew": "New Card",
            "cardsNewBody": "Body",
            "cardsNewTags": "Tags (comma separated)",
            "cardsNewTitle": "Title",
            "cardsNoResults": "No matching cards.",
            "cardsOverviewHint": "One cell per card; lighter means older.",
            "cardsRefresh": "Refresh",
            "cardsSaved": "Card saved.",
            "cardsSearchAction": "Search",
            "cardsSearchClear": "Clear Search",
            "cardsSearchPlaceholder": "Search cards",
            "cardsServiceUnavailable": "Not connected; the card library needs a connection.",
            "cardsSources": "Source Cards",
            "cardsTagAll": "All Tags",
            "cardsTagLabel": "Tag",
            "cardsTitle": "Cards",
        ],
    ]
    static let inspector: [AppLanguage: [String: String]] = [
        .zhHant: [
            "inspectorAddFailed": "加入上下文失敗：{value}",
            "inspectorCompact": "壓縮",
            "inspectorCompactFailed": "壓縮失敗：{value}",
            "inspectorCompacted": "已壓縮：{before} → {after} token",
            "inspectorCompacting": "正在壓縮…",
            "inspectorCompactTimedOut": "壓縮逾時，已解除等待；主機完成後畫面仍會更新。",
            "inspectorContextTitle": "上下文",
            "inspectorContextWindow": "模型上限 {count}",
            "inspectorDealByRetrieval": "由檢索排名發出",
            "inspectorDealPossiblyRelated": "可能相關",
            "inspectorDealProbability": "發牌機率",
            "inspectorDealSmallModelQuality": "System One 使用的是小模型，判斷品質有限",
            "inspectorDropHint": "把卡片拖進來加入上下文",
            "inspectorDropping": "放開以加入上下文",
            "inspectorEmpty": "這場對話的上下文還是空的。",
            "inspectorEstimated": "估算",
            "inspectorHeatGrid": "比例熱力格",
            "inspectorLayerBedrock": "基岩",
            "inspectorLayerCoreMemory": "核心記憶",
            "inspectorLayerOtherCards": "其他卡片",
            "inspectorLayerWorkingContext": "對話內容",
            "inspectorRemoveStale": "這個區塊已不在上下文，已重新整理",
            "inspectorLegendFresh": "新鮮",
            "inspectorLegendStale": "陳舊",
            "inspectorLegendStatic": "靜態層",
            "inspectorLoadFailed": "上下文載入失敗：{value}",
            "inspectorNoSession": "選一場對話，檢視它的上下文。",
            "inspectorNothingToCompact": "沒有可壓縮的內容。",
            "inspectorOtherCards": "其他 {count} 張",
            "inspectorPendingRemoval": "下次壓縮時移除",
            "inspectorRemove": "從上下文移除",
            "inspectorRemoveFailed": "移除失敗：{value}",
            "inspectorSelectedTitle": "已選區塊",
            "inspectorTokens": "{count} token",
            "inspectorTreemap": "矩形樹狀圖",
            "inspectorUsage": "{used} / {budget} token",
            "inspectorUsageNoBudget": "已用 {value} token；模型上限還沒取得。",
        ],
        .en: [
            "inspectorAddFailed": "Could not add to context: {value}",
            "inspectorCompact": "Compact",
            "inspectorCompactFailed": "Could not compact: {value}",
            "inspectorCompacted": "Compacted: {before} → {after} tokens",
            "inspectorCompacting": "Compacting…",
            "inspectorCompactTimedOut": "Compaction timed out; the wait was lifted. The view will update when the host finishes.",
            "inspectorContextTitle": "Context",
            "inspectorContextWindow": "Model window {count}",
            "inspectorDealByRetrieval": "Dealt by retrieval ranking",
            "inspectorDealPossiblyRelated": "Possibly relevant",
            "inspectorDealProbability": "Deal Probability",
            "inspectorDealSmallModelQuality": "System One is using a small model; judgment quality is limited",
            "inspectorDropHint": "Drag a card here to add it",
            "inspectorDropping": "Release to add to context",
            "inspectorEmpty": "This conversation has no context yet.",
            "inspectorEstimated": "Estimated",
            "inspectorHeatGrid": "Heat Grid",
            "inspectorLayerBedrock": "Bedrock",
            "inspectorLayerCoreMemory": "Core Memory",
            "inspectorLayerOtherCards": "Other Cards",
            "inspectorLayerWorkingContext": "Conversation",
            "inspectorRemoveStale": "This block is no longer in context and has been refreshed",
            "inspectorLegendFresh": "Fresh",
            "inspectorLegendStale": "Stale",
            "inspectorLegendStatic": "Static Layers",
            "inspectorLoadFailed": "Could not load the context: {value}",
            "inspectorNoSession": "Open a conversation to see its context.",
            "inspectorNothingToCompact": "Nothing to compact.",
            "inspectorOtherCards": "{count} more",
            "inspectorPendingRemoval": "Removed on next compaction",
            "inspectorRemove": "Remove from Context",
            "inspectorRemoveFailed": "Could not remove: {value}",
            "inspectorSelectedTitle": "Selected Block",
            "inspectorTokens": "{count} tokens",
            "inspectorTreemap": "Treemap",
            "inspectorUsage": "{used} / {budget} tokens",
            "inspectorUsageNoBudget": "Used {value} tokens; the model limit is not available yet.",
        ],
    ]
    static let archive: [AppLanguage: [String: String]] = [
        .zhHant: [
            "archiveArchivedAt": "封存於 {value}",
            "archiveCount": "共 {count} 場",
            "archiveDaysUnknown": "剩餘天數未知",
            "archiveDelete": "刪除…",
            "archiveDeleteAssets": "原檔：{count}",
            "archiveDeleteCancel": "取消",
            "archiveDeleteConfirm": "刪除",
            "archiveDeleteConfirmBody": "這會立即刪除對話與專屬卡片，無法復原；共用卡片與仍被引用的原檔會保留。",
            "archiveDeleteConfirmTitle": "刪除這場對話？",
            "archiveDeleteExclusiveCards": "專屬卡片：{count}",
            "archiveDeleteFailed": "刪除失敗：{value}",
            "archiveDeleteSessions": "對話（含支線）：{count}",
            "archiveDeleteSharedCards": "共用卡片（保留）：{count}",
            "archiveDeleted": "已刪除對話。",
            "archiveDeleting": "正在刪除…",
            "archiveEmpty": "沒有封存的對話。",
            "archiveLoadFailed": "封存區載入失敗：{value}",
            "archivePreviewFailed": "無法取得刪除範圍：{value}",
            "archivePreviewLoading": "正在計算刪除範圍…",
            "archivePreviewTitle": "刪除前確認",
            "archivePurgeAt": "將於 {value} 清除",
            "archiveRefresh": "重新整理",
            "archiveRemainingDays": "剩餘 {count} 天",
            "archiveServiceUnavailable": "還沒連上服務，封存區需要連線。",
            "archiveTitle": "封存區",
            "archiveUnarchive": "取消封存",
            "archiveUnarchiveFailed": "取消封存失敗：{value}",
            "archiveUnarchived": "已取消封存。",
        ],
        .en: [
            "archiveArchivedAt": "Archived {value}",
            "archiveCount": "{count} conversations",
            "archiveDaysUnknown": "Remaining days unknown",
            "archiveDelete": "Delete…",
            "archiveDeleteAssets": "Assets: {count}",
            "archiveDeleteCancel": "Cancel",
            "archiveDeleteConfirm": "Delete",
            "archiveDeleteConfirmBody": "This immediately deletes the conversation and its exclusive cards. Shared cards and still-referenced assets are kept.",
            "archiveDeleteConfirmTitle": "Delete this conversation?",
            "archiveDeleteExclusiveCards": "Exclusive cards: {count}",
            "archiveDeleteFailed": "Could not delete: {value}",
            "archiveDeleteSessions": "Conversations (with branches): {count}",
            "archiveDeleteSharedCards": "Shared cards (kept): {count}",
            "archiveDeleted": "Conversation deleted.",
            "archiveDeleting": "Deleting…",
            "archiveEmpty": "No archived conversations.",
            "archiveLoadFailed": "Could not load the archive: {value}",
            "archivePreviewFailed": "Could not preview deletion: {value}",
            "archivePreviewLoading": "Calculating what will be deleted…",
            "archivePreviewTitle": "Confirm Deletion",
            "archivePurgeAt": "Purges at {value}",
            "archiveRefresh": "Refresh",
            "archiveRemainingDays": "{count} days left",
            "archiveServiceUnavailable": "Not connected; the archive needs a connection.",
            "archiveTitle": "Archive",
            "archiveUnarchive": "Unarchive",
            "archiveUnarchiveFailed": "Could not unarchive: {value}",
            "archiveUnarchived": "Unarchived.",
        ],
    ]
}

/// 卡片介面的字串查詢。
public enum CardL10n {
    public static func text(_ key: CardsString, language: AppLanguage? = nil) -> String {
        resolve(key.rawValue, table: CardStringTables.cards, language: language)
    }

    public static func format(_ key: CardsString, _ values: [String: String], language: AppLanguage? = nil) -> String {
        replace(key.rawValue, table: CardStringTables.cards, language: language, values: values)
    }

    public static func format(_ key: CardsString, value: String, language: AppLanguage? = nil) -> String {
        format(key, ["value": value], language: language)
    }

    public static func count(_ key: CardsString, count: Int, language: AppLanguage? = nil) -> String {
        format(key, ["count": "\(count)"], language: language)
    }

    public static func text(_ key: InspectorString, language: AppLanguage? = nil) -> String {
        resolve(key.rawValue, table: CardStringTables.inspector, language: language)
    }

    public static func format(_ key: InspectorString, _ values: [String: String], language: AppLanguage? = nil) -> String {
        replace(key.rawValue, table: CardStringTables.inspector, language: language, values: values)
    }

    public static func format(_ key: InspectorString, value: String, language: AppLanguage? = nil) -> String {
        format(key, ["value": value], language: language)
    }

    public static func count(_ key: InspectorString, count: Int, language: AppLanguage? = nil) -> String {
        format(key, ["count": "\(count)"], language: language)
    }

    public static func text(_ key: ArchiveString, language: AppLanguage? = nil) -> String {
        resolve(key.rawValue, table: CardStringTables.archive, language: language)
    }

    public static func format(_ key: ArchiveString, _ values: [String: String], language: AppLanguage? = nil) -> String {
        replace(key.rawValue, table: CardStringTables.archive, language: language, values: values)
    }

    public static func format(_ key: ArchiveString, value: String, language: AppLanguage? = nil) -> String {
        format(key, ["value": value], language: language)
    }

    public static func count(_ key: ArchiveString, count: Int, language: AppLanguage? = nil) -> String {
        format(key, ["count": "\(count)"], language: language)
    }

    /// 一份語言的字串表，給逐 key 比對的測試用。
    public static func table(_ catalog: CardStringCatalog, language: AppLanguage) -> [String: String] {
        switch catalog {
        case .cards: return CardStringTables.cards[language] ?? [:]
        case .inspector: return CardStringTables.inspector[language] ?? [:]
        case .archive: return CardStringTables.archive[language] ?? [:]
        }
    }

    static func catalogKeys(_ catalog: CardStringCatalog) -> [String] {
        switch catalog {
        case .cards: return CardsString.allCases.map(\.rawValue)
        case .inspector: return InspectorString.allCases.map(\.rawValue)
        case .archive: return ArchiveString.allCases.map(\.rawValue)
        }
    }

    private static func resolve(
        _ rawKey: String,
        table: [AppLanguage: [String: String]],
        language: AppLanguage?
    ) -> String {
        let chosen = language ?? AppL10n.language
        return table[chosen]?[rawKey] ?? table[.en]?[rawKey] ?? rawKey
    }

    private static func replace(
        _ rawKey: String,
        table: [AppLanguage: [String: String]],
        language: AppLanguage?,
        values: [String: String]
    ) -> String {
        var text = resolve(rawKey, table: table, language: language)
        for (name, value) in values {
            text = text.replacingOccurrences(of: "{\(name)}", with: value)
        }
        return text
    }
}
