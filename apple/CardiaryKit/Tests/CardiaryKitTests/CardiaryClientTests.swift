import Foundation
import XCTest

@testable import CardiaryKit

/// 依序發出假傳輸層的工廠，讓測試控制每一次重連。
final class TransportQueue: @unchecked Sendable {
    private let lock = NSLock()
    private var transports: [FakeServerTransport] = []

    func append(_ transport: FakeServerTransport) {
        lock.lock()
        transports.append(transport)
        lock.unlock()
    }

    func next() -> FakeServerTransport {
        lock.lock()
        defer { lock.unlock() }
        return transports.removeFirst()
    }

    var isEmpty: Bool {
        lock.lock()
        defer { lock.unlock() }
        return transports.isEmpty
    }
}

/// 收集回呼結果，避免測試與非同步回呼競爭。
final class Recorder<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [Value] = []

    func append(_ value: Value) {
        lock.lock()
        values.append(value)
        lock.unlock()
    }

    var snapshot: [Value] {
        lock.lock()
        defer { lock.unlock() }
        return values
    }

    func waitForFirst(timeout: TimeInterval = 3) async throws -> Value {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let first = snapshot.first {
                return first
            }
            try await Task.sleep(nanoseconds: 2_000_000)
        }
        throw CardiaryClientError.timeout
    }
}

final class CardiaryClientTests: XCTestCase {
    private let clientInfo = ClientInfo(
        name: "Cardiary macOS",
        version: "0.1.0",
        platform: .macos,
        instanceId: "inst_test"
    )

    private func makeClient(
        queue: TransportQueue,
        statuses: Recorder<SystemStatus>,
        epochSeen: Recorder<String>? = nil
    ) -> CardiaryClient {
        let configuration = CardiaryClient.Configuration(
            endpoint: URL(string: "ws://127.0.0.1:1/v1/ws")!,
            clientToken: "client-token",
            client: clientInfo,
            reconnect: ReconnectPolicy(
                baseDelay: .milliseconds(10),
                maxDelay: .milliseconds(20)
            ),
            subscribeActiveSessions: false
        )
        let client = CardiaryClient(configuration: configuration) { _ in
            queue.next()
        }
        client.handlers.onSystemStatus = { status in
            statuses.append(status)
        }
        if let epochSeen {
            client.handlers.onStateChange = { state in
                if case .connected(let epoch, _) = state {
                    epochSeen.append(epoch)
                }
            }
        }
        return client
    }

