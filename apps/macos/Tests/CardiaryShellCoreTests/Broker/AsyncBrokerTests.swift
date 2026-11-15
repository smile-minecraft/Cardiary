import Foundation
import XCTest

@testable import CardiaryShellCore

/// `BrokerService` 的辨識路由：只轉給 `RecognitionHandling`，不碰檔案。
final class BrokerRecognitionTests: XCTestCase {
    private final class FakeRecognition: RecognitionHandling, @unchecked Sendable {
        private let lock = NSLock()
        private var ocrPayloads: [JSONValue] = []
        private var transcribePayloads: [JSONValue] = []
        var ocrReply: BrokerReply = .ok(
            .object(["available": .bool(true), "text": .string("辨識文字")])
        )
        var transcribeReply: BrokerReply = .ok(
            .object(["available": .bool(false), "reason": .string("not_authorized")])
        )

        var ocrCalls: [JSONValue] {
            lock.lock()
            defer { lock.unlock() }
            return ocrPayloads
        }

        var transcribeCalls: [JSONValue] {
            lock.lock()
            defer { lock.unlock() }
            return transcribePayloads
        }

        func ocr(payload: JSONValue) async -> BrokerReply {
            lock.lock()
            ocrPayloads.append(payload)
            lock.unlock()
            return ocrReply
        }

        func transcribe(payload: JSONValue) async -> BrokerReply {
            lock.lock()
            transcribePayloads.append(payload)
            lock.unlock()
            return transcribeReply
        }
    }

    private func makeService(
        recognition: FakeRecognition
    ) throws -> (BrokerService, ShellStateDirectory, URL) {
        let folder = try TestSupport.makeTemporaryFolder("broker-recognition")
        let state = ShellStateDirectory(root: folder.appendingPathComponent("shell-state"))
        let service = BrokerService(
            keychain: InMemoryKeychain(values: [:]),
            stateDirectory: state,
            folderProvider: { FolderSnapshot(state: .ready, path: folder.path, writable: true) },
            recognition: recognition
        )
        return (service, state, folder)
    }

    func testOCRRoutesThroughRecognition() async throws {
        let recognition = FakeRecognition()
        let (service, _, _) = try makeService(recognition: recognition)
        let reply = await service.handle(
            route: ControlRoute.brokerRecognitionOcr,
            payload: .object(["path": .string("/tmp/x.png"), "locales": .array([.string("zh-Hant")])])
        )
        XCTAssertEqual(reply, .ok(.object(["available": .bool(true), "text": .string("辨識文字")])))
        XCTAssertEqual(recognition.ocrCalls.count, 1)
        XCTAssertEqual(recognition.ocrCalls.first?["path"]?.stringValue, "/tmp/x.png")
        XCTAssertEqual(recognition.transcribeCalls.count, 0)
    }

    func testTranscribeRoutesThroughRecognition() async throws {
        let recognition = FakeRecognition()
        let (service, _, _) = try makeService(recognition: recognition)
        let reply = await service.handle(
            route: ControlRoute.brokerRecognitionTranscribe,
            payload: .object(["path": .string("/tmp/v.m4a"), "locale": .string("zh-TW")])
        )
        XCTAssertEqual(
            reply,
            .ok(.object(["available": .bool(false), "reason": .string("not_authorized")]))
        )
        XCTAssertEqual(recognition.transcribeCalls.first?["locale"]?.stringValue, "zh-TW")
        XCTAssertEqual(recognition.ocrCalls.count, 0)
    }

    func testKeychainStillWorksThroughAsyncEntryPoint() async throws {
        let folder = try TestSupport.makeTemporaryFolder("broker-keychain")
        let service = BrokerService(
            keychain: InMemoryKeychain(values: ["provider/openai/api-key": "secret"]),
            stateDirectory: ShellStateDirectory(root: folder),
            folderProvider: { FolderSnapshot.unselected },
            recognition: FakeRecognition()
        )
        let reply = await service.handle(
            route: ControlRoute.brokerKeychainGet,
            payload: .object(["account": .string("provider/openai/api-key")])
        )
        guard case .ok(let payload) = reply else {
            return XCTFail("鑰匙圈路由應該成功")
        }
        XCTAssertEqual(payload["found"]?.boolValue, true)
        XCTAssertEqual(payload["value"]?.stringValue, "secret")
    }

    func testUnknownRouteStaysUnavailable() async throws {
        let (service, _, _) = try makeService(recognition: FakeRecognition())
        let reply = await service.handle(route: "broker.recognition.delete", payload: .object([:]))
        XCTAssertEqual(reply, .unavailable("不支援的路由。"))
    }
}

/// 控制通道的代理處理器可以等待；慢的回應不會擋住其他請求，通道關閉後
/// 完成的結果不會寫回。
final class AsyncBrokerChannelTests: XCTestCase {
    private final class FakeServiceProcess: ServiceProcessHandle, @unchecked Sendable {
        let pid: Int32
        private let lock = NSLock()
        private var dataHandler: (@Sendable (Data) -> Void)?
        private var writes: [Data] = []

        init(pid: Int32) {
            self.pid = pid
        }

        var isRunning: Bool { true }

        func setDataHandler(_ handler: @escaping @Sendable (Data) -> Void) {
            lock.lock()
            dataHandler = handler
            lock.unlock()
        }

