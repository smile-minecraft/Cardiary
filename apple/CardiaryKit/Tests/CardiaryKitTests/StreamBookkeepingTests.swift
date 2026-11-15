import Foundation
import XCTest

@testable import CardiaryKit

final class StreamBookkeepingTests: XCTestCase {
    func testCursorSendsLastSeqOnlyWhenEpochMatches() {
        var cursor = StreamCursor(stream: "system")
        XCTAssertEqual(cursor.subscriptionParameters(currentEpoch: "A").lastSeq, nil)

        cursor.adopt(epoch: "A", seq: 12)
        let sameEpoch = cursor.subscriptionParameters(currentEpoch: "A")
        XCTAssertEqual(sameEpoch.lastSeq, 12)
        XCTAssertEqual(sameEpoch.epoch, "A")

        let otherEpoch = cursor.subscriptionParameters(currentEpoch: "B")
        XCTAssertNil(otherEpoch.lastSeq)
        XCTAssertNil(otherEpoch.epoch)
    }

    func testCursorDetectsGapsAndDuplicates() {
        var cursor = StreamCursor(stream: "system", epoch: "A", lastSeq: 10)
        XCTAssertEqual(cursor.advance(to: 12, epoch: "A"), .gap(expected: 11, received: 12))
        XCTAssertEqual(cursor.lastSeq, 10, "有缺口時不能推進游標")
        XCTAssertEqual(cursor.advance(to: 11, epoch: "A"), .applied(11))
        XCTAssertEqual(cursor.advance(to: 11, epoch: "A"), .duplicate(11))
        XCTAssertEqual(cursor.advance(to: 9, epoch: "A"), .duplicate(9))
        XCTAssertEqual(cursor.advance(to: 12, epoch: "B"), .epochChanged)
    }

    func testAdoptEpochOnlyKeepsLastSeqSoReplayApplies() throws {
        var model = SystemStatusModel(epoch: "epoch_a", lastSeq: 4)
        // 同一個 epoch、主機回 resyncRequired=false 且沒有快照。
        model.adoptEpochOnly("epoch_a")
        XCTAssertEqual(model.cursor.lastSeq, 4, "沒有快照時不能採納回應的 seq")

        let advance = model.apply(
            try decodeEvent(seq: 5, status: decodeStatus(state: "ready", service: "running"))
        )
        XCTAssertEqual(advance, .applied(5))
        XCTAssertEqual(model.cursor.lastSeq, 5)
    }

    func testSystemStatusSnapshotThenEvents() throws {
        var model = SystemStatusModel()
        let snapshot = try decodeStatus(state: "ready", service: "running", uptime: 5)
        model.applySnapshot(snapshot, epoch: "epoch_a", seq: 5)
        XCTAssertEqual(model.status?.service.uptimeSeconds, 5)

        let applied = model.apply(
            try decodeEvent(seq: 6, status: decodeStatus(state: "unavailable", service: "degraded"))
        )
        XCTAssertEqual(applied, .applied(6))
        XCTAssertEqual(model.status?.folder.state, .unavailable)
        XCTAssertEqual(model.status?.service.state, .degraded)

        let duplicate = model.apply(
            try decodeEvent(seq: 6, status: decodeStatus(state: "ready", service: "running"))
        )
        XCTAssertEqual(duplicate, .duplicate(6))
        XCTAssertEqual(model.status?.folder.state, .unavailable, "重複事件不能覆寫狀態")
    }

    func testStreamingTextFollowsSnapshotDeltaAndCompletionRules() throws {
        var model = SessionStreamModel(sessionId: "sess_1")
        let snapshot = try decodeSessionSnapshot(streamingText: "我先確認")
        model.applySnapshot(snapshot, epoch: "epoch_a", seq: 3)

        XCTAssertEqual(model.streaming?.text, "我先確認")
        XCTAssertEqual(model.streaming?.turnId, "turn_1")

        // 快照之後的 delta 是附加。
        _ = model.apply(try decodeDelta(delta: "資料夾狀態"))
        XCTAssertEqual(model.streaming?.text, "我先確認資料夾狀態")

        // message_completed 用完整文字取代整段，並推進序號。
        let advance = model.apply(try decodeCompletedMessage(text: "我先確認資料夾狀態，然後開始。", seq: 4))
        XCTAssertEqual(advance, .applied(4))
        XCTAssertNil(model.streaming)
        XCTAssertEqual(model.lastCompletedMessageId, "msg_1")
        XCTAssertEqual(model.cursor.lastSeq, 4)
    }

