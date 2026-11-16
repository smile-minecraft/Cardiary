import CardiaryKit
import CardiaryShellCore
import XCTest

@testable import CardiaryApp

/// 配對核准與裝置撤銷的視圖模型測試。
/// 字串固定用繁體中文，不跟著 CI runner 的系統語言。
@MainActor
final class RemoteModelTests: XCTestCase {
    private func makeModel() -> RemoteModel {
        RemoteModel(language: .zhHant)
    }

    private func notice(id: String = "pair-1", name: String = "iPhone") -> PairingNotice {
        PairingNotice(
            pairingRequestId: id,
            deviceName: name,
            deviceKind: "ios",
            code: "123-456",
            expiresAt: "2026-01-01T00:05:00Z"
        )
    }

    private func device(id: String = "dev-1", revokedAt: String? = nil) -> ShellPairedDevice {
        ShellPairedDevice(
            deviceId: id,
            deviceName: "MacBook",
            deviceKind: "web",
            fingerprint: "aa:bb:cc:dd",
            createdAt: "2026-01-01T00:00:00Z",
            revokedAt: revokedAt
        )
    }

    func testReceiveDeduplicatesById() {
        let model = makeModel()
        model.receive(notice: notice())
        model.receive(notice: notice())

        XCTAssertEqual(model.pendingRequests.count, 1)
        XCTAssertEqual(model.pendingRequests.first?.deviceName, "iPhone")
        XCTAssertEqual(model.pendingRequests.first?.code, "123-456")
    }

    func testApproveCallsServiceAndRemovesRequest() async {
        let fake = FakeRemoteControlService()
        let model = makeModel()
        model.attach(service: fake)
        model.receive(notice: notice())

        await model.approve(model.pendingRequests[0])

        let decisions = await fake.decisions
        XCTAssertEqual(decisions.count, 1)
        XCTAssertEqual(decisions.first?.requestId, "pair-1")
        XCTAssertEqual(decisions.first?.approve, true)
        XCTAssertTrue(model.pendingRequests.isEmpty)
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.noticeMessage, "已核准，裝置可以領取憑證。")
    }

    func testDenyCallsServiceWithApproveFalse() async {
        let fake = FakeRemoteControlService()
        let model = makeModel()
        model.attach(service: fake)
        model.receive(notice: notice())

        await model.deny(model.pendingRequests[0])

        let decisions = await fake.decisions
        XCTAssertEqual(decisions.first?.approve, false)
        XCTAssertTrue(model.pendingRequests.isEmpty)
        XCTAssertEqual(model.noticeMessage, "已拒絕這筆配對。")
    }

    func testDecisionFailureKeepsRequest() async {
        let fake = FakeRemoteControlService()
        await fake.setFailDecide(true)
        let model = makeModel()
        model.attach(service: fake)
        model.receive(notice: notice())

        await model.approve(model.pendingRequests[0])

        XCTAssertEqual(model.pendingRequests.count, 1)
        XCTAssertNotNil(model.errorMessage)
    }

    func testRevokeRemovesDeviceAndBlocksDuplicate() async {
        let fake = FakeRemoteControlService()
        let model = makeModel()
        model.attach(service: fake)
        model.update(devices: [device(), device(id: "dev-2")])

        await model.revoke(model.devices[0])

        let revoked = await fake.revokedIds
        XCTAssertEqual(revoked.count, 1)
        XCTAssertEqual(revoked.first, "dev-1")
        XCTAssertEqual(model.devices.map(\.deviceId), ["dev-2"])
        XCTAssertEqual(model.noticeMessage, "已撤銷裝置。")
    }

    func testRefreshListsDevices() async {
        let fake = FakeRemoteControlService()
        await fake.setDevices([device(), device(id: "dev-2")])
        let model = makeModel()
        model.attach(service: fake)

        await model.refreshDevices()

        XCTAssertTrue(model.isKnown)
        XCTAssertEqual(model.devices.count, 2)
        let calls = await fake.listCalls
        XCTAssertEqual(calls, 1)
    }

    func testDetachClearsState() {
        let model = makeModel()
        model.receive(notice: notice())
        model.update(devices: [device()])

        model.detach()

        XCTAssertTrue(model.pendingRequests.isEmpty)
        XCTAssertTrue(model.devices.isEmpty)
        XCTAssertFalse(model.isKnown)
    }
}

private actor FakeRemoteControlService: RemoteControlService {
    private(set) var decisions: [(requestId: String, approve: Bool)] = []
    private(set) var revokedIds: [String] = []
    private(set) var listCalls = 0
    private var devices: [ShellPairedDevice] = []
    private var failDecide = false

    func setDevices(_ value: [ShellPairedDevice]) { devices = value }
    func setFailDecide(_ value: Bool) { failDecide = value }

    func decidePairing(requestId: String, approve: Bool) async throws {
        if failDecide { throw FakeError.failed }
        decisions.append((requestId, approve))
    }

    func listDevices() async throws -> [ShellPairedDevice] {
        listCalls += 1
        return devices
    }

    func revokeDevice(deviceId: String) async throws {
        if deviceId == "missing" { throw FakeError.failed }
        revokedIds.append(deviceId)
    }
}

private enum FakeError: LocalizedError {
    case failed
    var errorDescription: String? { "測試錯誤" }
}