    func testReconnectAfterEpochChangeRequestsFullSnapshotWithoutLastSeq() async throws {
        let queue = TransportQueue()
        let first = FakeServerTransport()
        let second = FakeServerTransport()
        queue.append(first)
        queue.append(second)

        let statuses = Recorder<SystemStatus>()
        let epochs = Recorder<String>()
        let client = makeClient(queue: queue, statuses: statuses, epochSeen: epochs)
        await client.start()

        // 第一次連線：hello 回 epoch A，訂閱回快照 seq 5。
        let hello1 = JSONFixture.decode(try await first.nextSent())
        await first.push(
            JSONFixture.helloResponse(
                replyTo: try XCTUnwrap(hello1["id"] as? String),
                epoch: "epoch_a"
            )
        )
        let subscribe1 = JSONFixture.decode(try await first.nextSent())
        XCTAssertEqual(subscribe1["type"] as? String, "system.subscribe")
        var payload1 = try XCTUnwrap(subscribe1["payload"] as? [String: Any])
        XCTAssertNil(payload1["lastSeq"], "第一次訂閱沒有 lastSeq")
        await first.push(
            JSONFixture.systemSubscribeResponse(
                replyTo: try XCTUnwrap(subscribe1["id"] as? String),
                seq: 5,
                epoch: "epoch_a",
                resyncRequired: true,
                snapshot: JSONFixture.systemStatus(uptime: 5)
            )
        )

        let firstStatus = try await statuses.waitForFirst()
        XCTAssertEqual(firstStatus.service.uptimeSeconds, 5)

        // 即時事件 seq 6 套用。
        await first.push(
            JSONFixture.systemStatusEvent(seq: 6, status: JSONFixture.systemStatus(uptime: 6))
        )
        try await waitUntil { statuses.snapshot.contains { $0.service.uptimeSeconds == 6 } }

        // 斷線重連：新連線回報不同 epoch，訂閱時必須不帶 lastSeq。
        await first.serverClosed()
        let hello2 = JSONFixture.decode(try await second.nextSent())
        await second.push(
            JSONFixture.helloResponse(
                replyTo: try XCTUnwrap(hello2["id"] as? String),
                epoch: "epoch_b"
            )
        )
        let subscribe2 = JSONFixture.decode(try await second.nextSent())
        let payload2 = try XCTUnwrap(subscribe2["payload"] as? [String: Any])
        XCTAssertNil(payload2["lastSeq"], "epoch 不同時不能帶 lastSeq")
        XCTAssertNil(payload2["epoch"], "epoch 不同時不帶舊 epoch")

        await second.push(
            JSONFixture.systemSubscribeResponse(
                replyTo: try XCTUnwrap(subscribe2["id"] as? String),
                seq: 1,
                epoch: "epoch_b",
                resyncRequired: true,
                snapshot: JSONFixture.systemStatus(uptime: 1)
            )
        )
        try await waitUntil { statuses.snapshot.contains { $0.service.uptimeSeconds == 1 } }
        XCTAssertEqual(epochs.snapshot, ["epoch_a", "epoch_b"])

        await client.stop()
    }

    func testReconnectSameEpochCarriesLastSeq() async throws {
        let queue = TransportQueue()
        let first = FakeServerTransport()
        let second = FakeServerTransport()
        queue.append(first)
        queue.append(second)

        let statuses = Recorder<SystemStatus>()
        let client = makeClient(queue: queue, statuses: statuses)
        await client.start()

        let hello1 = JSONFixture.decode(try await first.nextSent())
        await first.push(
            JSONFixture.helloResponse(
                replyTo: try XCTUnwrap(hello1["id"] as? String),
                epoch: "epoch_a"
            )
        )
        let subscribe1 = JSONFixture.decode(try await first.nextSent())
        await first.push(
            JSONFixture.systemSubscribeResponse(
                replyTo: try XCTUnwrap(subscribe1["id"] as? String),
                seq: 5,
                epoch: "epoch_a",
                resyncRequired: true,
                snapshot: JSONFixture.systemStatus(uptime: 5)
            )
        )
        _ = try await statuses.waitForFirst()
        await first.push(
            JSONFixture.systemStatusEvent(seq: 6, status: JSONFixture.systemStatus(uptime: 6))
        )
        try await waitUntil { statuses.snapshot.contains { $0.service.uptimeSeconds == 6 } }

        await first.serverClosed()
        let hello2 = JSONFixture.decode(try await second.nextSent())
        await second.push(
            JSONFixture.helloResponse(
                replyTo: try XCTUnwrap(hello2["id"] as? String),
                epoch: "epoch_a"
            )
        )
        let subscribe2 = JSONFixture.decode(try await second.nextSent())
        let payload = try XCTUnwrap(subscribe2["payload"] as? [String: Any])
        XCTAssertEqual(payload["lastSeq"] as? Int, 6)
        XCTAssertEqual(payload["epoch"] as? String, "epoch_a")

        await second.push(
            JSONFixture.systemSubscribeResponse(
                replyTo: try XCTUnwrap(subscribe2["id"] as? String),
                seq: 6,
                epoch: "epoch_a",
                resyncRequired: false
            )
        )
        await client.stop()
    }

    private func waitUntil(
        timeout: TimeInterval = 3,
        _ condition: @Sendable () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return }
            try await Task.sleep(nanoseconds: 2_000_000)
        }
        XCTFail("等待條件逾時")
    }
}
