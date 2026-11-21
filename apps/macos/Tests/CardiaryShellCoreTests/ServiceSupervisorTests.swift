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

    func testRemountAfterPauseKeepsSingleService() async throws {
        let harness = try makeHarness()
        await harness.supervisor.start(folder: readyFolder(harness.folder))
        try await waitForRunning(harness)
        let firstPID = try XCTUnwrap(harness.statuses.latest?.pid)
        let paused = await harness.supervisor.pause(reason: "unmount")
        XCTAssertEqual(paused, .completed)
        XCTAssertEqual(harness.statuses.latest?.phase, .paused)

        // 接回：殼會把資料夾標成可用，再呼叫 restartIfFolderUsable；暫停中不能啟動
        // 第二個行程。
        harness.supervisor.folderSnapshot = readyFolder(harness.folder)
        await harness.supervisor.restartIfFolderUsable()
        XCTAssertEqual(harness.statuses.latest?.phase, .paused)
        XCTAssertEqual(harness.statuses.latest?.pid, firstPID)
        XCTAssertTrue(processAlive(firstPID))

        let launchesBefore = harness.logs.all.filter { $0.contains("啟動服務 pid=") }.count
        let resumed = await harness.supervisor.resume(volumeUUID: "VOL-1")
        XCTAssertEqual(resumed, .completed)
        XCTAssertEqual(harness.statuses.latest?.phase, .running)
        XCTAssertEqual(harness.statuses.latest?.pid, firstPID, "接回要走 resume，不能換行程")
        let launchesAfter = harness.logs.all.filter { $0.contains("啟動服務 pid=") }.count
        XCTAssertEqual(launchesAfter, launchesBefore, "接回不能啟動第二個服務")
        _ = await harness.supervisor.shutdown(reason: .shellExit)
    }

    func testMaintenanceStateResetsAfterRestart() async throws {
        let marker = try TestSupport.makeTemporaryFolder("maintenance-marker")
            .appendingPathComponent("sent")
        let harness = try makeHarness(
            environment: [
                "CARDIARY_DOUBLE_MAINTENANCE_MS": "5000",
                "CARDIARY_DOUBLE_MAINTENANCE_ONCE": marker.path,
                "CARDIARY_DOUBLE_LOG_HEALTH": "1",
            ],
            healthInterval: 0.1,
            healthTimeout: 0.5
        )
        await harness.supervisor.start(folder: readyFolder(harness.folder))
        try await waitForRunning(harness)
        try await TestSupport.waitUntil(timeout: 3, message: "應進入維護狀態") {
            harness.statuses.latest?.maintenanceInProgress == true
        }
        let firstPID = try XCTUnwrap(harness.statuses.latest?.pid)
        let healthBefore = harness.logs.all.filter { $0.contains("service-double: health pid=") }.count

        // 維護中把服務殺掉：新行程不該繼承「維護中」，health 要恢復。
        kill(firstPID, SIGKILL)
        try await TestSupport.waitUntil(timeout: 5, message: "服務應重啟") {
            guard let latest = harness.statuses.latest else { return false }
            return latest.phase == .running && latest.pid > 0 && latest.pid != firstPID
        }
        XCTAssertEqual(harness.statuses.latest?.maintenanceInProgress, false)
        XCTAssertEqual(harness.statuses.latest?.lifecycle, "idle")

        try await TestSupport.waitUntil(timeout: 5, message: "重啟後 health 應恢復") {
            harness.logs.all.filter { $0.contains("service-double: health pid=") }.count > healthBefore
        }
        _ = await harness.supervisor.shutdown(reason: .shellExit)
    }

    func testPausedShutdownSkipsProtocolWhenVolumeChanged() async throws {
        let harness = try makeHarness()
        harness.supervisor.authorizedVolumeUUID = "VOL-RECORDED"
        await harness.supervisor.start(folder: readyFolder(harness.folder))
        try await waitForRunning(harness)
        let paused = await harness.supervisor.pause(reason: "unmount")
        XCTAssertEqual(paused, .completed)

        // 同一條路徑換成另一顆磁碟：不能送 control.shutdown。
        harness.supervisor.folderSnapshot = FolderSnapshot(
            state: .ready,
            path: harness.folder.path,
            displayName: harness.folder.lastPathComponent,
            volumeUUID: "VOL-OTHER",
            writable: true
        )
        let outcome = await harness.supervisor.shutdown(reason: .user)
        XCTAssertNil(outcome.cleanShutdown, "磁碟不符時不能回報 cleanShutdown")
        XCTAssertTrue(outcome.forcedTermination)
        XCTAssertEqual(harness.statuses.latest?.phase, .stopped)
        XCTAssertFalse(
            harness.logs.all.contains { $0.contains("服務回報關閉") },
            "磁碟不符時不能送出 control.shutdown"
        )
    }

    func testShutdownRetriesWhileBusy() async throws {
        let harness = try makeHarness(environment: ["CARDIARY_DOUBLE_PAUSE_MS": "600"])
        await harness.supervisor.start(folder: readyFolder(harness.folder))
        try await waitForRunning(harness)
        let pid = try XCTUnwrap(harness.statuses.latest?.pid)

        async let pause: LifecycleOutcome = harness.supervisor.pause(reason: "unmount")
        try await Task.sleep(nanoseconds: 100_000_000)
        let outcome = await harness.supervisor.shutdownRetryingWhileBusy(
            reason: .user,
            attempts: 8,
            delay: .milliseconds(200)
        )
        XCTAssertFalse(outcome.isBusy, "慢速 pause 結束後應該關得掉")
        let pauseResult = await pause
        XCTAssertEqual(pauseResult, .completed)
        XCTAssertEqual(harness.statuses.latest?.phase, .stopped)
        XCTAssertFalse(processAlive(pid))
    }

    func testMemoryLimitExit75RestartsWithoutCountingFailures() async throws {
        let folder = try TestSupport.makeTemporaryFolder("memory-limit-restart")
        let plan = ServiceLaunchPlan(
            executableURL: URL(fileURLWithPath: "/usr/bin/true"),
            arguments: [],
            environment: [:],
            workingDirectory: folder
        )
        let handles = FakeProcessRecorder()
        let statuses = StatusRecorder()
        let logs = LogRecorder()
        let supervisor = ServiceSupervisor(
            configuration: ServiceSupervisorConfiguration(
                launchPlan: plan,
                healthInterval: 60,
                restartPolicy: RestartPolicy(
                    baseDelay: 0.02,
                    maxDelay: 0.05,
                    maxConsecutiveFailures: 1,
                    stableWindow: 30
                )
            ),
            folder: FolderSnapshot(),
            brokerHandler: { _, _ in .ok(.object([:])) },
            launcher: { _ in handles.spawn() }
        )
        supervisor.onStatusChange = { statuses.append($0) }
        supervisor.onLog = { logs.append($0) }
        supervisors.append(supervisor)

        await supervisor.start(folder: readyFolder(folder))
        try await TestSupport.waitUntil(timeout: 5, message: "首次應進入執行中") {
            statuses.latest?.phase == .running
        }
        let first = try XCTUnwrap(handles.current)

        // 連續兩次以 exit 75 退出，即使 maxConsecutiveFailures=1 也必須重啟且不計失敗次數。
        first.simulateExit(ServiceExit(status: 75, wasSignaled: false))
        try await TestSupport.waitUntil(timeout: 5, message: "第一次 exit 75 後應自動重啟") {
            guard let latest = statuses.latest else { return false }
            return latest.phase == .running && latest.pid == 102
        }
        XCTAssertEqual(statuses.latest?.consecutiveFailures, 0)
        XCTAssertEqual(statuses.latest?.restarts, 1)

        let second = try XCTUnwrap(handles.current)
        second.simulateExit(ServiceExit(status: 75, wasSignaled: false))
        try await TestSupport.waitUntil(timeout: 5, message: "第二次 exit 75 後應仍可自動重啟") {
            guard let latest = statuses.latest else { return false }
            return latest.phase == .running && latest.pid == 103
        }
        XCTAssertEqual(statuses.latest?.consecutiveFailures, 0)
        XCTAssertEqual(statuses.latest?.restarts, 2)
        XCTAssertTrue(
            logs.all.contains { $0.contains("exit 75") },
            "日誌應記錄因記憶體上限自動重啟"
        )

        // 資料夾不可用時，即使收到 exit 75 也不得重啟，停在 unavailable。
        supervisor.folderSnapshot = FolderSnapshot(
            state: .unavailable,
            path: folder.path,
            writable: false
        )
        let third = try XCTUnwrap(handles.current)
        third.simulateExit(ServiceExit(status: 75, wasSignaled: false))
        try await TestSupport.waitUntil(timeout: 5, message: "資料夾不可用時 exit 75 應停在不可用") {
            statuses.latest?.phase == .unavailable
        }
        XCTAssertEqual(handles.count, 3)

        _ = await supervisor.shutdown(reason: .shellExit)
    }

    private func processAlive(_ pid: Int32) -> Bool {
        guard pid > 0 else { return false }
        return kill(pid, 0) == 0
    }
}

