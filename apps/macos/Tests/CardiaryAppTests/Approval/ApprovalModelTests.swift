import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 檢視欄的審批：清單、三種決定、失敗保留與緊急暫停。
///
/// 這裡斷言介面字串，固定用繁體中文，不跟著 CI runner 的系統語言。
@MainActor
final class ApprovalModelTests: XCTestCase {
    private func makeModel() -> ApprovalModel {
        ApprovalModel(language: .zhHant)
    }

    func testUpdateSortsRequestsAndKeepsHostOptions() {
        let model = makeModel()
        model.update(requests: [
            Fixtures.approval(approvalId: "later", requestedAt: "2026-01-01T00:00:09Z"),
            Fixtures.approval(approvalId: "earlier", requestedAt: "2026-01-01T00:00:01Z"),
        ])

        XCTAssertTrue(model.isKnown)
        XCTAssertEqual(model.requests.map(\.approvalId), ["earlier", "later"])
        XCTAssertEqual(model.requests.first?.title, "寫入檔案")
        XCTAssertEqual(model.requests.first?.toolName, "write_file")
        XCTAssertEqual(model.requests.first?.summary, "代理想寫入 ~/notes.md")
        XCTAssertTrue(model.requests.first?.supportsApproveAlways == true)
    }

    func testApproveSendsApproveOptionAndRemovesRequest() async {
        let fake = FakeCardiaryService()
        let model = makeModel()
        model.attach(service: fake)
        let approval = ApprovalPresentation(request: Fixtures.approval())
        model.update(requests: [Fixtures.approval()])

        await model.approve(approval)

        let decisions = await fake.approvalDecisions
        XCTAssertEqual(decisions.count, 1)
        XCTAssertEqual(decisions.first?.approvalId, "approval-1")
        XCTAssertEqual(decisions.first?.optionId, "approve")
        XCTAssertTrue(model.requests.isEmpty, "決定成功後先從清單移除，事件再確認一次")
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.noticeMessage, "已核准。")
    }

    func testRejectSendsRejectOption() async {
        let fake = FakeCardiaryService()
        let model = makeModel()
        model.attach(service: fake)
        let approval = ApprovalPresentation(request: Fixtures.approval())
        model.update(requests: [Fixtures.approval()])

        await model.reject(approval)

        let decisions = await fake.approvalDecisions
        XCTAssertEqual(decisions.first?.optionId, "reject")
        XCTAssertEqual(model.noticeMessage, "已拒絕。")
    }

    func testApproveAlwaysOnlyWhenHostOffersIt() async {
        let withoutAlways = ApprovalPresentation(
            request: Fixtures.approval(approveAlways: false)
        )
        XCTAssertFalse(withoutAlways.supportsApproveAlways)

        let fake = FakeCardiaryService()
        let model = makeModel()
        model.attach(service: fake)
        let approval = ApprovalPresentation(request: Fixtures.approval())
        model.update(requests: [Fixtures.approval()])

        await model.approveAlways(withoutAlways)
        var decisions = await fake.approvalDecisions
        XCTAssertTrue(decisions.isEmpty, "主機沒有提供一律允許時不能送出")
        XCTAssertEqual(model.errorMessage, "這個審批沒有提供這個選項。")

        await model.approveAlways(approval)
        decisions = await fake.approvalDecisions
        XCTAssertEqual(decisions.first?.optionId, "always")
        XCTAssertEqual(model.noticeMessage, "已核准。")
    }

    func testFailureKeepsRequestAndShowsError() async {
        let fake = FakeCardiaryService(failure: .approval)
        let model = makeModel()
        model.attach(service: fake)
        let approval = ApprovalPresentation(request: Fixtures.approval())
        model.update(requests: [Fixtures.approval()])

        await model.approve(approval)

        XCTAssertEqual(model.requests.map(\.approvalId), ["approval-1"], "失敗時保留，讓使用者重試")
        XCTAssertNotNil(model.errorMessage)
        XCTAssertTrue(model.decidingIds.isEmpty)
    }

    func testDecideWithoutServiceShowsError() async {
        let model = makeModel()
        let approval = ApprovalPresentation(request: Fixtures.approval())
        model.update(requests: [Fixtures.approval()])

        await model.approve(approval)

        XCTAssertEqual(model.errorMessage, "還沒連上服務，無法送出審批。")
        XCTAssertEqual(model.requests.count, 1)
    }

    func testMessagesFollowInjectedLanguage() async {
        let approval = ApprovalPresentation(request: Fixtures.approval())

        let english = ApprovalModel(language: .en)
        await english.approve(approval)
        XCTAssertEqual(english.errorMessage, "Not connected; cannot send the decision.")

        let chinese = makeModel()
        await chinese.approve(approval)
        XCTAssertEqual(chinese.errorMessage, "還沒連上服務，無法送出審批。")
    }

    func testPauseAllCallsServiceAndMarksPaused() async {
        let fake = FakeCardiaryService()
        let model = makeModel()
        model.attach(service: fake)

        await model.pauseAll()

        let calls = await fake.pauseAllCalls
        XCTAssertEqual(calls, 1)
        XCTAssertTrue(model.isPaused)
        XCTAssertEqual(model.noticeMessage, "已全部暫停。")
    }

    func testEmptyListClearsPausedFlag() async {
        let fake = FakeCardiaryService()
        let model = makeModel()
        model.attach(service: fake)
        await model.pauseAll()
        XCTAssertTrue(model.isPaused)

        model.update(requests: [])
        XCTAssertFalse(model.isPaused, "沒有待審批時不再顯示暫停中")
    }

    func testDisconnectMarksUnknown() {
        let model = makeModel()
        model.update(requests: [Fixtures.approval()])
        XCTAssertTrue(model.isKnown)

        model.markDisconnected()

        XCTAssertFalse(model.isKnown)
        XCTAssertTrue(model.requests.isEmpty)
    }
}
