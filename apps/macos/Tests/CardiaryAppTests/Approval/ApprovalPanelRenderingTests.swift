import CardiaryKit
import SwiftUI
import XCTest

@testable import CardiaryApp

/// 審批面板的建構冒煙測試：有資料時整個畫面要能建立並完成排版。
/// CI runner 有虛擬螢幕，所以 NSScreen 判斷沒有用；ImageRenderer 與 NSHostingView
/// 在 runner 上都耗時約 2000 秒，因此用 CI 環境變數跳過。
@MainActor
final class ApprovalPanelRenderingTests: XCTestCase {
    func testPanelRendersWithApprovalAndWithoutAlwaysOption() throws {
        if ProcessInfo.processInfo.environment["CI"] != nil {
            throw XCTSkip("CI runner 無法在合理時間內完成 SwiftUI 排版")
        }

        let model = ApprovalModel()

        model.update(requests: [Fixtures.approval()])
        let withApproval = render(ApprovalPanelView(model: model))
        XCTAssertTrue(withApproval.width > 0 && withApproval.height > 0, "有待審批時要能排版")

        model.update(requests: [Fixtures.approval(approveAlways: false)])
        let withoutAlways = render(ApprovalPanelView(model: model))
        XCTAssertTrue(withoutAlways.width > 0 && withoutAlways.height > 0, "主機沒有提供一律允許時也要能排版")

        model.update(requests: [])
        let empty = render(ApprovalPanelView(model: model))
        XCTAssertTrue(empty.width > 0 && empty.height > 0, "沒有待審批時顯示空狀態")
    }

    private func render(_ view: some View) -> NSSize {
        let host = NSHostingView(rootView: view.frame(width: 320, height: 420))
        host.frame = NSRect(x: 0, y: 0, width: 320, height: 420)
        host.layoutSubtreeIfNeeded()
        return host.fittingSize
    }
}
