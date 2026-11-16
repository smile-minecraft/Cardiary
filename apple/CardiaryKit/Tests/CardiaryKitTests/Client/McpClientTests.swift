import Foundation
import XCTest

@testable import CardiaryKit

/// `mcp.*` 請求與事件：五個方法的型別、payload、回應解碼，以及事件的轉送。
final class McpClientTests: XCTestCase {
    private let createdAt = "2026-01-01T00:00:00Z"

    // MARK: - 連線層

    func testListMcpServersSendsRequestAndDecodesResponse() async throws {
        let transport = FakeServerTransport()
        let connection = CardiaryConnection(transport: transport, clientToken: "client-token")
        defer { Task { await connection.close() } }

        let task = Task { try await connection.listMcpServers() }
        let sent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(sent["type"] as? String, "mcp.servers.list")
        await transport.push(try responseFrame(
            replyTo: sent,
            type: "mcp.servers.list",
            payload: ["servers": [serverJSON(serverId: "srv_1", name: "Filesystem")]]
        ))

        let payload = try await task.value
        XCTAssertEqual(payload.servers.map(\.serverId), ["srv_1"])
        XCTAssertEqual(payload.servers.first?.transport, .stdio)
        XCTAssertEqual(payload.servers.first?.allowedHosts, [])
        XCTAssertEqual(payload.servers.first?.state, .ready)
    }

    func testAddMcpServerSendsFullPayload() async throws {
        let transport = FakeServerTransport()
        let connection = CardiaryConnection(transport: transport, clientToken: "client-token")
        defer { Task { await connection.close() } }

        let task = Task {
            try await connection.addMcpServer(
                name: "Fetch",
                transport: .http,
                url: "https://api.example.com/mcp",
                allowedHosts: ["api.example.com"],
                clientRequestId: "req_mcp_add"
            )
        }
        let sent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(sent["type"] as? String, "mcp.server.add")
        let payload = try XCTUnwrap(sent["payload"] as? [String: Any])
        XCTAssertEqual(payload["name"] as? String, "Fetch")
        XCTAssertEqual(payload["transport"] as? String, "http")
        XCTAssertEqual(payload["url"] as? String, "https://api.example.com/mcp")
        XCTAssertEqual(payload["allowedHosts"] as? [String], ["api.example.com"])
        XCTAssertEqual(payload["clientRequestId"] as? String, "req_mcp_add")
        XCTAssertNil(payload["command"], "HTTP 伺服器不帶 command")

        await transport.push(try responseFrame(
            replyTo: sent,
            type: "mcp.server.add",
            payload: ["approvalId": "appr_1"]
        ))
        let result = try await task.value
        XCTAssertEqual(result.approvalId, "appr_1")
    }

    func testRemoveMcpServerSendsServerId() async throws {
        let transport = FakeServerTransport()
        let connection = CardiaryConnection(transport: transport, clientToken: "client-token")
        defer { Task { await connection.close() } }

        let task = Task { try await connection.removeMcpServer(serverId: "srv_1") }
        let sent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(sent["type"] as? String, "mcp.server.remove")
        let payload = try XCTUnwrap(sent["payload"] as? [String: Any])
        XCTAssertEqual(payload["serverId"] as? String, "srv_1")

        await transport.push(try responseFrame(
            replyTo: sent,
            type: "mcp.server.remove",
            payload: ["serverId": "srv_1", "removed": true]
        ))
        let result = try await task.value
        XCTAssertEqual(result, McpServerRemoveResponsePayload(serverId: "srv_1", removed: true))
    }

    func testSetMcpServerEnabledSendsStateAndReturnsServer() async throws {
        let transport = FakeServerTransport()
        let connection = CardiaryConnection(transport: transport, clientToken: "client-token")
        defer { Task { await connection.close() } }

        let task = Task {
            try await connection.setMcpServerEnabled(
                serverId: "srv_1",
                enabled: false,
                clientRequestId: "req_mcp_toggle"
            )
        }
        let sent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(sent["type"] as? String, "mcp.server.set_enabled")
        let payload = try XCTUnwrap(sent["payload"] as? [String: Any])
        XCTAssertEqual(payload["serverId"] as? String, "srv_1")
        XCTAssertEqual(payload["enabled"] as? Bool, false)
        XCTAssertEqual(payload["clientRequestId"] as? String, "req_mcp_toggle")

        await transport.push(try responseFrame(
            replyTo: sent,
            type: "mcp.server.set_enabled",
            payload: ["server": serverJSON(serverId: "srv_1", name: "Filesystem", enabled: false)]
        ))
        let result = try await task.value
        XCTAssertEqual(result.server.enabled, false)
        XCTAssertEqual(result.server.state, .disabled)
    }

    func testSetMcpServerAllowedHostsSendsHosts() async throws {
        let transport = FakeServerTransport()
        let connection = CardiaryConnection(transport: transport, clientToken: "client-token")
        defer { Task { await connection.close() } }

        let task = Task {
            try await connection.setMcpServerAllowedHosts(
                serverId: "srv_1",
                allowedHosts: ["api.example.com", "cdn.example.com"]
            )
        }
        let sent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(sent["type"] as? String, "mcp.server.allow_hosts")
        let payload = try XCTUnwrap(sent["payload"] as? [String: Any])
        XCTAssertEqual(payload["serverId"] as? String, "srv_1")
        XCTAssertEqual(payload["allowedHosts"] as? [String], ["api.example.com", "cdn.example.com"])

        await transport.push(try responseFrame(
            replyTo: sent,
            type: "mcp.server.allow_hosts",
            payload: ["server": serverJSON(
                serverId: "srv_1",
                name: "Fetch",
                transport: "http",
                url: "https://api.example.com/mcp",
                allowedHosts: ["api.example.com", "cdn.example.com"]
            )]
        ))
        let result = try await task.value
        XCTAssertEqual(result.server.allowedHosts, ["api.example.com", "cdn.example.com"])
    }

