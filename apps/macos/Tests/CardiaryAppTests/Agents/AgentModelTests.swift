import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 外部代理模型：快照排序、事件更新、待核准決定與結果未知的呈現。
@MainActor
final class AgentModelTests: XCTestCase {
    func testReloadLoadsSnapshotSortedByStartThenId() async {
        let service = FakeCardiaryService(agentSessions: [
            Fixtures.agentInfo(id: "later", startedAt: "2026-01-01T00:00:02Z"),
            Fixtures.agentInfo(id: "b", startedAt: "2026-01-01T00:00:01Z"),
            Fixtures.agentInfo(id: "a", startedAt: "2026-01-01T00:00:01Z")
        ])
        let model = AgentModel()
        model.attach(service: service, approvals: service)

        await model.reload()

        XCTAssertTrue(model.isKnown)
        XCTAssertEqual(model.sessions.map(\.agentSessionId), ["a", "b", "later"])
    }

    func testDisconnectedMarksUnknownAndClearsSessions() {
        let model = AgentModel()
        model.update(sessions: [Fixtures.agentInfo()])
        XCTAssertTrue(model.isKnown)

        model.markDisconnected()

        XCTAssertFalse(model.isKnown)
        XCTAssertTrue(model.sessions.isEmpty)
    }

    func testStateEventUpsertsAndKeepsSnapshotFields() {
        let model = AgentModel()
        model.update(sessions: [
            Fixtures.agentInfo(id: "agent-1", workingDirectory: "/snapshot", startedAt: "2026-01-01T00:00:00Z")
        ])

        let event = AgentStateChangedEventPayload(
            agentSessionId: "agent-1",
            agentKind: .opencode,
            status: .running,
            progress: AgentProgress(step: "build", label: "編譯中", completed: 2, total: 4),
            message: "還在跑",
            resultUnknown: nil,
            pendingPermission: nil
        )
        model.handle(frame: .agentStateChangedEvent(AgentStateChangedEvent(
            stream: "system",
            seq: 7,
            emittedAt: "2026-01-01T00:00:05Z",
            payload: event
        )))

        XCTAssertEqual(model.sessions.count, 1)
        XCTAssertEqual(model.sessions[0].workingDirectory, "/snapshot")
        XCTAssertEqual(model.sessions[0].startedAt, "2026-01-01T00:00:00Z")
        XCTAssertEqual(model.sessions[0].message, "還在跑")
        XCTAssertEqual(model.sessions[0].progressFraction, 0.5)
        XCTAssertEqual(model.sessions[0].progressText(language: .en), "Step 2/4")
    }

    func testStateEventForUnknownSessionCreatesCard() {
        let model = AgentModel()
        let payload = AgentStateChangedEventPayload(
            agentSessionId: "new-agent",
            agentKind: .claudeCode,
            status: .waitingApproval,
            pendingPermission: Fixtures.agentPermission()
        )

        model.apply(payload, startedAt: "2026-01-01T00:00:09Z")

        XCTAssertEqual(model.sessions.count, 1)
        XCTAssertEqual(model.sessions[0].agentSessionId, "new-agent")
        XCTAssertEqual(model.sessions[0].pendingPermission?.approvalId, "approval-1")
    }

    func testResultUnknownIsPreserved() {
        let model = AgentModel()
        model.apply(AgentStateChangedEventPayload(
            agentSessionId: "agent-1",
            agentKind: .opencode,
            status: .stopped,
            resultUnknown: true
        ), startedAt: "2026-01-01T00:00:00Z")

        XCTAssertTrue(model.sessions[0].resultUnknown)
    }

    func testApproveSendsApproveAndClearsPermission() async {
        let service = FakeCardiaryService()
        let model = AgentModel()
        model.attach(service: service, approvals: service)
        model.update(sessions: [
            Fixtures.agentInfo(status: .waitingApproval, pendingPermission: Fixtures.agentPermission())
        ])
        let session = model.sessions[0]

        await model.approve(session)

        let decisions = await service.approvalDecisions
        XCTAssertEqual(decisions.count, 1)
        XCTAssertEqual(decisions[0].approvalId, "approval-1")
        XCTAssertEqual(decisions[0].optionId, "approve")
        XCTAssertNil(model.sessions[0].pendingPermission)
        XCTAssertEqual(model.noticeMessage, AppL10n.text(.approvalApproved))
    }

    func testRejectSendsDeny() async {
        let service = FakeCardiaryService()
        let model = AgentModel()
        model.attach(service: service, approvals: service)
        model.update(sessions: [
            Fixtures.agentInfo(status: .waitingApproval, pendingPermission: Fixtures.agentPermission(approvalId: "a2"))
        ])

        await model.reject(model.sessions[0])

        let decisions = await service.approvalDecisions
        XCTAssertEqual(decisions.count, 1)
        XCTAssertEqual(decisions[0].optionId, "deny")
        XCTAssertEqual(model.noticeMessage, AppL10n.text(.approvalRejected))
    }

    func testFailedDecisionKeepsPermissionAndShowsError() async {
        let service = FakeCardiaryService(failure: .approval)
        let model = AgentModel()
        model.attach(service: service, approvals: service)
        model.update(sessions: [
            Fixtures.agentInfo(status: .waitingApproval, pendingPermission: Fixtures.agentPermission())
        ])

        await model.approve(model.sessions[0])

        XCTAssertNotNil(model.sessions[0].pendingPermission)
        XCTAssertNotNil(model.errorMessage)
        XCTAssertTrue(model.decidingIds.isEmpty)
    }

    func testDecisionWithoutServiceReportsUnavailable() async {
        let model = AgentModel()
        model.update(sessions: [
            Fixtures.agentInfo(status: .waitingApproval, pendingPermission: Fixtures.agentPermission())
        ])

        await model.approve(model.sessions[0])

        XCTAssertEqual(model.errorMessage, AppL10n.text(.agentServiceUnavailable))
    }
}
