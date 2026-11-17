import CardiaryKit
import Foundation

/// `stream.ui` 之中 MCP App Html 區塊的約定。
///
/// 電話協定只有 `renderer:String` 與 `data:JSONValue` 兩個通用欄位（`stream.ui`），
/// 每一種 renderer 自己約定 `data` 的形狀，原生這側再依 renderer 選呈現方式。
/// `bar`、`table` 已經是這種做法；MCP App 沿用同一個通道，不新增協定欄位。
///
/// 內容由 MCP 伺服器的 `ui://` 資源而來（詳見 `docs/spikes/external-agents.md`
/// 第 6 節：MIME `text/html;profile=mcp-app`）。主機端會從工具結果自帶的
/// resource，或工具描述 `_meta.ui.resourceUri` 所指的 `ui://` 資源讀取 HTML，
/// 通過 MIME 與大小檢查後，以 `stream.ui renderer=mcp.app` 送到客戶端；
/// 這一層只負責「當內容以這個 renderer 送來時，安全地嵌入式呈現」。
public enum McpAppBlockContent {
    /// 只有這個 renderer 會被當成可嵌入的 MCP App。
    public static let renderer = "mcp.app"

    public struct Parsed: Equatable, Sendable {
        public let html: String
        public let allowedHosts: [String]

        public init(html: String, allowedHosts: [String]) {
            self.html = html
            self.allowedHosts = allowedHosts
        }
    }

    /// 從 `stream.ui.data` 讀出 Html 與允許清單。
    /// 缺少 Html 或形狀不對時回 nil，呼叫端就退回原本的原始資料呈現，
    /// 不讓來路不明的內容進到 WebView。
    public static func parse(renderer: String, data: JSONValue) -> Parsed? {
        guard renderer == Self.renderer,
              let object = data.objectValue,
              let html = object["html"]?.stringValue,
              !html.isEmpty
        else { return nil }

        let hosts = object["allowedHosts"]?.arrayValue?
            .compactMap(\.stringValue)
            .filter { !$0.isEmpty } ?? []
        return Parsed(html: html, allowedHosts: hosts)
    }
}