        func setLogHandler(_ handler: @escaping @Sendable (String) -> Void) {}
        func setExitHandler(_ handler: @escaping @Sendable (ServiceExit) -> Void) {}
        func closeStdin() {}
        func terminate() {}
        func kill() {}

        func write(_ data: Data) throws {
            lock.lock()
            writes.append(data)
            lock.unlock()
        }

        func feed(_ line: String) {
            lock.lock()
            let handler = dataHandler
            lock.unlock()
            handler?(Data((line + "\n").utf8))
        }

        var lines: [String] {
            lock.lock()
            defer { lock.unlock() }
            return writes.compactMap { String(data: $0, encoding: .utf8) }
        }
    }

    private func establishedChannel(
        pid: Int32 = 707
    ) async throws -> (ControlChannel, FakeServiceProcess, ControlToken) {
        let transport = FakeServiceProcess(pid: pid)
        let brokerToken = ControlToken.generate()
        let channel = ControlChannel(
            transport: transport,
            controlToken: ControlToken.generate(),
            brokerToken: brokerToken,
            clientToken: ControlToken.generate()
        )
        let handshake = Task { try await channel.handshake(folderPath: "/tmp/folder") }
        try await TestSupport.waitUntil(timeout: 3, message: "等 init 送出") {
            transport.lines.contains { $0.contains("\"type\":\"init\"") }
        }
        transport.feed(
            """
            {"type":"ready","protocol":1,"pid":\(pid),"clientPort":0,\
            "folderId":"folder","epoch":"epoch-1"}
            """
        )
        transport.feed(
            """
            {"v":1,"kind":"hello","role":"host-service","pid":\(pid),\
            "auth":{"token":"\(brokerToken.value)"}}
            """
        )
        _ = try await handshake.value
        XCTAssertTrue(transport.lines.contains { $0.contains("\"kind\":\"hello-ack\"") })
        return (channel, transport, brokerToken)
    }

    func testSlowBrokerHandlerRespondsAfterAwaiting() async throws {
        let (channel, transport, brokerToken) = try await establishedChannel()
        defer { channel.invalidate() }

        let started = Date()
        channel.brokerHandler = { route, _ in
            XCTAssertEqual(route, ControlRoute.brokerRecognitionOcr)
            try? await Task.sleep(nanoseconds: 150_000_000)
            return .ok(.object(["available": .bool(true), "text": .string("慢的結果")]))
        }
        transport.feed(request(id: "brk_slow", route: ControlRoute.brokerRecognitionOcr, token: brokerToken))
        try await TestSupport.waitUntil(timeout: 3, message: "等慢的代理回應") {
            transport.lines.contains { $0.contains("\"replyTo\":\"brk_slow\"") }
        }
        XCTAssertGreaterThanOrEqual(
            Date().timeIntervalSince(started),
            0.1,
            "回應應該等處理器完成才送出"
        )
        let line = try XCTUnwrap(
            transport.lines.first { $0.contains("\"replyTo\":\"brk_slow\"") }
        )
        XCTAssertTrue(line.contains("\"ok\":true"))
        XCTAssertTrue(line.contains("慢的結果"))
    }

    func testChannelStaysUsableWhileAnotherBrokerRequestIsWaiting() async throws {
        let (channel, transport, brokerToken) = try await establishedChannel()
        defer { channel.invalidate() }

        channel.brokerHandler = { route, _ in
            if route == ControlRoute.brokerRecognitionTranscribe {
                try? await Task.sleep(nanoseconds: 200_000_000)
            }
            return .ok(.object(["route": .string(route)]))
        }
        transport.feed(
            request(id: "brk_slow", route: ControlRoute.brokerRecognitionTranscribe, token: brokerToken)
        )
        transport.feed(
            request(id: "brk_fast", route: ControlRoute.brokerRecognitionOcr, token: brokerToken)
        )
        try await TestSupport.waitUntil(timeout: 3, message: "兩個代理請求都應回應") {
            transport.lines.contains { $0.contains("\"replyTo\":\"brk_slow\"") }
                && transport.lines.contains { $0.contains("\"replyTo\":\"brk_fast\"") }
        }
        // 快的請求先回應：慢的不會佔住通道。
        let slow = try XCTUnwrap(transport.lines.firstIndex { $0.contains("\"replyTo\":\"brk_slow\"") })
        let fast = try XCTUnwrap(transport.lines.firstIndex { $0.contains("\"replyTo\":\"brk_fast\"") })
        XCTAssertLessThan(fast, slow)
    }

    func testClosedChannelDropsLateBrokerResult() async throws {
        let (channel, transport, brokerToken) = try await establishedChannel()
        channel.brokerHandler = { _, _ in
            try? await Task.sleep(nanoseconds: 200_000_000)
            return .ok(.object(["late": .bool(true)]))
        }
        transport.feed(request(id: "brk_late", route: ControlRoute.brokerRecognitionOcr, token: brokerToken))
        channel.invalidate()
        try await Task.sleep(nanoseconds: 400_000_000)
        XCTAssertFalse(
            transport.lines.contains { $0.contains("\"replyTo\":\"brk_late\"") },
            "通道關閉後不能寫回代理回應"
        )
    }

    private func request(id: String, route: String, token: ControlToken) -> String {
        """
        {"v":1,"kind":"request","id":"\(id)","route":"\(route)",\
        "auth":{"token":"\(token.value)"},"payload":{}}
        """
    }
}
