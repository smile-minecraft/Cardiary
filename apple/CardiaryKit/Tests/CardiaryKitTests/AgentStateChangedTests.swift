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
