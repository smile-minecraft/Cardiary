import Foundation
import XCTest

@testable import CardiaryShellCore

final class ShellStateDirectoryTests: XCTestCase {
    func testUsedBytesAndPayloadReportOnlySizes() throws {
        let root = try TestSupport.makeTemporaryFolder("shell-state")
        let directory = ShellStateDirectory(root: root, limitBytes: 1_000_000)
        try directory.ensureExists()
        try Data(repeating: 0x41, count: 2_000).write(to: root.appendingPathComponent("shell-20260101.log"))

        XCTAssertEqual(directory.usedBytes(), 2_000)
        let payload = directory.payload()
        XCTAssertEqual(payload["usedBytes"]?.intValue, 2_000)
        XCTAssertEqual(payload["limitBytes"]?.intValue, 1_000_000)
        XCTAssertEqual(payload.objectValue?.keys.sorted(), ["limitBytes", "usedBytes"])
    }

    func testPruneDeletesOldestLogsAndKeepsAuthorization() throws {
        let root = try TestSupport.makeTemporaryFolder("shell-state")
        let directory = ShellStateDirectory(root: root, limitBytes: 10_000)
        try directory.ensureExists()

        let authorization = root.appendingPathComponent(ShellStateDirectory.authorizationFileName)
        try Data("{}".utf8).write(to: authorization)

        let old = root.appendingPathComponent("shell-20260101.log")
        let middle = root.appendingPathComponent("shell-20260102.log")
        let newest = root.appendingPathComponent("shell-20260103.log")
        try Data(repeating: 0x41, count: 6_000).write(to: old)
        try Data(repeating: 0x42, count: 6_000).write(to: middle)
        try Data(repeating: 0x43, count: 6_000).write(to: newest)
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSince1970: 1_000)],
            ofItemAtPath: old.path
        )
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSince1970: 2_000)],
            ofItemAtPath: middle.path
        )
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSince1970: 3_000)],
            ofItemAtPath: newest.path
        )

        let report = directory.pruneIfNeeded()
        XCTAssertFalse(report.removedFiles.isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: authorization.path), "授權紀錄不能刪")
        XCTAssertLessThanOrEqual(directory.usedBytes(), 10_000)
        XCTAssertFalse(FileManager.default.fileExists(atPath: old.path), "應先刪最舊的日誌")
    }

    func testPruneOnlyTouchesLogsAndRuntimeFiles() throws {
        let root = try TestSupport.makeTemporaryFolder("shell-state")
        let directory = ShellStateDirectory(root: root, limitBytes: 1_000)
        try directory.ensureExists()

        let unknown = root.appendingPathComponent("notes.txt")
        try Data(repeating: 0x41, count: 4_000).write(to: unknown)

        let report = directory.pruneIfNeeded()
        XCTAssertTrue(report.removedFiles.isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: unknown.path), "不認得的檔案不能刪")
        XCTAssertTrue(report.stillOverLimit)
    }
}

final class L10nTests: XCTestCase {
    func testEveryKeyHasBothLanguages() {
        for key in L10n.Key.allCases {
            let zh = L10n.table(.zhHant)[key]
            let en = L10n.table(.en)[key]
            XCTAssertNotNil(zh, "缺少繁中字串：\(key)")
            XCTAssertNotNil(en, "缺少英文字串：\(key)")
            XCTAssertFalse((zh ?? "").isEmpty)
            XCTAssertFalse((en ?? "").isEmpty)
        }
    }

    func testTablesHaveNoExtraKeys() {
        XCTAssertEqual(L10n.table(.zhHant).count, L10n.Key.allCases.count)
        XCTAssertEqual(L10n.table(.en).count, L10n.Key.allCases.count)
    }

    func testDefaultLanguageSelection() {
        XCTAssertEqual(L10n.defaultLanguage(preferred: ["zh-Hant-TW"]), .zhHant)
        XCTAssertEqual(L10n.defaultLanguage(preferred: ["zh-TW"]), .zhHant)
        XCTAssertEqual(L10n.defaultLanguage(preferred: ["en-US"]), .en)
        XCTAssertEqual(L10n.defaultLanguage(preferred: ["fr-FR", "en-US"]), .en)
        XCTAssertEqual(L10n.defaultLanguage(preferred: []), .en)
    }

