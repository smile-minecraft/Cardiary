import AppKit
import WebKit
import XCTest

@testable import CardiaryApp

/// 內容高度同步：頁面用 bridge 回報高度，原生這側據此調整容器，
/// 不使用固定高度造成空白或截斷。這是真的 WKWebView +  injected script 的端到端測試。
@MainActor
final class McpAppHeightSyncTests: XCTestCase {
    private var windows: [NSWindow] = []
    private var probes: [WebViewProbe] = []

    override func tearDown() {
        probes.forEach { $0.tearDown() }
        probes = []
        windows = []
        super.tearDown()
    }

    /// bridge 只接受有限、非負的 height 訊息；其他形狀忽略。
    func testBridgeParsesOnlyValidHeightMessages() {
        XCTAssertEqual(McpAppBridgeMessage.parse(["type": "height", "height": 320.0]), .height(320))
        XCTAssertNil(McpAppBridgeMessage.parse(["type": "height", "height": -1]))
        XCTAssertNil(McpAppBridgeMessage.parse(["type": "height", "height": Double.infinity]))
        XCTAssertNil(McpAppBridgeMessage.parse(["type": "height", "height": Double.nan]))
        XCTAssertNil(McpAppBridgeMessage.parse(["type": "height", "height": "320"]))
        XCTAssertNil(McpAppBridgeMessage.parse(["type": "height"]))
    }

    /// 真的 WKWebView 載入高內容頁面後，injected script 應回報接近內容高度的值，
    /// 而且 onHeightChange 被呼叫。這證明高度不是寫死的佔位高度。
    func testRealWebViewReportsContentHeight() {
        let tallHTML = """
        <!doctype html><html><body style="margin:0">
        <div style="height:640px;background:#eee">content</div>
        </body></html>
        """
        var reportedHeights: [CGFloat] = []
        let heightReported = expectation(description: "height reported")

        let coordinator = makeCoordinator { height in
            reportedHeights.append(height)
            heightReported.fulfill()
        }
        let config = McpAppWebView.makeConfiguration(handler: coordinator)
        let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 320, height: 240), configuration: config)
        let window = makeWindow()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        let probe = WebViewProbe(webView: webView)
        probes.append(probe)

        webView.loadHTMLString(tallHTML, baseURL: nil)
        probe.waitForPageLoad()

        XCTAssertEqual(XCTWaiter().wait(for: [heightReported], timeout: 5), .completed, "頁面應回報內容高度")
        let first = reportedHeights.first ?? 0
        XCTAssertGreaterThan(first, 500, "回報高度應接近 640px 的內容，而不是佔位的 120")
    }

    /// 同一高度重複回報不會重複往外送，避免 SwiftUI 無謂重排。
    /// 直接餵 Coordinator 兩個相同高度，第三個不同高度，驗證去重與更新。
    func testCoordinatorDedupsRepeatedHeights() throws {
        let recorded = RecordedHeights()
        let coordinator = makeCoordinator { height in recorded.values.append(height) }
        let config = McpAppWebView.makeConfiguration(handler: coordinator)
        let webView = WKWebView(frame: .zero, configuration: config)

        func deliver(_ height: Double) throws {
            let body = ["type": "height", "height": height] as [String: Any]
            let message = try XCTUnwrap(ScriptMessageFake(name: McpAppWebView.messageHandlerName, body: body).message)
            coordinator.userContentController(WKUserContentController(), didReceive: message)
        }

        try deliver(300)
        try deliver(300)
        try deliver(480)

        XCTAssertEqual(recorded.values.map { Int($0) }, [300, 480])
        XCTAssertNotNil(webView) // 保持 webView 存活直到測試結束
    }

    private func makeCoordinator(onHeightChange: @escaping (CGFloat) -> Void) -> McpAppWebView.Coordinator {
        McpAppWebView.Coordinator(
            policy: McpAppNavigationPolicy(allowedHosts: []),
            context: McpAppHostContext(theme: .light, language: .zhHant),
            onHeightChange: onHeightChange
        )
    }

    private func makeWindow() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 240),
            styleMask: [.titled],
            backing: .buffered,
            defer: true
        )
        windows.append(window)
        return window
    }
}

/// 記錄回呼用，避免 @MainActor 下直接陣列捕獲的併發警告。
private final class RecordedHeights {
    var values: [CGFloat] = []
}

/// 造一個 WKScriptMessage：用子類覆寫唯讀的 name/body，確保測到 Coordinator
/// 真正的訊息處理邏輯，而不是測試裡複製的一份。
private final class ScriptMessageFake {
    let message: WKScriptMessage?
    init(name: String, body: Any) {
        // WKScriptMessage 沒有公開 init；用子類化 + KVC 設定唯讀屬性。
        let message = WKScriptMessageFakeImpl()
        message.setValues(name: name, body: body)
        self.message = message
    }
}

private final class WKScriptMessageFakeImpl: WKScriptMessage {
    private var _name: String = ""
    private var _body: Any = ""
    func setValues(name: String, body: Any) {
        _name = name
        _body = body
    }
    override var name: String { _name }
    override var body: Any { _body }
}

/// 在真的 WKWebView 上執行 JS 並等待文件完成載入。
private final class WebViewProbe {
    let webView: WKWebView
    init(webView: WKWebView) { self.webView = webView }

    func javaScript(_ script: String) -> Any? {
        var result: Any?
        let done = XCTestExpectation(description: "evaluateJavaScript")
        webView.evaluateJavaScript(script) { value, _ in
            result = value
            done.fulfill()
        }
        XCTWaiter().wait(for: [done], timeout: 3)
        return result
    }

    func waitForPageLoad() {
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline {
            if let ready = javaScript("document.readyState") as? String, ready == "complete" { return }
            let done = XCTestExpectation(description: "poll")
            XCTWaiter().wait(for: [done], timeout: 0.05)
        }
    }

    func tearDown() {
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: McpAppWebView.messageHandlerName
        )
        webView.loadHTMLString("", baseURL: nil)
        webView.removeFromSuperview()
    }
}
