import SwiftUI
import WebKit

/// MCP App 的嵌入元件：一個獨立、用完即丟的 WKWebView。
///
/// 安全邊界（`docs/spec.md` 第 11 章連線安全）：
/// - 每次掛載都用 `WKWebsiteDataStore.nonPersistent()`，離開畫面就不留 cookie、
///   快取或本機儲存。
/// - 原生注入的主題、語系與卡片摘要只在專屬的 `WKContentWorld` 裡執行，頁面
///   拿不到橋接函式；資料以 JSON 放進 DOM 的 `#cardiary-host-context`，這是
///   殼給頁面的唯一一份資料。
/// - 頁面發起的導航與重新導向都依 `allowedHosts` 檢查，外網一律取消；
///   `window.open` 與新視窗一律拒絕。
/// - `dismantleNSView` 或離開視窗時立刻拆除：停止載入、移除訊息處理器與委派、
///   清空頁面。
///
/// 頁面這一側的約定：讀 `#cardiary-host-context` 的 `textContent`（JSON，只有
/// `theme`、`language` 與 `card`），需要資料時送
/// `window.webkit.messageHandlers.cardiaryMcp.postMessage({ type: "ready" })`。
/// 殼收到 `ready` 後才寫入資料，其他訊息一律忽略。
public struct McpAppWebView: NSViewRepresentable {
    /// 頁面用來傳「我準備好了」的訊息名稱。
    public static let messageHandlerName = "cardiaryMcp"
    /// 原生橋接程式專屬的 content world。
    public static let bridgeWorldName = "cardiary.mcp-app.bridge"
    static let contextElementID = "cardiary-host-context"

    public let html: String
    public let allowedHosts: [String]
    public let context: McpAppHostContext
    /// 串流是否完成。回去之前不載入 HTML，只留空容器當占位；完成後才掛載內容。
    /// 預設 `true` 讓既有呼叫端行為不變。
    public let isReady: Bool

    public init(
        html: String,
        allowedHosts: [String],
        context: McpAppHostContext,
        isReady: Bool = true
    ) {
        self.html = html
        self.allowedHosts = allowedHosts
        self.context = context
        self.isReady = isReady
    }

    public func makeCoordinator() -> Coordinator {
        Coordinator(
            policy: McpAppNavigationPolicy(allowedHosts: allowedHosts),
            context: context
        )
    }

    public func makeNSView(context swiftContext: Context) -> McpAppContainerView {
        let configuration = Self.makeConfiguration(handler: swiftContext.coordinator)
        let container = McpAppContainerView(configuration: configuration)
        container.webView.navigationDelegate = swiftContext.coordinator
        container.webView.uiDelegate = swiftContext.coordinator
        swiftContext.coordinator.loadIfReady(html: html, isReady: isReady, in: container.webView)
        return container
    }

    public func updateNSView(_ container: McpAppContainerView, context swiftContext: Context) {
        swiftContext.coordinator.updateContext(context)
        // 與 makeNSView 走同一個入口：串流中不載入，完成後且 HTML 不同才載入。
        swiftContext.coordinator.loadIfReady(html: html, isReady: isReady, in: container.webView)
    }

    /// 掛載決策：串流完成，而且這份 HTML 和已載入的不同才載入。
    /// 抽成純函式讓「串流完成才掛載」可以直接被測試。
    static func shouldLoad(isReady: Bool, loadedHTML: String?, html: String) -> Bool {
        isReady && loadedHTML != html
    }

    public static func dismantleNSView(_ container: McpAppContainerView, coordinator: Coordinator) {
        container.tearDown()
    }

    static func makeConfiguration(handler: WKScriptMessageHandler) -> WKWebViewConfiguration {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        // 只有頁面自己的 content world 能送訊息給殼；其他 world 送來的一律收不到。
        configuration.userContentController.add(
            handler,
            contentWorld: .page,
            name: messageHandlerName
        )
        return configuration
    }