    func testMcpRequestRejectsMismatchedResponse() async throws {
        for (call, wrongType) in [
            ("list", "mcp.server.add"),
            ("add", "mcp.servers.list"),
            ("remove", "mcp.server.set_enabled"),
            ("enable", "mcp.server.allow_hosts"),
            ("hosts", "mcp.server.remove"),
        ] {
            let transport = FakeServerTransport()
            let connection = CardiaryConnection(transport: transport, clientToken: "client-token")
            defer { Task { await connection.close() } }

            let task = Task { () -> String in
                switch call {
                case "list": return try await connection.listMcpServers().servers.description
                case "add":
                    return try await connection.addMcpServer(
                        name: "x", transport: .stdio, command: "x", allowedHosts: []
                    ).approvalId
                case "remove": return try await connection.removeMcpServer(serverId: "srv_1").serverId
                case "enable":
                    return try await connection.setMcpServerEnabled(
                        serverId: "srv_1", enabled: true
                    ).server.serverId
                default:
                    return try await connection.setMcpServerAllowedHosts(
                        serverId: "srv_1", allowedHosts: []
                    ).server.serverId
                }
            }
            let sent = JSONFixture.decode(try await transport.nextSent())
            await transport.push(try responseFrame(
                replyTo: sent,
                type: wrongType,
                payload: ["servers": [], "approvalId": "appr_1", "serverId": "srv_1",
                          "removed": true, "server": serverJSON(serverId: "srv_1", name: "x")]
            ))
            do {
                _ = try await task.value
                XCTFail("\(call)：型別不符的回應不能當成結果")
            } catch let error as CardiaryClientError {
                guard case .invalidFrame(let detail) = error else {
                    return XCTFail("\(call)：應該是 invalidFrame，得到 \(error)")
                }
                XCTAssertTrue(detail.contains("而不是回應"), detail)
            }
        }
    }

    // MARK: - 客戶端的事件

    func testClientForwardsMcpServersChangedToHandler() async throws {
        let queue = TransportQueue()
        let transport = FakeServerTransport()
        queue.append(transport)
        let client = makeClient(queue: queue)
        let events = Recorder<McpServersChangedEventPayload>()
        await client.setMcpServersChangedHandler { payload in
            events.append(payload)
        }
        try await connect(client: client, transport: transport)
        defer { Task { await client.stop() } }

        await transport.push(JSONFixture.string([
            "v": 1,
            "kind": "event",
            "type": "mcp.servers_changed",
            "stream": "system",
            "seq": 7,
            "emittedAt": "2026-01-01T00:00:07Z",
            "payload": [
                "server": serverJSON(serverId: "srv_2", name: "Approved"),
                "removed": false,
            ],
        ]))
        let event = try await events.waitForFirst()
        XCTAssertEqual(event.server.serverId, "srv_2")
        XCTAssertEqual(event.server.name, "Approved")
        XCTAssertFalse(event.removed)

        await transport.push(JSONFixture.string([
            "v": 1,
            "kind": "event",
            "type": "mcp.servers_changed",
            "stream": "system",
            "seq": 8,
            "emittedAt": "2026-01-01T00:00:08Z",
            "payload": [
                "server": serverJSON(serverId: "srv_2", name: "Approved"),
                "removed": true,
            ],
        ]))
        try await waitUntil { events.snapshot.count >= 2 }
        let removal = events.snapshot.last
        XCTAssertTrue(removal?.removed ?? false)
    }

    // MARK: - 測試連線

    private func serverJSON(
        serverId: String,
        name: String,
        transport: String = "stdio",
        url: String? = nil,
        allowedHosts: [String] = [],
        enabled: Bool = true
    ) -> [String: Any] {
        var json: [String: Any] = [
            "serverId": serverId,
            "name": name,
            "transport": transport,
            "allowedHosts": allowedHosts,
            "enabled": enabled,
            "state": enabled ? "ready" : "disabled",
            "createdAt": createdAt,
        ]
        if transport == "stdio" {
            json["command"] = "npx"
        }
        if let url {
            json["url"] = url
        }
        return json
    }

    private func responseFrame(
        replyTo sent: [String: Any],
        type: String,
        payload: [String: Any]
    ) throws -> String {
        JSONFixture.string([
            "v": 1,
            "kind": "response",
            "replyTo": try XCTUnwrap(sent["id"] as? String),
            "type": type,
            "payload": payload,
        ])
    }

    private func makeClient(queue: TransportQueue) -> CardiaryClient {
        let configuration = CardiaryClient.Configuration(
            endpoint: URL(string: "ws://127.0.0.1:1/v1/ws")!,
            clientToken: "client-token",
            client: ClientInfo(
                name: "Cardiary macOS",
                version: "0.1.0",
                platform: .macos,
                instanceId: "inst_mcp"
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
                epoch: "epoch_mcp"
            )
        )
        let subscribe = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(subscribe["type"] as? String, "system.subscribe")
        await transport.push(
            JSONFixture.systemSubscribeResponse(
                replyTo: try XCTUnwrap(subscribe["id"] as? String),
                seq: 5,
                epoch: "epoch_mcp",
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
