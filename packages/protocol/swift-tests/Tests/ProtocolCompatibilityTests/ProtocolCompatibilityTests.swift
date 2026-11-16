import Foundation
import XCTest
@testable import CardiaryKit

final class ProtocolCompatibilityTests: XCTestCase {
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
