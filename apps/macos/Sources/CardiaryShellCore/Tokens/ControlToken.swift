import CryptoKit
import Foundation

/// 控制面 Token。
///
/// 格式是 32 位元組隨機值的 base64url（43 個字元）。殼每次啟動產生兩把：
/// 殼→服務的控制 Token 與服務→殼的代理 Token。兩把只經 stdin 的 `init` 交給
/// 服務，不進 argv、環境變數、日誌或磁碟。
public struct ControlToken: Equatable, Sendable {
    /// 協定規定的長度：32 bytes 的 base64url，沒有 padding。
    public static let encodedLength = 43

    public let value: String

    public init(value: String) {
        self.value = value
    }

    /// 產生新的隨機 Token。
    public static func generate(byteCount: Int = 32) -> ControlToken {
        var generator = SystemRandomNumberGenerator()
        var bytes = [UInt8]()
        bytes.reserveCapacity(byteCount)
        for _ in 0..<byteCount {
            bytes.append(UInt8.random(in: UInt8.min...UInt8.max, using: &generator))
        }
        return ControlToken(value: base64URL(Data(bytes)))
    }

    public static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public var isValidFormat: Bool {
        guard value.count == Self.encodedLength else { return false }
        let allowed = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
        return value.allSatisfy { allowed.contains($0) }
    }

    /// 常數時間比較：長度相同時逐位元組累積差異，不提早回傳。
    ///
    /// 長度不是秘密（格式固定 43 個字元），所以長度不符時直接回 false。
    public func matches(_ candidate: String?) -> Bool {
        guard let candidate else { return false }
        let expected = Array(value.utf8)
        let actual = Array(candidate.utf8)
        guard expected.count == actual.count else { return false }
        var difference: UInt8 = 0
        for index in expected.indices {
            difference |= expected[index] ^ actual[index]
        }
        return difference == 0
    }

    /// 日誌只能出現這個形式：不可逆的 SHA-256 前 8 個十六進位字元。
    public var logPrefix: String {
        let digest = SHA256.hash(data: Data(value.utf8))
        return digest.prefix(4).map { String(format: "%02x", $0) }.joined()
    }

    /// 萬一需要寫進日誌，只能寫這個字串。
    public var redactedDescription: String {
        "<redacted \(value.count) chars \(logPrefix)>"
    }

    /// 只用在測試：避免 Token 被編譯器最佳化掉。
    public var byteCount: Int { value.utf8.count }
}
