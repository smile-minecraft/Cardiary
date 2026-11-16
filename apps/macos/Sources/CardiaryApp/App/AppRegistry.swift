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
    /// 白板的位置；圖示用方塊花色。
    static let boardsSlotId = "whiteboard"
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
            systemImage: "bubble.left.and.bubble.right.fill"
        ))
        // 卡片庫與封存區：位置在這裡保留，內容由 `CardUIModule.install` 掛上。
        app.sidebar.register(SidebarSlot(
            id: cardsSlotId,
            titleKey: .destinationCards,
            systemImage: "rectangle.stack.fill",
            placeholderKey: .placeholderCards
        ))
        app.sidebar.register(SidebarSlot(
            id: archiveSlotId,
            titleKey: .destinationArchive,
            systemImage: "archivebox.fill",
            placeholderKey: .placeholderArchive
        ))
        // 通知、白板與文件：M1 只保留入口。
        app.sidebar.register(SidebarSlot(
            id: "notifications",
            titleKey: .destinationNotifications,
            systemImage: "bell.fill"
        ))
        app.sidebar.register(SidebarSlot(
            id: boardsSlotId,
            titleKey: .destinationWhiteboard,
            systemImage: "square.grid.2x2.fill"
        ))
        app.sidebar.register(SidebarSlot(
            id: "documents",
            titleKey: .destinationDocuments,
            systemImage: "doc.text.fill"
        ))
        app.sidebar.register(SidebarSlot(
            id: settingsSlotId,
            titleKey: .settingsTitle,
            systemImage: "gearshape.fill"
        ))

        // 檢視欄：審批與外部代理是真的實作；上下文面板由卡片介面提供。
        app.inspector.register(ApprovalInspectorPanel(model: app.approvals))
        app.inspector.register(AgentsInspectorPanel(model: app.agents))
        app.inspector.register(PlaceholderInspectorPanel(
            id: contextInspectorId,
            titleKey: .inspectorTitle,
            messageKey: .placeholderInspector
        ))

        // 設定分頁：模型、一般設定、模組、儲存空間與 MCP。卡片相關設定由卡片介面再加一頁。
        app.settings.register(ModelsSettingsTab(model: app.settingsModel.models))
        app.settings.register(GeneralSettingsTab(model: app.settingsModel.general))
        app.settings.register(ModulesSettingsTab(model: app.settingsModel.modules))
        app.settings.register(StorageSettingsTab(model: app.settingsModel.storage))
        app.settings.register(McpSettingsTab(model: app.settingsModel.mcp))

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
            titleKey: .sidebarSectionTools
        ))

        // 卡片庫、封存區、檢視欄、卡片設定與匯入：一次掛上。
        CardUIModule.install(app)
        ImportUIModule.install(app)
        BoardsUIModule.install(app)

        // 通知流接到既有的側欄入口；配對核准與裝置清單放到設定頁。
        app.sidebar.installContent(for: "notifications") {
            AnyView(NotificationListView(model: app.notifications))
        }
        app.settings.register(RemoteSettingsTab(remote: app.remote))
    }
}
