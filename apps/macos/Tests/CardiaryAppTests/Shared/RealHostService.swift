import CardiaryKit
import CardiaryShellCore
import Foundation
import XCTest

/// 用真的主機服務（fake engine）啟動殼的監督器與客戶端，供跨殼／主機的測試共用。
///
/// 需要 Node 與已建置的 `packages/host/dist/main.js`；缺少任何一項就跳過，
/// 不讓測試環境的問題變成一連串失敗。
@MainActor
enum RealHostService {
    struct Harness {
        let folder: URL
        let supervisor: ServiceSupervisor
        let client: CardiaryClient
        let token: String
        /// 服務的 HTTP 根網址；原檔上傳與下載走這個埠。
        let baseURL: URL
        let blobs: BlobClient
    }

    static func start(
        folderPrefix: String = "cardiary-real-host",
        brokerHandler: @escaping @Sendable (String, CardiaryShellCore.JSONValue) async -> BrokerReply
    ) async throws -> Harness {
        let hostEntry = repositoryRoot.appendingPathComponent("packages/host/dist/main.js")
        guard FileManager.default.fileExists(atPath: hostEntry.path) else {
            throw XCTSkip("找不到主機服務；先跑 pnpm build")
        }
        guard let node = nodeLaunch() else {
            throw XCTSkip("找不到 Node")
        }

        let folder = try makeTemporaryFolder(prefix: folderPrefix)
        let stateDirectory = folder.appendingPathComponent("state", isDirectory: true)
        try FileManager.default.createDirectory(at: stateDirectory, withIntermediateDirectories: true)
        let identity: [String: Any] = [
            "format": 1,
            "folderId": "01TESTFOLDER00000000000000",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "createdBy": "real-host-tests",
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
            brokerHandler: brokerHandler
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
                name: "cardiary-real-host-tests",
                version: "0",
                platform: .macos,
                instanceId: "real-host-\(UUID().uuidString)"
            ),
            subscribeActiveSessions: false
        ))
        await client.start()
        do {
            try await waitUntil(timeout: 20) {
                if case .connected = await client.currentState { return true }
                return false
            }
        } catch {
            supervisor.stopImmediately()
            await client.stop()
            throw error
        }
        let baseURL = URL(string: "http://127.0.0.1:\(port)")!
        return Harness(
            folder: folder,
            supervisor: supervisor,
            client: client,
            token: token,
            baseURL: baseURL,
            blobs: BlobClient(
                configuration: BlobClient.Configuration(
                    baseURL: baseURL,
                    clientToken: token
                )
            )
        )
    }

    /// 從這個檔案往上找到 repo 根目錄（含 `packages/host/package.json` 的那一層）。
    private static var repositoryRoot: URL {
        var url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while url.path != "/" {
            if FileManager.default.fileExists(
                atPath: url.appendingPathComponent("packages/host/package.json").path
            ) {
                return url
            }
            url.deleteLastPathComponent()
        }
        return url
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

    static func makeTemporaryFolder(prefix: String) throws -> URL {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("\(prefix)-\(UUID().uuidString)", isDirectory: true)
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
        throw NSError(domain: "CardiaryRealHost", code: 1)
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
