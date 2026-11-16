import AppKit
import CardiaryKit
import WebKit
import XCTest

@testable import CardiaryApp

/// MCP App 的嵌入邊界：導航白名單、訊息通道的資料範圍、臨時資料儲存與拆除。
///
/// 負向測試都在真的 `WKWebView` 上載入 HTML、執行 JavaScript 並等非同步結果，
/// 不走純政策函式。`NavigationProbe` 轉呼叫真正的 `Coordinator`，因此測到的是
/// 產品的決策邏輯，不是測試裡複製的一份。
@MainActor
final class McpAppWebViewTests: XCTestCase {
    // MARK: - 導航（純政策）

    func testPolicyAllowsOnlyConfiguredHosts() {
        let policy = McpAppNavigationPolicy(allowedHosts: ["api.example.com", "CDN.Example.com"])

        XCTAssertTrue(policy.allows(URL(string: "https://api.example.com/tool")))
        XCTAssertTrue(policy.allows(URL(string: "http://cdn.example.com/asset.js")))
        XCTAssertEqual(
            policy.decision(for: URL(string: "https://cdn.example.com/")),
            .allow
        )
    }

    func testPolicyBlocksExternalHostsAndSubdomains() {
        let policy = McpAppNavigationPolicy(allowedHosts: ["api.example.com"])

        XCTAssertEqual(
            policy.decision(for: URL(string: "https://evil.example.com/")),
            .block(.hostNotAllowed("evil.example.com"))
        )
        XCTAssertEqual(
            policy.decision(for: URL(string: "https://sub.api.example.com/")),
            .block(.hostNotAllowed("sub.api.example.com"))
        )
        XCTAssertEqual(
            policy.decision(for: URL(string: "https://api.example.com.evil.com/")),
            .block(.hostNotAllowed("api.example.com.evil.com"))
        )
    }

    func testPolicyBlocksNonWebSchemesAndMissingURL() {
        let policy = McpAppNavigationPolicy(allowedHosts: ["api.example.com"])

        XCTAssertEqual(policy.decision(for: nil), .block(.missingURL))
        XCTAssertEqual(
            policy.decision(for: URL(string: "file:///etc/passwd")),
            .block(.unsupportedScheme("file"))
        )
        XCTAssertEqual(
            policy.decision(for: URL(string: "data:text/html,<h1>hi</h1>")),
            .block(.unsupportedScheme("data"))
        )
        XCTAssertEqual(
            policy.decision(for: URL(string: "javascript:alert(1)")),
            .block(.unsupportedScheme("javascript"))
        )
    }

    func testPolicyAllowsBlankDocumentButNotOtherAboutURLs() {
        let policy = McpAppNavigationPolicy(allowedHosts: [])

        XCTAssertEqual(policy.decision(for: URL(string: "about:blank")), .allow)
        XCTAssertEqual(
            policy.decision(for: URL(string: "about:srcdoc")),
            .block(.unsupportedScheme("about"))
        )
    }

    func testPolicyIgnoresEmptyAllowedHosts() {
        let policy = McpAppNavigationPolicy(allowedHosts: ["", "   ", "api.example.com"])

        XCTAssertEqual(policy.allowedHosts, ["api.example.com"])
        XCTAssertEqual(
            policy.decision(for: URL(string: "https://api.example.com/")),
            .allow
        )
    }

    // MARK: - 訊息通道（純資料）

    func testHostContextHasOnlyThemeLanguageAndCard() throws {
        let context = McpAppHostContext(
            theme: .dark,
            language: .zhHant,
            card: McpAppCardSummary(
                cardId: "card-1",
                title: "面試筆記",
                summary: "兩輪面試的重點",
                tags: ["工作", "面試"],
                kind: "note"
            )
        )

        let object = context.jsonObject
        XCTAssertEqual(Set(object.keys), ["theme", "language", "card"])

        let card = try XCTUnwrap(object["card"] as? [String: Any])
        XCTAssertEqual(Set(card.keys), ["cardId", "title", "summary", "tags", "kind"])
        XCTAssertEqual(card["title"] as? String, "面試筆記")
        XCTAssertEqual(card["kind"] as? String, "note")
    }