private final class FakeProcessRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var nextPID: Int32 = 100
    private var spawned: [FakeServiceProcessHandle] = []

    func spawn() -> FakeServiceProcessHandle {
        lock.lock()
        nextPID += 1
        let handle = FakeServiceProcessHandle(pid: nextPID)
        spawned.append(handle)
        lock.unlock()
        return handle
    }

    var current: FakeServiceProcessHandle? {
        lock.lock()
        defer { lock.unlock() }
        return spawned.last
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return spawned.count
    }
}

private final class FakeServiceProcessHandle: ServiceProcessHandle, @unchecked Sendable {
    let pid: Int32
    private let lock = NSLock()
    private var running = true
    private var dataHandler: (@Sendable (Data) -> Void)?
    private var logHandler: (@Sendable (String) -> Void)?
    private var exitHandler: (@Sendable (ServiceExit) -> Void)?
    private var buffer = Data()
    private var brokerToken = ""

    init(pid: Int32) {
        self.pid = pid
    }

    var isRunning: Bool {
        lock.lock()
        defer { lock.unlock() }
        return running
    }

    func setDataHandler(_ handler: @escaping @Sendable (Data) -> Void) {
        lock.lock()
        dataHandler = handler
        lock.unlock()
    }

    func setLogHandler(_ handler: @escaping @Sendable (String) -> Void) {
        lock.lock()
        logHandler = handler
        lock.unlock()
    }

