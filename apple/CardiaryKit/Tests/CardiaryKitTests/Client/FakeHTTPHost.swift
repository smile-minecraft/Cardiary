import Foundation

/// 測試用的 HTTP 主機：`FakeURLProtocol` 把請求交給目前設定的 `FakeHTTPHost`。
///
/// 上傳任務的內容在 `URLProtocol` 裡以 `httpBodyStream` 出現，這裡把它讀成 `Data`，
/// 測試才能斷言送出的位元組與 `Content-Length`。
final class FakeHTTPHost: @unchecked Sendable {
    struct Record: Sendable {
        let method: String
        let url: URL?
        let headers: [String: String]
        let body: Data?
    }

    struct Reply: Sendable {
        let status: Int
        let headers: [String: String]
        let body: Data

        init(status: Int = 201, headers: [String: String] = [:], body: Data = Data()) {
            self.status = status
            self.headers = headers
            self.body = body
        }

        static func json(_ text: String, status: Int = 201) -> Reply {
            Reply(
                status: status,
                headers: ["Content-Type": "application/json"],
                body: Data(text.utf8)
            )
        }
    }

    private let lock = NSLock()
    private var queued: [Reply] = []
    private var received: [Record] = []
    private var cursor = 0

    func enqueue(_ reply: Reply) {
        lock.lock()
        queued.append(reply)
        lock.unlock()
    }

    func record(_ record: Record) {
        lock.lock()
        received.append(record)
        lock.unlock()
    }

    func nextReply() -> Reply {
        lock.lock()
        defer { lock.unlock() }
        if queued.isEmpty { return Reply(status: 200) }
        return queued.removeFirst()
    }

    var records: [Record] {
        lock.lock()
        defer { lock.unlock() }
        return received
    }

    /// 等下一筆請求進來；測試依序檢查送出的內容。
    func nextRecord(timeout: TimeInterval = 3) async throws -> Record {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let record = takeRecord() {
                return record
            }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        throw FakeHTTPHostError.timeout
    }

    private func takeRecord() -> Record? {
        lock.lock()
        defer { lock.unlock() }
        guard cursor < received.count else { return nil }
        let record = received[cursor]
        cursor += 1
        return record
    }

    /// 建立連到這個主機的 URLSession；同一時間只支援一個主機。
    func makeSession() -> URLSession {
        FakeURLProtocol.host = self
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FakeURLProtocol.self]
        return URLSession(configuration: configuration)
    }
}

enum FakeHTTPHostError: Error {
    case timeout
}

final class FakeURLProtocol: URLProtocol {
    private final class HostBox: @unchecked Sendable {
        let lock = NSLock()
        var host: FakeHTTPHost?
    }

    private static let box = HostBox()

    static var host: FakeHTTPHost? {
        get {
            box.lock.lock()
            defer { box.lock.unlock() }
            return box.host
        }
        set {
            box.lock.lock()
            box.host = newValue
            box.lock.unlock()
        }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let host = Self.host else {
            client?.urlProtocol(self, didFailWithError: FakeHTTPHostError.timeout)
            return
        }
        let record = FakeHTTPHost.Record(
            method: request.httpMethod ?? "GET",
            url: request.url,
            headers: request.allHTTPHeaderFields ?? [:],
            body: Self.body(of: request)
        )
        host.record(record)

        let reply = host.nextReply()
        let response = HTTPURLResponse(
            url: request.url ?? URL(string: "http://127.0.0.1")!,
            statusCode: reply.status,
            httpVersion: "HTTP/1.1",
            headerFields: reply.headers
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if !reply.body.isEmpty {
            client?.urlProtocol(self, didLoad: reply.body)
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func body(of request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: 4096)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}
