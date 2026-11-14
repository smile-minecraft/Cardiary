import Foundation
import XCTest

@testable import CardiaryShellCore

final class ServiceSupervisorTests: XCTestCase {
    private var supervisors: [ServiceSupervisor] = []

    override func tearDown() {
        for supervisor in supervisors {
            supervisor.stopImmediately()
        }
        supervisors.removeAll()
        super.tearDown()
    }

    private struct Harness {
        let supervisor: ServiceSupervisor
        let folder: URL
        let statuses: StatusRecorder
        let logs: LogRecorder
    }

    final class StatusRecorder: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [ServiceStatusSnapshot] = []

        func append(_ value: ServiceStatusSnapshot) {
            lock.lock()
            values.append(value)
            lock.unlock()
        }

        var latest: ServiceStatusSnapshot? {
            lock.lock()
            defer { lock.unlock() }
            return values.last
        }

        var all: [ServiceStatusSnapshot] {
            lock.lock()
            defer { lock.unlock() }
            return values
        }
    }

    final class LogRecorder: @unchecked Sendable {
        private let lock = NSLock()
        private var lines: [String] = []

        func append(_ line: String) {
            lock.lock()
            lines.append(line)
            lock.unlock()
        }

        var all: [String] {
            lock.lock()
            defer { lock.unlock() }
            return lines
        }
    }

    private func makeHarness(
        environment: [String: String] = [:],
        healthInterval: TimeInterval = 0.1,
        healthTimeout: TimeInterval = 0.5,
        healthFailureThreshold: Int = 3,
        pauseTimeout: TimeInterval = 2,
        resumeTimeout: TimeInterval = 2,
        shutdownTimeout: TimeInterval = 2,
        terminateGrace: TimeInterval = 1,
        restartPolicy: RestartPolicy = RestartPolicy(
            baseDelay: 0.05,
            maxDelay: 0.1,
            maxConsecutiveFailures: 10,
            stableWindow: 30
        )
    ) throws -> Harness {
        let folder = try TestSupport.makeTemporaryFolder()
        let plan = try TestSupport.plan(folder: folder, environment: environment)
        let configuration = ServiceSupervisorConfiguration(
            launchPlan: plan,
            channelLimits: ControlChannel.Limits(
                maxFrameBytes: 65_536,
                readyTimeout: 3,
                helloTimeout: 2,
                defaultRequestTimeout: 2
            ),
            healthInterval: healthInterval,
            healthTimeout: healthTimeout,
            healthFailureThreshold: healthFailureThreshold,
            pauseTimeout: pauseTimeout,
            resumeTimeout: resumeTimeout,
            shutdownTimeout: shutdownTimeout,
            terminateGrace: terminateGrace,
            restartPolicy: restartPolicy
        )
        let statuses = StatusRecorder()
        let logs = LogRecorder()
        let supervisor = ServiceSupervisor(
            configuration: configuration,
            folder: FolderSnapshot(),
            brokerHandler: { _, _ in .ok(.object([:])) }
        )
        supervisor.onStatusChange = { snapshot in statuses.append(snapshot) }
        supervisor.onLog = { line in logs.append(line) }
        supervisors.append(supervisor)
        return Harness(supervisor: supervisor, folder: folder, statuses: statuses, logs: logs)
    }

    private var readyFolder: (URL) -> FolderSnapshot {
        { url in
            FolderSnapshot(
                state: .ready,
                path: url.path,
                displayName: url.lastPathComponent,
                writable: true
            )
        }
    }

    private func waitForRunning(_ harness: Harness) async throws {
        try await TestSupport.waitUntil(timeout: 5, message: "服務應進入執行中") {
            harness.statuses.latest?.phase == .running
        }
    }

    func testStartsAndReportsRunning() async throws {
        let harness = try makeHarness()
        await harness.supervisor.start(folder: readyFolder(harness.folder))
        try await waitForRunning(harness)

        let snapshot = try XCTUnwrap(harness.statuses.latest)
        XCTAssertGreaterThan(snapshot.pid, 0)
        XCTAssertEqual(snapshot.epoch, "01JCX8Q3W7Z9K5V2N4M6P8R0T2")
        XCTAssertEqual(snapshot.clientPort, 49_152)
        XCTAssertEqual(snapshot.folderId, "01JCX8Q3W7Z9K5V2N4M6P8R0T1")
        _ = await harness.supervisor.shutdown(reason: .shellExit)
    }

    func testRestartsAfterForcedKill() async throws {
        let harness = try makeHarness()
        await harness.supervisor.start(folder: readyFolder(harness.folder))
        try await waitForRunning(harness)
        let firstPID = try XCTUnwrap(harness.statuses.latest?.pid)

        kill(firstPID, SIGKILL)
        try await TestSupport.waitUntil(timeout: 5, message: "服務被殺掉後應自動重啟") {
            guard let latest = harness.statuses.latest else { return false }
            return latest.phase == .running && latest.pid > 0 && latest.pid != firstPID
        }
        XCTAssertGreaterThanOrEqual(harness.statuses.latest?.restarts ?? 0, 1)
        XCTAssertFalse(
            harness.logs.all.contains { $0.contains("資料夾不可用，不重啟服務") },
            "資料夾仍可用時應該重啟"
        )
        _ = await harness.supervisor.shutdown(reason: .shellExit)
    }

    func testShutdownLeavesNoProcess() async throws {
        let harness = try makeHarness()
        await harness.supervisor.start(folder: readyFolder(harness.folder))
        try await waitForRunning(harness)
        let pid = try XCTUnwrap(harness.statuses.latest?.pid)

        let outcome = await harness.supervisor.shutdown(reason: .user)
        XCTAssertEqual(outcome.cleanShutdown, true)
        XCTAssertFalse(outcome.forcedTermination)
        XCTAssertFalse(processAlive(pid), "關閉後不能殘留服務行程")
        XCTAssertEqual(harness.statuses.latest?.phase, .stopped)
    }

    func testPauseAndResumeKeepEpoch() async throws {
        let harness = try makeHarness()
        await harness.supervisor.start(folder: readyFolder(harness.folder))
        try await waitForRunning(harness)
        let epoch = try XCTUnwrap(harness.statuses.latest?.epoch)

        let pause = await harness.supervisor.pause(reason: "unmount")
        XCTAssertEqual(pause, .completed)
        XCTAssertEqual(harness.statuses.latest?.phase, .paused)

        let resume = await harness.supervisor.resume(volumeUUID: "VOL-1")
        XCTAssertEqual(resume, .completed)
        XCTAssertEqual(harness.statuses.latest?.phase, .running)
        XCTAssertEqual(harness.statuses.latest?.epoch, epoch, "pause／resume 不能換 epoch")
        _ = await harness.supervisor.shutdown(reason: .shellExit)
    }

    func testSecondLifecycleRequestIsBusy() async throws {
        let harness = try makeHarness(environment: ["CARDIARY_DOUBLE_PAUSE_MS": "600"])
        await harness.supervisor.start(folder: readyFolder(harness.folder))
        try await waitForRunning(harness)

        async let pause: LifecycleOutcome = harness.supervisor.pause(reason: "unmount")
        try await Task.sleep(nanoseconds: 100_000_000)
        let resume = await harness.supervisor.resume(volumeUUID: nil)
        XCTAssertEqual(resume, .busy, "生命週期請求不能並行")
        let pauseResult = await pause
        XCTAssertEqual(pauseResult, .completed)
        _ = await harness.supervisor.shutdown(reason: .shellExit)
    }

    func testSlowPauseIsNotKilledByHealthChecks() async throws {
        let harness = try makeHarness(
            environment: ["CARDIARY_DOUBLE_PAUSE_MS": "600"],
            healthInterval: 0.1,
            healthTimeout: 0.05,
            healthFailureThreshold: 2
        )
        await harness.supervisor.start(folder: readyFolder(harness.folder))
        try await waitForRunning(harness)
        let pid = try XCTUnwrap(harness.statuses.latest?.pid)

        let pause = await harness.supervisor.pause(reason: "unmount")
        XCTAssertEqual(pause, .completed)
        XCTAssertTrue(processAlive(pid), "慢速 pause 不能被健康檢查殺掉")
        XCTAssertEqual(harness.statuses.latest?.phase, .paused)
        _ = await harness.supervisor.shutdown(reason: .shellExit)
    }

    func testMaintenanceSuspendsHealthChecks() async throws {
        let harness = try makeHarness(
            environment: ["CARDIARY_DOUBLE_MAINTENANCE_MS": "700"],
            healthInterval: 0.1,
            healthTimeout: 0.05,
            healthFailureThreshold: 2
        )
        await harness.supervisor.start(folder: readyFolder(harness.folder))
        try await waitForRunning(harness)
        let pid = try XCTUnwrap(harness.statuses.latest?.pid)

        try await TestSupport.waitUntil(timeout: 3, message: "應進入維護狀態") {
            harness.statuses.latest?.maintenanceInProgress == true
        }
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertTrue(processAlive(pid), "維護期間不能因 health 逾時殺掉服務")
        XCTAssertEqual(harness.statuses.latest?.phase, .running)

        try await TestSupport.waitUntil(timeout: 3, message: "維護結束後恢復") {
            harness.statuses.latest?.maintenanceInProgress == false
        }
        _ = await harness.supervisor.shutdown(reason: .shellExit)
    }

    func testFolderUnavailableDoesNotSpawn() async throws {
        let folder = try TestSupport.makeTemporaryFolder()
        let plan = try TestSupport.plan(folder: folder)
        let statuses = StatusRecorder()
        let launches = LaunchCounter()
        let supervisor = ServiceSupervisor(
            configuration: ServiceSupervisorConfiguration(launchPlan: plan),
            folder: FolderSnapshot(state: .unavailable),
            brokerHandler: { _, _ in .ok(.object([:])) },
            launcher: { plan in
                launches.increment()
                return try ProcessServiceHandle(plan: plan)
            }
        )
        supervisor.onStatusChange = { statuses.append($0) }
        supervisors.append(supervisor)

        await supervisor.start(
            folder: FolderSnapshot(state: .unavailable, path: folder.path, writable: false)
        )
        XCTAssertEqual(launches.count, 0, "資料夾不可用時不能啟動服務")
        XCTAssertEqual(statuses.latest?.phase, .unavailable)
    }

    func testExitWithUnavailableFolderDoesNotRestart() async throws {
        let harness = try makeHarness()
        await harness.supervisor.start(folder: readyFolder(harness.folder))
        try await waitForRunning(harness)
        let pid = try XCTUnwrap(harness.statuses.latest?.pid)

        harness.supervisor.folderSnapshot = FolderSnapshot(
            state: .unavailable,
            path: harness.folder.path,
            writable: false
        )
        kill(pid, SIGKILL)

        try await TestSupport.waitUntil(timeout: 5, message: "資料夾不可用時應停在不可用") {
            harness.statuses.latest?.phase == .unavailable
        }
        XCTAssertEqual(harness.statuses.latest?.pid, 0)
        XCTAssertFalse(
            harness.logs.all.contains { $0.contains("秒後重啟服務") },
            "資料夾不可用時不能排程重啟"
        )
    }

    func testShutdownWhilePausedReportsCleanShutdown() async throws {
        let harness = try makeHarness()
        await harness.supervisor.start(folder: readyFolder(harness.folder))
        try await waitForRunning(harness)
        let paused = await harness.supervisor.pause(reason: "unmount")
        XCTAssertEqual(paused, .completed)

        let outcome = await harness.supervisor.shutdown(reason: .user)
        XCTAssertEqual(outcome.cleanShutdown, true)
        XCTAssertEqual(harness.statuses.latest?.phase, .stopped)
    }

    private func processAlive(_ pid: Int32) -> Bool {
        guard pid > 0 else { return false }
        return kill(pid, 0) == 0
    }
}

final class LaunchCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func increment() {
        lock.lock()
        value += 1
        lock.unlock()
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}
