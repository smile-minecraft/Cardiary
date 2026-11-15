import CardiaryKit
import Foundation

/// 協定要求的用戶端請求 ID。格式是 `前綴_隨機`，重送時由呼叫端沿用同一個值。
enum ClientRequestID {
    static func next(_ prefix: String) -> String {
        "\(prefix)_\(UUID().uuidString.lowercased())"
    }
}

/// 把工具輸入與結構化資料轉成畫面上看得懂的一小段文字。
enum JSONText {
    static func compact(_ object: JSONObject, limit: Int = 400) -> String {
        compact(JSONValue.object(object), limit: limit)
    }

    static func compact(_ value: JSONValue, limit: Int = 400) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(value), let text = String(data: data, encoding: .utf8) else {
            return ""
        }
        if text.count <= limit { return text }
        return String(text.prefix(limit)) + "…"
    }

    /// 給清單用的單行摘要：拿掉換行並截短。
    static func oneline(_ text: String, limit: Int = 160) -> String {
        let collapsed = text.split(whereSeparator: \.isNewline).joined(separator: " ")
        if collapsed.count <= limit { return collapsed }
        return String(collapsed.prefix(limit)) + "…"
    }
}
