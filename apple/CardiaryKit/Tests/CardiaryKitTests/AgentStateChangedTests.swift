import Foundation
import XCTest

@testable import CardiaryKit

/// 外部代理狀態事件：解碼後要保留耐久串流與序號，讓客戶端能推进游標與去重。
final class AgentStateChangedTests: XCTestCase {
    func testStateChangedEventKeepsStreamAndSeq() throws {
        let frame = try decodeAgentStateChanged(stream: "system", seq: 42)

        XCTAssertEqual(frame.eventStream, "system")
        XCTAssertEqual(frame.eventSeq, 42)
        XCTAssertEqual(frame.kindLabel, "agent.state_changed")
    }

    func testStateChangedEventPayloadSurvivesDecoding() throws {
        let frame = try decodeAgentStateChanged(stream: "system", seq: 7)

        guard case .agentStateChangedEvent(let event) = frame else {
            return XCTFail("應解碼為 agent.state_changed 事件")
        }
        XCTAssertEqual(event.payload.agentSessionId, "agent-1")
        XCTAssertEqual(event.payload.agentKind, .opencode)
        XCTAssertEqual(event.payload.status, .running)
        XCTAssertEqual(event.payload.progress?.completed, 2)
        XCTAssertEqual(event.payload.progress?.total, 4)
        XCTAssertEqual(event.payload.pendingPermission?.approvalId, "approval-1")
    }

    // MARK: - 客戶端啟停請求

    private let clientInfo = ClientInfo(
        name: "Cardiary macOS",
        version: "0.1.0",
        platform: .macos,
        instanceId: "inst_agents"
    )

    private func makeClient(queue: TransportQueue) -> CardiaryClient {
        let configuration = CardiaryClient.Configuration(
            endpoint: URL(string: "ws://127.0.0.1:1/v1/ws")!,
            clientToken: "client-token",
            client: clientInfo,
            reconnect: ReconnectPolicy(baseDelay: .milliseconds(10), maxDelay: .milliseconds(20)),
            subscribeActiveSessions: false
        )
        return CardiaryClient(configuration: configuration) { _ in queue.next() }
    }

    private func connect(client: CardiaryClient, transport: FakeServerTransport) async throws {
        await client.start()
        let hello = JSONFixture.decode(try await transport.nextSent())
        await transport.push(
            JSONFixture.helloResponse(
                replyTo: try XCTUnwrap(hello["id"] as? String),
                epoch: "epoch_agents"
            )
        )
        let subscribe = JSONFixture.decode(try await transport.nextSent())
        await transport.push(
            JSONFixture.systemSubscribeResponse(
                replyTo: try XCTUnwrap(subscribe["id"] as? String),
                seq: 5,
                epoch: "epoch_agents",
                resyncRequired: false
            )
        )
    }

    func testStartAgentSendsAgentStartAndDecodesApproval() async throws {
        let queue = TransportQueue()
        let transport = FakeServerTransport()
        queue.append(transport)
        let client = makeClient(queue: queue)
        try await connect(client: client, transport: transport)

        let task = Task {
            try await client.startAgent(
                agentKind: .claudeCode,
                workingDirectory: "/repo",
                prompt: "修正登入",
                clientRequestId: "req_1"
            )
        }
        let sent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(sent["type"] as? String, "agent.start")
        let payload = try XCTUnwrap(sent["payload"] as? [String: Any])
        XCTAssertEqual(payload["agentKind"] as? String, "claude-code")
        XCTAssertEqual(payload["workingDirectory"] as? String, "/repo")
        XCTAssertEqual(payload["prompt"] as? String, "修正登入")
        XCTAssertEqual(payload["clientRequestId"] as? String, "req_1")

        await transport.push(JSONFixture.string([
            "v": 1,
            "kind": "response",
            "replyTo": try XCTUnwrap(sent["id"] as? String),
            "type": "agent.start",
            "payload": ["agentSessionId": "agent-9", "approvalId": "approval-9"],
        ]))
        let response = try await task.value
        XCTAssertEqual(response.agentSessionId, "agent-9")
        XCTAssertEqual(response.approvalId, "approval-9")
        await client.stop()
    }

    func testStopAgentSendsAgentStopAndDecodesStopped() async throws {
        let queue = TransportQueue()
        let transport = FakeServerTransport()
        queue.append(transport)
        let client = makeClient(queue: queue)
        try await connect(client: client, transport: transport)

        let task = Task {
            try await client.stopAgent(agentSessionId: "agent-9")
        }
        let sent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(sent["type"] as? String, "agent.stop")
        let payload = try XCTUnwrap(sent["payload"] as? [String: Any])
        XCTAssertEqual(payload["agentSessionId"] as? String, "agent-9")

        await transport.push(JSONFixture.string([
            "v": 1,
            "kind": "response",
            "replyTo": try XCTUnwrap(sent["id"] as? String),
            "type": "agent.stop",
            "payload": ["agentSessionId": "agent-9", "stopped": true],
        ]))
        let response = try await task.value
        XCTAssertEqual(response.agentSessionId, "agent-9")
        XCTAssertTrue(response.stopped)
        await client.stop()
    }

    // MARK: - 測試資料

    private func decodeAgentStateChanged(stream: String, seq: Int) throws -> ServerFrame {
        let json = JSONFixture.string([
            "v": 1,
            "kind": "event",
            "type": "agent.state_changed",
            "stream": stream,
            "seq": seq,
            "emittedAt": "2026-11-17T00:00:00Z",
            "payload": [
                "agentSessionId": "agent-1",
                "agentKind": "opencode",
                "status": "running",
                "progress": [
                    "step": "build",
                    "label": "編譯中",
                    "completed": 2,
                    "total": 4,
                ],
                "message": "還在跑",
                "pendingPermission": [
                    "approvalId": "approval-1",
                    "toolName": "shell",
                    "description": "執行指令",
                ],
            ],
        ])
        return try JSONDecoder().decode(ServerFrame.self, from: Data(json.utf8))
    }
}
