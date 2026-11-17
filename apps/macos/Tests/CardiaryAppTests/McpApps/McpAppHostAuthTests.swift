import CardiaryKit
import CardiaryShellCore
import Foundation
import WebKit
import XCTest

@testable import CardiaryApp

/// 驗收 #5 的關鍵差異證據：既有 `testWebViewCannotReadHostProtocolResponse`
/// 只靠 CORS 讓頁面讀不到回應，無法證明「沒有有效 Token 的請求不會被 host 當成
/// 有效控制請求」。這裡改用真的 host gateway + 真的 WKWebView（產品同一份
/// `McpAppWebView.makeConfiguration`），讓頁面自己開 WebSocket 送一個控制請求，
/// 直接觀察 host 回傳的錯誤訊框——完全不經過 CORS。
///
/// 頁面沒有 system.hello、也沒有任何 Token。若 host 把這個請求當成有效控制請求，
/// 就會回一個成功的控制回應；測試要求它只收到拒絕錯誤，絕對不能收到成功回應。
///
/// 整個測試刻意保持同步：WebKit 的 JavaScript 回呼只在同步測試（主執行緒 RunLoop
/// 正常運轉）下才會觸發，`async` 測試方法裡 XCTWaiter 無法驅動 WebKit。因此 host
/// 用 `Process` 在固定埠啟動，同步輪詢連線就緒。
@MainActor
final class McpAppHostAuthTests: XCTestCase {
    private var process: Process?
    private var windows: [NSWindow] = []
    private var probe: WebViewProbe?

    override func tearDown() {
        probe?.tearDown()
        probe = nil
        if let process, process.isRunning {
            process.terminate()
            process.waitUntilExit()
        }
        self.process = nil
        windows = []
        super.tearDown()
    }