    func testCountReplacement() {
        let text = L10n.count(.menuApprovalsCount, count: 3, language: .en)
        XCTAssertEqual(text, "3 pending")
        let zh = L10n.count(.menuApprovalsCount, count: 3, language: .zhHant)
        XCTAssertEqual(zh, "3 件待審批")
    }

    func testServiceAndFolderStatesHaveStrings() {
        for phase in [ServicePhase]([
            .idle, .starting, .running, .paused, .unavailable, .failed, .stopping, .stopped,
        ]) {
            XCTAssertFalse(L10n.text(phase.localizationKey, language: .zhHant).isEmpty)
            XCTAssertFalse(L10n.text(phase.localizationKey, language: .en).isEmpty)
        }
        for state in FolderAvailabilityState.allCases {
            XCTAssertFalse(L10n.text(state.localizationKey, language: .zhHant).isEmpty)
            XCTAssertFalse(L10n.text(state.localizationKey, language: .en).isEmpty)
        }
    }
}

final class FolderTests: XCTestCase {
    func testAllEightStatesMapToProtocolStates() {
        XCTAssertEqual(FolderAvailabilityState.allCases.count, 8)
        XCTAssertEqual(FolderAvailabilityState.unselected.protocolState, "not_selected")
        XCTAssertEqual(FolderAvailabilityState.ready.protocolState, "ready")
        XCTAssertEqual(FolderAvailabilityState.paused.protocolState, "ready")
        XCTAssertEqual(FolderAvailabilityState.unavailable.protocolState, "unavailable")
        XCTAssertEqual(FolderAvailabilityState.mismatch.protocolState, "unavailable")
        XCTAssertEqual(FolderAvailabilityState.migrationFailed.protocolState, "unavailable")
        XCTAssertEqual(FolderAvailabilityState.migrationFailed.rawValue, "migration-failed")
    }

    func testAuthorizationRoundTripKeepsBookmarkAndMetadata() throws {
        let directory = try TestSupport.makeTemporaryFolder("authorization")
        let url = directory.appendingPathComponent("folder-authorization.json")
        let record = FolderAuthorization(
            displayPath: "/Volumes/Cardiary/Cardiary",
            bookmark: Data([0x01, 0x02, 0x03]),
            volumeUUID: "VOL-1",
            volumePath: "/Volumes/Cardiary",
            isExternalVolume: true,
            folderId: "01JCX",
            recordedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
        try FolderAuthorizationStore.save(record, to: url)
        let loaded = try FolderAuthorizationStore.load(from: url)
        XCTAssertEqual(loaded, record)
    }

    func testMissingFolderIsNotCreated() throws {
        let base = try TestSupport.makeTemporaryFolder("missing")
        let missing = base.appendingPathComponent("NotThere")
        XCTAssertNil(VolumeProbe.probe(path: missing.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: missing.path))
    }

    func testVolumeProbeOnTemporaryDirectory() throws {
        let folder = try TestSupport.makeTemporaryFolder("volume")
        let info = try XCTUnwrap(VolumeProbe.probe(path: folder.path))
        XCTAssertNotNil(info.uuid)
        XCTAssertNotNil(info.fileSystemName)
        // 本機測試目錄在 APFS 上；其他檔案系統只檢查不誤報 APFS。
        if info.fileSystemName?.lowercased() == "apfs" {
            XCTAssertTrue(info.isAPFS)
            XCTAssertNil(VolumeProbe.formatWarning(for: info))
        }
    }

    func testNonAPFSWarningMentionsFormat() {
        let info = VolumeInfo(fileSystemName: "exfat", localizedFormat: "ExFAT")
        let warning = try? XCTUnwrap(VolumeProbe.formatWarning(for: info))
        XCTAssertTrue(warning?.contains("ExFAT") ?? false)
    }

    func testFolderSnapshotUsability() {
        XCTAssertFalse(FolderSnapshot.unselected.isUsable)
        XCTAssertFalse(FolderSnapshot(state: .ready, path: "/x", writable: false).isUsable)
        XCTAssertTrue(FolderSnapshot(state: .ready, path: "/x", writable: true).isUsable)
    }
}

final class BrokerServiceTests: XCTestCase {
    private func makeService(
        keychain: KeychainReading,
        folder: FolderSnapshot = FolderSnapshot(
            state: .ready,
            path: "/Users/test/Cardiary",
            displayName: "Cardiary",
            volumeUUID: "VOL-1",
            writable: true
        )
    ) throws -> BrokerService {
        let root = try TestSupport.makeTemporaryFolder("broker-state")
        return BrokerService(
            keychain: keychain,
            stateDirectory: ShellStateDirectory(root: root),
            folderProvider: { folder }
        )
    }

