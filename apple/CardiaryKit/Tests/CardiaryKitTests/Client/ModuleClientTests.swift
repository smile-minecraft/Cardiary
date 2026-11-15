import Foundation
import XCTest

@testable import CardiaryKit

/// `module.*` 請求與事件：payload 外層、回應解碼與事件分流。
final class ModuleClientTests: XCTestCase {
    // MARK: - 連線層

    func testModuleRequestSendsDataEnvelopeAndReturnsPayload() async throws {
        let transport = FakeServerTransport()
        let connection = CardiaryConnection(transport: transport, clientToken: "client-token")
        defer { Task { await connection.close() } }

        let task = Task {
            try await connection.sendModuleRequest(
                type: "module.import.list",
                payload: .object(["path": .string("/tmp/source")])
            )
        }
        let sent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(sent["type"] as? String, "module.import.list")
        let requestPayload = try XCTUnwrap(sent["payload"] as? [String: Any])
        let requestData = try XCTUnwrap(requestPayload["data"] as? [String: Any])
        XCTAssertEqual(requestData["path"] as? String, "/tmp/source")
        XCTAssertNil(requestData["type"], "型別在外層，不在 data 裡")

        await transport.push(JSONFixture.string([
            "v": 1,
            "kind": "response",
            "replyTo": try XCTUnwrap(sent["id"] as? String),
            "type": "module.import.list",
            "payload": ["data": ["files": [["relativePath": "a.md"]]]],
        ]))
        let payload = try await task.value
        guard case .object(let object) = payload, case .object(let data)? = object["data"] else {
            return XCTFail("回應應該是 { data: … }")
        }
        guard case .array(let files)? = data["files"] else {
            return XCTFail("data 裡要有 files")
        }
        XCTAssertEqual(files.count, 1)
    }

    func testModuleRequestRejectsNonModuleResponse() async throws {
        let transport = FakeServerTransport()
        let connection = CardiaryConnection(transport: transport, clientToken: "client-token")
        defer { Task { await connection.close() } }

        let task = Task {
            try await connection.sendModuleRequest(
                type: "module.import.sources",
                payload: .object([:])
            )
        }
        let sent = JSONFixture.decode(try await transport.nextSent())
        await transport.push(JSONFixture.string([
            "v": 1,
            "kind": "response",
            "replyTo": try XCTUnwrap(sent["id"] as? String),
            "type": "card.list",
            "payload": ["cards": []],
        ]))
        do {
            _ = try await task.value
            XCTFail("型別不符的回應不能當成模組回應")
        } catch let error as CardiaryClientError {
            guard case .invalidFrame(let detail) = error else {
                return XCTFail("應該是 invalidFrame，得到 \(error)")
            }
            XCTAssertTrue(detail.contains("module.import.sources"))
        }
    }

    func testModuleRequestThrowsServerError() async throws {
        let transport = FakeServerTransport()
        let connection = CardiaryConnection(transport: transport, clientToken: "client-token")
        defer { Task { await connection.close() } }

        let task = Task {
            try await connection.sendModuleRequest(
                type: "module.import.preview",
                payload: .object([:])
            )
        }
        let sent = JSONFixture.decode(try await transport.nextSent())
        await transport.push(JSONFixture.string([
            "v": 1,
            "kind": "error",
            "replyTo": try XCTUnwrap(sent["id"] as? String),
            "code": "invalid_message",
            "message": "缺少來源資料夾。",
            "retryable": false,
        ]))
        do {
            _ = try await task.value
            XCTFail("錯誤信封要讓請求失敗")
        } catch let error as CardiaryClientError {
            guard case .server(let frame) = error else {
                return XCTFail("應該是 server 錯誤，得到 \(error)")
            }
            XCTAssertEqual(frame.code, .invalidMessage)
            XCTAssertEqual(frame.message, "缺少來源資料夾。")
        }
    }

    func testModuleRequestRequiresObjectPayload() async throws {
        let transport = FakeServerTransport()
        let connection = CardiaryConnection(transport: transport, clientToken: "client-token")
        defer { Task { await connection.close() } }

        do {
            _ = try await connection.sendModuleRequest(
                type: "module.import.sources",
                payload: .string("不是物件")
            )
            XCTFail("非物件 payload 要在送出前被擋下")
        } catch let error as CardiaryClientError {
            guard case .invalidFrame = error else {
                return XCTFail("應該是 invalidFrame，得到 \(error)")
            }
        }
    }

    // MARK: - 客戶端的模組事件

    func testClientForwardsModuleEventsToModuleHandler() async throws {
        let queue = TransportQueue()
        let transport = FakeServerTransport()
        queue.append(transport)
        let client = makeClient(queue: queue)
        let moduleEvents = Recorder<ServerFrame>()
        client.handlers.onModuleEvent = { frame in
            moduleEvents.append(frame)
        }
        try await connect(client: client, transport: transport)
        defer { Task { await client.stop() } }

        await transport.push(JSONFixture.string([
            "v": 1,
            "kind": "event",
            "type": "module.import.progress",
            "stream": "system",
            "seq": 6,
            "emittedAt": "2026-01-01T00:00:06Z",
            "payload": ["data": ["jobId": "job_1", "done": 1, "total": 2, "status": "written"]],
        ]))
        let frame = try await moduleEvents.waitForFirst()
        guard case .moduleEvent(let event) = frame else {
            return XCTFail("應該是 module 事件")
        }
        XCTAssertEqual(event.type, "module.import.progress")
        XCTAssertEqual(event.payload.data["jobId"]?.stringValue, "job_1")
        XCTAssertEqual(event.payload.data["done"]?.intValue, 1)
    }

    // MARK: - 測試連線

    private func makeClient(queue: TransportQueue) -> CardiaryClient {
        let configuration = CardiaryClient.Configuration(
            endpoint: URL(string: "ws://127.0.0.1:1/v1/ws")!,
            clientToken: "client-token",
            client: ClientInfo(
                name: "Cardiary macOS",
                version: "0.1.0",
                platform: .macos,
                instanceId: "inst_module"
            ),
            reconnect: ReconnectPolicy(
                baseDelay: .milliseconds(10),
                maxDelay: .milliseconds(20)
            ),
            subscribeActiveSessions: false
        )
        return CardiaryClient(configuration: configuration) { _ in
            queue.next()
        }
    }

    private func connect(client: CardiaryClient, transport: FakeServerTransport) async throws {
        await client.start()
        let hello = JSONFixture.decode(try await transport.nextSent())
        await transport.push(
            JSONFixture.helloResponse(
                replyTo: try XCTUnwrap(hello["id"] as? String),
                epoch: "epoch_module"
            )
        )
        let subscribe = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(subscribe["type"] as? String, "system.subscribe")
        await transport.push(
            JSONFixture.systemSubscribeResponse(
                replyTo: try XCTUnwrap(subscribe["id"] as? String),
                seq: 5,
                epoch: "epoch_module",
                resyncRequired: true,
                snapshot: JSONFixture.systemStatus()
            )
        )
        try await waitUntil { await client.currentState.isConnected }
    }

    private func waitUntil(
        timeout: TimeInterval = 3,
        _ condition: @escaping @Sendable () async -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if await condition() { return }
            try await Task.sleep(nanoseconds: 2_000_000)
        }
        throw CardiaryClientError.timeout
    }
}

private extension CardiaryClient.State {
    var isConnected: Bool {
        if case .connected = self { return true }
        return false
    }
}