    func testCompletionClearsStreamingWhenEngineIdsDiffer() throws {
        var model = SessionStreamModel(sessionId: "sess_1", epoch: "epoch_a", lastSeq: 3)
        _ = model.apply(try decodeDelta(delta: "我先確認", messageId: "msg_turn_1"))
        XCTAssertEqual(model.streaming?.messageId, "msg_turn_1")

        // Pi 轉接層的增量識別碼是 msg_<turnId>，完成訊息用引擎的訊息編號；
        // 兩者不同時仍要用回合把進行中的文字收掉。
        _ = model.apply(try decodeCompletedMessage(text: "我先確認。", seq: 4, id: "14"))
        XCTAssertNil(model.streaming)
        XCTAssertEqual(model.lastCompletedMessageId, "14")
    }

    func testNonDurableDeltaDoesNotAdvanceCursor() throws {
        var model = SessionStreamModel(sessionId: "sess_1", epoch: "epoch_a", lastSeq: 7)
        _ = model.apply(try decodeDelta(delta: "更多"))
        XCTAssertEqual(model.cursor.lastSeq, 7)
        XCTAssertEqual(model.streaming?.text, "更多")
    }

    func testApprovalCounterTracksRequestedAndDecided() throws {
        var counter = ApprovalCounter()
        counter.apply(try decodeApprovalRequested(approvalId: "appr_1"))
        counter.apply(try decodeApprovalRequested(approvalId: "appr_2"))
        XCTAssertEqual(counter.count, 2)
        XCTAssertEqual(counter.requests.map(\.approvalId), ["appr_1", "appr_2"])
        XCTAssertEqual(counter.requests.first?.title, "需要核准")
        XCTAssertEqual(counter.requests.first?.scope.target, "bash")

        counter.apply(try decodeApprovalDecided(approvalId: "appr_1"))
        XCTAssertEqual(counter.count, 1)
        XCTAssertEqual(counter.requests.map(\.approvalId), ["appr_2"])

        counter.reset()
        XCTAssertEqual(counter.count, 0)
        XCTAssertTrue(counter.requests.isEmpty)
    }

    func testApprovalCounterAdoptsSnapshotPerSession() throws {
        var counter = ApprovalCounter()
        counter.apply(try decodeApprovalRequested(approvalId: "appr_1"))
        counter.apply(try decodeApprovalRequested(approvalId: "appr_other_session", sessionId: "sess_2"))
        counter.apply(try decodeApprovalRequested(approvalId: "appr_2"))

        // 快照是主機現況：同一個會話只留快照帶的那一筆，其他會話不受影響。
        let snapshotApproval = try JSONDecoder().decode(
            ApprovalRequest.self,
            from: JSONSerialization.data(withJSONObject: [
                "approvalId": "appr_3",
                "sessionId": "sess_1",
                "turnId": "turn_2",
                "title": "寫入檔案",
                "scope": ["kind": "tool_call", "target": "write_file"],
                "options": [["id": "approve", "label": "核准", "effect": "approve"]],
                "requestedAt": "2026-11-14T10:00:02Z",
            ])
        )
        counter.adoptSnapshot(snapshotApproval, sessionId: "sess_1")

        XCTAssertEqual(Set(counter.requests.map(\.approvalId)), ["appr_3", "appr_other_session"])
    }

    // MARK: - 測試資料

    private func decodeStatus(
        state: String,
        service: String,
        uptime: Int = 0
    ) throws -> SystemStatus {
        let json = JSONFixture.systemStatus(
            folderState: state,
            serviceState: service,
            uptime: uptime
        )
        return try JSONDecoder().decode(
            SystemStatus.self,
            from: JSONSerialization.data(withJSONObject: json)
        )
    }

