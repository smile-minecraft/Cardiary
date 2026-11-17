import CardiaryKit
import Foundation

/// MCP App 取得的主題。深淺色由殼目前的環境決定，App 不自行判斷。
public enum McpAppTheme: String, Equatable, Sendable {
    case light
    case dark
}

/// 給 MCP App 的卡片摘要。只放畫面上看得到的欄位，不含內文全文、檔案路徑或任何權杖。
public struct McpAppCardSummary: Equatable, Sendable {
    public let cardId: String
    public let title: String
    public let summary: String?
    public let tags: [String]
    public let kind: String

    public init(
        cardId: String,
        title: String,
        summary: String? = nil,
        tags: [String] = [],
        kind: String
    ) {
        self.cardId = cardId
        self.title = title
        self.summary = summary
        self.tags = tags
        self.kind = kind
    }

    public init(_ card: CardSummary) {
        self.init(
            cardId: card.cardId,
            title: card.title,
            summary: card.summary,
            tags: card.tags,
            kind: card.kind.rawValue
        )
    }

    /// 傳給頁面的欄位。新增欄位前先確認它屬於卡片摘要，不能夾帶其他資料。
    var jsonObject: [String: Any] {
        var object: [String: Any] = [
            "cardId": cardId,
            "title": title,
            "tags": tags,
            "kind": kind,
        ]
        if let summary {
            object["summary"] = summary
        }
        return object
    }
}

/// 殼提供給 MCP App 的唯一一份資料：主題、語系與卡片摘要。
///
/// 這是嵌入網頁的訊息通道白名單。連線資訊、權杖、檔案路徑、卡片全文與其他設定
/// 都不在這裡，也不得以「順便」的名義加進來（`docs/spec.md` 第 11 章連線安全）。
public struct McpAppHostContext: Equatable, Sendable {
    public let theme: McpAppTheme
    public let language: AppLanguage
    public let card: McpAppCardSummary?

    public init(theme: McpAppTheme, language: AppLanguage, card: McpAppCardSummary? = nil) {
        self.theme = theme
        self.language = language
        self.card = card
    }

    /// 只有三個鍵：`theme`、`language`、`card`。
    public var jsonObject: [String: Any] {
        var object: [String: Any] = [
            "theme": theme.rawValue,
            "language": language.rawValue,
        ]
        if let card {
            object["card"] = card.jsonObject
        }
        return object
    }

    /// 排好鍵的 JSON 文字，讓頁面與測試看到同一份內容。
    public func jsonText() -> String {
        guard
            JSONSerialization.isValidJSONObject(jsonObject),
            let data = try? JSONSerialization.data(withJSONObject: jsonObject, options: [.sortedKeys])
        else {
            return "{}"
        }
        return String(decoding: data, as: UTF8.self)
    }
}

/// 把字串變成安全的 JavaScript 字串常值。
///
/// 內容來自卡片，可能含有 `<`、`</script>` 或 U+2028 這類會提早結束指令碼的字元。
/// 這裡全部跳脫，嵌進 `evaluateJavaScript` 時不會跳脫字串脈絡。
public enum McpAppScript {
    public static func literal(_ value: String) -> String {
        var output = "\""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\"": output += "\\\""
            case "\\": output += "\\\\"
            case "\n": output += "\\n"
            case "\r": output += "\\r"
            case "\t": output += "\\t"
            case "<": output += "\\u003C"
            case ">": output += "\\u003E"
            case "&": output += "\\u0026"
            case "\u{2028}": output += "\\u2028"
            case "\u{2029}": output += "\\u2029"
            default:
                if scalar.value < 0x20 {
                    output += String(format: "\\u%04X", scalar.value)
                } else {
                    output.unicodeScalars.append(scalar)
                }
            }
        }
        return output + "\""
    }
}