    func testValidatesAccountFormat() {
        XCTAssertNotNil(BrokerService.KeychainAccount("provider/openai/api-key"))
        XCTAssertNotNil(BrokerService.KeychainAccount("provider/anthropic/api-key"))
        XCTAssertNil(BrokerService.KeychainAccount(""))
        XCTAssertNil(BrokerService.KeychainAccount("provider"))
        XCTAssertNil(BrokerService.KeychainAccount("Provider/OpenAI"))
        XCTAssertNil(BrokerService.KeychainAccount("provider/openai/api-key/extra/again"))
        XCTAssertNil(BrokerService.KeychainAccount(String(repeating: "a", count: 201) + "/b"))
        XCTAssertNil(BrokerService.KeychainAccount("provider/openai/api key"))
    }

    func testKeychainGetReturnsOnlyFoundAndValue() throws {
        let service = try makeService(keychain: InMemoryKeychain(values: ["provider/openai/api-key": "secret"]))
        let reply = service.handle(
            route: ControlRoute.brokerKeychainGet,
            payload: .object(["account": .string("provider/openai/api-key")])
        )
        guard case .ok(let payload) = reply else {
            return XCTFail("預期成功")
        }
        XCTAssertEqual(payload.objectValue?.keys.sorted(), ["found", "value"])
        XCTAssertEqual(payload["found"]?.boolValue, true)

        let missing = service.handle(
            route: ControlRoute.brokerKeychainGet,
            payload: .object(["account": .string("provider/other/api-key")])
        )
        guard case .ok(let missingPayload) = missing else {
            return XCTFail("預期成功")
        }
        XCTAssertEqual(missingPayload.objectValue?.keys.sorted(), ["found"])
        XCTAssertEqual(missingPayload["found"]?.boolValue, false)
    }

    func testBadAccountIsUnavailable() throws {
        let service = try makeService(keychain: InMemoryKeychain(values: [:]))
        let reply = service.handle(
            route: ControlRoute.brokerKeychainGet,
            payload: .object(["account": .string("../etc/passwd")])
        )
        XCTAssertEqual(reply, .unavailable("account 格式不合法。"))
    }

    func testFolderGetReportsAvailability() throws {
        let service = try makeService(keychain: InMemoryKeychain(values: [:]))
        let reply = service.handle(route: ControlRoute.brokerFolderGet, payload: .object([:]))
        guard case .ok(let payload) = reply else {
            return XCTFail("預期成功")
        }
        XCTAssertEqual(payload["path"]?.stringValue, "/Users/test/Cardiary")
        XCTAssertEqual(payload["available"]?.boolValue, true)
        XCTAssertEqual(payload["volumeUUID"]?.stringValue, "VOL-1")
        XCTAssertNil(payload["reason"])
    }

    func testShellStateGetReturnsSizesOnly() throws {
        let service = try makeService(keychain: InMemoryKeychain(values: [:]))
        let reply = service.handle(route: ControlRoute.brokerShellStateGet, payload: .object([:]))
        guard case .ok(let payload) = reply else {
            return XCTFail("預期成功")
        }
        XCTAssertEqual(payload.objectValue?.keys.sorted(), ["limitBytes", "usedBytes"])
        XCTAssertEqual(payload["limitBytes"]?.intValue, 50 * 1024 * 1024)
    }

