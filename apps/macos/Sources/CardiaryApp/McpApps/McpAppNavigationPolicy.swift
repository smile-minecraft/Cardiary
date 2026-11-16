import Foundation

/// 一次導航的決定。被拒絕時帶著原因，記錄與測試才分得出是哪一條規則擋下的。
public enum McpAppNavigationDecision: Equatable, Sendable {
    case allow
    case block(McpAppNavigationBlockReason)
}

public enum McpAppNavigationBlockReason: Equatable, Sendable {
    /// 沒有網址，無法確認去向。
    case missingURL
    /// 不是 http 或 https（`about:blank` 只允許文件本身的初始載入）。
    case unsupportedScheme(String)
    /// 主機不在這個 MCP 伺服器的允許清單裡。
    case hostNotAllowed(String)
}

/// MCP App 的導航規則：只放行允許清單裡的網域。
///
/// 主機端對 HTTP 型 MCP 伺服器只允許設定的 URL host，重新導向逐次檢查
/// （`docs/spec.md` 第 11 章）；嵌入的頁面自己發起的導航也用同一套規則，
/// 不讓它把使用者帶到外網。比對只看小寫的完整 hostname，不含子網域、
/// 通訊協定或連接埠。
public struct McpAppNavigationPolicy: Equatable, Sendable {
    public let allowedHosts: Set<String>

    public init(allowedHosts: [String]) {
        self.allowedHosts = Set(
            allowedHosts
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
                .filter { !$0.isEmpty }
        )
    }

    public func decision(for url: URL?) -> McpAppNavigationDecision {
        guard let url else { return .block(.missingURL) }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "about" {
            // WKWebView 以 loadHTMLString 載入、沒有 base URL 時，文件網址就是 about:blank。
            return url.absoluteString == "about:blank" ? .allow : .block(.unsupportedScheme(scheme))
        }
        guard scheme == "http" || scheme == "https" else {
            return .block(.unsupportedScheme(scheme))
        }
        guard let host = url.host?.lowercased(), allowedHosts.contains(host) else {
            return .block(.hostNotAllowed(url.host?.lowercased() ?? ""))
        }
        return .allow
    }

    public func allows(_ url: URL?) -> Bool {
        decision(for: url) == .allow
    }
}

/// 頁面可以送給殼的訊息。只收這一種，其他形狀一律忽略。
///
/// 訊息通道從頁面往殼的方向只做「我準備好了」，殼收到後才把主題、語系與
/// 卡片摘要寫進 DOM；頁面沒有辦法要求更多資料。
public enum McpAppBridgeMessage: Equatable, Sendable {
    case ready

    public static func parse(_ body: Any) -> McpAppBridgeMessage? {
        guard let dictionary = body as? [String: Any], dictionary.count == 1 else { return nil }
        guard let type = dictionary["type"] as? String, type == "ready" else { return nil }
        return .ready
    }
}
