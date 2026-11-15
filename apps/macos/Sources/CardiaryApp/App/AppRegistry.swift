import SwiftUI

/// App 啟動時註冊的固定位置。其他介面工作只呼叫這裡的註冊表掛上自己的畫面，
/// 不需要改 `App/` 的檔案。
enum AppRegistry {
    /// 內建的對話入口；左側欄用它顯示對話清單，不是一般的位置。
    static let conversationsSlotId = "conversations"
    /// 設定頁的位置。
    static let settingsSlotId = "settings"
    /// 卡片庫與封存區的位置；內容由卡片介面提供。
    static let cardsSlotId = "cards"
    static let archiveSlotId = "archive"
    /// 檢視欄的上下文面板；卡片介面提供實作。
    static let contextInspectorId = "context"
    /// 選單群組：卡片與匯入。
    static let cardCommandsGroupId = "cards"
    static let importCommandsGroupId = "import"

    @MainActor
    static func installBuiltins(_ app: AppModel) {
        app.sidebar.register(SidebarSlot(
            id: conversationsSlotId,
            titleKey: .sidebarSectionSession,
            systemImage: "bubble.left.and.bubble.right"
        ))
        // 卡片庫與封存區：位置在這裡保留，內容由 `CardUIModule.install` 掛上。
        app.sidebar.register(SidebarSlot(
            id: cardsSlotId,
            titleKey: .destinationCards,
            systemImage: "square.grid.2x2",
            placeholderKey: .placeholderCards
        ))
        app.sidebar.register(SidebarSlot(
            id: archiveSlotId,
            titleKey: .destinationArchive,
            systemImage: "archivebox",
            placeholderKey: .placeholderArchive
        ))
        // 通知、白板與文件：M1 只保留入口。
        app.sidebar.register(SidebarSlot(
            id: "notifications",
            titleKey: .destinationNotifications,
            systemImage: "bell"
        ))
        app.sidebar.register(SidebarSlot(
            id: "whiteboard",
            titleKey: .destinationWhiteboard,
            systemImage: "rectangle.on.rectangle"
        ))
        app.sidebar.register(SidebarSlot(
            id: "documents",
            titleKey: .destinationDocuments,
            systemImage: "doc.text"
        ))
        app.sidebar.register(SidebarSlot(
            id: settingsSlotId,
            titleKey: .settingsTitle,
            systemImage: "gearshape"
        ))

        // 檢視欄：審批面板是真的實作；上下文面板由卡片介面提供。
        app.inspector.register(ApprovalInspectorPanel(model: app.approvals))
        app.inspector.register(PlaceholderInspectorPanel(
            id: contextInspectorId,
            titleKey: .inspectorTitle,
            messageKey: .placeholderInspector
        ))

        // 設定分頁：模型、一般設定與模組。卡片相關設定由卡片介面再加一頁。
        app.settings.register(ModelsSettingsTab(model: app.settingsModel.models))
        app.settings.register(GeneralSettingsTab(model: app.settingsModel.general))
        app.settings.register(ModulesSettingsTab(model: app.settingsModel.modules))

        // 選單：主視窗自己的「檢視」，以及留給卡片與匯入的空群組。
        app.commands.register(CommandGroup(
            id: "view",
            titleKey: .commandGroupView,
            commands: [
                AppCommand(id: "view.toggleInspector", titleKey: .commandToggleInspector) {
                    app.toggleInspector()
                }
            ]
        ))
        app.commands.register(CommandGroup(
            id: cardCommandsGroupId,
            titleKey: .commandGroupCards
        ))
        app.commands.register(CommandGroup(
            id: importCommandsGroupId,
            titleKey: .commandGroupImport
        ))

        // 卡片庫、封存區、檢視欄、卡片設定與匯入：一次掛上。
        CardUIModule.install(app)
        ImportUIModule.install(app)
    }
}