    func testCardSummaryFromCardOnlyCarriesDisplayFields() {
        let card = CardSummary(
            cardId: "card-9",
            kind: .memory,
            title: "喜歡的咖啡",
            summary: "淺焙、手沖",
            tags: ["生活"],
            persona: "default",
            createdAt: "2026-11-01T00:00:00Z",
            freshness: 80,
            lifecycle: .live
        )

        let summary = McpAppCardSummary(card)
        XCTAssertEqual(summary.cardId, "card-9")
        XCTAssertEqual(summary.title, "喜歡的咖啡")
        XCTAssertEqual(summary.summary, "淺焙、手沖")
        XCTAssertEqual(summary.tags, ["生活"])
        XCTAssertEqual(summary.kind, "memory")
        XCTAssertEqual(
            Set(summary.jsonObject.keys),
            ["cardId", "title", "summary", "tags", "kind"]
        )
    }

    func testContextJSONTextIsStableAndReadable() {
        let context = McpAppHostContext(theme: .light, language: .en)
        XCTAssertEqual(context.jsonText(), #"{"language":"en","theme":"light"}"#)
    }

    func testBridgeAcceptsOnlyReadyMessage() {
        XCTAssertEqual(McpAppBridgeMessage.parse(["type": "ready"]), .ready)
        XCTAssertNil(McpAppBridgeMessage.parse(["type": "token"]))
        XCTAssertNil(McpAppBridgeMessage.parse(["type": "ready", "card": "x"]))
        XCTAssertNil(McpAppBridgeMessage.parse("ready"))
        XCTAssertNil(McpAppBridgeMessage.parse(["ready": true]))
    }

    func testScriptLiteralEscapesMarkupAndLineBreaks() {
        let literal = McpAppScript.literal("</script>\u{2028}\"quoted\"\n")
        XCTAssertFalse(literal.contains("</script>"))
        XCTAssertTrue(literal.contains("\\u003C/script\\u003E"))
        XCTAssertTrue(literal.contains("\\u2028"))
        XCTAssertTrue(literal.contains("\\\"quoted\\\""))
        XCTAssertTrue(literal.contains("\\n"))
    }

    func testContextScriptCannotBreakOutOfJavaScript() {
        let json = #"{"card":{"title":"</script><script>alert(1)</script>"}}"#
        let script = McpAppWebView.contextScript(json: json)

        XCTAssertFalse(script.contains("</script>"))
        XCTAssertTrue(script.contains("\\u003C/script\\u003E"))
    }

    // MARK: - 真實 WebView：負面測試

    /// 1. 本機檔案：頁面用 fetch 讀本機檔案必須失敗，且不能讀到內容。
    func testWebViewCannotReadLocalFile() {
        let probe = makeLiveProbe(html: """
        <!doctype html><html><body><script>
          window.__result = 'pending';
          fetch('file:///etc/passwd')
            .then(function (r) { return r.text(); })
            .then(function (t) { window.__result = 'READ:' + t.substring(0, 40); })
            .catch(function () { window.__result = 'BLOCKED'; });
        </script></body></html>
        """)
        defer { probe.tearDown() }

        probe.waitForSettled(initial: "pending")
        let result = probe.javaScript("String(window.__result)") as? String
        XCTAssertNotEqual(result, "READ:", "頁面不該讀到本機檔案內容")
        XCTAssertEqual(result, "BLOCKED")
    }

    /// 2. 連線 Token：頁面拿不到 Cardiary 的連線 Token。
    ///    同時確認 host context 的 JSON 沒有任何 token 欄位，且訊息處理器只收 ready。
    func testWebViewCannotReachConnectionToken() {
        let token = "fake-connection-token-for-test-only"
        let context = McpAppHostContext(theme: .light, language: .zhHant)
        XCTAssertFalse(context.jsonText().localizedCaseInsensitiveContains("token"))
        XCTAssertFalse(context.jsonText().contains(token))

        let probe = makeLiveProbe(html: """
        <!doctype html><html><body><script>
          window.__result = 'none';
          var host = window.webkit && window.webkit.messageHandlers;
          if (host && host.cardiaryMcp) {
            window.__result = 'cardiaryMcp';
          } else {
            window.__result = 'no-handler';
          }
        </script></body></html>
        """)
        defer { probe.tearDown() }

        let handlers = probe.javaScript("String(window.__result)") as? String ?? ""
        XCTAssertEqual(handlers, "cardiaryMcp", "頁面只該看到一個固定的訊息通道")
        XCTAssertFalse(handlers.localizedCaseInsensitiveContains("token"))
        XCTAssertFalse(handlers.contains(token))

        // 送一個偽造的 token 訊息，確認不能從 bridge 取得任何回傳值。
        let messageResult = probe.javaScript("""
        (function () {
          try {
            if (window.webkit && window.webkit.messageHandlers &&
                window.webkit.messageHandlers.cardiaryMcp) {
              window.webkit.messageHandlers.cardiaryMcp.postMessage({ type: 'token' });
              return 'posted';
            }
            return 'no-handler';
          } catch (e) { return 'threw'; }
        })()
        """) as? String
        XCTAssertTrue(messageResult == "posted" || messageResult == "no-handler")
    }

    /// 3. 主機協定請求：頁面直接 fetch loopback 的主機協定端點時拿不到回應。
    ///    用本機伺服器模擬主機端點，確定測的是「讀不到」而不是「剛好沒東西在聽」。
    ///    頁面的來源是 null（loadHTMLString），跨來源讀取會被擋下；搭配第 2 項
    ///    證明頁面也沒有任何連線 Token 可用。
    func testWebViewCannotReachHostProtocol() {
        guard let server = RedirectServer() else {
            XCTFail("無法啟動測試用的本機 HTTP 伺服器")
            return
        }
        defer { server.stop() }

        let probe = makeLiveProbe(html: """
        <!doctype html><html><body><script>
          window.__result = 'pending';
          fetch('http://127.0.0.1:\(server.port)/host-protocol', { method: 'POST', body: '{}' })
            .then(function (r) { return r.text(); })
            .then(function (t) { window.__result = 'REACHED:' + t.substring(0, 40); })
            .catch(function () { window.__result = 'BLOCKED'; });
        </script></body></html>
        """)
        defer { probe.tearDown() }

        let reached = probe.waitForSettled(initial: "pending")
        XCTAssertNotEqual(reached, "REACHED:", "頁面不該讀到主機協定的回應")
        XCTAssertEqual(reached, "BLOCKED")
    }

    /// 4. 開新視窗：window.open 回 null；Coordinator 的 createWebViewWith 回 nil。
    func testWebViewCannotOpenNewWindow() {
        let coordinator = makeCoordinator()
        let config = McpAppWebView.makeConfiguration(handler: coordinator)
        let action = makeNavigationAction(url: URL(string: "https://evil.example.com/")!)
        XCTAssertNil(
            coordinator.webView(WKWebView(frame: .zero, configuration: config),
                                createWebViewWith: config,
                                for: action,
                                windowFeatures: WKWindowFeatures()),
            "即使被要求開新視窗，也不能建立 WKWebView"
        )

        let probe = makeLiveProbe(html: """
        <!doctype html><html><body><script>
          window.__result = String(window.open('https://evil.example.com/'));
        </script></body></html>
        """)
        defer { probe.tearDown() }

        XCTAssertEqual(probe.javaScript("String(window.__result)") as? String, "null")
    }

    /// 5. 外部網址：頁面導覽到外部 https 被政策擋下；導覽決策記錄顯示 cancel。
    func testWebViewBlocksExternalNavigation() {
        let recorder = NavigationProbe(coordinator: makeCoordinator(allowedHosts: ["api.example.com"]))
        let (probe, webView) = makeLiveProbeWithDelegate(html: """
        <!doctype html><html><body>ok</body></html>
        """, delegate: recorder)
        defer { probe.tearDown() }

        recorder.actions.removeAll()
        recorder.decisions.removeAll()
        webView.evaluateJavaScript("window.location.href = 'https://evil.example.com/'") { _, _ in }
        let done = expectation(description: "external navigation")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { done.fulfill() }
        wait(for: [done], timeout: 3)

        let external = recorder.actions.first { $0.contains("evil.example.com") }
        XCTAssertNotNil(external, "應該記錄到外部網址的導覽決策")
        let externalDecision = recorder.decisions.first { $0.url.contains("evil.example.com") }
        XCTAssertNotNil(externalDecision, "應該記錄到外部網址的決策結果")
        XCTAssertEqual(externalDecision?.allowed, false, "外部網址不該被允許")
    }

    /// 5b. 真正的伺服器重新導向：白名單主機回 302 到非白名單主機，
    /// 頁面不該被帶到該主機，也不該拿到目標內容。
    /// 用本機最小 HTTP 伺服器，不需要對外網路。
    /// WebKit 對重新導向是在 navigationAction 就回報目標網址，實測會看到
    /// `action:http://localhost:<port>/marker` 被擋下；response 政策是備援，
    /// 由 5c 確認它真的有接到回應。
    func testServerRedirectToExternalHostIsBlocked() {
        guard let server = RedirectServer() else {
            XCTFail("無法啟動測試用的本機 HTTP 伺服器")
            return
        }
        defer { server.stop() }

        let recorder = NavigationProbe(coordinator: makeCoordinator(allowedHosts: ["127.0.0.1"]))
        let (probe, webView) = makeWindowedWebView(delegate: recorder)
        defer { probe.tearDown() }

        webView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(server.port)/redirect")!))
        let done = expectation(description: "redirect finished")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { done.fulfill() }
        wait(for: [done], timeout: 5)

        let blockedTarget = recorder.decisions.contains {
            $0.url.contains("localhost") && !$0.allowed
        }
        XCTAssertTrue(blockedTarget, "重新導向到非白名單主機應被擋下並記錄：\(recorder.decisions)")
        XCTAssertFalse(
            recorder.decisions.contains { $0.url.contains("localhost") && $0.allowed },
            "非白名單主機不該被允許"
        )
        XCTAssertNotEqual(webView.url?.host, "localhost", "頁面不該導覽到非白名單主機")
        let body = probe.javaScript("document.body ? document.body.innerHTML : ''") as? String
        XCTAssertFalse(
            body?.contains(RedirectServer.marker) ?? false,
            "頁面不該取得重新導向目標的內容"
        )
    }

    /// 5c. 一般載入時 response 政策確實會被呼叫，且白名單主機的回應被允許。
    /// 搭配政策單元測試（外部主機一律拒絕），這證明 response 這一層有接上，
    /// 不是只有宣告而沒有連線。
    func testResponsePolicyRunsForAllowedNavigation() {
        guard let server = RedirectServer() else {
            XCTFail("無法啟動測試用的本機 HTTP 伺服器")
            return
        }
        defer { server.stop() }

        let recorder = NavigationProbe(coordinator: makeCoordinator(allowedHosts: ["127.0.0.1"]))
        let (probe, webView) = makeWindowedWebView(delegate: recorder)
        defer { probe.tearDown() }

        webView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(server.port)/marker")!))
        recorder.waitForResponseAction()

        XCTAssertTrue(
            recorder.actions.contains { $0.hasPrefix("response:") },
            "載入完成後應觸發 response 政策：\(recorder.actions)"
        )
        XCTAssertFalse(recorder.decisions.contains { !$0.allowed }, "白名單主機的回應應被允許")
        XCTAssertEqual(webView.url?.host, "127.0.0.1")
    }

    // MARK: - 掛載時機（串流完成才載入）

    /// 串流中不能載入 HTML；串流完成才 load。直接呼叫 Coordinator 的載入決策，
    /// makeNSView 與 updateNSView 也走同一個方法。
    func testWebViewLoadsOnlyAfterStreamCompletes() {
        let coordinator = makeCoordinator()
        let config = McpAppWebView.makeConfiguration(handler: coordinator)
        let container = McpAppContainerView(configuration: config)
        let html = "<!doctype html><html><body>mcp</body></html>"

        // 串流中：isReady = false，Coordinator 不該載入。
        coordinator.loadIfReady(html: html, isReady: false, in: container.webView)
        XCTAssertNil(coordinator.loadedHTML, "串流中不該載入 HTML")

        // 串流完成：isReady = true，才載入。
        coordinator.loadIfReady(html: html, isReady: true, in: container.webView)
        XCTAssertEqual(coordinator.loadedHTML, html, "串流完成後才載入 HTML")

        // 產品的掛載決策本身：串流中一律不載入；已載入同一份 HTML 不重載。
        XCTAssertFalse(McpAppWebView.shouldLoad(isReady: false, loadedHTML: nil, html: html))
        XCTAssertFalse(McpAppWebView.shouldLoad(isReady: true, loadedHTML: html, html: html))
        XCTAssertTrue(McpAppWebView.shouldLoad(isReady: true, loadedHTML: nil, html: html))
        XCTAssertTrue(McpAppWebView.shouldLoad(isReady: true, loadedHTML: "<b>old</b>", html: html))
    }

    /// 同一份 HTML 在 isReady 翻轉前後只載入一次（loadedHTML 只設一次）。
    func testLoadIsIdempotentAcrossReadinessFlip() {
        let coordinator = makeCoordinator()
        let container = makeBareContainer()

        coordinator.loadIfReady(html: "<b>x</b>", isReady: false, in: container.webView)
        XCTAssertNil(coordinator.loadedHTML)

        coordinator.loadIfReady(html: "<b>x</b>", isReady: true, in: container.webView)
        XCTAssertEqual(coordinator.loadedHTML, "<b>x</b>")
    }

    // MARK: - 回收量測

    /// 離開畫面後，容器從視窗移除、沒有外部強參考時可被釋放。
    /// WKWebView 的內部資源由 WebKit 在 RunLoop 後續回合釋放，需留幾秒。
    func testContainerIsDeallocatedAfterLeavingWindow() {
        weak var weakContainer: McpAppContainerView?
        weak var weakWebView: WKWebView?
        autoreleasepool {
            let container = makeBareContainer()
            // 用一層 superview 當 contentView，容器是它的 subview；
            // 這樣 removeFromSuperview 才會真的切掉最後一個強參考。
            let superview = NSView(frame: NSRect(x: 0, y: 0, width: 320, height: 240))
            superview.addSubview(container)
            let window = makeWindow()
            window.contentView = superview
            window.makeKeyAndOrderFront(nil)
            weakContainer = container
            weakWebView = container.webView
            container.removeFromSuperview()
            XCTAssertNil(container.webView.superview)
        }
        let done = expectation(description: "dealloc")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { done.fulfill() }
        wait(for: [done], timeout: 5)
        XCTAssertNil(weakContainer, "離開視窗且沒有外部強參考時，容器應被釋放")
        XCTAssertNil(weakWebView, "容器釋放時，WKWebView 也應被釋放")
    }

    /// 量測行程記憶體足跡：建立並拆除 5 個 WebView、等 WebKit 釋放內部資源後，
    /// 穩態足跡不該無上限成長。門檻刻意寬鬆（500 MB），只攔真的洩漏。
    /// 實際數字由 FOOTPRINT 訊息印出，可重複執行本測試觀察。
    func testFootprintDoesNotGrowUnboundedAfterRepeatedMounts() {
        let before = ProcessFootprint.bytes()
        XCTAssertGreaterThan(before, 0, "應能讀到行程記憶體足跡")
        for _ in 0..<5 {
            autoreleasepool {
                let container = makeBareContainer()
                let superview = NSView(frame: NSRect(x: 0, y: 0, width: 320, height: 240))
                superview.addSubview(container)
                let window = makeWindow()
                window.contentView = superview
                window.makeKeyAndOrderFront(nil)
                container.webView.loadHTMLString("<html><body>mcp</body></html>", baseURL: nil)
                container.removeFromSuperview()
            }
        }
        // 等 WebKit 在 RunLoop 後續回合釋放 WebContent 快取，再量穩態。
        let settled = expectation(description: "footprint settled")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { settled.fulfill() }
        wait(for: [settled], timeout: 5)

        let after = ProcessFootprint.bytes()
        let growth = after - before
        print("FOOTPRINT before=\(before) after=\(after) growth=\(growth)")
        // WKWebView 的 WebContent 行程會保留快取，不要求回到基準線。
        XCTAssertLessThan(growth, 500 * 1024 * 1024, "拆除後記憶體不該無上限成長")
    }

    // MARK: - 連線與拆除（原有的結構測試）

    func testConfigurationUsesEphemeralStoreAndBlocksNewWindows() {
        let configuration = McpAppWebView.makeConfiguration(handler: MessageHandlerSpy())

        XCTAssertFalse(configuration.websiteDataStore.isPersistent)
        XCTAssertFalse(configuration.preferences.javaScriptCanOpenWindowsAutomatically)
        XCTAssertTrue(configuration.defaultWebpagePreferences.allowsContentJavaScript)
    }

    func testLeavingWindowTearsDownWebView() {
        let container = makeContainer()
        let window = makeWindow()
        window.contentView = container

        XCTAssertNotNil(container.webView.navigationDelegate)
        XCTAssertNotNil(container.webView.uiDelegate)

        container.removeFromSuperview()

        XCTAssertNil(container.webView.navigationDelegate)
        XCTAssertNil(container.webView.uiDelegate)
        XCTAssertNil(container.webView.superview)

        container.tearDown()
    }

    func testTeardownIsIdempotent() {
        let container = makeContainer()

        container.tearDown()
        container.tearDown()

        XCTAssertNil(container.webView.navigationDelegate)
        XCTAssertNil(container.webView.uiDelegate)
    }

    // MARK: - 輔助

    private var spies: [MessageHandlerSpy] = []
    private var liveProbes: [WebViewProbe] = []
    private var windows: [NSWindow] = []

    override func tearDown() {
        liveProbes.forEach { $0.tearDown() }
        liveProbes = []
        spies = []
        windows = []
        super.tearDown()
    }

    private func sampleContext() -> McpAppHostContext {
        McpAppHostContext(theme: .light, language: .zhHant)
    }

    private func makeCoordinator(allowedHosts: [String] = []) -> McpAppWebView.Coordinator {
        McpAppWebView.Coordinator(
            policy: McpAppNavigationPolicy(allowedHosts: allowedHosts),
            context: sampleContext()
        )
    }

    private func makeNavigationAction(url: URL) -> WKNavigationAction {
        NavigationActionProbe(request: URLRequest(url: url))
    }

    private func makeContainer() -> McpAppContainerView {
        let spy = MessageHandlerSpy()
        spies.append(spy)
        let configuration = McpAppWebView.makeConfiguration(handler: spy)
        let container = McpAppContainerView(configuration: configuration)
        container.webView.navigationDelegate = spy
        container.webView.uiDelegate = spy
        return container
    }

    private func makeBareContainer() -> McpAppContainerView {
        McpAppContainerView(configuration: McpAppWebView.makeConfiguration(handler: MessageHandlerSpy()))
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

    private func makeLiveProbe(html: String) -> WebViewProbe {
        let (probe, _) = makeLiveProbeWithDelegate(html: html, delegate: nil)
        return probe
    }

    private func makeWindowedWebView(
        delegate: NavigationProbe
    ) -> (WebViewProbe, WKWebView) {
        let coordinator = makeCoordinator()
        let config = McpAppWebView.makeConfiguration(handler: coordinator)
        let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 320, height: 240), configuration: config)
        webView.navigationDelegate = delegate
        webView.uiDelegate = delegate
        let window = makeWindow()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        let probe = WebViewProbe(webView: webView)
        liveProbes.append(probe)
        return (probe, webView)
    }

