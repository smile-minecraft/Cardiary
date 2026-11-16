import Foundation
import XCTest
@testable import CardiaryKit

final class ProtocolCompatibilityTests: XCTestCase {
    func testBoardExamplesDecodeAndRoundTrip() throws {
        let testFile = URL(fileURLWithPath: #filePath)
        let protocolDirectory = testFile.deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let exampleURL = protocolDirectory.appendingPathComponent("examples/protocol-examples.json")
        let object = try JSONSerialization.jsonObject(with: Data(contentsOf: exampleURL))
        let examples = try XCTUnwrap(object as? [String: Any])
        let boards = examples.filter { $0.key.hasPrefix("board") }
        XCTAssertEqual(boards.count, 17)
        for (name, value) in boards {
            let data = try JSONSerialization.data(withJSONObject: value)
            if name.hasSuffix("Request") {
                let frame = try JSONDecoder().decode(ClientFrame.self, from: data)
                XCTAssertEqual(try JSONDecoder().decode(ClientFrame.self, from: JSONEncoder().encode(frame)), frame)
            } else {
                let frame = try JSONDecoder().decode(ServerFrame.self, from: data)
                XCTAssertEqual(try JSONDecoder().decode(ServerFrame.self, from: JSONEncoder().encode(frame)), frame)
                let payload = try XCTUnwrap(value as? [String: Any])
                XCTAssertEqual(frame.kindLabel, payload["type"] as? String, name)
                XCTAssertNil(frame.eventStream, name)
                XCTAssertNil(frame.eventSeq, name)
                var session = SessionStreamModel(sessionId: "s1", epoch: "e1", lastSeq: 7)
                XCTAssertNil(session.apply(frame), name)
                XCTAssertEqual(session.cursor.lastSeq, 7, name)
            }
        }
        XCTAssertThrowsError(try JSONDecoder().decode(BoardPoint.self, from: Data(#"{"x":0.5,"y":0}"#.utf8)))
    }

    func testNotificationDoesNotChangeApprovalsOrSessionState() throws {
        let json = #"""
        {"v":1,"kind":"event","type":"notification.changed","stream":"system","seq":1,
         "emittedAt":"2026-11-16T04:02:11Z","payload":{"notification":{
         "notificationId":"n1","kind":"heartbeat","title":"通知","body":"內容",
         "createdAt":"2026-11-16T04:02:11Z","payload":{}}}}
        """#
        let frame = try JSONDecoder().decode(ServerFrame.self, from: Data(json.utf8))
        XCTAssertEqual(frame.kindLabel, "notification.changed")
        XCTAssertNil(frame.eventStream)
        XCTAssertNil(frame.eventSeq)
        let approvalJSON = #"""
        {"v":1,"kind":"event","type":"approval.requested","stream":"session:s1","seq":1,
         "emittedAt":"2026-11-16T04:02:11Z","payload":{"approvalId":"a1","sessionId":"s1",
         "turnId":"t1","title":"需要核准","scope":{"kind":"tool_call","target":"bash"},
         "options":[{"id":"approve","label":"核准","effect":"approve"}],
         "requestedAt":"2026-11-16T04:02:11Z"}}
        """#
        var approvals = ApprovalCounter()
        approvals.apply(try JSONDecoder().decode(ServerFrame.self, from: Data(approvalJSON.utf8)))
        XCTAssertEqual(approvals.count, 1)
        approvals.apply(frame)
        XCTAssertEqual(approvals.requests.map(\.approvalId), ["a1"])
        var session = SessionStreamModel(sessionId: "s1", epoch: "e1", lastSeq: 7)
        XCTAssertNil(session.apply(frame))
        XCTAssertEqual(session.cursor.lastSeq, 7)
    }
}
