import CardiaryKit
import CardiaryShellCore
import Foundation
import XCTest

@testable import CardiaryApp

/// 用真的外部代理 CLI 協定（ACP）跑介面流程的假代理。
///
/// 只替代不可控的 opencode CLI；橋接層、沙盒、訊息正規化、審批、狀態都是
/// 真的產品路徑。假代理把執行事件寫進工作目錄的 `agent.log`，測試用它證明
/// 「核准前沒有 spawn」與「核准後真的執行」。
private final class FakeExternalAgent {
    let workingDirectory: URL
    let logFile: URL
    let command: URL

    private init(workingDirectory: URL, logFile: URL, command: URL) {
        self.workingDirectory = workingDirectory
        self.logFile = logFile
        self.command = command
    }

    static func install(node: URL, steps: [String]) throws -> FakeExternalAgent {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("cardiary-fake-agent-\(UUID().uuidString)", isDirectory: true)
        let work = root.appendingPathComponent("work", isDirectory: true)
        try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)

        let logFile = work.appendingPathComponent("agent.log")

        // plan.json 必須跟 agent.mjs 同目錄（mjs 用 import.meta.url 找它）。
        let scriptDir = root.appendingPathComponent("script", isDirectory: true)
        try FileManager.default.createDirectory(at: scriptDir, withIntermediateDirectories: true)
        let plan = scriptDir.appendingPathComponent("plan.json")
        let planBody: [String: Any] = [
            "logFile": logFile.path,
            "steps": steps,
        ]
        try JSONSerialization.data(withJSONObject: planBody).write(to: plan)

        let script = scriptDir.appendingPathComponent("agent.mjs")
        try Self.agentSource.write(to: script, atomically: true, encoding: .utf8)

        // 把 node/腳本/plan 的絕對路徑寫死，避免沙盒行程遺失環境變數。
        let wrapper = root.appendingPathComponent("opencode")
        let wrapperBody = "#!/bin/sh\nexec \"\(node.path)\" \"\(script.path)\" \"$@\"\n"
        try wrapperBody.write(to: wrapper, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: wrapper.path)

