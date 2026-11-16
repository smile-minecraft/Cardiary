// 由 Boards.xcstrings 整理而成的執行期字串表。
// `BoardStringCatalogTests` 會逐 key 比對兩邊是否一致。
import Foundation

public enum BoardString: String, CaseIterable, Sendable {
    case boardsTitle
    case boardsSubtitle
    case boardsNew
    case boardsNewTitle
    case boardsBoardName
    case boardsCreate
    case boardsCancel
    case boardsLoading
    case boardsLoadFailed
    case boardsServiceUnavailable
    case boardsEmpty
    case boardsCreated
    case boardsSaved
    case boardsSaving
    case boardsSave
    case boardsConflict
    case boardsDelete
    case boardsDeleteConfirmTitle
    case boardsDeleteConfirmBody
    case boardsDeleted
    case boardsInbox
    case boardsInboxEmpty
    case boardsInboxHint
    case boardsMoveToCanvas
    case boardsRemoveProjection
    case boardsSelection
    case boardsNoSelection
    case boardsSendToConversation
    case boardsGenerateCard
    case boardsSentToConversation
    case boardsSendUnavailable
    case boardsNewCardTitle
    case boardsNewCardBody
    case boardsCreateCard
    case boardsCreating
    case boardsCardCreated
    case boardsPin
    case boardsUnpin
    case boardsPinned
    case boardsUndo
    case boardsRedo
    case boardsZoomIn
    case boardsZoomOut
    case boardsZoomFit
    case boardsAlignLeft
    case boardsAlignCenterX
    case boardsAlignRight
    case boardsAlignTop
    case boardsAlignMiddleY
    case boardsAlignBottom
    case boardsDropHint
    case boardsProjectFailed
    case boardsAgentModeNote
    case boardsCardCount
}

public enum BoardL10n {
    public static func text(_ key: BoardString, language: AppLanguage? = nil) -> String {
        resolve(key.rawValue, language: language)
    }

    public static func format(_ key: BoardString, _ values: [String: String], language: AppLanguage? = nil) -> String {
        var text = resolve(key.rawValue, language: language)
        for (name, value) in values {
            text = text.replacingOccurrences(of: "{\(name)}", with: value)
        }
        return text
    }

    public static func format(_ key: BoardString, value: String, language: AppLanguage? = nil) -> String {
        format(key, ["value": value], language: language)
    }

    public static func count(_ key: BoardString, count: Int, language: AppLanguage? = nil) -> String {
        format(key, ["count": "\(count)"], language: language)
    }

    static func table(_ language: AppLanguage) -> [String: String] {
        tables[language] ?? [:]
    }

    static var allKeys: [String] { BoardString.allCases.map(\.rawValue) }

    private static func resolve(_ key: String, language: AppLanguage?) -> String {
        let chosen = language ?? AppL10n.language
        return tables[chosen]?[key] ?? tables[.en]?[key] ?? key
    }

