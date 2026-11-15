import Foundation
import XCTest

@testable import CardiaryKit

/// 原檔的 HTTP 客戶端：上傳走串流、回應解碼、錯誤信封與端點檢查。
final class BlobClientTests: XCTestCase {
    private var host: FakeHTTPHost!
    private var session: URLSession!

    override func setUp() {
        super.setUp()
        host = FakeHTTPHost()
        session = host.makeSession()
    }

    override func tearDown() {
        FakeURLProtocol.host = nil
        session.invalidateAndCancel()
        session = nil
        host = nil
        super.tearDown()
    }

    private func makeClient(baseURL: String = "http://127.0.0.1:51234") -> BlobClient {
        BlobClient(
            configuration: BlobClient.Configuration(
                baseURL: URL(string: baseURL)!,
                clientToken: "client-token"
            ),
            session: session
        )
    }

    private func temporaryFile(_ bytes: [UInt8]) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("cardiary-blob-\(UUID().uuidString).bin")
        try Data(bytes).write(to: url)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    func testUploadStreamsFileWithAuthHeaderAndDecodesBlobInfo() async throws {
        let file = try temporaryFile([0x89, 0x50, 0x4E, 0x47])
        host.enqueue(.json(#"{"blobId":"\#(String(repeating: "a", count: 64))","mediaType":"image/png","sizeBytes":4}"#))

        let client = makeClient()
        let blob = try await client.upload(fileURL: file, mediaType: "image/png")

        XCTAssertEqual(blob.blobId, String(repeating: "a", count: 64))
        XCTAssertEqual(blob.mediaType, "image/png")
        XCTAssertEqual(blob.sizeBytes, 4)

        let record = try await host.nextRecord()
        XCTAssertEqual(record.method, "POST")
        XCTAssertEqual(record.url?.path, "/v1/blobs")
        XCTAssertEqual(record.headers["Authorization"], "Bearer client-token")
        XCTAssertEqual(record.headers["Content-Type"], "image/png")
        XCTAssertEqual(record.body, Data([0x89, 0x50, 0x4E, 0x47]), "檔案內容要原樣送出")
    }

    func testUploadDataSendsBody() async throws {
        host.enqueue(.json(#"{"blobId":"\#(String(repeating: "b", count: 64))","mediaType":"audio/wav","sizeBytes":2}"#))
        let client = makeClient()

        _ = try await client.upload(data: Data([1, 2]), mediaType: "audio/wav")

        let record = try await host.nextRecord()
        XCTAssertEqual(record.method, "POST")
        XCTAssertEqual(record.headers["Content-Type"], "audio/wav")
        XCTAssertEqual(record.body, Data([1, 2]))
    }

    func testDownloadReturnsBytesAndRequestsThumbVariant() async throws {
        host.enqueue(FakeHTTPHost.Reply(status: 200, body: Data([9, 8, 7])))
        host.enqueue(FakeHTTPHost.Reply(status: 200, body: Data([1])))
        let client = makeClient()
        let blobId = String(repeating: "c", count: 64)

        let original = try await client.download(blobId: blobId)
        XCTAssertEqual(original, Data([9, 8, 7]))
        let first = try await host.nextRecord()
        XCTAssertEqual(first.method, "GET")
        XCTAssertEqual(first.url?.path, "/v1/blobs/\(blobId)")
        XCTAssertNil(first.url?.query)
        XCTAssertEqual(first.headers["Authorization"], "Bearer client-token")

        _ = try await client.download(blobId: blobId, variant: .thumb)
        let second = try await host.nextRecord()
        XCTAssertEqual(second.url?.query, "variant=thumb")
    }

    func testServerErrorEnvelopeBecomesServerError() async throws {
        host.enqueue(
            FakeHTTPHost.Reply.json(
                #"{"v":1,"kind":"error","code":"auth_invalid","message":"Token 無效","retryable":false}"#,
                status: 401
            )
        )
        let client = makeClient()

        do {
            _ = try await client.upload(data: Data([1]), mediaType: "image/png")
            XCTFail("預期驗證失敗")
        } catch let CardiaryClientError.server(frame) {
            XCTAssertEqual(frame.code, .authInvalid)
            XCTAssertEqual(frame.message, "Token 無效")
        }
    }

    func testFailureWithoutErrorEnvelopeIsInvalidFrame() async throws {
        host.enqueue(FakeHTTPHost.Reply(status: 500, body: Data("oops".utf8)))
        let client = makeClient()

        do {
            _ = try await client.download(blobId: String(repeating: "d", count: 64))
            XCTFail("預期失敗")
        } catch let CardiaryClientError.invalidFrame(detail) {
            XCTAssertTrue(detail.contains("500"), detail)
        }
    }

    func testMalformedBlobIdIsRejectedWithoutRequest() async throws {
        let client = makeClient()

        do {
            _ = try await client.download(blobId: "../state/cardiary.sqlite")
            XCTFail("預期拒絕不合法的 blobId")
        } catch CardiaryClientError.invalidFrame {
        }
        XCTAssertTrue(host.records.isEmpty, "不合法的 blobId 不能送出請求")
    }

    func testNonHTTPSchemeIsRejected() async throws {
        let client = makeClient(baseURL: "ws://127.0.0.1:51234")

        do {
            _ = try await client.upload(data: Data([1]), mediaType: "image/png")
            XCTFail("預期拒絕非 http(s) 端點")
        } catch CardiaryClientError.invalidEndpoint {
        }
        XCTAssertTrue(host.records.isEmpty)
    }
}
