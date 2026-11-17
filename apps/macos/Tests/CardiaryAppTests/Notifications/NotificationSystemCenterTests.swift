import XCTest

@testable import CardiaryApp

/// 測試環境沒有 `UNUserNotificationCenter`，`resolvedCenter` 會是 nil。
/// `show` 必須立刻丟出錯誤，不能讓呼叫端永遠等下去。
final class NotificationSystemCenterTests: XCTestCase {
    func testRequestAuthorizationWithoutSystemCenterReturnsFalse() async {
        let center = UserNotificationSystemCenter()
        let authorized = await center.requestAuthorization()
        XCTAssertFalse(authorized)
    }

    func testShowWithoutSystemCenterThrowsInsteadOfHanging() async {
        let center = UserNotificationSystemCenter()
        let started = Date()
        do {
            try await center.show(id: "n-1", title: "標題", body: "內容")
            XCTFail("沒有系統通知中心時，show 應該丟出錯誤")
        } catch {
            XCTAssertEqual(error as? NotificationSystemCenterError, .unavailable)
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    }
}
