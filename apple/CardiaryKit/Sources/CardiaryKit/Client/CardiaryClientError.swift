import Foundation

/// 客戶端連線層的錯誤。`server` 保留主機回的錯誤信封，讓畫面能分辨版本、
/// 驗證與暫時性失敗。
public enum CardiaryClientError: Error, Equatable, Sendable {
    /// 連線已關閉，或傳輸層回報結束。
    case connectionClosed
    /// 等不到回應。
    case timeout
    /// 沒有共同的協定版本；主機只在 `details` 提供時帶範圍。
    case incompatibleVersion(serverMin: Int?, serverMax: Int?)
    /// 主機回傳錯誤信封。
    case server(ErrorFrame)
    /// frame 不是合法的 UTF-8 JSON 物件，或缺少必要欄位。
    case invalidFrame(String)
    /// 回應的 `replyTo` 對不上任何在途請求。
    case unexpectedReply(String)
    /// 主機要求重新載入快照，但客戶端沒有可用的快照處理方式。
    case resyncRequired(stream: String)
}

extension CardiaryClientError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .connectionClosed:
            return "與主機服務的連線已關閉。"
        case .timeout:
            return "主機服務沒有在期限內回應。"
        case .incompatibleVersion(let min, let max):
            if let min, let max {
                return "沒有共同的協定版本（主機支援 \(min)…\(max)）。"
            }
            return "沒有共同的協定版本。"
        case .server(let frame):
            return frame.message
        case .invalidFrame(let detail):
            return "收到不合法的協定訊息：\(detail)"
        case .unexpectedReply(let id):
            return "收到對不上請求的回應：\(id)"
        case .resyncRequired(let stream):
            return "串流 \(stream) 需要重新載入快照。"
        }
    }
}