    func testWebViewWithoutTokenCannotGetControlRequestProcessedByRealHost() throws {
        let repositoryRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // McpApps
            .deletingLastPathComponent()  // CardiaryAppTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // macos
            .deletingLastPathComponent()  // apps
            .deletingLastPathComponent()  // repo
        let hostEntry = repositoryRoot.appendingPathComponent("packages/host/dist/main.js")
        guard FileManager.default.fileExists(atPath: hostEntry.path) else {
            throw XCTSkip("找不到主機服務；先跑 pnpm build")
        }
        guard let node = nodeLaunch() else { throw XCTSkip("找不到 Node") }

        let port = try XCTUnwrap(freePort())
        let folder = try makeTemporaryFolder(prefix: "cardiary-mcp-app-auth")
        let stateDirectory = folder.appendingPathComponent("state", isDirectory: true)
        try FileManager.default.createDirectory(at: stateDirectory, withIntermediateDirectories: true)
        let identity: [String: Any] = [
            "format": 1,
            "folderId": "01TESTFOLDER00000000000000",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "createdBy": "mcp-app-auth-test",
        ]
        try JSONSerialization.data(withJSONObject: identity, options: [.prettyPrinted])
            .write(to: stateDirectory.appendingPathComponent("folder.json"))

        let tmp = folder.appendingPathComponent("tmp", isDirectory: true).path
        let task = Process()
        task.executableURL = node
        task.arguments = [hostEntry.path, "--engine", "fake", "--folder", folder.path, "--port", String(port)]
        task.environment = [
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "HOME": NSHomeDirectory(),
            "TMPDIR": tmp,
            "TMP": tmp,
            "TEMP": tmp,
        ]
        task.currentDirectoryURL = folder
        // 排空 stdout/stderr，避免 pipe 滿了讓 host 卡住。
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { _ in }
        try task.run()
        self.process = task

        // 同步等 host 的 gateway 開始接受連線。
        let ready = waitForPort(port, timeout: 20)
        XCTAssertTrue(ready, "host gateway 應該在 20 秒內開始監聽埠 \(port)")

        let html = """
        <!doctype html><html><body><script>
          window.__frames = [];
          window.__close = null;
          window.__opened = false;
          var ws = new WebSocket('ws://127.0.0.1:\(port)/v1/ws');
          ws.onopen = function () {
            window.__opened = true;
            try {
              ws.send(JSON.stringify({
                v: 1, kind: 'request', id: 'evil-no-token',
                type: 'session.create', payload: { title: 'should-not-be-created' }
              }));
            } catch (e) {}
          };
          ws.onmessage = function (event) {
            try { window.__frames.push(JSON.parse(event.data)); }
            catch (e) { window.__frames.push({ parseError: true }); }
          };
          ws.onclose = function (event) { window.__close = event.code; };
        </script></body></html>
        """

        let coordinator = McpAppWebView.Coordinator(
            policy: McpAppNavigationPolicy(allowedHosts: ["127.0.0.1"]),
            context: McpAppHostContext(theme: .light, language: .zhHant)
        )
        let configuration = McpAppWebView.makeConfiguration(handler: coordinator)
        let webView = WKWebView(
            frame: NSRect(x: 0, y: 0, width: 320, height: 240),
            configuration: configuration
        )
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 240),
            styleMask: [.titled],
            backing: .buffered,
            defer: true
        )
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        windows.append(window)

        // baseURL 指向 loopback，讓頁面帶 allowed origin；即使如此，沒有 Token
        // 與 system.hello 的控制請求仍必須被 host 拒絕。
        webView.loadHTMLString(html, baseURL: URL(string: "http://127.0.0.1:\(port)/")!)

        let page = WebViewProbe(webView: webView)
        self.probe = page
        page.waitForPageLoad()
        page.waitForAuthSettled()

        let frames = page.jsonArray("window.__frames")
        let closeCode = page.javaScript("window.__close === null ? null : Number(window.__close)")
        let opened = page.javaScript("window.__opened === true") as? Bool ?? false

        // 真正的主張：host 回的是拒絕錯誤，絕對不是成功控制回應。
        let errors = frames.filter { $0["kind"] as? String == "error" }
        let errorCodes = errors.compactMap { $0["code"] as? String }
        XCTAssertTrue(
            errorCodes.contains("not_authenticated") || errorCodes.contains("auth_invalid"),
            "host 必須以 not_authenticated 或 auth_invalid 拒絕沒有 Token 的控制請求，收到：\(frames)"
        )

        let success = frames.filter { frame in
            frame["kind"] as? String == "response"
                && frame["id"] as? String == "evil-no-token"
        }
        XCTAssertTrue(
            success.isEmpty,
            "沒有有效 Token 的 session.create 絕對不能被當成有效控制請求處理，收到：\(frames)"
        )
        XCTAssertTrue(opened || !frames.isEmpty, "頁面應該真的建立過 WebSocket 並收到 host 訊框")
        if let code = closeCode as? Int {
            XCTAssertTrue(code == 1008 || code == 1000, "拒絕應伴隨 Close，收到 code \(code)")
        }
    }

    // MARK: - 啟動真的 host（同步）

    private func nodeLaunch() -> URL? {
        if let override = ProcessInfo.processInfo.environment["CARDIARY_NODE"],
            FileManager.default.isExecutableFile(atPath: override)
        {
            return URL(fileURLWithPath: override)
        }
        for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        where FileManager.default.isExecutableFile(atPath: candidate) {
            return URL(fileURLWithPath: candidate)
        }
        return nil
    }

    private func makeTemporaryFolder(prefix: String) throws -> URL {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("\(prefix)-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func freePort() -> UInt16? {
        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let size = socklen_t(MemoryLayout<sockaddr_in>.size)
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(fd, $0, size) }
        }
        guard bound == 0 else { return nil }
        var actual = sockaddr_in()
        var actualSize = size
        let named = withUnsafeMutablePointer(to: &actual) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &actualSize) }
        }
        guard named == 0 else { return nil }
        return UInt16(bigEndian: actual.sin_port)
    }

    private func waitForPort(_ port: UInt16, timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let fd = socket(AF_INET, SOCK_STREAM, 0)
            if fd >= 0 {
                var address = sockaddr_in()
                address.sin_family = sa_family_t(AF_INET)
                address.sin_port = UInt16(bigEndian: port)
                address.sin_addr.s_addr = inet_addr("127.0.0.1")
                let size = socklen_t(MemoryLayout<sockaddr_in>.size)
                let connected = withUnsafePointer(to: &address) {
                    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, size) }
                }
                close(fd)
                if connected == 0 { return true }
            }
            let done = XCTestExpectation(description: "port poll")
            XCTWaiter().wait(for: [done], timeout: 0.1)
        }
        return false
    }
}

/// 在真的 WKWebView 上讀取頁面狀態。用同步 XCTWaiter 驅動主執行緒，
/// 與 `McpAppWebViewTests` 的 `WebViewProbe` 同一個做法。
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

    func jsonArray(_ script: String) -> [[String: Any]] {
        guard let raw = javaScript("JSON.stringify(\(script))") as? String,
            let data = raw.data(using: .utf8),
            let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return [] }
        return array
    }

    func waitForPageLoad() {
        waitUntil(deadline: Date().addingTimeInterval(10)) {
            (self.javaScript("document.readyState") as? String) == "complete"
        }
    }

    func waitForAuthSettled() {
        waitUntil(deadline: Date().addingTimeInterval(12)) {
            let count = self.javaScript("window.__frames ? window.__frames.length : 0") as? Int ?? 0
            let closed = self.javaScript("window.__close !== null") as? Bool ?? false
            return count > 0 || closed
        }
    }

    private func waitUntil(deadline: Date, condition: () -> Bool) {
        while Date() < deadline, !condition() {
            let done = XCTestExpectation(description: "poll")
            XCTWaiter().wait(for: [done], timeout: 0.1)
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
