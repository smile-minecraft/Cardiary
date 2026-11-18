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

    // MARK: - 遠端存取開關與位址

    private func accessItem(_ enabled: Bool) -> SettingItem {
        SettingItem(
            key: "remote.accessEnabled",
            value: .bool(enabled),
            level: .humanOnly,
            updatedAt: "2026-01-01T00:00:00Z"
        )
    }

    func testLoadAccessSettingReadsHumanSetting() async {
        let settings = FakeSettingsService(items: [accessItem(true)])
        let model = makeModel()
        model.attachSettings(service: settings)

        await model.loadAccessSetting()

        XCTAssertTrue(model.accessEnabled)
        XCTAssertTrue(model.accessLoaded)
        XCTAssertFalse(model.isPairingPaused)
        XCTAssertNil(model.accessError)
    }

    func testSetAccessEnabledWritesSetting() async {
        let settings = FakeSettingsService()
        let model = makeModel()
        model.attachSettings(service: settings)

        await model.setAccessEnabled(true)

        let changes = await settings.changes
        XCTAssertEqual(changes.count, 1)
        XCTAssertEqual(changes.first?.first?.key, "remote.accessEnabled")
        XCTAssertEqual(changes.first?.first?.value, .bool(true))
        XCTAssertTrue(model.accessEnabled)
        XCTAssertEqual(model.accessNotice, "已更新遠端存取設定。")
    }

    func testSetAccessEnabledFailureKeepsPreviousValue() async {
        let settings = FakeSettingsService()
        await settings.failNextSave()
        let model = makeModel()
        model.attachSettings(service: settings)

        await model.setAccessEnabled(true)

        XCTAssertFalse(model.accessEnabled)
        XCTAssertNotNil(model.accessError)
        XCTAssertNil(model.accessNotice)
    }

    func testDisabledAccessKeepsDevicesListAndPausesPairing() async {
        let settings = FakeSettingsService(items: [accessItem(false)])
        let model = makeModel()
        model.attachSettings(service: settings)
        await model.loadAccessSetting()
        let fake = FakeRemoteControlService()
        await fake.setDevices([device()])
        model.attach(service: fake)

        await model.refreshDevices()

        XCTAssertTrue(model.isPairingPaused)
        XCTAssertEqual(model.devices.map(\.deviceId), ["dev-1"])
    }

    func testRemoteAddressFollowsServicePort() {
        let model = makeModel()
        XCTAssertNil(model.remoteAddress)

        model.update(servicePort: 63_715)
        XCTAssertEqual(model.remoteAddress, "http://127.0.0.1:63715")

        model.update(servicePort: nil)
        XCTAssertNil(model.remoteAddress)
    }

    func testDetachSettingsClearsAccessState() async {
        let settings = FakeSettingsService(items: [accessItem(true)])
        let model = makeModel()
        model.attachSettings(service: settings)
        await model.loadAccessSetting()

        model.detachSettings()

        XCTAssertFalse(model.accessEnabled)
        XCTAssertFalse(model.accessLoaded)
        XCTAssertFalse(model.isPairingPaused)
    }
}

private actor FakeSettingsService: SettingsService {
    private var items: [SettingItem]
    private var shouldFailNextSave = false
    private(set) var changes: [[SettingChange]] = []

    init(items: [SettingItem] = []) {
        self.items = items
    }

    func failNextSave() {
        shouldFailNextSave = true
    }

    func getSettings() async throws -> SystemSettingsGetResponsePayload {
        SystemSettingsGetResponsePayload(settings: items)
    }

    func setSettings(
        changes: [SettingChange],
        clientRequestId: String
    ) async throws -> SystemSettingsSetResponsePayload {
        if shouldFailNextSave {
            shouldFailNextSave = false
            throw FakeError.failed
        }
        self.changes.append(changes)
        var applied: [SettingItem] = []
        for change in changes {
            let item = SettingItem(
                key: change.key,
                value: change.value,
                level: .humanOnly,
                updatedAt: "2026-01-01T00:00:00Z"
            )
            if let index = items.firstIndex(where: { $0.key == change.key }) {
                items[index] = item
            } else {
                items.append(item)
            }
            applied.append(item)
        }
        return SystemSettingsSetResponsePayload(applied: applied, requiresApproval: false)
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
