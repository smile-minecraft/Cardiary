import CardiaryKit
import CardiaryShellCore
import Foundation
import XCTest

@testable import CardiaryApp

/// 用真的主機服務（假引擎與示範工具）跑一輪介面流程：
/// 開對話、送出訊息、收到審批、核准、看到工具結果與完成的回覆；
/// 以及全新資料夾的首次設定：新增供應商、寫入金鑰、設定主力模型、開對話、串流。
///
/// 這裡走的是介面的 view model，不是直接操作協定；`CardiaryShell` 把客戶端
/// 回呼轉給 `AppModel` 的那幾行由測試照樣接起來。GUI 的點擊步驟另外列在
/// 交付說明，因為測試環境沒有可操作的視窗伺服器。
@MainActor
final class RealServiceAppFlowTests: XCTestCase {
    private static var repositoryRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // App
            .deletingLastPathComponent()  // CardiaryAppTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // macos
            .deletingLastPathComponent()  // apps
            .deletingLastPathComponent()  // repo
    }

    func testFakeEngineApprovalFlowThroughAppModels() async throws {
        let harness = try await Self.startFakeService(scriptSteps: [[
            ["kind": "tool", "toolName": "demo.echo", "input": ["text": "示範工具"]],
            ["kind": "text", "text": "完成"],
        ]])
        defer {
            harness.supervisor.stopImmediately()
            Task { await harness.client.stop() }
        }

        let model = AppModel(setupCompleted: true)
        model.update(folder: FolderPresentation(
            availability: .ready,
            displayName: harness.folder.lastPathComponent,
            path: harness.folder.path
        ))
        Self.wire(harness.client, to: model)
        try await Self.connect(harness.client)
        await model.attach(service: harness.client)

        let created = await model.createConversation()
        XCTAssertNotNil(created, "建立對話失敗")
        XCTAssertEqual(model.selection, created.map { .conversation($0) })

        model.conversation.composerText = "請用示範工具"
        await model.conversation.send()

        // 檢視欄與選單列看的是同一份待審批：數量與內容都出現。
        try await Self.waitUntil(timeout: 30) { model.approvals.count == 1 }
        XCTAssertEqual(model.bridge.approvalCount, 1)
        let approval = try XCTUnwrap(model.approvals.requests.first)
        XCTAssertEqual(approval.toolName, "demo.echo")
        XCTAssertFalse(approval.options.isEmpty, "審批至少要有核准或拒絕其中一個選項")
        XCTAssertEqual(model.conversation.pendingApproval?.approvalId, approval.approvalId)

        await model.approvals.approve(approval)

        try await Self.waitUntil(timeout: 30) {
            model.conversation.items.contains {
                guard case .tool(let tool) = $0.kind else { return false }
                return tool.name == "demo.echo" && tool.status == .complete && tool.outputText == "示範工具"
            }
        }
        try await Self.waitUntil(timeout: 30) {
            model.conversation.items.contains {
                if case .assistantText(let text, _) = $0.kind { return text == "完成" }
                return false
            }
        }
        XCTAssertTrue(model.approvals.requests.isEmpty)
        XCTAssertEqual(model.bridge.approvalCount, 0)
        XCTAssertNil(model.conversation.pendingApproval, "決定之後不再顯示待審批")
        XCTAssertTrue(
            model.conversation.items.contains {
                if case .ui(let block) = $0.kind { return block.renderer == "demo.echo" }
                return false
            },
            "stream.ui 的結構化資料要變成畫面的一列"
        )
    }

    /// 全新資料夾：首次設定用真的 `system.models.get/set` 新增供應商、寫入金鑰、
    /// 設定主力模型，開第一場對話並收到串流與審批；設定頁三個分頁也從真的主機載入。
    func testFirstRunSetsMainModelAndOpensStreamingConversation() async throws {
        let harness = try await Self.startFakeService(scriptSteps: [[
            ["kind": "tool", "toolName": "demo.echo", "input": ["text": "第一次設定工具"]],
            ["kind": "text", "text": "第一次設定回覆"],
        ]])
        defer {
            harness.supervisor.stopImmediately()
            Task { await harness.client.stop() }
        }

        let keychain = FakeKeychain()
        let app = AppModel(keychain: keychain)
        app.update(folder: FolderPresentation(
            availability: .ready,
            displayName: harness.folder.lastPathComponent,
            path: harness.folder.path
        ))
        Self.wire(harness.client, to: app)
        try await Self.connect(harness.client)
        await app.attach(service: harness.client)

        XCTAssertEqual(app.firstRun.step, .model, "選好資料夾後進到設定主力模型")
        try await Self.waitUntil(timeout: 20) { !app.firstRun.isLoadingModels }
        XCTAssertTrue(app.firstRun.providers.isEmpty, "全新資料夾還沒有供應商")
        XCTAssertFalse(app.firstRun.canSave)

        // 用介面的模型設定新增一個本機供應商；金鑰只在這個行程內寫入替身鑰匙圈。
        app.firstRun.modelSettings.newProviderId = "local"
        app.firstRun.modelSettings.newProviderName = "本機"
        app.firstRun.modelSettings.newProviderKind = .local
        app.firstRun.modelSettings.newProviderBaseURL = "http://127.0.0.1:11434/v1"
        app.firstRun.modelSettings.newProviderModels = "llama"
        await app.firstRun.addProvider()

        XCTAssertEqual(app.firstRun.providers.map(\.providerId), ["local"])
        XCTAssertEqual(app.firstRun.selectedModelId, "llama")
        XCTAssertNil(app.firstRun.modelSettings.errorMessage)

        app.firstRun.modelSettings.beginCredentialEntry(for: "local")
        app.firstRun.modelSettings.credentialInput = "first-run-test-key"
        await app.firstRun.modelSettings.storeCredential(for: "local")
        XCTAssertEqual(keychain.value("cardiary/provider/local"), "first-run-test-key")

        await app.firstRun.saveMainModel()
        XCTAssertEqual(app.firstRun.step, .conversation)
        XCTAssertTrue(app.firstRun.savedMainModel)

        await app.startFirstConversation()
        XCTAssertEqual(app.screen, .main)
        XCTAssertTrue(app.firstRun.isComplete)

        app.conversation.composerText = "你好"
        await app.conversation.send()

        try await Self.waitUntil(timeout: 30) { app.approvals.count == 1 }
        let approval = try XCTUnwrap(app.approvals.requests.first)
        XCTAssertEqual(approval.toolName, "demo.echo")
        XCTAssertEqual(app.bridge.approvalCount, 1)
        await app.approvals.approve(approval)

        try await Self.waitUntil(timeout: 30) {
            app.conversation.items.contains {
                guard case .tool(let tool) = $0.kind else { return false }
                return tool.name == "demo.echo" && tool.status == .complete
            }
        }
        try await Self.waitUntil(timeout: 30) {
            app.conversation.items.contains {
                if case .assistantText(let text, _) = $0.kind { return text == "第一次設定回覆" }
                return false
            }
        }
        XCTAssertTrue(app.approvals.requests.isEmpty)
        XCTAssertEqual(app.bridge.approvalCount, 0)

        // 設定頁三個分頁都從真的主機載入，不顯示「設定請求失敗」的 placeholder。
        await app.settingsModel.models.load()
        XCTAssertNil(app.settingsModel.models.errorMessage)
        XCTAssertEqual(app.settingsModel.models.providers.map(\.providerId), ["local"])

        await app.settingsModel.general.load()
        XCTAssertNil(app.settingsModel.general.errorMessage)
        XCTAssertFalse(app.settingsModel.general.items.isEmpty)
        XCTAssertFalse(
            app.settingsModel.general.items.contains {
                $0.key == "models.providers" || $0.key == "models.roles"
            },
            "模型設定只在模型分頁，不在一般設定重複出現"
        )

        await app.settingsModel.modules.load()
        XCTAssertNil(app.settingsModel.modules.errorMessage)
        XCTAssertFalse(app.settingsModel.modules.modules.isEmpty)
    }

    // MARK: - 啟動主機服務

    private struct Harness {
        let folder: URL
        let supervisor: ServiceSupervisor
        let client: CardiaryClient
    }

    /// 與 `ShellController` 的接線相同：待審批清單、會話事件與 epoch 換代。
    private static func wire(_ client: CardiaryClient, to model: AppModel) {
        client.handlers.onApprovals = { requests in
            Task { @MainActor in model.update(approvals: requests) }
        }
        client.handlers.onSessionEvent = { frame in
            Task { @MainActor in model.handle(sessionEvent: frame) }
        }
        client.handlers.onEpochChange = { epoch in
            Task { @MainActor in await model.handleEpochChange(epoch: epoch) }
        }
    }

    private static func connect(_ client: CardiaryClient) async throws {
        await client.start()
        try await waitUntil(timeout: 20) {
            if case .connected = await client.currentState { return true }
            return false
        }
    }

    private static func startFakeService(scriptSteps: [[[String: Any]]]) async throws -> Harness {
        let hostEntry = repositoryRoot.appendingPathComponent("packages/host/dist/main.js")
        guard FileManager.default.fileExists(atPath: hostEntry.path) else {
            throw XCTSkip("找不到主機服務；先跑 pnpm build")
        }
        guard let node = nodeLaunch() else {
            throw XCTSkip("找不到 Node")
        }

        let folder = try makeTemporaryFolder()
        // 假引擎用記憶體儲存，不建立資料夾；主機仍要求 state/folder.json。
        let stateDirectory = folder.appendingPathComponent("state", isDirectory: true)
        try FileManager.default.createDirectory(at: stateDirectory, withIntermediateDirectories: true)
        let identity: [String: Any] = [
            "format": 1,
            "folderId": "01TESTFOLDER00000000000000",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "createdBy": "app-e2e",
        ]
        try JSONSerialization.data(withJSONObject: identity, options: [.prettyPrinted])
            .write(to: stateDirectory.appendingPathComponent("folder.json"))

        let scriptDirectory = try makeTemporaryFolder()
        let script = scriptDirectory.appendingPathComponent("script.json")
        try JSONSerialization.data(withJSONObject: scriptSteps).write(to: script)

        let tmp = folder.appendingPathComponent("tmp", isDirectory: true).path
        let plan = ServiceLaunchPlan(
            executableURL: node.executable,
            arguments: node.prefix + [
                hostEntry.path,
                "--engine", "fake",
                "--demo",
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
            brokerHandler: { _, _ in .unavailable("這個測試不需要代理") }
        )
        let tokenBox = TokenBox()
        supervisor.onClientToken = { tokenBox.set($0) }

        await supervisor.start(folder: supervisor.folderSnapshot)
        do {
            try await waitUntil(timeout: 30) { supervisor.snapshot.phase == .running }
        } catch {
            supervisor.stopImmediately()
            throw error
        }
        let token = try XCTUnwrap(tokenBox.current)
        let port = try XCTUnwrap(supervisor.snapshot.clientPort)

        let client = CardiaryClient(configuration: .init(
            endpoint: URL(string: "ws://127.0.0.1:\(port)/v1/ws")!,
            clientToken: token,
            client: ClientInfo(
                name: "cardiary-app-e2e",
                version: "0",
                platform: .macos,
                instanceId: "e2e-app-1"
            ),
            subscribeActiveSessions: false
        ))
        return Harness(folder: folder, supervisor: supervisor, client: client)
    }

    private static func nodeLaunch() -> (executable: URL, prefix: [String])? {
        if let override = ProcessInfo.processInfo.environment["CARDIARY_NODE"],
            FileManager.default.isExecutableFile(atPath: override)
        {
            return (URL(fileURLWithPath: override), [])
        }
        for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        where FileManager.default.isExecutableFile(atPath: candidate) {
            return (URL(fileURLWithPath: candidate), [])
        }
        return nil
    }

    private static func makeTemporaryFolder() throws -> URL {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("cardiary-app-e2e-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private static func waitUntil(
        timeout: TimeInterval,
        _ condition: @MainActor () async -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if await condition() { return }
            try await Task.sleep(nanoseconds: 25_000_000)
        }
        XCTFail("等待逾時")
        throw NSError(domain: "CardiaryAppE2E", code: 1)
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
