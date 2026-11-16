import AppKit
import CardiaryKit
import WebKit
import XCTest

@testable import CardiaryApp

/// MCP App 的嵌入邊界：導航白名單、訊息通道的資料範圍、臨時資料儲存與拆除。
@MainActor
final class McpAppWebViewTests: XCTestCase {
    // MARK: - 導航

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

    // MARK: - 訊息通道

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

    // MARK: - 連線與拆除

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

        // 重複拆除不會出錯。
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

    /// WKWebView 的委派是 weak，測試要自己留住替身。
    private var spies: [MessageHandlerSpy] = []

    override func tearDown() {
        spies = []
        super.tearDown()
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

    private func makeWindow() -> NSWindow {
        NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 240),
            styleMask: [.titled],
            backing: .buffered,
            defer: true
        )
    }
}

private final class MessageHandlerSpy: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {}
}
