import Foundation

/// 以 `URLSessionWebSocketTask` 連到主機服務的傳輸層。
///
/// 驗證 Token 由 `CardiaryConnection` 放進 `system.hello`，不放在 URL，也不放在
/// 查詢字串。端點只接受 `127.0.0.1` 的 loopback 位址。
public final class WebSocketTransport: CardiaryTransport, @unchecked Sendable {
    private let task: URLSessionWebSocketTask
    private let session: URLSession
    private let lock = NSLock()
    private var closed = false

    public init(endpoint: URL, session: URLSession = .shared) {
        precondition(
            endpoint.scheme == "ws" || endpoint.scheme == "wss",
            "WebSocket 端點必須是 ws 或 wss"
        )
        self.session = session
        self.task = session.webSocketTask(with: endpoint)
        task.resume()
    }

    public func send(_ text: String) async throws {
        guard !isClosed else { throw CardiaryClientError.connectionClosed }
        try await task.send(.string(text))
    }

    public func receive() async throws -> String? {
        if isClosed { return nil }
        do {
            let message = try await task.receive()
            switch message {
            case .string(let text):
                return text
            case .data(let data):
                guard let text = String(data: data, encoding: .utf8) else {
                    throw CardiaryClientError.invalidFrame("WebSocket 收到不是 UTF-8 的二進位訊息。")
                }
                return text
            @unknown default:
                throw CardiaryClientError.invalidFrame("WebSocket 收到不支援的訊息種類。")
            }
        } catch {
            if isClosed { return nil }
            throw error
        }
    }

    public func close() async {
        guard markClosed() else { return }
        task.cancel(with: .normalClosure, reason: nil)
        session.invalidateAndCancel()
    }

    private func markClosed() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        let alreadyClosed = closed
        closed = true
        return !alreadyClosed
    }

    private var isClosed: Bool {
        lock.lock()
        defer { lock.unlock() }
        return closed
    }
}
