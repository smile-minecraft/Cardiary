import CardiaryKit
import Foundation

#if canImport(UserNotifications)
@preconcurrency import UserNotifications
#endif

/// 系統通知中心需要的最小介面；測試用假的實作。
public protocol NotificationSystemCenter: Sendable {
    /// 詢問使用者授權；已授權時直接回 true。
    func requestAuthorization() async -> Bool
    /// 送出一則系統通知；失敗要丟出錯誤。
    func show(id: String, title: String, body: String) async throws
}

/// 讀 `notifications.systemCenter` 設定的最小介面；沒有這個設定時預設開。
public protocol NotificationSystemCenterSettings: Sendable {
    func isEnabled() async throws -> Bool
}

/// 由一般設定服務讀出 `notifications.systemCenter`；沒有這一列就回預設開。
public struct SettingsNotificationSystemCenter: NotificationSystemCenterSettings {
    public static let settingKey = "notifications.systemCenter"

    private let service: any SettingsService

    public init(service: any SettingsService) {
        self.service = service
    }

    public func isEnabled() async throws -> Bool {
        let payload = try await service.getSettings()
        return payload.settings
            .first { $0.key == Self.settingKey }?
            .value
            .boolValue ?? true
    }
}

/// macOS 的 `UNUserNotificationCenter` 實作。
#if canImport(UserNotifications)
public struct UserNotificationSystemCenter: NotificationSystemCenter {
    private var center: UNUserNotificationCenter?

    public init(center: UNUserNotificationCenter? = nil) {
        self.center = center
    }

    /// 只有真正的 App 才拿得到系統通知中心；跑在測試環境就回 nil，呼叫方當作不支援。
    private var resolvedCenter: UNUserNotificationCenter? {
        if let center { return center }
        guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return nil }
        return UNUserNotificationCenter.current()
    }

    public func requestAuthorization() async -> Bool {
        do {
            guard let center = resolvedCenter else { return false }
            return try await center.requestAuthorization(options: [.alert, .sound])
        } catch {
            return false
        }
    }

    public func show(id: String, title: String, body: String) async throws {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        // 立即送出；0.1 秒只是觸發器需要的非零間隔。
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            guard let center = resolvedCenter else { return }
            center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger)) { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }
}
#endif