    /// 把資料寫進 DOM 的指令碼。在專屬 content world 執行，頁面只讀得到結果。
    static func contextScript(json: String) -> String {
        """
        (function () {
          var id = '\(contextElementID)';
          var element = document.getElementById(id);
          if (!element) {
            element = document.createElement('script');
            element.type = 'application/json';
            element.id = id;
            (document.head || document.documentElement).appendChild(element);
          }
          element.textContent = \(McpAppScript.literal(json));
          document.documentElement.setAttribute('data-cardiary-context', 'ready');
        })();
        """
    }

    @MainActor
    public final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate,
        WKScriptMessageHandler
    {
        private let policy: McpAppNavigationPolicy
        private let bridgeWorld = WKContentWorld.world(name: McpAppWebView.bridgeWorldName)
        private weak var webView: WKWebView?
        private(set) var context: McpAppHostContext
        private(set) var loadedHTML: String?

        init(policy: McpAppNavigationPolicy, context: McpAppHostContext) {
            self.policy = policy
            self.context = context
        }

        /// 只有串流完成、且這份 HTML 還沒載入過才載入。`makeNSView` 和
        /// `updateNSView` 都走這裡，測試也直接呼叫它，測到的就是產品的掛載時機。
        func loadIfReady(html: String, isReady: Bool, in webView: WKWebView) {
            guard McpAppWebView.shouldLoad(isReady: isReady, loadedHTML: loadedHTML, html: html)
            else { return }
            load(html: html, in: webView)
        }

        func load(html: String, in webView: WKWebView) {
            self.webView = webView
            loadedHTML = html
            webView.loadHTMLString(html, baseURL: nil)
        }

        func updateContext(_ context: McpAppHostContext) {
            guard context != self.context else { return }
            self.context = context
            deliverContext()
        }

        /// 把白名單資料寫進 DOM。
        func deliverContext() {
            guard let webView else { return }
            let script = McpAppWebView.contextScript(json: context.jsonText())
            webView.evaluateJavaScript(script, in: nil, in: bridgeWorld) { _ in }
        }

        // MARK: WKNavigationDelegate

        public func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            decisionHandler(policy.allows(navigationAction.request.url) ? .allow : .cancel)
        }

        /// 伺服器重新導向不經過 navigationAction，這裡再檢查一次實際回應的網址。
        public func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            decisionHandler(policy.allows(navigationResponse.response.url) ? .allow : .cancel)
        }

        public func webView(
            _ webView: WKWebView,
            didFinish navigation: WKNavigation?
        ) {
            deliverContext()
        }

        // MARK: WKUIDelegate

        /// `window.open`、`target="_blank"` 這類新視窗一律不建立。
        public func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            nil
        }

        // MARK: WKScriptMessageHandler

        public func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard message.name == McpAppWebView.messageHandlerName,
                let parsed = McpAppBridgeMessage.parse(message.body)
            else { return }
            switch parsed {
            case .ready:
                deliverContext()
            }
        }
    }
}

/// WKWebView 的容器。離開視窗時就拆除，不等 SwiftUI 回收整個畫面。
public final class McpAppContainerView: NSView {
    public let webView: WKWebView
    private var tornDown = false
    /// 只有真的進過視窗，離開視窗才代表使用者離開畫面。剛建立、還沒掛上視窗時
    /// SwiftUI 可能先放進暫存的父層，不能那時就拆掉。
    private var hasBeenInWindow = false

    init(configuration: WKWebViewConfiguration) {
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(frame: .zero)
        webView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: trailingAnchor),
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("McpAppContainerView 只由程式建立")
    }

    public override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window != nil {
            hasBeenInWindow = true
        } else if hasBeenInWindow {
            tearDown()
        }
    }

    /// 停止載入、解除委派、移除訊息處理器，讓頁面與殼之間不再有通道。
    public func tearDown() {
        guard !tornDown else { return }
        tornDown = true
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(
            forName: McpAppWebView.messageHandlerName
        )
        webView.configuration.userContentController.removeAllUserScripts()
        webView.loadHTMLString("", baseURL: nil)
        webView.removeFromSuperview()
    }
}
