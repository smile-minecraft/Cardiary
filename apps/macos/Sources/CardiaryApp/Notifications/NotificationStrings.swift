// 由 Notifications.xcstrings 整理而成的執行期字串表。
// 執行時不讀 bundle：`LocalizationTests` 會逐 key 比對兩邊是否一致。
import Foundation

/// 通知介面的可在地化 key。
public enum NotificationString: String, CaseIterable, Sendable {
    case notificationTitle
    case notificationEmpty
    case notificationUnread
    case notificationMarkRead
    case notificationMarkAllRead
    case notificationToCard
    case notificationCardCreated
    case notificationCardReused
    case notificationActionFailed
    case notificationServiceUnavailable
    case notificationKindSchedule
    case notificationKindHeartbeat
    case notificationKindDistillation
    case notificationSourceSchedule
    case notificationLoading
    case notificationRefresh
    case notificationOpenConversation
}

/// 通知介面的字串查詢。
public enum NotificationL10n {
    public static func text(_ key: NotificationString, language: AppLanguage? = nil) -> String {
        resolve(key.rawValue, table: NotificationStringTables.notifications, language: language)
    }

    public static func format(
        _ key: NotificationString,
        _ values: [String: String],
        language: AppLanguage? = nil
    ) -> String {
        var text = resolve(key.rawValue, table: NotificationStringTables.notifications, language: language)
        for (name, value) in values {
            text = text.replacingOccurrences(of: "{\(name)}", with: value)
        }
        return text
    }

    public static func format(
        _ key: NotificationString,
        value: String,
        language: AppLanguage? = nil
    ) -> String {
        format(key, ["value": value], language: language)
    }

    public static func count(_ key: NotificationString, count: Int, language: AppLanguage? = nil) -> String {
        format(key, ["count": "\(count)"], language: language)
    }

    /// 一份語言的字串表，給逐 key 比對的測試用。
    public static func table(_ language: AppLanguage) -> [String: String] {
        NotificationStringTables.notifications[language] ?? [:]
    }

    static func catalogKeys() -> [String] {
        NotificationString.allCases.map(\.rawValue)
    }

    private static func resolve(
        _ rawKey: String,
        table: [AppLanguage: [String: String]],
        language: AppLanguage?
    ) -> String {
        let chosen = language ?? AppL10n.language
        return table[chosen]?[rawKey] ?? table[.en]?[rawKey] ?? rawKey
    }
}

enum NotificationStringTables {
    static let notifications: [AppLanguage: [String: String]] = [
        .zhHant: [
            "notificationTitle": "通知",
            "notificationEmpty": "還沒有通知。",
            "notificationUnread": "{count} 則未讀",
            "notificationMarkRead": "標為已讀",
            "notificationMarkAllRead": "全部標為已讀",
            "notificationToCard": "轉成卡片",
            "notificationCardCreated": "已建立卡片。",
            "notificationCardReused": "這則通知已經有卡片。",
            "notificationActionFailed": "通知操作失敗：{value}",
            "notificationServiceUnavailable": "還沒連上服務，通知需要連線。",
            "notificationKindSchedule": "排程",
            "notificationKindHeartbeat": "心跳檢查",
            "notificationKindDistillation": "蒸餾",
            "notificationSourceSchedule": "來源：{value}",
            "notificationLoading": "正在載入通知…",
            "notificationRefresh": "重新整理",
            "notificationOpenConversation": "開啟對話",
        ],
        .en: [
            "notificationTitle": "Notifications",
            "notificationEmpty": "No notifications yet.",
            "notificationUnread": "{count} unread",
            "notificationMarkRead": "Mark as read",
            "notificationMarkAllRead": "Mark all as read",
            "notificationToCard": "Turn into card",
            "notificationCardCreated": "Card created.",
            "notificationCardReused": "This notification already has a card.",
            "notificationActionFailed": "Notification action failed: {value}",
            "notificationServiceUnavailable": "Not connected; notifications need a service connection.",
            "notificationKindSchedule": "Schedule",
            "notificationKindHeartbeat": "Heartbeat",
            "notificationKindDistillation": "Distillation",
            "notificationSourceSchedule": "Source: {value}",
            "notificationLoading": "Loading notifications…",
            "notificationRefresh": "Refresh",
            "notificationOpenConversation": "Open conversation",
        ],
    ]
}