    func setExitHandler(_ handler: @escaping @Sendable (ServiceExit) -> Void) {
        lock.lock()
        exitHandler = handler
        lock.unlock()
    }

    func write(_ data: Data) throws {
        var lines: [Data] = []
        lock.lock()
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 0x0A) {
            lines.append(buffer.subdata(in: buffer.startIndex..<newline))
            buffer.removeSubrange(buffer.startIndex...newline)
        }
        lock.unlock()

        for line in lines {
            handleFrame(line)
        }
    }

    func closeStdin() {}

    func terminate() {
        simulateExit(ServiceExit(status: 0, wasSignaled: false))
    }

    func kill() {
        simulateExit(ServiceExit(status: SIGKILL, wasSignaled: true))
    }

    func simulateExit(_ exit: ServiceExit) {
        let callback: (@Sendable (ServiceExit) -> Void)? = lock.withLock {
            guard running else { return nil }
            running = false
            return exitHandler
        }
        callback?(exit)
    }

    private func handleFrame(_ line: Data) {
        guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else {
            return
        }
        if object["type"] as? String == "init" {
            let token = (object["brokerToken"] as? String) ?? ""
            lock.withLock { brokerToken = token }
            emit([
                "type": "ready",
                "protocol": 1,
                "pid": Int(pid),
                "clientPort": 49_152,
                "folderId": "01JCX8Q3W7Z9K5V2N4M6P8R0T1",
                "epoch": "01JCX8Q3W7Z9K5V2N4M6P8R0T2",
            ])
            emit([
                "v": 1,
                "kind": "hello",
                "role": "host-service",
                "pid": Int(pid),
                "auth": ["token": token],
            ])
            return
        }
        guard object["kind"] as? String == "request",
            let id = object["id"] as? String,
            let route = object["route"] as? String
        else { return }
        let token = lock.withLock { brokerToken }
        if route == "control.shutdown" {
            emit([
                "v": 1,
                "kind": "response",
                "id": "res_\(id)",
                "replyTo": id,
                "auth": ["token": token],
                "ok": true,
                "payload": ["state": "closed", "cleanShutdown": true],
            ])
            simulateExit(ServiceExit(status: 0, wasSignaled: false))
        } else if route == "control.health" {
            emit([
                "v": 1,
                "kind": "response",
                "id": "res_\(id)",
                "replyTo": id,
                "auth": ["token": token],
                "ok": true,
                "payload": [
                    "state": "running",
                    "epoch": "01JCX8Q3W7Z9K5V2N4M6P8R0T2",
                    "uptimeSeconds": 0,
                    "folderId": "01JCX8Q3W7Z9K5V2N4M6P8R0T1",
                    "clientPort": 49_152,
                    "lifecycle": "idle",
                ],
            ])
        }
    }

    private func emit(_ object: [String: Any]) {
        guard var data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        else { return }
        data.append(0x0A)
        let handler = lock.withLock { dataHandler }
        handler?(data)
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
