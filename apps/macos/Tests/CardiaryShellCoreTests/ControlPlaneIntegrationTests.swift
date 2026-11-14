import Foundation
import XCTest

@testable import CardiaryShellCore

/// 殼端控制面的端到端測試：真的子行程、真的 pipe、真的 NDJSON。
final class ControlPlaneIntegrationTests: XCTestCase {
    struct Running {
        let handle: ProcessServiceHandle
        let channel: ControlChannel
        let ready: ReadyMessage
        let controlToken: ControlToken
        let brokerToken: ControlToken
    }

    private func start(
        folder: URL,
        environment: [String: String] = [:],
        limits: ControlChannel.Limits = .default
    ) async throws -> Running {
        let plan = try TestSupport.plan(folder: folder, environment: environment)
        let handle = try ProcessServiceHandle(plan: plan)
        let control = ControlToken.generate()
        let broker = ControlToken.generate()
        let channel = ControlChannel(
            transport: handle,
            controlToken: control,
            brokerToken: broker,
            limits: limits
        )
        let ready = try await channel.handshake(folderPath: folder.path)
        return Running(
            handle: handle,
            channel: channel,
            ready: ready,
            controlToken: control,
            brokerToken: broker
        )
    }

    func testHandshakeHealthAndShutdown() async throws {
        let folder = try TestSupport.makeTemporaryFolder()
        let running = try await start(folder: folder)
        defer { running.handle.kill() }

        XCTAssertEqual(running.ready.pid, running.handle.pid)
        XCTAssertEqual(running.ready.clientPort, 49_152)
        XCTAssertEqual(running.ready.folderId, "01JCX8Q3W7Z9K5V2N4M6P8R0T1")

        let health = try await running.channel.request(route: ControlRoute.health, timeout: 2)
        XCTAssertEqual(health["state"]?.stringValue, "running")
        XCTAssertEqual(health["lifecycle"]?.stringValue, "idle")
        XCTAssertEqual(health["epoch"]?.stringValue, running.ready.epoch)

        let shutdown = try await running.channel.request(route: ControlRoute.shutdown, timeout: 2)
        XCTAssertEqual(shutdown["state"]?.stringValue, "closed")
        XCTAssertEqual(shutdown["cleanShutdown"]?.boolValue, true)

        // 收到回應之後才關 stdin；服務 flush 後才結束。
        running.handle.closeStdin()
        let exited = await waitForExit(running.handle, timeout: 3)
        XCTAssertTrue(exited, "收到 shutdown 後服務應該自行結束")
    }

    func testTokensTravelOnlyOnStdin() async throws {
        let folder = try TestSupport.makeTemporaryFolder()
        let running = try await start(folder: folder)
        defer { running.handle.kill() }

        let pid = running.handle.pid
        XCTAssertNotEqual(running.controlToken.value, running.brokerToken.value)

        let arguments = TestSupport.processArguments(pid: pid)
        let environment = TestSupport.processEnvironment(pid: pid)
        XCTAssertFalse(arguments.contains(running.controlToken.value), "控制 Token 不能出現在 argv")
        XCTAssertFalse(arguments.contains(running.brokerToken.value), "代理 Token 不能出現在 argv")
        XCTAssertFalse(environment.contains(running.controlToken.value), "控制 Token 不能出現在環境變數")
        XCTAssertFalse(environment.contains(running.brokerToken.value), "代理 Token 不能出現在環境變數")

        _ = try await running.channel.request(route: ControlRoute.shutdown, timeout: 2)
        running.handle.closeStdin()
        _ = await waitForExit(running.handle, timeout: 3)
    }

    func testServiceEnvironmentPointsTempAtFolder() async throws {
        let folder = try TestSupport.makeTemporaryFolder()
        let running = try await start(folder: folder)
        defer { running.handle.kill() }

        let environment = TestSupport.processEnvironment(pid: running.handle.pid)
        let tmp = folder.appendingPathComponent("tmp").path
        XCTAssertTrue(environment.contains("TMPDIR=\(tmp)"), "TMPDIR 應指向 <folder>/tmp：\(environment)")
        XCTAssertTrue(environment.contains("TMP=\(tmp)"))
        XCTAssertTrue(environment.contains("TEMP=\(tmp)"))

        _ = try await running.channel.request(route: ControlRoute.shutdown, timeout: 2)
        running.handle.closeStdin()
        _ = await waitForExit(running.handle, timeout: 3)
    }

