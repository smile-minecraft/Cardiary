import CardiaryKit
import Foundation
import XCTest

@testable import CardiaryApp

/// 殼組好的媒體服務：原檔真的走 HTTP 上傳，匯入用回傳的 blobId 走協定。
final class MediaServiceTests: XCTestCase {
    private var host: BlobHTTPHost!
    private var session: URLSession!

    override func setUp() {
        super.setUp()
        host = BlobHTTPHost()
        session = host.makeSession()
    }

    override func tearDown() {
        BlobHTTPProtocol.host = nil
        session.invalidateAndCancel()
        session = nil
        host = nil
        super.tearDown()
    }

    private func temporaryFile(_ bytes: [UInt8]) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("cardiary-import-\(UUID().uuidString).png")
        try Data(bytes).write(to: url)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func makeService(importer: any MediaImportService) -> CardiaryMediaService {
        CardiaryMediaService(
            blobs: BlobClient(
                configuration: BlobClient.Configuration(
                    baseURL: URL(string: "http://127.0.0.1:51234")!,
                    clientToken: "client-token"
                ),
                session: session
            ),
            importer: importer
        )
    }

    func testImportFileUploadsThenImportsReturnedBlobId() async throws {
        let blobId = String(repeating: "a", count: 64)
        let file = try temporaryFile([0x89, 0x50, 0x4E, 0x47])
        host.setReply(
            status: 201,
            body: Data(
                #"{"blobId":"\#(blobId)","mediaType":"image/png","sizeBytes":4}"#.utf8
            )
        )
        let importer = FakeCardiaryService()
        let service = makeService(importer: importer)

        let result = try await service.importFile(
            fileURL: file,
            mediaType: "image/png",
            ocrLocales: ["zh-Hant"],
            title: "截圖"
        )

        XCTAssertEqual(result.cardId, "card-image")
        XCTAssertEqual(result.kind, .image)

        let record = try await host.nextRecord()
        XCTAssertEqual(record.request.httpMethod, "POST")
        XCTAssertEqual(record.request.url?.path, "/v1/blobs")
        XCTAssertEqual(record.request.value(forHTTPHeaderField: "Authorization"), "Bearer client-token")
        XCTAssertEqual(record.request.value(forHTTPHeaderField: "Content-Type"), "image/png")
        XCTAssertEqual(record.body, Data([0x89, 0x50, 0x4E, 0x47]))

        let imported = await importer.importedBlobIds
        XCTAssertEqual(imported, [blobId], "匯入要用上傳回來的 blobId")
    }

    func testDownloadRequestsThumbVariant() async throws {
        let blobId = String(repeating: "b", count: 64)
        host.setReply(status: 200, body: Data([7, 8]))
        let service = makeService(importer: FakeCardiaryService())

        let data = try await service.download(blobId: blobId, variant: .thumb)

        XCTAssertEqual(data, Data([7, 8]))
        let record = try await host.nextRecord()
        XCTAssertEqual(record.request.httpMethod, "GET")
        XCTAssertEqual(record.request.url?.path, "/v1/blobs/\(blobId)")
        XCTAssertEqual(record.request.url?.query, "variant=thumb")
    }

    func testUploadFailureStopsBeforeImport() async throws {
        let file = try temporaryFile([1, 2])
        host.setReply(
            status: 401,
            body: Data(
                #"{"v":1,"kind":"error","code":"auth_invalid","message":"Token 無效","retryable":false}"#.utf8
            )
        )
        let importer = FakeCardiaryService()
        let service = makeService(importer: importer)

        do {
            _ = try await service.importFile(fileURL: file, mediaType: "image/png")
            XCTFail("預期上傳失敗")
        } catch let CardiaryClientError.server(frame) {
            XCTAssertEqual(frame.code, .authInvalid)
        }

        let imported = await importer.importedBlobIds
        XCTAssertTrue(imported.isEmpty, "上傳失敗不能建立卡片")
    }
}

// MARK: - 測試用的 HTTP 主機

private final class BlobHTTPHost: @unchecked Sendable {
    struct Record {
        let request: URLRequest
        let body: Data?
    }

    private let lock = NSLock()
    private var records: [Record] = []
    private var cursor = 0
    private var status = 200
    private var replyBody = Data()

    func setReply(status: Int, body: Data) {
        lock.lock()
        self.status = status
        self.replyBody = body
        lock.unlock()
    }

    func add(_ record: Record) {
        lock.lock()
        records.append(record)
        lock.unlock()
    }

    func makeSession() -> URLSession {
        BlobHTTPProtocol.host = self
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [BlobHTTPProtocol.self]
        return URLSession(configuration: configuration)
    }

    func nextRecord(timeout: TimeInterval = 3) async throws -> Record {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            lock.lock()
            if cursor < records.count {
                let record = records[cursor]
                cursor += 1
                lock.unlock()
                return record
            }
            lock.unlock()
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        throw BlobHTTPError.timeout
    }

    func reply() -> (status: Int, body: Data) {
        lock.lock()
        defer { lock.unlock() }
        return (status, replyBody)
    }
}

private enum BlobHTTPError: Error {
    case timeout
}

private final class BlobHTTPProtocol: URLProtocol {
    private final class HostBox: @unchecked Sendable {
        let lock = NSLock()
        var host: BlobHTTPHost?
    }

    private static let box = HostBox()

    static var host: BlobHTTPHost? {
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
            client?.urlProtocol(self, didFailWithError: BlobHTTPError.timeout)
            return
        }
        host.add(BlobHTTPHost.Record(
            request: request,
            body: Self.body(of: request)
        ))
        let reply = host.reply()
        let response = HTTPURLResponse(
            url: request.url ?? URL(string: "http://127.0.0.1")!,
            statusCode: reply.status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
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
