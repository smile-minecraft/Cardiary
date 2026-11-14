import Foundation
import XCTest

import CardiaryKit

@testable import CardiaryShellCore

/// App bundle 內嵌的真主機服務：用 `Scripts/pack-service.sh` 打包，再用殼的
/// `ServiceSupervisor` 啟動，確認控制交握、client Token 與客戶端協定都可用。
///
/// 這不是 GUI 測試；GUI 的手動步驟在 `docs/acceptance/chapter-13.md`。
final class BundledServiceTests: XCTestCase {
    private static var repositoryRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    /// 打包後的服務會快取在 `apps/macos/build/service`；第一次跑會執行
    /// `pnpm deploy`，之後直接重用。
    private func packedService() throws -> URL {
        let service = Self.repositoryRoot.appendingPathComponent("apps/macos/build/service")
        let entry = service.appendingPathComponent("dist/main.js")
        if FileManager.default.fileExists(atPath: entry.path) {
            return service
        }
        let script = Self.repositoryRoot.appendingPathComponent("apps/macos/Scripts/pack-service.sh")
        guard FileManager.default.isExecutableFile(atPath: script.path) else {
            throw XCTSkip("找不到 pack-service.sh（\(script.path)）")
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [script.path, service.path]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        process.standardInput = FileHandle.nullDevice
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0,
            FileManager.default.fileExists(atPath: entry.path)
        else {
            throw XCTSkip(
                "打包主機服務失敗（\(process.terminationStatus)）："
                    + (String(data: data, encoding: .utf8) ?? "")
            )
        }
        return service
    }

    func testLaunchPlanInitializesEmptyFolder() {
        let plan = ServiceLaunchPlan.make(
            nodeURL: URL(fileURLWithPath: "/usr/bin/node"),
            scriptURL: URL(fileURLWithPath: "/Applications/Cardiary.app/Contents/Resources/Service/dist/main.js"),
            folderPath: "/tmp/Cardiary",
            initializeFolder: true
        )
        XCTAssertTrue(plan.arguments.contains("--initialize-folder"))

        let without = ServiceLaunchPlan.make(
            nodeURL: URL(fileURLWithPath: "/usr/bin/node"),
            scriptURL: URL(fileURLWithPath: "/tmp/main.js"),
            folderPath: "/tmp/Cardiary"
        )
        XCTAssertFalse(without.arguments.contains("--initialize-folder"))
    }

    func testPackedServiceHandshakesAndAnswersOneTurn() async throws {
        let service = try packedService()
        guard let node = TestSupport.nodeLaunch() else {
            throw XCTSkip("找不到 Node；設定 CARDIARY_NODE 後再跑")
        }
        let folder = try TestSupport.makeTemporaryFolder()
        let scriptDirectory = try TestSupport.makeTemporaryFolder("script")
        let script = scriptDirectory.appendingPathComponent("script.json")
        try JSONSerialization.data(withJSONObject: [[["kind": "text", "text": "打包服務回覆"]]])
            .write(to: script)

        let tmp = folder.appendingPathComponent("tmp", isDirectory: true).path
        let plan = ServiceLaunchPlan(
            executableURL: node.executable,
            arguments: node.prefix + [
                service.appendingPathComponent("dist/main.js").path,
                "--engine", "pi",
                "--demo",
                "--initialize-folder",
                "--script", script.path,
            ],
            environment: [
                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
                "HOME": NSHomeDirectory(),
                "TMPDIR": tmp,
                "TMP": tmp,
                "TEMP": tmp,
            ],
            workingDirectory: folder
        )
        let supervisor = ServiceSupervisor(
            configuration: ServiceSupervisorConfiguration(launchPlan: plan),
            folder: FolderSnapshot(
                state: .ready,
                path: folder.path,
                displayName: folder.lastPathComponent,
                writable: true
            ),
            brokerHandler: { _, _ in .unavailable("啟動測試沒有代理需求") }
        )
        let tokenBox = TokenBox()
        supervisor.onClientToken = { token in tokenBox.set(token) }
        defer { supervisor.stopImmediately() }

        await supervisor.start(folder: supervisor.folderSnapshot)
        try await TestSupport.waitUntil(timeout: 60, message: "打包的服務沒有就緒") {
            supervisor.snapshot.phase == .running
        }
        let token = try XCTUnwrap(tokenBox.current, "服務沒有回報 client Token")
        let port = try XCTUnwrap(supervisor.snapshot.clientPort)

        let connection = CardiaryConnection(
            transport: WebSocketTransport(
                endpoint: URL(string: "ws://127.0.0.1:\(port)/v1/ws")!
            ),
            clientToken: token
        )
        defer { Task { await connection.close() } }
        let handshake = try await connection.open(
            client: ClientInfo(
                name: "cardiary-bundled-service",
                version: "0",
                platform: .macos,
                instanceId: "bundled-1"
            )
        )
        XCTAssertFalse(handshake.epoch.isEmpty)

        let created = try await connection.createSession(
            clientRequestId: "bundled-1",
            title: "打包服務"
        )
        let sessionId = created.session.id
        _ = try await connection.subscribeSession(sessionId: sessionId)
        let collector = FrameCollector()
        let reading = Task {
            for await frame in connection.events {
                await collector.append(frame)
            }
        }
        defer { reading.cancel() }

        _ = try await connection.sendMessage(
            sessionId: sessionId,
            text: "打包服務測試",
            clientMessageId: "bundled-message-1"
        )
        let completed = try await collector.waitFor(timeout: 60) { frame in
            guard case .streamMessageCompletedEvent(let event) = frame else { return false }
            return event.payload.entry.text == "打包服務回覆"
        }
        guard case .streamMessageCompletedEvent(let event) = completed else {
            return XCTFail("收到的不是完成訊息")
        }
        XCTAssertEqual(event.payload.entry.status, .complete)
    }
}

private final class TokenBox: @unchecked Sendable {
    private let lock = NSLock()
    private var token: String?

    var current: String? {
        lock.lock()
        defer { lock.unlock() }
        return token
    }

    func set(_ value: String) {
        lock.lock()
        token = value
        lock.unlock()
    }
}

private actor FrameCollector {
    private var frames: [ServerFrame] = []

    func append(_ frame: ServerFrame) {
        frames.append(frame)
    }

    func waitFor(timeout: TimeInterval, _ predicate: (ServerFrame) -> Bool) async throws
        -> ServerFrame
    {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let frame = frames.first(where: predicate) {
                return frame
            }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        throw NSError(
            domain: "CardiaryBundledService",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "等不到預期的 frame（已收到 \(frames.count) 則）"]
        )
    }
}