    func testUnknownBrokerRouteIsUnavailable() throws {
        let service = try makeService(keychain: InMemoryKeychain(values: [:]))
        XCTAssertEqual(
            service.handle(route: "broker.keychain.list", payload: .object([:])),
            .unavailable("不支援的路由。")
        )
    }
}

final class ShellLogTests: XCTestCase {
    func testTokenNeverReachesTheFile() throws {
        let directory = try TestSupport.makeTemporaryFolder("logs")
        let token = ControlToken.generate()
        let log = ShellLog(fileURL: directory.appendingPathComponent("shell-test.log"))
        log.addSecret(token.value)
        log.write("交握使用 Token \(token.value)，前綴 \(token.logPrefix)")
        log.write("另一個 43 字元的字串 \(String(repeating: "Z", count: 43)) 也要去掉")

        let contents = try String(contentsOf: logFile(in: directory), encoding: .utf8)
        XCTAssertFalse(contents.contains(token.value))
        XCTAssertTrue(contents.contains("<redacted>"))
        XCTAssertTrue(contents.contains(token.logPrefix))
        XCTAssertFalse(contents.contains(String(repeating: "Z", count: 43)))
        XCTAssertTrue(contents.contains("<redacted-token>"))
    }

    private func logFile(in directory: URL) -> URL {
        directory.appendingPathComponent("shell-test.log")
    }
}

final class RestartPolicyTests: XCTestCase {
    func testBackoffSequence() {
        let policy = RestartPolicy()
        XCTAssertEqual(policy.delay(afterFailure: 1), 0.25, accuracy: 0.001)
        XCTAssertEqual(policy.delay(afterFailure: 2), 0.5, accuracy: 0.001)
        XCTAssertEqual(policy.delay(afterFailure: 3), 1, accuracy: 0.001)
        XCTAssertEqual(policy.delay(afterFailure: 4), 2, accuracy: 0.001)
        XCTAssertEqual(policy.delay(afterFailure: 5), 4, accuracy: 0.001)
        XCTAssertEqual(policy.delay(afterFailure: 9), 4, accuracy: 0.001)
        XCTAssertTrue(policy.shouldRestart(consecutiveFailures: 10))
        XCTAssertFalse(policy.shouldRestart(consecutiveFailures: 11))
        XCTAssertTrue(policy.resetsFailures(uptime: 31))
        XCTAssertFalse(policy.resetsFailures(uptime: 29))
    }
}

final class ServiceLaunchPlanTests: XCTestCase {
    func testEnvironmentPointsTempAtFolderAndNeverCarriesTokens() throws {
        let folder = "/Volumes/Cardiary/Cardiary"
        let plan = ServiceLaunchPlan.make(
            nodeURL: URL(fileURLWithPath: "/Applications/Cardiary.app/Contents/Helpers/Node/node"),
            scriptURL: URL(fileURLWithPath: "/Applications/Cardiary.app/Contents/Resources/Service/service.mjs"),
            folderPath: folder,
            homeDirectory: "/Users/test"
        )
        let tmp = "\(folder)/tmp"
        XCTAssertEqual(plan.environment["TMPDIR"], tmp)
        XCTAssertEqual(plan.environment["TMP"], tmp)
        XCTAssertEqual(plan.environment["TEMP"], tmp)
        XCTAssertEqual(plan.environment["HOME"], "/Users/test")
        XCTAssertEqual(plan.environment["PATH"], "/usr/bin:/bin:/usr/sbin:/sbin")
        XCTAssertEqual(plan.arguments.count, 2)
        XCTAssertEqual(plan.arguments.first, "--disable-warning=ExperimentalWarning")
        XCTAssertEqual(plan.arguments.last, "/Applications/Cardiary.app/Contents/Resources/Service/service.mjs")

        let allValues = plan.environment.values.joined() + plan.arguments.joined()
        XCTAssertFalse(allValues.contains("token"))
        XCTAssertFalse(allValues.lowercased().contains("secret"))
    }

    func testServiceExitDescription() {
        XCTAssertEqual(ServiceExit(status: 9, wasSignaled: false).description, "exit 9")
        XCTAssertEqual(ServiceExit(status: SIGBUS, wasSignaled: true).description, "signal 10")
        XCTAssertTrue(ServiceExit(status: SIGBUS, wasSignaled: true).isBusError)
    }
}
