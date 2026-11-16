import CardiaryKit
import SwiftUI

// MARK: - 卡片與封存的模型

/// 卡片庫與封存區的模型。
///
/// `AppModel` 不認識這些模型的型別，只負責在服務連上、收到事件與 epoch 換代時
/// 轉發。模型由 `CardUIScreens` 建立，跟畫面一起交給 App。
@MainActor
public protocol AppContentModel: AnyObject {
    /// 新的服務連線（第一次連上、重連、服務換行程都會呼叫）。
    func attach(service: any CardiaryService)
    /// 服務斷線；模型停止送出請求，已載入的內容留著顯示。
    func detach()
    /// 主機事件；模型自己過濾感興趣的串流。
    func handle(event frame: ServerFrame)
    /// 事件 epoch 換代：丟棄本地狀態，從主機重新載入。
    func handleEpochChange(epoch: String) async
    /// 介面以外的變更（例如匯入完成）之後重新載入。
    func refresh() async
}

extension AppContentModel {
    public func detach() {}
    public func handle(event frame: ServerFrame) {}
    public func handleEpochChange(epoch: String) async {}
    public func refresh() async {}
}

// MARK: - 掛載點

/// 卡片介面安裝到 App 的一組東西：模型、左側欄畫面、檢視欄面板、設定分頁與選單。
///
/// 卡片介面工作在自己的目錄建立這個結構，交給 `CardUIModule`；`App/` 的其他
/// 檔案（`AppRegistry`、`AppModel`、主視窗）都不用改。
@MainActor
public struct CardUIScreens {
    /// 需要跟著服務連線、事件與 epoch 換代的模型。
    public let models: [any AppContentModel]
    /// 左側欄「卡片庫」的內容。
    public let cardLibrary: () -> AnyView
    /// 左側欄「封存區」的內容。
    public let archive: () -> AnyView
    /// 檢視欄的上下文面板，取代預設的 `PlaceholderInspectorPanel`。
    public let contextInspector: () -> any InspectorPanel
    /// 卡片相關的設定分頁（例如新鮮度參數）；沒有就不加。
    public let freshnessSettings: (() -> any SettingsTab)?
    /// 「卡片」選單群組的命令。
    public let cardCommands: [AppCommand]

    public init(
        models: [any AppContentModel] = [],
        cardLibrary: @escaping () -> AnyView,
        archive: @escaping () -> AnyView,
        contextInspector: @escaping () -> any InspectorPanel,
        freshnessSettings: (() -> any SettingsTab)? = nil,
        cardCommands: [AppCommand] = []
    ) {
        self.models = models
        self.cardLibrary = cardLibrary
        self.archive = archive
        self.contextInspector = contextInspector
        self.freshnessSettings = freshnessSettings
        self.cardCommands = cardCommands
    }

    /// 還沒有實作時：三個位置顯示原本的佔位說明，不假裝有內容。
    public static func pending(app: AppModel) -> CardUIScreens {
        CardUIScreens(
            cardLibrary: {
                AnyView(PlaceholderTextView(messageKey: .placeholderCards))
            },
            archive: {
                AnyView(PlaceholderTextView(messageKey: .placeholderArchive))
            },
            contextInspector: {
                PlaceholderInspectorPanel(
                    id: AppRegistry.contextInspectorId,
                    titleKey: .inspectorTitle,
                    messageKey: .placeholderInspector
                )
            }
        )
    }
}

/// 卡片介面的掛載點。
///
/// App 啟動時呼叫一次 `install`，位置由 `AppRegistry` 保留；`makeScreens` 是唯一
/// 需要換的地方。卡片介面工作在自己的檔案提供 `CardUIScreens`，把
/// `makeScreens` 換成它，App/ 的其他檔案不用動。
@MainActor
public enum CardUIModule {
    /// 卡片介面提供的畫面與模型。
    public static var makeScreens: @MainActor (AppModel) -> CardUIScreens = { app in
        .live(app: app)
    }

    /// 把卡片介面掛上 App。重複呼叫是安全的：同一個位置、分頁與命令都只留一份。
    public static func install(_ app: AppModel) {
        app.installCardUI(makeScreens(app))
    }
}