    func testWrongHelloTokenClosesChannel() async throws {
        let folder = try TestSupport.makeTemporaryFolder()
        do {
            _ = try await start(folder: folder, environment: ["CARDIARY_DOUBLE_BAD_HELLO_TOKEN": "1"])
            XCTFail("brokerToken 不符時不能完成交握")
        } catch let error as ControlChannel.ChannelError {
            guard case .protocolViolation = error else {
                return XCTFail("預期協定錯誤，得到 \(error)")
            }
        }
    }

    func testWrongHelloPidClosesChannel() async throws {
        let folder = try TestSupport.makeTemporaryFolder()
        do {
            _ = try await start(folder: folder, environment: ["CARDIARY_DOUBLE_BAD_HELLO_PID": "1"])
            XCTFail("pid 不符時不能完成交握")
        } catch let error as ControlChannel.ChannelError {
            guard case .protocolViolation = error else {
                return XCTFail("預期協定錯誤，得到 \(error)")
            }
        }
    }

    func testMismatchedReplyToClosesChannel() async throws {
        let folder = try TestSupport.makeTemporaryFolder()
        let running = try await start(folder: folder, environment: ["CARDIARY_DOUBLE_BAD_REPLY": "1"])
        defer { running.handle.kill() }

        do {
            _ = try await running.channel.request(route: ControlRoute.health, timeout: 2)
            XCTFail("replyTo 對不上時不能當成成功")
        } catch let error as ControlChannel.ChannelError {
            guard case .protocolViolation = error else {
                return XCTFail("預期協定錯誤，得到 \(error)")
            }
        }
        XCTAssertEqual(running.channel.currentState, .closed)
    }

    func testOversizeFrameClosesChannel() async throws {
        let folder = try TestSupport.makeTemporaryFolder()
        let running = try await start(folder: folder, environment: ["CARDIARY_DOUBLE_OVERSIZE": "1"])
        defer { running.handle.kill() }

        try await TestSupport.waitUntil(timeout: 3, message: "超過上限的 frame 應關閉通道") {
            running.channel.currentState == .closed
        }
    }

    func testBrokerKeychainGetReturnsSingleItemWithoutMetadata() async throws {
        let folder = try TestSupport.makeTemporaryFolder()
        let plan = try TestSupport.plan(
            folder: folder,
            environment: ["CARDIARY_DOUBLE_BROKER_ACCOUNT": "provider/openai/api-key"]
        )
        let handle = try ProcessServiceHandle(plan: plan)
        let control = ControlToken.generate()
        let broker = ControlToken.generate()
        let channel = ControlChannel(
            transport: handle,
            controlToken: control,
            brokerToken: broker,
            limits: .default
        )

        let secret = "sk-test-SECRET-VALUE"
        let keychain = InMemoryKeychain(values: ["provider/openai/api-key": secret])
        let stateDirectory = ShellStateDirectory(root: folder.appendingPathComponent("shell-state"))
        let brokerService = BrokerService(
            keychain: keychain,
            stateDirectory: stateDirectory,
            folderProvider: { FolderSnapshot(state: .ready, path: folder.path, writable: true) }
        )
        channel.brokerHandler = { route, payload in
            brokerService.handle(route: route, payload: payload)
        }

        var stderrLines: [String] = []
        let lock = NSLock()
        handle.setLogHandler { line in
            lock.lock()
            stderrLines.append(line)
            lock.unlock()
        }

        _ = try await channel.handshake(folderPath: folder.path)
        defer { handle.kill() }

        try await TestSupport.waitUntil(timeout: 3, message: "等服務回報代理結果") {
            lock.lock()
            defer { lock.unlock() }
            return stderrLines.contains { $0.contains("broker-found=") }
        }

        lock.lock()
        let lines = stderrLines
        lock.unlock()
        XCTAssertTrue(lines.contains { $0.contains("broker-found=true") }, "應回 found=true")
        XCTAssertTrue(lines.contains { $0.contains("keys=found,value") }, "回應只能有 found 與 value")
        XCTAssertFalse(lines.contains { $0.contains(secret) }, "金鑰不能出現在服務日誌")
        XCTAssertFalse(lines.contains { $0.contains("length") || $0.contains("fingerprint") })
    }