    private static let tables: [AppLanguage: [String: String]] = [
        .zhHant: [
            "boardsTitle": "白板",
            "boardsSubtitle": "{count} 個物件",
            "boardsNew": "新白板",
            "boardsNewTitle": "建立白板",
            "boardsBoardName": "白板名稱",
            "boardsCreate": "建立",
            "boardsCancel": "取消",
            "boardsLoading": "正在載入白板…",
            "boardsLoadFailed": "無法載入白板：{value}",
            "boardsServiceUnavailable": "還沒連上服務，白板需要連線。",
            "boardsEmpty": "還沒有白板。建立第一張，開始把卡片排在同一個平面上。",
            "boardsCreated": "已建立白板。",
            "boardsSaved": "已儲存白板。",
            "boardsSaving": "儲存中…",
            "boardsSave": "儲存",
            "boardsConflict": "白板在別處被改過，已載入最新版本。你的變更尚未存回。",
            "boardsDelete": "刪除白板",
            "boardsDeleteConfirmTitle": "刪除這張白板？",
            "boardsDeleteConfirmBody": "只會刪除白板上的排列，卡片本身不受影響。此動作無法復原。",
            "boardsDeleted": "已刪除白板。",
            "boardsInbox": "收件區",
            "boardsInboxEmpty": "收件區沒有東西。",
            "boardsInboxHint": "受限模式的代理只能把新卡放進收件區；確認後再移到畫布。",
            "boardsMoveToCanvas": "移到畫布",
            "boardsRemoveProjection": "取消投影",
            "boardsSelection": "已選 {count} 張",
            "boardsNoSelection": "點一張卡或框選多張。",
            "boardsSendToConversation": "送進對話",
            "boardsGenerateCard": "生成新卡",
            "boardsSentToConversation": "已把 {count} 張卡加入對話的上下文。",
            "boardsSendUnavailable": "先選一場對話，才能把圈選的卡片送進去。",
            "boardsNewCardTitle": "新卡標題",
            "boardsNewCardBody": "內容",
            "boardsCreateCard": "建立並投影",
            "boardsCreating": "正在建立…",
            "boardsCardCreated": "已在白板上建立新卡。",
            "boardsPin": "釘選",
            "boardsUnpin": "取消釘選",
            "boardsPinned": "已釘選",
            "boardsUndo": "復原",
            "boardsRedo": "重做",
            "boardsZoomIn": "放大",
            "boardsZoomOut": "縮小",
            "boardsZoomFit": "全部入鏡",
            "boardsAlignLeft": "靠左對齊",
            "boardsAlignCenterX": "水平置中",
            "boardsAlignRight": "靠右對齊",
            "boardsAlignTop": "靠上對齊",
            "boardsAlignMiddleY": "垂直置中",
            "boardsAlignBottom": "靠下對齊",
            "boardsDropHint": "放開以投影到白板",
            "boardsProjectFailed": "投影失敗：{value}",
            "boardsAgentModeNote": "代理白板權限切換只影響新開的對話；既有對話保留原本可用的工具。",
            "boardsCardCount": "{count} 張卡",
        ],
        .en: [
            "boardsTitle": "Boards",
            "boardsSubtitle": "{count} items",
            "boardsNew": "New Board",
            "boardsNewTitle": "Create a board",
            "boardsBoardName": "Board name",
            "boardsCreate": "Create",
            "boardsCancel": "Cancel",
            "boardsLoading": "Loading boards…",
            "boardsLoadFailed": "Could not load boards: {value}",
            "boardsServiceUnavailable": "The service is not connected; boards need a connection.",
            "boardsEmpty": "No boards yet. Create one to arrange cards on a single surface.",
            "boardsCreated": "Board created.",
            "boardsSaved": "Board saved.",
            "boardsSaving": "Saving…",
            "boardsSave": "Save",
            "boardsConflict": "The board changed elsewhere; the latest version is loaded. Your changes are not saved.",
            "boardsDelete": "Delete Board",
            "boardsDeleteConfirmTitle": "Delete this board?",
            "boardsDeleteConfirmBody": "Only the arrangement is deleted. The cards themselves are kept. This cannot be undone.",
            "boardsDeleted": "Board deleted.",
            "boardsInbox": "Inbox",
            "boardsInboxEmpty": "The inbox is empty.",
            "boardsInboxHint": "Agents in restricted mode can only place new cards in the inbox. Move them to the canvas after reviewing.",
            "boardsMoveToCanvas": "Move to Canvas",
            "boardsRemoveProjection": "Remove",
            "boardsSelection": "{count} selected",
            "boardsNoSelection": "Click a card or drag a marquee to select several.",
            "boardsSendToConversation": "Send to Conversation",
            "boardsGenerateCard": "Generate Card",
            "boardsSentToConversation": "Added {count} cards to the conversation context.",
            "boardsSendUnavailable": "Select a conversation before sending the selected cards.",
            "boardsNewCardTitle": "New card title",
            "boardsNewCardBody": "Body",
            "boardsCreateCard": "Create and Project",
            "boardsCreating": "Creating…",
            "boardsCardCreated": "Created a new card on the board.",
            "boardsPin": "Pin",
            "boardsUnpin": "Unpin",
            "boardsPinned": "Pinned",
            "boardsUndo": "Undo",
            "boardsRedo": "Redo",
            "boardsZoomIn": "Zoom In",
            "boardsZoomOut": "Zoom Out",
            "boardsZoomFit": "Zoom to Fit",
            "boardsAlignLeft": "Align Left",
            "boardsAlignCenterX": "Center Horizontally",
            "boardsAlignRight": "Align Right",
            "boardsAlignTop": "Align Top",
            "boardsAlignMiddleY": "Center Vertically",
            "boardsAlignBottom": "Align Bottom",
            "boardsDropHint": "Drop to project onto the board",
            "boardsProjectFailed": "Projection failed: {value}",
            "boardsAgentModeNote": "Changing the agent board permission only affects new conversations; existing conversations keep their tools.",
            "boardsCardCount": "{count} cards",
        ],
    ]
}