        return FakeExternalAgent(workingDirectory: work, logFile: logFile, command: wrapper)
    }

    /// 假代理只說 opencode 真正的 ACP 協定（JSON-RPC over NDJSON）；橋接層
    /// 不認識「假的」格式，所以走的是產品路徑。把執行事件寫進 `logFile`，
    /// 測試用它證明核准前有沒有 spawn、核准後有沒有真的執行。
    private static let agentSource = """
    import { appendFileSync, readFileSync } from "node:fs";
    import { createInterface } from "node:readline";

    const plan = JSON.parse(readFileSync(new URL("./plan.json", import.meta.url), "utf8"));
    const log = (entry) =>
      appendFileSync(plan.logFile, JSON.stringify({ at: Date.now(), ...entry }) + "\\n");
    const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");

    log({ event: "start", pid: process.pid });

    function finish() {
      send({ jsonrpc: "2.0", id: 100, result: { stopReason: "end_turn" } });
      log({ event: "completed" });
      setInterval(() => undefined, 1000);
    }

    function runAcpPrompt() {
      log({ event: "prompt" });
      if (plan.steps && plan.steps.length > 0) {
        send({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "sess_fake",
            update: {
              sessionUpdate: "plan",
              entries: plan.steps.map((content, i) => ({
                content,
                status: i === 0 ? "completed" : "in_progress",
              })),
            },
          },
        });
        log({ event: "progress" });
      }
      finish();
    }

    function handleAcp(frame) {
      if (frame.method === "initialize") {
        send({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: 1, agentCapabilities: {} } });
      } else if (frame.method === "session/new") {
        send({ jsonrpc: "2.0", id: frame.id, result: { sessionId: "sess_fake" } });
      } else if (frame.method === "session/set_config_option") {
        send({ jsonrpc: "2.0", id: frame.id, result: {} });
      } else if (frame.method === "session/cancel") {
        log({ event: "cancel" });
        setTimeout(() => process.exit(0), 10);
      } else if (frame.method === "session/prompt") {
        runAcpPrompt();
      }
    }

    const lines = createInterface({ input: process.stdin });
    lines.on("line", (line) => {
      const text = line.trim();
      if (!text) return;
      try {
        handleAcp(JSON.parse(text));
      } catch {
        log({ event: "bad-frame" });
      }
    });
    lines.on("close", () => {
      log({ event: "stdin-closed" });
      process.exit(0);
    });
    """

    func loggedEvents() -> [[String: Any]] {
        guard let text = try? String(contentsOf: logFile, encoding: .utf8) else { return [] }
        return text
            .split(separator: "\n")
            .compactMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
    }

    func hasEvent(_ name: String) -> Bool {
        loggedEvents().contains { ($0["event"] as? String) == name }
    }
}

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

    /// 從 App 啟動外部代理，狀態卡出現啟動審批；核准前假行程沒被 spawn，
    /// 按「核准」後假行程才執行並回報完成。整條路徑用真 host + 真
    /// CardiaryClient + 真 AppModel/AgentModel，只替換不可控的 opencode CLI。
    func testExternalAgentStartApprovalFromApp() async throws {
        guard let node = Self.nodeLaunch() else { throw XCTSkip("找不到 Node") }
        let fake = try FakeExternalAgent.install(node: node.executable, steps: ["整理結果"])
        let harness = try await Self.startFakeService(
            scriptSteps: [],
            extraEnvironment: ["CARDIARY_AGENT_COMMAND_OPENCODE": fake.command.path]
        )
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

        // 從 AgentModel 啟動，不是直接打協定。
        let started = await model.agents.start(
            agentKind: .opencode,
            workingDirectory: fake.workingDirectory.path,
            prompt: "整理結果"
        )
        XCTAssertTrue(started, "AgentModel.start 失敗：\(model.agents.errorMessage ?? "")")

        // 狀態卡出現啟動審批：pendingPermission 帶核准鈕需要的 approvalId。
        try await Self.waitUntil(timeout: 30) {
            model.agents.sessions.contains { session in
                session.status == .waitingApproval && session.pendingPermission != nil
            }
        }
        let waiting = try XCTUnwrap(
            model.agents.sessions.first { $0.status == .waitingApproval && $0.pendingPermission != nil }
        )
        let permission = try XCTUnwrap(waiting.pendingPermission)
        XCTAssertEqual(permission.toolName, "opencode-acp")
        XCTAssertTrue(permission.description?.contains(fake.workingDirectory.path) == true,
                      "啟動審批要顯示來源工作目錄")
        XCTAssertTrue(fake.loggedEvents().isEmpty, "核准前不該 spawn 假代理")

        // reload 仍看到同一個審批，且沒有重複的會話。
        await model.agents.reload()
        let afterReload = model.agents.sessions.filter { $0.agentSessionId == waiting.agentSessionId }
        XCTAssertEqual(afterReload.count, 1, "重載不該產生重複會話")
        XCTAssertEqual(afterReload.first?.pendingPermission?.approvalId, permission.approvalId,
                       "重載後仍是同一個審批")

        // 從 AgentModel 核准。
        await model.agents.approve(waiting)
        XCTAssertNil(model.agents.errorMessage, "核准不該出錯：\(model.agents.errorMessage ?? "")")

        // 核准後假行程真的被 spawn 並完成。
        try await Self.waitUntil(timeout: 30) { fake.hasEvent("start") }
        try await Self.waitUntil(timeout: 30) { fake.hasEvent("completed") }
        try await Self.waitUntil(timeout: 30) {
            model.agents.sessions.contains {
                $0.agentSessionId == waiting.agentSessionId && $0.status == .stopped
            }
        }
    }

    /// 拒絕啟動審批後假行程完全沒被 spawn；重連後仍看得到尚未決定的審批。
    func testExternalAgentRejectAndReconnectKeepsApproval() async throws {
        guard let node = Self.nodeLaunch() else { throw XCTSkip("找不到 Node") }
        let fake = try FakeExternalAgent.install(node: node.executable, steps: ["整理結果"])
        let harness = try await Self.startFakeService(
            scriptSteps: [],
            extraEnvironment: ["CARDIARY_AGENT_COMMAND_OPENCODE": fake.command.path]
        )
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

        let started = await model.agents.start(
            agentKind: .opencode,
            workingDirectory: fake.workingDirectory.path,
            prompt: "整理結果"
        )
        XCTAssertTrue(started)
        try await Self.waitUntil(timeout: 30) {
            model.agents.sessions.contains {
                $0.status == .waitingApproval && $0.pendingPermission != nil
            }
        }
        let waiting = try XCTUnwrap(
            model.agents.sessions.first { $0.status == .waitingApproval && $0.pendingPermission != nil }
        )

        // 重連：新 client 連到同一個 host，仍看得到同一個審批，且沒有重複會話。
        let second = try await Self.connectSecondClient(like: harness)
        defer { Task { await second.stop() } }
        let reconnected = AppModel(setupCompleted: true)
        reconnected.update(folder: FolderPresentation(
            availability: .ready,
            displayName: harness.folder.lastPathComponent,
            path: harness.folder.path
        ))
        Self.wire(second, to: reconnected)
        await reconnected.attach(service: second)
        try await Self.waitUntil(timeout: 30) {
            reconnected.agents.isKnown &&
            reconnected.agents.sessions.contains {
                $0.status == .waitingApproval && $0.pendingPermission != nil
            }
        }
        let reconnectedWaiting = try XCTUnwrap(
            reconnected.agents.sessions.first { $0.status == .waitingApproval }
        )
        XCTAssertEqual(reconnectedWaiting.pendingPermission?.approvalId,
                       waiting.pendingPermission?.approvalId)
        XCTAssertEqual(reconnected.agents.sessions.filter { $0.agentSessionId == waiting.agentSessionId }.count, 1)

        // 拒絕後假行程完全沒執行。
        await reconnected.agents.reject(reconnectedWaiting)
        try await Self.waitUntil(timeout: 30) {
            reconnected.agents.sessions.contains {
                $0.agentSessionId == waiting.agentSessionId && $0.status == .failed
            }
        }
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertFalse(fake.hasEvent("start"), "拒絕後不該 spawn 假代理")
    }

    // MARK: - 啟動主機服務

    private struct Harness {
        let folder: URL
        let supervisor: ServiceSupervisor
        let client: CardiaryClient
        let port: UInt16
        let token: String
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

    private static func startFakeService(
        scriptSteps: [[[String: Any]]],
        extraEnvironment: [String: String] = [:]
    ) async throws -> Harness {
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
            ].merging(extraEnvironment) { _, new in new },
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
        return Harness(folder: folder, supervisor: supervisor, client: client, port: port, token: token)
    }

    /// 開一條連到同一個 host 的新客戶端，模擬 App 斷線重連。
    private static func connectSecondClient(like harness: Harness) async throws -> CardiaryClient {
        let client = CardiaryClient(configuration: .init(
            endpoint: URL(string: "ws://127.0.0.1:\(harness.port)/v1/ws")!,
            clientToken: harness.token,
            client: ClientInfo(
                name: "cardiary-app-e2e",
                version: "0",
                platform: .macos,
                instanceId: "e2e-app-2"
            ),
            subscribeActiveSessions: false
        ))
        try await connect(client)
        return client
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