    func testBrokerKeychainMissingAccountReturnsFoundFalse() async throws {
        let folder = try TestSupport.makeTemporaryFolder()
        let plan = try TestSupport.plan(
            folder: folder,
            environment: ["CARDIARY_DOUBLE_BROKER_ACCOUNT": "provider/missing/api-key"]
        )
        let handle = try ProcessServiceHandle(plan: plan)
        let channel = ControlChannel(
            transport: handle,
            controlToken: ControlToken.generate(),
            brokerToken: ControlToken.generate()
        )
        let brokerService = BrokerService(
            keychain: InMemoryKeychain(values: [:]),
            stateDirectory: ShellStateDirectory(root: folder),
            folderProvider: { FolderSnapshot(state: .ready, path: folder.path, writable: true) }
        )
        channel.brokerHandler = { route, payload in
            brokerService.handle(route: route, payload: payload)
        }

        var lines: [String] = []
        let lock = NSLock()
        handle.setLogHandler { line in
            lock.lock()
            lines.append(line)
            lock.unlock()
        }

        _ = try await channel.handshake(folderPath: folder.path)
        defer { handle.kill() }

        try await TestSupport.waitUntil(timeout: 3, message: "等服務回報代理結果") {
            lock.lock()
            defer { lock.unlock() }
            return lines.contains { $0.contains("broker-found=") }
        }
        lock.lock()
        let captured = lines
        lock.unlock()
        XCTAssertTrue(captured.contains { $0.contains("broker-found=false") })
        XCTAssertTrue(captured.contains { $0.contains("keys=found") })
    }

    func testControlPlaneHasNoListenerAndNoSocketPath() async throws {
        let folder = try TestSupport.makeTemporaryFolder()
        let running = try await start(folder: folder)
        defer { running.handle.kill() }

        let pid = running.handle.pid
        let listeners = TestSupport.run("/usr/sbin/lsof", ["-nP", "-a", "-p", "\(pid)", "-iTCP", "-sTCP:LISTEN"])
        XCTAssertTrue(
            listeners.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            "控制面不能有 TCP listener：\(listeners)"
        )

        let unixSockets = TestSupport.run("/usr/sbin/lsof", ["-nP", "-a", "-p", "\(pid)", "-U"])
        for line in unixSockets.split(separator: "\n") {
            XCTAssertFalse(line.contains("/"), "控制面不能有 socket 路徑：\(line)")
        }

        _ = try await running.channel.request(route: ControlRoute.shutdown, timeout: 2)
        running.handle.closeStdin()
        _ = await waitForExit(running.handle, timeout: 3)
    }

    func testClosingStdinEndsTheService() async throws {
        let folder = try TestSupport.makeTemporaryFolder()
        let plan = try TestSupport.plan(folder: folder)
        let handle = try ProcessServiceHandle(plan: plan)
        let channel = ControlChannel(
            transport: handle,
            controlToken: ControlToken.generate(),
            brokerToken: ControlToken.generate()
        )
        _ = try await channel.handshake(folderPath: folder.path)

        // 殼消失：只關 stdin，服務應自行結束（防孤兒的最後一道）。
        handle.closeStdin()
        let exited = await waitForExit(handle, timeout: 3)
        XCTAssertTrue(exited, "stdin 關閉後服務應結束")
        XCTAssertFalse(handle.isRunning)
    }

    func testUnsupportedRouteKeepsChannelOpen() async throws {
        let folder = try TestSupport.makeTemporaryFolder()
        let running = try await start(folder: folder)
        defer { running.handle.kill() }

        do {
            _ = try await running.channel.request(route: "control.delete_everything", timeout: 1)
            XCTFail("未知路由不能成功")
        } catch let error as ControlChannel.ChannelError {
            XCTAssertEqual(error, .unsupportedRoute("control.delete_everything"))
        }
        XCTAssertEqual(running.channel.currentState, .established)

        _ = try await running.channel.request(route: ControlRoute.shutdown, timeout: 2)
        running.handle.closeStdin()
        _ = await waitForExit(running.handle, timeout: 3)
    }

