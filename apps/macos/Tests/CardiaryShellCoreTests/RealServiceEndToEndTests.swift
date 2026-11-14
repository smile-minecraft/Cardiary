import Foundation
import XCTest

import CardiaryKit

@testable import CardiaryShellCore

/// 殼的核心層啟動真正的 Pi Durable 主機服務，並用 CardiaryKit 連上跑完一場含審批的對話。
///
/// 這是「殼啟動真服務」的端到端驗證：控制面、client Token、客戶端協定與引擎
/// 都是正式實作，只有模型是腳本化的假供應商。GUI 的操作步驟另外列在
/// `docs/acceptance/chapter-13.md`。
final class RealServiceEndToEndTests: XCTestCase {
    private static var repositoryRoot: URL {
        // #filePath = <repo>/apps/macos/Tests/CardiaryShellCoreTests/<本檔>
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    private static var hostEntry: URL {
        repositoryRoot.appendingPathComponent("packages/host/dist/main.js")
    }

    func testShellCoreRunsRealServiceWithOneApproval() async throws {
        guard FileManager.default.fileExists(atPath: Self.hostEntry.path) else {
            throw XCTSkip("找不到 \(Self.hostEntry.path)；先跑 pnpm build")
        }
        guard let node = TestSupport.nodeExecutable() else {
            throw XCTSkip("找不到 Node；設定 CARDIARY_NODE 後再跑")
        }

        let folder = try TestSupport.makeTemporaryFolder()
        // 腳本不能放進資料夾：初始化要求資料夾只有空的子目錄。
        let scriptDirectory = try TestSupport.makeTemporaryFolder("script")
        let script = scriptDirectory.appendingPathComponent("script.json")
        let steps = [
            [
                ["kind": "tool", "toolName": "demo.echo", "input": ["text": "殼端工具"]],
                ["kind": "text", "text": "殼端完成"],
            ]
        ]
        let data = try JSONSerialization.data(withJSONObject: steps)
        try data.write(to: script)

        let tmp = folder.appendingPathComponent("tmp", isDirectory: true).path
        let plan = ServiceLaunchPlan(
            executableURL: node,
            arguments: [
                Self.hostEntry.path,
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
            brokerHandler: { _, _ in .unavailable("端到端測試沒有代理需求") }
        )
        let tokenBox = TokenBox()
        supervisor.onClientToken = { token in tokenBox.set(token) }
        defer {
            supervisor.stopImmediately()
        }

        await supervisor.start(folder: supervisor.folderSnapshot)
        try await TestSupport.waitUntil(timeout: 30, message: "服務沒有就緒") {
            supervisor.snapshot.phase == .running
        }
        let token = try XCTUnwrap(tokenBox.current, "服務沒有回報 client Token")
        let port = try XCTUnwrap(supervisor.snapshot.clientPort)
        XCTAssertEqual(supervisor.snapshot.phase, .running)

        let transport = WebSocketTransport(endpoint: URL(string: "ws://127.0.0.1:\(port)/v1/ws")!)
        let connection = CardiaryConnection(transport: transport, clientToken: token)
        defer {
            Task { await connection.close() }
        }
        let handshake = try await connection.open(
            client: ClientInfo(
                name: "cardiary-shell-e2e",
                version: "0",
                platform: .macos,
                instanceId: "e2e-1"
            )
        )
        XCTAssertFalse(handshake.epoch.isEmpty)
        XCTAssertEqual(handshake.serverName, "Cardiary 主機服務")

        let created = try await connection.createSession(
            clientRequestId: "e2e-1",
            title: "殼端對話"
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
            text: "殼端送出的訊息",
            clientMessageId: "e2e-message-1"
        )

        let approval = try await collector.waitFor(timeout: 30) { frame in
            if case .approvalRequestedEvent = frame { return true }
            return false
        }
        guard case .approvalRequestedEvent(let requested) = approval else {
            return XCTFail("收到的不是審批請求")
        }
        let decided = try await connection.decideApproval(
            approvalId: requested.payload.approvalId,
            optionId: "approve"
        )
        XCTAssertEqual(decided.effect, .approve)
        XCTAssertTrue(decided.persisted)

        let completed = try await collector.waitFor(timeout: 30) { frame in
            guard case .streamMessageCompletedEvent(let event) = frame else { return false }
            return event.payload.entry.text == "殼端完成"
        }
        guard case .streamMessageCompletedEvent(let event) = completed else {
            return XCTFail("收到的不是完成的訊息")
        }
        XCTAssertEqual(event.payload.entry.status, .complete)

        let toolResult = try await collector.first { frame in
            if case .streamToolResultEvent = frame { return true }
            return false
        }
        guard case .streamToolResultEvent(let result) = toolResult else {
            return XCTFail("沒有工具結果")
        }
        XCTAssertEqual(result.payload.status, .ok)
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

/// 收集連線事件；測試用輪詢等待，避免和 AsyncStream 的取消時序糾纏。
private actor FrameCollector {
    private var frames: [ServerFrame] = []

    func append(_ frame: ServerFrame) {
        frames.append(frame)
    }

    func first(_ predicate: (ServerFrame) -> Bool) -> ServerFrame? {
        frames.first(where: predicate)
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
            domain: "CardiaryE2E",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "等不到預期的 frame（已收到 \(frames.count) 則）"]
        )
    }
}
