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

    // MARK: - 啟動

    func testStartSendsKindDirectoryPromptAndRequestId() async {
        let service = FakeCardiaryService()
        let model = AgentModel()
        model.attach(service: service, approvals: service)

        let started = await model.start(
            agentKind: .claudeCode,
            workingDirectory: "/repo/with spaces",
            prompt: "  修正登入錯誤  "
        )

        XCTAssertTrue(started)
        let calls = await service.agentStartCalls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls[0].agentKind, .claudeCode)
        XCTAssertEqual(calls[0].workingDirectory, "/repo/with spaces")
        XCTAssertEqual(calls[0].prompt, "修正登入錯誤")
        XCTAssertFalse(calls[0].clientRequestId?.isEmpty ?? true)
        XCTAssertEqual(model.noticeMessage, AppL10n.text(.agentStartedNotice))
        XCTAssertNil(model.errorMessage)
        XCTAssertTrue(model.isKnown)
    }

    func testStartDropsBlankPromptAndRejectsEmptyDirectory() async {
        let service = FakeCardiaryService()
        let model = AgentModel()
        model.attach(service: service, approvals: service)

        let blankPrompt = await model.start(
            agentKind: .opencode,
            workingDirectory: "  /work  ",
            prompt: "   "
        )
        XCTAssertTrue(blankPrompt)
        var calls = await service.agentStartCalls
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls[0].workingDirectory, "/work")
        XCTAssertNil(calls[0].prompt)

        let emptyDirectory = await model.start(
            agentKind: .opencode,
            workingDirectory: "   ",
            prompt: "做事"
        )
        XCTAssertFalse(emptyDirectory)
        calls = await service.agentStartCalls
        XCTAssertEqual(calls.count, 1, "空目錄不該送出請求")
        XCTAssertEqual(model.errorMessage, AppL10n.text(.agentStartInvalidDirectory))
    }

    func testFailedStartKeepsFormAndShowsError() async {
        let service = FakeCardiaryService(failure: .agentStart)
        let model = AgentModel()
        model.attach(service: service, approvals: service)

        let started = await model.start(
            agentKind: .opencode,
            workingDirectory: "/work",
            prompt: nil
        )

        XCTAssertFalse(started)
        XCTAssertNotNil(model.errorMessage)
        XCTAssertNil(model.noticeMessage)
    }

    func testStartWithoutServiceReportsUnavailable() async {
        let model = AgentModel()

        let started = await model.start(
            agentKind: .opencode,
            workingDirectory: "/work",
            prompt: nil
        )

        XCTAssertFalse(started)
        XCTAssertEqual(model.errorMessage, AppL10n.text(.agentServiceUnavailable))
    }

    func testLostResponseRetryReusesRequestId() async {
        let service = FakeCardiaryService(loseFirstStartResponse: true)
        let model = AgentModel()
        model.attach(service: service, approvals: service)

        let first = await model.start(
            agentKind: .opencode,
            workingDirectory: "/work",
            prompt: "做事"
        )
        XCTAssertFalse(first)
        var calls = await service.agentStartCalls
        XCTAssertEqual(calls.count, 1)
        let firstId = calls[0].clientRequestId

        // 斷線重連不該清掉 attempt；重試沿用同一個要求和同一個 id。
        model.markDisconnected()
        model.attach(service: service, approvals: service)
        let retry = await model.start(
            agentKind: .opencode,
            workingDirectory: "  /work  ",
            prompt: "  做事  "
        )
        XCTAssertTrue(retry)
        calls = await service.agentStartCalls
        XCTAssertEqual(calls.count, 2)
        XCTAssertEqual(calls[1].clientRequestId, firstId)
        XCTAssertEqual(calls[1].workingDirectory, "/work")
        XCTAssertEqual(calls[1].prompt, "做事")
    }

    func testDifferentPayloadAfterLostResponseUsesNewRequestId() async {
        let service = FakeCardiaryService(loseFirstStartResponse: true)
        let model = AgentModel()
        model.attach(service: service, approvals: service)

        let first = await model.start(agentKind: .opencode, workingDirectory: "/work", prompt: "做事")
        XCTAssertFalse(first)
        var calls = await service.agentStartCalls
        let firstId = calls[0].clientRequestId

        let second = await model.start(agentKind: .claudeCode, workingDirectory: "/work", prompt: "做事")
        XCTAssertTrue(second)
        calls = await service.agentStartCalls
        XCTAssertEqual(calls.count, 2)
        XCTAssertNotEqual(calls[1].clientRequestId, firstId)
    }

    func testStartAfterSuccessUsesNewRequestId() async {
        let service = FakeCardiaryService()
        let model = AgentModel()
        model.attach(service: service, approvals: service)

        let first = await model.start(agentKind: .opencode, workingDirectory: "/work", prompt: "做事")
        XCTAssertTrue(first)
        var calls = await service.agentStartCalls
        let firstId = calls[0].clientRequestId

        let second = await model.start(agentKind: .opencode, workingDirectory: "/work", prompt: "做事")
        XCTAssertTrue(second)
        calls = await service.agentStartCalls
        XCTAssertEqual(calls.count, 2)
        XCTAssertNotEqual(calls[1].clientRequestId, firstId)
    }

    func testConcurrentStartSendsOnlyOneRequest() async {
        let service = FakeCardiaryService(holdFirstStart: true)
        let model = AgentModel()
        model.attach(service: service, approvals: service)

        async let first = model.start(agentKind: .opencode, workingDirectory: "/work", prompt: "做事")
        await service.waitForFirstStartEntered()
        let second = await model.start(agentKind: .opencode, workingDirectory: "/work", prompt: "做事")

        var calls = await service.agentStartCalls
        XCTAssertFalse(second, "第一次還沒回來時，重入不該送第二次請求")
        XCTAssertTrue(model.isStarting)
        XCTAssertEqual(calls.count, 1)

        await service.releaseFirstStart()
        let firstResult = await first
        XCTAssertTrue(firstResult)
        XCTAssertFalse(model.isStarting)
        calls = await service.agentStartCalls
        XCTAssertEqual(calls.count, 1)
    }

    func testNewFailedStartClearsPreviousNotice() async {
        let service = FakeCardiaryService(agentSessions: [Fixtures.agentInfo()])
        let model = AgentModel()
        model.attach(service: service, approvals: service)

        let succeeded = await model.start(agentKind: .opencode, workingDirectory: "/work", prompt: "做事")
        XCTAssertTrue(succeeded)
        XCTAssertEqual(model.noticeMessage, AppL10n.text(.agentStartedNotice))

        await service.setFailure(.agentStart)
        let failed = await model.start(agentKind: .opencode, workingDirectory: "/work", prompt: "做事")
        XCTAssertFalse(failed)
        XCTAssertNil(model.noticeMessage)
        XCTAssertNotNil(model.errorMessage)
    }

    // MARK: - 停止

    func testStopSendsSessionId() async {
        let service = FakeCardiaryService(agentSessions: [Fixtures.agentInfo(id: "agent-x")])
        let model = AgentModel()
        model.attach(service: service, approvals: service)
        await model.reload()

        await model.stop(model.sessions[0])

        let calls = await service.agentStopCalls
        XCTAssertEqual(calls, ["agent-x"])
        XCTAssertEqual(model.noticeMessage, AppL10n.text(.agentStoppedNotice))
        XCTAssertNil(model.errorMessage)
    }

    func testStopNotAppliedShowsDistinctNoticeAndReloads() async {
        let service = FakeCardiaryService(
            agentSessions: [Fixtures.agentInfo(id: "agent-x")],
            agentStopStopped: false
        )
        let model = AgentModel()
        model.attach(service: service, approvals: service)
        await model.reload()
        let listsBefore = await service.agentListCallCount

        await model.stop(model.sessions[0])

        let calls = await service.agentStopCalls
        let listsAfter = await service.agentListCallCount
        XCTAssertEqual(calls, ["agent-x"])
        XCTAssertEqual(model.noticeMessage, AppL10n.text(.agentStopNotAppliedNotice))
        XCTAssertNotEqual(model.noticeMessage, AppL10n.text(.agentStoppedNotice))
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(listsAfter, listsBefore + 1, "停止後仍要 reload 快照")
    }

    func testFailedStopClearsPreviousNotice() async {
        let service = FakeCardiaryService(
            agentSessions: [Fixtures.agentInfo(id: "agent-x")]
        )
        let model = AgentModel()
        model.attach(service: service, approvals: service)
        await model.reload()

        let succeeded = await model.start(agentKind: .opencode, workingDirectory: "/work", prompt: "做事")
        XCTAssertTrue(succeeded)
        XCTAssertNotNil(model.noticeMessage)

        await service.setFailure(.agentStop)
        await model.stop(model.sessions[0])

        XCTAssertNotNil(model.errorMessage)
        XCTAssertNil(model.noticeMessage)
    }

    func testFailedDecisionClearsPreviousNotice() async {
        let service = FakeCardiaryService()
        let model = AgentModel()
        model.attach(service: service, approvals: service)
        await model.start(agentKind: .opencode, workingDirectory: "/work", prompt: "做事")
        XCTAssertNotNil(model.noticeMessage)
        model.update(sessions: [
            Fixtures.agentInfo(status: .waitingApproval, pendingPermission: Fixtures.agentPermission())
        ])

        await service.setFailure(.approval)
        await model.approve(model.sessions[0])

        XCTAssertNotNil(model.errorMessage)
        XCTAssertNil(model.noticeMessage)
    }

    func testFailedStopShowsError() async {
        let service = FakeCardiaryService(
            agentSessions: [Fixtures.agentInfo(id: "agent-x")],
            failure: .agentStop
        )
        let model = AgentModel()
        model.attach(service: service, approvals: service)
        await model.reload()

        await model.stop(model.sessions[0])

        let calls = await service.agentStopCalls
        XCTAssertTrue(calls.isEmpty)
        XCTAssertNotNil(model.errorMessage)
        XCTAssertNil(model.noticeMessage)
    }
}
