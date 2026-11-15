import Foundation

/// 本機辨識不可用的原因。
///
/// `path_not_allowed` 代表路徑驗證沒過，殼沒有讀檔；`not_authorized` 與
/// `unsupported` 是 `docs/design/shell-control.md` 第 5.2 節定義的正常退化。
/// `timeout` 與 `failed` 是殼自己判斷的結果，服務端一律當成「沒有文字替身」。
public enum RecognitionUnavailableReason: String, Equatable, Sendable {
    case notAuthorized = "not_authorized"
    case unsupported
    case pathNotAllowed = "path_not_allowed"
    case timeout
    case failed
}

/// 語音逐字稿的一段；有時間軸時才帶毫秒。
public struct RecognitionSegment: Equatable, Sendable {
    public let text: String
    public let startMs: Int?
    public let durationMs: Int?

    public init(text: String, startMs: Int? = nil, durationMs: Int? = nil) {
        self.text = text
        self.startMs = startMs
        self.durationMs = durationMs
    }

    var payload: JSONValue {
        var object: [String: JSONValue] = ["text": .string(text)]
        if let startMs { object["startMs"] = .number(Double(startMs)) }
        if let durationMs { object["durationMs"] = .number(Double(durationMs)) }
        return .object(object)
    }
}

/// 一次辨識的結果；`text` 已經過 1 MiB 上限截斷。
public struct RecognitionText: Equatable, Sendable {
    public let text: String
    public let locale: String?
    public let truncated: Bool
    public let segments: [RecognitionSegment]?

    public init(
        text: String,
        locale: String? = nil,
        truncated: Bool = false,
        segments: [RecognitionSegment]? = nil
    ) {
        self.text = text
        self.locale = locale
        self.truncated = truncated
        self.segments = segments
    }
}

/// 辨識結果轉成代理回應的 payload；欄位照 `shell-control.md` 第 5.2 節。
public enum RecognitionOutcome: Equatable, Sendable {
    case available(RecognitionText)
    case unavailable(RecognitionUnavailableReason)

    public var payload: JSONValue {
        switch self {
        case .available(let result):
            var object: [String: JSONValue] = [
                "available": .bool(true),
                "text": .string(result.text),
            ]
            if let locale = result.locale {
                object["locale"] = .string(locale)
            }
            if let segments = result.segments {
                object["segments"] = .array(segments.map(\.payload))
            }
            if result.truncated {
                object["truncated"] = .bool(true)
            }
            return .object(object)
        case .unavailable(let reason):
            return .object([
                "available": .bool(false),
                "reason": .string(reason.rawValue),
            ])
        }
    }
}

/// 辨識引擎回報的失敗；`reason` 直接決定回應的 `reason`。
public struct RecognitionEngineError: Error, Equatable, Sendable {
    public let reason: RecognitionUnavailableReason
    public let message: String

    public init(reason: RecognitionUnavailableReason, message: String) {
        self.reason = reason
        self.message = message
    }
}

/// 辨識超過時限；不當成引擎失敗，回應 `reason: "timeout"`。
public struct RecognitionTimeoutError: Error, Equatable, Sendable {
    public init() {}
}

/// 回應文字的 1 MiB 上限。
///
/// 以 UTF-8 位元組計算；截斷點退到完整的 Unicode 純量邊界，不會留下半個
/// 字元。回應超過上限時帶 `truncated: true`，內容本身不進日誌。
public enum RecognitionTextLimiter {
    public static let maxBytes = 1024 * 1024

    public static func limit(
        _ text: String,
        maxBytes: Int = RecognitionTextLimiter.maxBytes
    ) -> (text: String, truncated: Bool) {
        let bytes = Array(text.utf8)
        guard bytes.count > maxBytes, maxBytes > 0 else {
            return (text, false)
        }
        var end = maxBytes
        while end > 0, bytes[end] & 0xC0 == 0x80 {
            end -= 1
        }
        return (String(decoding: bytes[0..<end], as: UTF8.self), true)
    }
}
