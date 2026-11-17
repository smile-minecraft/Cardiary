import CoreTransferable
import Foundation
import UniformTypeIdentifiers

extension UTType {
    /// 通知拖進對話時使用的型別；只帶通知識別碼，不帶通知內容。
    static let cardiaryNotification = UTType(exportedAs: "com.cardiary.notification")
}

/// 從通知流拖進對話的一則通知。對話收到後再向主機查詢內容並轉成卡片，拖曳過程不傳內容。
public struct NotificationDrag: Codable, Transferable, Sendable {
    public let notificationId: String

    public init(notificationId: String) {
        self.notificationId = notificationId
    }

    public static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .cardiaryNotification)
    }
}
