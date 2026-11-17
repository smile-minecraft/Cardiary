import CoreTransferable
import Foundation
import UniformTypeIdentifiers

extension UTType {
    /// 通知拖進對話時使用的型別。
    static let cardiaryNotification = UTType(exportedAs: "com.cardiary.notification")
}

/// 從通知流拖到側欄對話的一則通知。
///
/// 拖曳時帶著整份通知內容：通知流可能還沒載入或已經換頁，收到的一端
/// 不必只靠識別碼回頭查詢。主機仍會依識別碼去重。
public struct NotificationDrag: Codable, Equatable, Transferable, Sendable {
    public let notificationId: String
    public let notification: NotificationPresentation?

    public init(notificationId: String, notification: NotificationPresentation? = nil) {
        self.notificationId = notificationId
        self.notification = notification
    }

    public static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .cardiaryNotification)
    }
}