    func testDefaultDevServiceHandshakesWithClientPortZero() async throws {
        guard let node = TestSupport.nodeExecutable() else {
            throw XCTSkip("找不到 node，跳過預設服務的交握測試")
        }
        let folder = try TestSupport.makeTemporaryFolder()
        let script = TestSupport.devServiceScript
        XCTAssertTrue(FileManager.default.fileExists(atPath: script.path), "dev-service.mjs 必須存在")

        let tmp = folder.appendingPathComponent("tmp").path
        var arguments = ["--disable-warning=ExperimentalWarning", script.path]
        if node.path == "/usr/bin/env" {
            arguments.insert("node", at: 0)
        }
        let plan = ServiceLaunchPlan(
            executableURL: node,
            arguments: arguments,
            environment: [
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                "HOME": NSHomeDirectory(),
                "TMPDIR": tmp,
                "TMP": tmp,
                "TEMP": tmp,
            ],
            workingDirectory: folder
        )

        let handle = try ProcessServiceHandle(plan: plan)
        var stderrLines: [String] = []
        let lock = NSLock()
        handle.setLogHandler { line in
            lock.lock()
            stderrLines.append(line)
            lock.unlock()
        }
        let channel = ControlChannel(
            transport: handle,
            controlToken: ControlToken.generate(),
            brokerToken: ControlToken.generate()
        )
        defer { handle.kill() }

        let ready = try await channel.handshake(folderPath: folder.path)
        // 預設 bundle 的替身沒有客戶端協定，用 0 表示。
        XCTAssertEqual(ready.clientPort, 0)
        let health = try await channel.request(route: ControlRoute.health, timeout: 2)
        XCTAssertEqual(health["state"]?.stringValue, "running")

        let shutdown = try await channel.request(route: ControlRoute.shutdown, timeout: 2)
        XCTAssertEqual(shutdown["cleanShutdown"]?.boolValue, true)
        handle.closeStdin()
        let exited = await waitForExit(handle, timeout: 3)
        XCTAssertTrue(exited)

        lock.lock()
        let lines = stderrLines
        lock.unlock()
        XCTAssertFalse(lines.contains { $0.lowercased().contains("error") })
    }

    func testSupervisorAcceptsClientPortZero() async throws {
        guard let node = TestSupport.nodeExecutable() else {
            throw XCTSkip("找不到 node，跳過預設服務的監管測試")
        }
        let folder = try TestSupport.makeTemporaryFolder()
        let script = TestSupport.devServiceScript
        let tmp = folder.appendingPathComponent("tmp").path
        var arguments = ["--disable-warning=ExperimentalWarning", script.path]
        if node.path == "/usr/bin/env" {
            arguments.insert("node", at: 0)
        }
        let plan = ServiceLaunchPlan(
            executableURL: node,
            arguments: arguments,
            environment: [
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                "HOME": NSHomeDirectory(),
                "TMPDIR": tmp,
                "TMP": tmp,
                "TEMP": tmp,
            ],
            workingDirectory: folder
        )
        let statuses = StatusBox()
        let supervisor = ServiceSupervisor(
            configuration: ServiceSupervisorConfiguration(
                launchPlan: plan,
                healthInterval: 0.2,
                healthTimeout: 1,
                healthFailureThreshold: 3
            ),
            folder: FolderSnapshot(),
            brokerHandler: { _, _ in .ok(.object([:])) }
        )
        supervisor.onStatusChange = { statuses.append($0) }
        await supervisor.start(
            folder: FolderSnapshot(
                state: .ready,
                path: folder.path,
                displayName: folder.lastPathComponent,
                writable: true
            )
        )
        try await TestSupport.waitUntil(timeout: 8, message: "預設服務應進入執行中") {
            statuses.latest?.phase == .running
        }
        // clientPort 0 代表沒有客戶端協定，殼顯示 nil 而不是 0。
        XCTAssertNil(statuses.latest?.clientPort)
        _ = await supervisor.shutdown(reason: .shellExit)
    }

    private func waitForExit(_ handle: ProcessServiceHandle, timeout: TimeInterval) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if !handle.isRunning { return true }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return !handle.isRunning
    }
}

/// 測試用的記憶體鑰匙圈。
final class InMemoryKeychain: KeychainReading, @unchecked Sendable {
    private let values: [String: String]

    init(values: [String: String]) {
        self.values = values
    }

    func read(account: String) -> String? {
        values[account]
    }
}


/// 收集監管狀態。
final class StatusBox: @unchecked Sendable {
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
}
