import CardiaryKit
import CardiaryShellCore
import Foundation
import XCTest

@testable import CardiaryApp

/// 用真的主機服務跑一次匯入流程：選來源（合成資料夾）、預覽、勾選、寫入。
///
/// 走的是介面的 view model 與真的 `module.import.*`；GUI 的點擊與截圖另外列在
/// 交付說明，因為測試環境沒有可操作的視窗伺服器。
@MainActor
final class ImportRealHostTests: XCTestCase {
    func testGenericImportThroughRealHostCreatesCardsAndSecondRunCreatesNothing() async throws {
        let harness = try await Self.startFakeService()
        defer {
            harness.supervisor.stopImmediately()
            Task { await harness.client.stop() }
        }

        let source = try Self.makeTemporaryFolder(prefix: "cardiary-import-source")
        try Self.write("# 人格\n\n語氣溫和，先講結論。\n", to: source, name: "persona.md")
        try Self.write("# 記憶\n\n- 喜歡喝咖啡\n- 住在新竹\n", to: source, name: "memory.md")
        try Self.write("# 規則\n\n先確認再動手。\n", to: source, name: "rules.md")

        let model = ImportFlowModel(service: ModuleImportService(sender: harness.client))
        await model.load()
        XCTAssertNil(model.errorMessage)
        XCTAssertTrue(model.sources.contains { $0.kind == .generic && $0.available })

        await model.chooseSource(kind: .generic, path: source.path)
        XCTAssertEqual(
            model.files.map(\.relativePath).sorted(),
            ["memory.md", "persona.md", "rules.md"]
        )
        model.setCategory(.persona, for: "persona.md")
        model.setCategory(.memory, for: "memory.md")
        model.setCategory(.rule, for: "rules.md")

        await model.preview()
        XCTAssertNil(model.errorMessage)
        let preview = try XCTUnwrap(model.preview, "預覽失敗：\(model.errorMessage ?? "")")
        XCTAssertEqual(preview.newCards, 4, "人格 1、記憶 2、操作規則 1")
        XCTAssertEqual(preview.duplicates, 0)
        XCTAssertTrue(preview.skipped.isEmpty, "三個檔案都指定了類別，不該被跳過")

        // 人格預設不勾，要使用者過目；這裡模擬使用者勾起來。
        let personaKey = try XCTUnwrap(
            preview.items.first { $0.category == .persona }?.key
        )
        XCTAssertFalse(model.selectedKeys.contains(personaKey))
        model.setSelected(personaKey, true)
        XCTAssertEqual(model.selectedCardCount, 4)

        await model.write()
        XCTAssertNil(model.errorMessage)
        let result = try XCTUnwrap(model.result, "寫入失敗：\(model.errorMessage ?? "")")
        XCTAssertEqual(result.cardsCreated, 4)
        XCTAssertEqual(result.duplicates, 0)

        // 寫入的卡片是真的檔案，索引也已經補掃。
        let cardFiles = try Self.cardFiles(in: harness.folder)
        XCTAssertEqual(cardFiles.count, 4)
        let cardTexts = try cardFiles.map { try String(contentsOf: $0, encoding: .utf8) }
        let personaText = try XCTUnwrap(
            cardTexts.first { $0.contains("kind: persona") },
            "要有一張人格卡"
        )
        XCTAssertTrue(personaText.contains("importedFrom"))
        XCTAssertTrue(personaText.contains("語氣溫和"))
        let kinds = cardTexts.compactMap { text -> String? in
            text.split(separator: "\n")
                .first { $0.hasPrefix("kind: ") }
                .map { String($0.dropFirst("kind: ".count)) }
        }
        XCTAssertEqual(kinds.sorted(), ["memory", "memory", "note", "persona"])
        let cards = try await harness.client.listCards(limit: 20)
        XCTAssertEqual(cards.cards.count, 4, "CardIndex.rescan 之後協定要看得到四張卡")

        // 同一來源第二次預覽：全部是重複，選不到任何項目，也不會再建立卡片。
        let second = ImportFlowModel(service: ModuleImportService(sender: harness.client))
        await second.load()
        await second.chooseSource(kind: .generic, path: source.path)
        second.setCategory(.persona, for: "persona.md")
        second.setCategory(.memory, for: "memory.md")
        second.setCategory(.rule, for: "rules.md")
        await second.preview()
        XCTAssertNil(second.errorMessage)
        let secondPreview = try XCTUnwrap(second.preview)
        XCTAssertEqual(secondPreview.newCards, 0)
        XCTAssertEqual(secondPreview.duplicates, 4)
        XCTAssertTrue(second.selectedKeys.isEmpty, "重複的項目不能勾")
        XCTAssertFalse(second.canWrite)

        XCTAssertEqual(try Self.cardFiles(in: harness.folder).count, 4, "第二次不能多出卡片")
    }

    // MARK: - 啟動主機服務

    private struct Harness {
        let folder: URL
        let supervisor: ServiceSupervisor
        let client: CardiaryClient
    }

    private static var repositoryRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // Import
            .deletingLastPathComponent()  // CardiaryAppTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // macos
            .deletingLastPathComponent()  // apps
            .deletingLastPathComponent()  // repo
    }

    private static func startFakeService() async throws -> Harness {
        let hostEntry = repositoryRoot.appendingPathComponent("packages/host/dist/main.js")
        guard FileManager.default.fileExists(atPath: hostEntry.path) else {
            throw XCTSkip("找不到主機服務；先跑 pnpm build")
        }
        guard let node = nodeLaunch() else {
            throw XCTSkip("找不到 Node")
        }

        let folder = try makeTemporaryFolder(prefix: "cardiary-import-folder")
        let stateDirectory = folder.appendingPathComponent("state", isDirectory: true)
        try FileManager.default.createDirectory(at: stateDirectory, withIntermediateDirectories: true)
        let identity: [String: Any] = [
            "format": 1,
            "folderId": "01TESTFOLDER00000000000000",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "createdBy": "import-e2e",
        ]
        try JSONSerialization.data(withJSONObject: identity, options: [.prettyPrinted])
            .write(to: stateDirectory.appendingPathComponent("folder.json"))

        let tmp = folder.appendingPathComponent("tmp", isDirectory: true).path
        let plan = ServiceLaunchPlan(
            executableURL: node.executable,
            arguments: node.prefix + [hostEntry.path, "--engine", "fake"],
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
                name: "cardiary-import-e2e",
                version: "0",
                platform: .macos,
                instanceId: "import-e2e-1"
            ),
            subscribeActiveSessions: false
        ))
        await client.start()
        try await waitUntil(timeout: 20) {
            if case .connected = await client.currentState { return true }
            return false
        }
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

    private static func makeTemporaryFolder(prefix: String) throws -> URL {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("\(prefix)-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private static func write(_ text: String, to folder: URL, name: String) throws {
        try text.write(to: folder.appendingPathComponent(name), atomically: true, encoding: .utf8)
    }

    private static func cardFiles(in folder: URL) throws -> [URL] {
        let cards = folder.appendingPathComponent("cards", isDirectory: true)
        guard FileManager.default.fileExists(atPath: cards.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: cards, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "md" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
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
        throw NSError(domain: "CardiaryImportE2E", code: 1)
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
