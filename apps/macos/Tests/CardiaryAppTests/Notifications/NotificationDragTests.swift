import CardiaryKit
import CoreTransferable
import XCTest

@testable import CardiaryApp

/// 拖曳通知時帶的內容：識別碼與完整通知都要能原樣還原，
/// 這樣側欄在通知流還沒載入那則通知時也能直接用拖曳帶來的資料。
final class NotificationDragTests: XCTestCase {
    private func presentation(id: String = "n-1") -> NotificationPresentation {
        NotificationPresentation(
            record: CardiaryNotification(
                notificationId: id,
                kind: .schedule,
                title: "每日摘要",
                body: "今天有 3 則新訊息",
                createdAt: "2026-01-01T00:00:00Z",
                readAt: nil,
                sourceScheduleId: "schedule-1",
                payload: [:]
            )
        )
    }

    func testCodableRoundTripKeepsIdAndNotification() throws {
        let drag = NotificationDrag(notificationId: "n-1", notification: presentation())

        let data = try JSONEncoder().encode(drag)
        let decoded = try JSONDecoder().decode(NotificationDrag.self, from: data)

        XCTAssertEqual(decoded, drag)
        XCTAssertEqual(decoded.notification?.title, "每日摘要")
        XCTAssertEqual(decoded.notification?.sourceScheduleId, "schedule-1")
    }

    func testTransferableRoundTripsThroughItemProvider() async throws {
        let drag = NotificationDrag(notificationId: "n-1", notification: presentation())
        let provider = NSItemProvider()
        provider.register(drag)

        let loaded: NotificationDrag = try await withCheckedThrowingContinuation { continuation in
            provider.loadTransferable(type: NotificationDrag.self) { result in
                continuation.resume(with: result)
            }
        }

        XCTAssertEqual(loaded, drag)
        XCTAssertEqual(loaded.notification?.body, "今天有 3 則新訊息")
    }

    // exportedContentTypes() 需要 macOS 15.2，產品目標是 macOS 14，所以用 loadTransferable 當 Transferable 的證明。
    func testDragWithoutPayloadStillDecodes() throws {
        let drag = NotificationDrag(notificationId: "n-9")
        let data = try JSONEncoder().encode(drag)

        XCTAssertEqual(try JSONDecoder().decode(NotificationDrag.self, from: data), drag)
        XCTAssertNil(drag.notification)
    }
}