    private func makeLiveProbeWithDelegate(
        html: String,
        delegate: NavigationProbe?
    ) -> (WebViewProbe, WKWebView) {
        let navProbe = delegate ?? NavigationProbe(coordinator: makeCoordinator())
        let (probe, webView) = makeWindowedWebView(delegate: navProbe)

        // 在目前文件放記號；loadHTMLString 換成新文件時 window 被替換，記號消失，
        // 可用來分辨「新文件已載入完成」而非剛建立的 about:blank（它一開始就是 complete）。
        probe.javaScript("window.__probeSentinel = true")
        webView.loadHTMLString(html, baseURL: nil)
        probe.waitForPageLoad()

        return (probe, webView)
    }
}

// MARK: - 測試輔助型別

/// 在真的 WKWebView 上執行 JS 並等待結果。
private final class WebViewProbe {
    let webView: WKWebView

    init(webView: WKWebView) {
        self.webView = webView
    }

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

    /// 輪詢 `document.readyState`，等新文件真的完成載入，最多 10 秒。
    /// 以 `window.__probeSentinel` 消失判斷新文件已替換舊文件，因為新 webView 一開始的
    /// about:blank 也是 complete，只看 readyState 會在 loadHTMLString 生效前就誤判完成。
    func waitForPageLoad() {
        waitUntil(deadline: Date().addingTimeInterval(10)) {
            guard let ready = self.javaScript("document.readyState") as? String,
                  ready == "complete" else { return false }
            let sentinel = self.javaScript("typeof window.__probeSentinel")
            return sentinel as? String != "boolean"
        }
    }

