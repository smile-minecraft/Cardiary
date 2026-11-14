import Foundation

/// 協定訊息的傳輸層。正式連線走 WebSocket，測試用記憶體內的替身。
///
/// 一個 frame 就是一則 UTF-8 JSON 文字訊息；傳輸層不解析內容，也不重送。
public protocol CardiaryTransport: Sendable {
    /// 送出一個 frame。呼叫端保證前一次送出已完成。
    func send(_ text: String) async throws

    /// 取得下一個 frame；連線關閉時回傳 `nil`。
    func receive() async throws -> String?

    /// 關閉連線。重複呼叫是安全的。
    func close() async
}
