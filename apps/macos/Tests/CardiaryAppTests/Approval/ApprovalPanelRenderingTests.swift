import CardiaryKit
import SwiftUI
import XCTest

@testable import CardiaryApp

/// 審批面板的建構冒煙測試：有資料時整個畫面要能建立並完成排版。
///
/// 一般的主視窗需要真的視窗伺服器，這裡只渲染面板本身；`ImageRenderer`
/// 對 `NavigationSplitView` 與 `ScrollView` 不支援，所以範圍刻意限縮在面板。
@MainActor
final class ApprovalPanelRenderingTests: XCTestCase {
    func testPanelRendersWithApprovalAndWithoutAlwaysOption() throws {
        let model = ApprovalModel()

        model.update(requests: [Fixtures.approval()])
        XCTAssertNotNil(render(ApprovalPanelView(model: model)), "有待審批時要能排版")

        model.update(requests: [Fixtures.approval(approveAlways: false)])
        XCTAssertNotNil(render(ApprovalPanelView(model: model)), "主機沒有提供一律允許時也要能排版")

        model.update(requests: [])
        XCTAssertNotNil(render(ApprovalPanelView(model: model)), "沒有待審批時顯示空狀態")
    }

    private func render(_ view: some View) -> NSImage? {
        let renderer = ImageRenderer(
            content: view.frame(width: 320, height: 420)
                .background(Color(nsColor: .windowBackgroundColor))
        )
        renderer.scale = 2
        return renderer.nsImage
    }
}
