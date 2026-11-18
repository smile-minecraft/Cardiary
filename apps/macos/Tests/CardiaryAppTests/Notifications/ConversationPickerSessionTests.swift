import Combine
import XCTest

@testable import CardiaryApp

/// 選擇對話列的加入流程：不管成敗，按鈕都要回到可按狀態。
/// 先前的寫法在失敗時按鈕永久鎖住、錯誤訊息在 sheet 後方，看起來就是「完全沒反應」。
@MainActor
final class ConversationPickerSessionTests: XCTestCase {
    func testSuccessReturnsTrueAndUnlocksButtons() async {
        let picker = ConversationPickerSession()

        let ok = await picker.pick("session-1", title: "對話一") { _, _ in true }

        XCTAssertTrue(ok)
        XCTAssertNil(picker.addingId)
        XCTAssertFalse(picker.isAdding)
    }

    func testFailureReturnsFalseAndRestoresRetryableState() async {
        let picker = ConversationPickerSession()

        let ok = await picker.pick("session-1", title: "對話一") { _, _ in false }

        XCTAssertFalse(ok)
        XCTAssertNil(picker.addingId)
        XCTAssertFalse(picker.isAdding, "失敗後按鈕必須可以再按")
    }

    func testButtonLockedWhilePickIsInFlight() async {
        let picker = ConversationPickerSession()
        let gate = Gate()

        let task = Task {
            await picker.pick("session-1", title: "對話一") { _, _ in
                await gate.wait()
                return true
            }
        }
        // 等到加入開始進行
        while picker.addingId == nil {
            await Task.yield()
        }
        XCTAssertEqual(picker.addingId, "session-1")
        XCTAssertTrue(picker.isAdding)

        await gate.open()
        _ = await task.value
        XCTAssertNil(picker.addingId)
    }

    func testSecondPickWhileInFlightIsIgnored() async {
        let picker = ConversationPickerSession()
        let gate = Gate()
        var calls: [String] = []

        let first = Task {
            await picker.pick("session-1", title: "對話一") { id, _ in
                calls.append(id)
                await gate.wait()
                return true
            }
        }
        while picker.addingId == nil {
            await Task.yield()
        }

        // 連點：按鈕還沒來得及停用，第二下又排進來。
        let second = await picker.pick("session-2", title: "對話二") { id, _ in
            calls.append(id)
            return true
        }

        XCTAssertFalse(second)
        XCTAssertEqual(picker.addingId, "session-1", "進行中的那一筆不能被第二下蓋掉")
        await gate.open()
        _ = await first.value
        XCTAssertEqual(calls, ["session-1"])
        XCTAssertNil(picker.addingId)
    }

    func testRetryAfterFailure() async {
        let picker = ConversationPickerSession()

        _ = await picker.pick("session-1", title: "對話一") { _, _ in false }
        let ok = await picker.pick("session-1", title: "對話一") { _, _ in true }

        XCTAssertTrue(ok)
        XCTAssertNil(picker.addingId)
    }

    func testOnPickReceivesRequestedSessionAndTitle() async {
        let picker = ConversationPickerSession()
        var received: [(String, String)] = []

        _ = await picker.pick("session-9", title: "尾牙") { id, title in
            received.append((id, title))
            return true
        }

        XCTAssertEqual(received.map(\.0), ["session-9"])
        XCTAssertEqual(received.map(\.1), ["尾牙"])
    }
}

/// 簡單的一次性閘門，讓測試能確定性地同步進行中的加入。
private actor Gate {
    private var continuation: CheckedContinuation<Void, Never>?
    private var opened = false

    func wait() async {
        if opened { return }
        await withCheckedContinuation { continuation in
            if opened {
                continuation.resume()
            } else {
                self.continuation = continuation
            }
        }
    }

    func open() {
        opened = true
        continuation?.resume()
        continuation = nil
    }
}