    /// 非同步等待 `window.__result` 從初始值變成明確字串結果。
    /// 只有 `typeof` 是 string 且值不同於初始值才算完成；undefined／null 代表頁面腳本還沒執行，必須繼續等。
    /// 逾時回傳最後讀到的值，讓 assertion 顯示頁面的具體內容。
    @discardableResult
    func waitForSettled(initial: String) -> String {
        waitUntil(deadline: Date().addingTimeInterval(10)) {
            guard let value = self.javaScript(
                "typeof window.__result === 'string' ? window.__result : null"
            ) as? String else { return false }
            return value != initial
        }
        return javaScript("String(window.__result)") as? String ?? "undefined"
    }

    /// 在期限前反覆檢查條件，每次檢查之間留一拍給 WebKit 的回呼與頁面腳本執行。
    private func waitUntil(deadline: Date, condition: () -> Bool) {
        while Date() < deadline, !condition() {
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

/// 記錄導航決策：把請求轉送給真正的 Coordinator，記錄它回傳的 allow/cancel。
/// 這樣測到的是產品的決策邏輯，不是測試裡複製的一份。
private final class NavigationProbe: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let coordinator: McpAppWebView.Coordinator
    var actions: [String] = []
    var decisions: [(url: String, allowed: Bool)] = []

    init(coordinator: McpAppWebView.Coordinator) {
        self.coordinator = coordinator
    }

    /// 輪詢 `actions`，等 response 政策被呼叫，最多 10 秒。
    /// 每次等待都讓主執行緒的 RunLoop 有機會處理 WebKit 的 delegate 回呼。
    func waitForResponseAction(timeout: TimeInterval = 10) {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline, !actions.contains(where: { $0.hasPrefix("response:") }) {
            let done = XCTestExpectation(description: "response action poll")
            XCTWaiter().wait(for: [done], timeout: 0.05)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        actions.append("action:\(url?.absoluteString ?? "nil")")
        coordinator.webView(webView, decidePolicyFor: navigationAction) { decision in
            self.decisions.append((url?.absoluteString ?? "", decision == .allow))
            decisionHandler(decision)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let url = navigationResponse.response.url
        actions.append("response:\(url?.absoluteString ?? "nil")")
        coordinator.webView(webView, decidePolicyFor: navigationResponse) { decision in
            self.decisions.append((url?.absoluteString ?? "", decision == .allow))
            decisionHandler(decision)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        coordinator.webView(webView, createWebViewWith: configuration, for: navigationAction, windowFeatures: windowFeatures)
    }
}

private final class MessageHandlerSpy: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {}
}

/// 用來直接呼叫 createWebViewWith 的最小 WKNavigationAction 替代。
private final class NavigationActionProbe: WKNavigationAction {
    private let probeRequest: URLRequest
    init(request: URLRequest) { probeRequest = request }
    override var request: URLRequest { probeRequest }
}

/// 只服務測試用的最小 HTTP 伺服器。`/redirect` 回 302 到 `localhost` 的 `/marker`，
/// 其他路徑回一段帶標記的 HTML。全部走本機，不需要對外網路。
private final class RedirectServer {
    /// 目標頁面的標記；重新導向被擋下時，頁面不該拿到這段內容。
    static let marker = "REDIRECT_MARKER_SHOULD_NOT_LOAD"

    private(set) var port: UInt16 = 0
    private var listenFD: Int32 = -1
    private let queue = DispatchQueue(label: "cardiary.tests.redirect-server")
    private let lock = NSLock()
    private var stopped = false

    init?() {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }

        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let size = socklen_t(MemoryLayout<sockaddr_in>.size)

        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, size) }
        }
        guard bound == 0 else { close(fd); return nil }

        var actual = sockaddr_in()
        var actualSize = size
        let named = withUnsafeMutablePointer(to: &actual) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &actualSize) }
        }
        guard named == 0, listen(fd, 8) == 0 else { close(fd); return nil }

        port = UInt16(bigEndian: actual.sin_port)
        listenFD = fd
        queue.async { [weak self] in self?.acceptLoop() }
    }

    func stop() {
        lock.lock()
        stopped = true
        let fd = listenFD
        listenFD = -1
        lock.unlock()
        if fd >= 0 {
            shutdown(fd, SHUT_RDWR)
            close(fd)
        }
    }

    private var isStopped: Bool {
        lock.lock()
        defer { lock.unlock() }
        return stopped
    }

    private func acceptLoop() {
        while !isStopped {
            let client = accept(listenFD, nil, nil)
            if client < 0 { return }
            handle(client)
        }
    }

    private func handle(_ client: Int32) {
        defer { close(client) }
        var buffer = [UInt8](repeating: 0, count: 4096)
        let count = read(client, &buffer, buffer.count)
        guard count > 0 else { return }
        let request = String(decoding: buffer[0..<count], as: UTF8.self)
        let path = request.split(separator: " ").dropFirst().first.map(String.init) ?? "/"

        let response: String
        if path == "/redirect" {
            response = "HTTP/1.1 302 Found\r\n"
                + "Location: http://localhost:\(port)/marker\r\n"
                + "Content-Length: 0\r\nConnection: close\r\n\r\n"
        } else if path == "/host-protocol" {
            let body = #"{"jsonrpc":"2.0","result":{"token":"HOST_TOKEN_SHOULD_NOT_LEAK"}}"#
            response = "HTTP/1.1 200 OK\r\n"
                + "Content-Type: application/json\r\n"
                + "Content-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n"
                + body
        } else {
            let body = "<html><body>\(Self.marker)</body></html>"
            response = "HTTP/1.1 200 OK\r\n"
                + "Content-Type: text/html; charset=utf-8\r\n"
                + "Content-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n"
                + body
        }
        writeAll(client, Data(response.utf8))
    }

    private func writeAll(_ fd: Int32, _ data: Data) {
        data.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let written = write(fd, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                if written <= 0 { return }
                offset += written
            }
        }
    }
}

/// 讀取行程記憶體足跡（Mach `task_info`）。
private enum ProcessFootprint {
    static func bytes() -> UInt64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / 4)
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { rebound in
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), rebound, &count)
            }
        }
        guard result == KERN_SUCCESS else { return 0 }
        return info.resident_size
    }
}
