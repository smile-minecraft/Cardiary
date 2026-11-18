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
    case notificationTabNotifications
    case notificationTabSchedules
    case notificationAddToConversation
    case notificationChooseConversationTitle
    case notificationConversationEmpty
    case notificationPickerCancel
    case notificationAddedToConversation
    case notificationSourceScheduleName
    case notificationUnknownSchedule
    case notificationDragHint
    case notificationNotFound
    case notificationPartiallyAdded
    case schedulerTitle
    case schedulerEmpty
    case schedulerName
    case schedulerKind
    case schedulerKindOnce
    case schedulerKindDaily
    case schedulerKindInterval
    case schedulerKindHeartbeat
    case schedulerOnceAt
    case schedulerDailyTime
    case schedulerEveryMinutes
    case schedulerTask
    case schedulerTaskAgent
    case schedulerTaskDistillation
    case schedulerTaskPrompt
    case schedulerPromptPlaceholder
    case schedulerCreate
    case schedulerPause
    case schedulerResume
    case schedulerDelete
    case schedulerNextRun
    case schedulerLastRun
    case schedulerRunCount
    case schedulerStatusOK
    case schedulerStatusSilent
    case schedulerStatusNotify
    case schedulerStatusError
    case notificationScheduleCreated
    case notificationSchedulePaused
    case notificationScheduleResumed
    case notificationScheduleDeleted
    case notificationScheduleInvalidName
    case notificationScheduleInvalidTime
    case notificationScheduleInvalidInterval
    case notificationScheduleInvalidPrompt
    case notificationScheduleSpecOnce
    case notificationScheduleSpecDaily
    case notificationScheduleSpecEvery
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
            "notificationTabNotifications": "通知",
            "notificationTabSchedules": "排程",
            "notificationAddToConversation": "加入對話",
            "notificationChooseConversationTitle": "選擇要加入的對話",
            "notificationConversationEmpty": "沒有可加入的對話，請先建立一個對話。",
            "notificationPickerCancel": "取消",
            "notificationAddedToConversation": "已加入「{value}」。",
            "notificationSourceScheduleName": "來源：{value}",
            "notificationUnknownSchedule": "排程通知",
            "notificationDragHint": "拖到左側對話",
            "notificationNotFound": "找不到這則通知，請重新整理後再試。",
            "notificationPartiallyAdded": "已加入 {count} 則，其餘沒加入。",
            "schedulerTitle": "排程",
            "schedulerEmpty": "還沒有排程。建立後會照時間執行。",
            "schedulerName": "名稱",
            "schedulerKind": "觸發方式",
            "schedulerKindOnce": "一次",
            "schedulerKindDaily": "每天",
            "schedulerKindInterval": "固定間隔",
            "schedulerKindHeartbeat": "心跳檢查",
            "schedulerOnceAt": "執行時間（2026-01-01T10:00:00+08:00）",
            "schedulerDailyTime": "每日時間（04:00）",
            "schedulerEveryMinutes": "間隔（分鐘）",
            "schedulerTask": "任務",
            "schedulerTaskAgent": "背景代理",
            "schedulerTaskDistillation": "每日蒸餾",
            "schedulerTaskPrompt": "提示詞",
            "schedulerPromptPlaceholder": "描述這次要代理做的事",
            "schedulerCreate": "建立排程",
            "schedulerPause": "暫停",
            "schedulerResume": "恢復",
            "schedulerDelete": "刪除",
            "schedulerNextRun": "下次執行：{value}",
            "schedulerLastRun": "上次執行：{value}",
            "schedulerRunCount": "已執行 {count} 次",
            "schedulerStatusOK": "成功",
            "schedulerStatusSilent": "無事",
            "schedulerStatusNotify": "已通知",
            "schedulerStatusError": "失敗",
            "notificationScheduleCreated": "已建立排程。",
            "notificationSchedulePaused": "已暫停排程。",
            "notificationScheduleResumed": "已恢復排程。",
            "notificationScheduleDeleted": "已刪除排程。",
            "notificationScheduleInvalidName": "請先填排程名稱。",
            "notificationScheduleInvalidTime": "時間格式不對，照畫面上的範例再填一次。",
            "notificationScheduleInvalidInterval": "心跳檢查與固定間隔至少要 5 分鐘。",
            "notificationScheduleInvalidPrompt": "背景代理的提示詞不能留空。",
            "notificationScheduleSpecOnce": "一次：{value}",
            "notificationScheduleSpecDaily": "每天 {value}",
            "notificationScheduleSpecEvery": "每隔 {value} 分鐘",
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
            "notificationTabNotifications": "Notifications",
            "notificationTabSchedules": "Schedules",
            "notificationAddToConversation": "Add to conversation",
            "notificationChooseConversationTitle": "Choose a conversation",
            "notificationConversationEmpty": "No conversations yet. Create one first.",
            "notificationPickerCancel": "Cancel",
            "notificationAddedToConversation": "Added to “{value}”.",
            "notificationSourceScheduleName": "Source: {value}",
            "notificationUnknownSchedule": "Scheduled notification",
            "notificationDragHint": "Drag onto a conversation on the left",
            "notificationNotFound": "That notification is no longer available. Refresh and try again.",
            "notificationPartiallyAdded": "Added {count}; the rest did not get added.",
            "schedulerTitle": "Schedules",
            "schedulerEmpty": "No schedules yet. Created ones run on time.",
            "schedulerName": "Name",
            "schedulerKind": "Trigger",
            "schedulerKindOnce": "Once",
            "schedulerKindDaily": "Daily",
            "schedulerKindInterval": "Interval",
            "schedulerKindHeartbeat": "Heartbeat",
            "schedulerOnceAt": "Run at (2026-01-01T10:00:00+08:00)",
            "schedulerDailyTime": "Daily time (04:00)",
            "schedulerEveryMinutes": "Interval (minutes)",
            "schedulerTask": "Task",
            "schedulerTaskAgent": "Background agent",
            "schedulerTaskDistillation": "Daily distillation",
            "schedulerTaskPrompt": "Prompt",
            "schedulerPromptPlaceholder": "Describe what the agent should do",
            "schedulerCreate": "Create schedule",
            "schedulerPause": "Pause",
            "schedulerResume": "Resume",
            "schedulerDelete": "Delete",
            "schedulerNextRun": "Next run: {value}",
            "schedulerLastRun": "Last run: {value}",
            "schedulerRunCount": "{count} runs",
            "schedulerStatusOK": "OK",
            "schedulerStatusSilent": "Nothing to report",
            "schedulerStatusNotify": "Notified",
            "schedulerStatusError": "Failed",
            "notificationScheduleCreated": "Schedule created.",
            "notificationSchedulePaused": "Schedule paused.",
            "notificationScheduleResumed": "Schedule resumed.",
            "notificationScheduleDeleted": "Schedule deleted.",
            "notificationScheduleInvalidName": "Enter a schedule name first.",
            "notificationScheduleInvalidTime": "The time format is wrong; match the example above.",
            "notificationScheduleInvalidInterval": "Heartbeat and interval schedules need at least 5 minutes.",
            "notificationScheduleInvalidPrompt": "The background agent prompt can't be empty.",
            "notificationScheduleSpecOnce": "Once: {value}",
            "notificationScheduleSpecDaily": "Daily at {value}",
            "notificationScheduleSpecEvery": "Every {value} minutes",
        ],
    ]
}
