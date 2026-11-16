import Foundation
import XCTest

@testable import CardiaryShellCore

/// 殼對已經結束的子行程寫 stdin 時，核心會先送出 SIGPIPE；預設處置會殺掉整個
/// 行程，也就是 CI 上的 `Exited with unexpected signal code 13`。
///
/// 控制通道在子行程剛結束、`terminationHandler` 還沒收掉通道時仍可能送出
/// health 或代理回應，所以這條路徑必須以 EPIPE 回報錯誤，不能讓殼跟著死。
final class ProcessServiceHandleTests: XCTestCase {
    func testWriteToExitedProcessFailsWithoutKillingTheShell() throws {
        // `/usr/bin/true` 不讀 stdin 就結束，讀端關閉後寫入必定得到 EPIPE。
        let plan = ServiceLaunchPlan(
            executableURL: URL(fileURLWithPath: "/usr/bin/true"),
            arguments: [],
            environment: ["PATH": "/usr/bin:/bin"],
            workingDirectory: nil
        )
        let handle = try ProcessServiceHandle(plan: plan)

        let deadline = Date().addingTimeInterval(5)
        while handle.isRunning && Date() < deadline {
            usleep(10_000)
        }
        XCTAssertFalse(handle.isRunning, "子行程應該已經結束")

        // 沒有關掉這個 fd 的 SIGPIPE 時，這一行會直接殺掉測試行程（signal 13）。
        XCTAssertThrowsError(try handle.write(Data("ping\n".utf8))) { error in
            guard case ServiceLaunchError.writeFailed(let code) = error else {
                return XCTFail("預期 writeFailed，得到 \(error)")
            }
            XCTAssertEqual(code, EPIPE, "應回報 EPIPE（\(EPIPE)），得到 errno \(code)")
        }
    }
}