    private func decodeEvent(seq: Int, status: SystemStatus) throws -> SystemStatusEvent {
        let json = JSONFixture.systemStatusEvent(
            seq: seq,
            status: JSONFixture.systemStatus(folderState: "unavailable", serviceState: "degraded")
        )
        return try JSONDecoder().decode(SystemStatusEvent.self, from: Data(json.utf8))
    }

    private func decodeSessionSnapshot(streamingText: String) throws -> SessionSnapshot {
        let json: [String: Any] = [
            "session": [
                "id": "sess_1",
                "title": "測試",
                "status": "running",
                "createdAt": "2026-11-14T10:00:00Z",
                "updatedAt": "2026-11-14T10:00:01Z",
                "messageCount": 1,
            ],
            "entries": [],
            "streaming": [
                "messageId": "msg_1",
                "turnId": "turn_1",
                "text": streamingText,
                "startedAt": "2026-11-14T10:00:00Z",
            ],
        ]
        let data = try JSONSerialization.data(withJSONObject: json)
        return try JSONDecoder().decode(SessionSnapshot.self, from: data)
    }

    private func decodeDelta(delta: String, messageId: String = "msg_1") throws -> ServerFrame {
        let json = JSONFixture.string([
            "v": 1,
            "kind": "event",
            "type": "stream.text_delta",
            "stream": "session:sess_1",
            "seq": 3,
            "emittedAt": "2026-11-14T10:00:01Z",
            "payload": [
                "sessionId": "sess_1",
                "turnId": "turn_1",
                "messageId": messageId,
                "delta": delta,
            ],
        ])
        return try JSONDecoder().decode(ServerFrame.self, from: Data(json.utf8))
    }

    private func decodeCompletedMessage(text: String, seq: Int, id: String = "msg_1") throws -> ServerFrame {
        let json = JSONFixture.string([
            "v": 1,
            "kind": "event",
            "type": "stream.message_completed",
            "stream": "session:sess_1",
            "seq": seq,
            "emittedAt": "2026-11-14T10:00:02Z",
            "payload": [
                "sessionId": "sess_1",
                "turnId": "turn_1",
                "entry": [
                    "id": id,
                    "role": "assistant",
                    "turnId": "turn_1",
                    "createdAt": "2026-11-14T10:00:02Z",
                    "text": text,
                    "status": "complete",
                ],
            ],
        ])
        return try JSONDecoder().decode(ServerFrame.self, from: Data(json.utf8))
    }

    private func decodeApprovalRequested(approvalId: String, sessionId: String = "sess_1") throws -> ServerFrame {
        let json = JSONFixture.string([
            "v": 1,
            "kind": "event",
            "type": "approval.requested",
            "stream": "session:\(sessionId)",
            "seq": 1,
            "emittedAt": "2026-11-14T10:00:00Z",
            "payload": [
                "approvalId": approvalId,
                "sessionId": sessionId,
                "turnId": "turn_1",
                "title": "需要核准",
                "scope": ["kind": "tool_call", "target": "bash"],
                "options": [["id": "approve", "label": "核准", "effect": "approve"]],
                "requestedAt": "2026-11-14T10:00:00Z",
            ],
        ])
        return try JSONDecoder().decode(ServerFrame.self, from: Data(json.utf8))
    }

    private func decodeApprovalDecided(approvalId: String) throws -> ServerFrame {
        let json = JSONFixture.string([
            "v": 1,
            "kind": "event",
            "type": "approval.decided",
            "stream": "session:sess_1",
            "seq": 2,
            "emittedAt": "2026-11-14T10:00:01Z",
            "payload": [
                "approvalId": approvalId,
                "sessionId": "sess_1",
                "effect": "approve",
                "decidedAt": "2026-11-14T10:00:01Z",
                "decidedBy": ["kind": "client", "clientId": "local"],
            ],
        ])
        return try JSONDecoder().decode(ServerFrame.self, from: Data(json.utf8))
    }
}
