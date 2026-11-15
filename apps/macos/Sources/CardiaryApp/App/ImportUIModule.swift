import CardiaryKit
import SwiftUI

/// 匯入介面安裝到 App 的一組東西。
///
/// 匯入是一個從選單打開的流程，掛在「匯入」群組；預覽與逐項勾選的畫面由
/// `Import/` 提供。匯入與卡片共用 `AppModel.media`（原檔上傳與 `media.import`）。
@MainActor
public struct ImportUIEntry {
    /// 「匯入」選單群組的命令。
    public let commands: [AppCommand]

    public init(commands: [AppCommand] = []) {
        self.commands = commands
    }

    /// 還沒有實作時：群組存在，但沒有命令。
    public static let pending = ImportUIEntry()
}

/// 匯入介面的掛載點。
///
/// App 啟動時呼叫一次 `install`；匯入工作在自己的檔案提供 `ImportUIEntry`，把
/// `makeEntry` 換成它，`App/` 的其他檔案不用動。
@MainActor
public enum ImportUIModule {
    /// 匯入介面提供的命令。預設沒有命令。
    public static var makeEntry: @MainActor (AppModel) -> ImportUIEntry = { _ in .pending }

    /// 把匯入介面掛上 App。重複呼叫時同一個命令只留一份。
    public static func install(_ app: AppModel) {
        app.installImportUI(makeEntry(app))
    }
}
