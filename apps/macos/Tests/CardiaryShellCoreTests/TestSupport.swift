import Foundation
import XCTest

@testable import CardiaryShellCore

/// 測試共用的工具：暫存資料夾、服務替身的啟動計畫、stderr 收集。
enum TestSupport {
    /// 每個測試一個獨立的暫存資料夾；測試自己建立，不靠被測程式。
    static func makeTemporaryFolder(_ label: String = "cardiary") throws -> URL {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("cardiary-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        let folder = url.appendingPathComponent(label, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    /// 開發用的預設服務腳本（`apps/macos/scripts/dev-service.mjs`）。
    static var devServiceScript: URL {
        // #filePath 指向這個測試檔；往上三層就是 apps/macos。
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("scripts/dev-service.mjs")
    }

    /// 系統上的 Node。測試需要真的 Node 才跑得起來，沒有就跳過。
    static func nodeExecutable() -> URL? {
        if let override = ProcessInfo.processInfo.environment["CARDIARY_NODE"],
            FileManager.default.isExecutableFile(atPath: override)
        {
            return URL(fileURLWithPath: override)
        }
        for candidate in [
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ] where FileManager.default.isExecutableFile(atPath: candidate) {
            return URL(fileURLWithPath: candidate)
        }
        // 最後用 env 找 node（PATH 由殼指定，這裡只給測試）。
        let probe = run("/usr/bin/env", ["node", "--version"])
        if probe.hasPrefix("v") { return URL(fileURLWithPath: "/usr/bin/env") }
        return nil
    }

    /// 啟動 Node 的方式：正常情況是 node 的絕對路徑；只有 `/usr/bin/env`
    /// 這個 fallback 時要把 `node` 放進參數，否則會執行錯的東西。
    static func nodeLaunch() -> (executable: URL, prefix: [String])? {
        guard let node = nodeExecutable() else { return nil }
        if node.path == "/usr/bin/env" {
            return (node, ["node"])
        }
        return (node, [])
    }

    static var serviceDoubleURL: URL {
        let bundle = Bundle(for: TestSupportAnchor.self)
        let directory = bundle.bundleURL.deletingLastPathComponent()
        return directory.appendingPathComponent("CardiaryServiceDouble")
    }

    static func plan(
        folder: URL,
        environment extra: [String: String] = [:]
    ) throws -> ServiceLaunchPlan {
        let executable = serviceDoubleURL
        guard FileManager.default.isExecutableFile(atPath: executable.path) else {
            throw XCTSkip("找不到 CardiaryServiceDouble（\(executable.path)）；先跑 swift build")
        }
        let tmp = folder.appendingPathComponent("tmp", isDirectory: true).path
        var environment: [String: String] = [
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
            "HOME": NSHomeDirectory(),
            "TMPDIR": tmp,
            "TMP": tmp,
            "TEMP": tmp,
            "CARDIARY_SHELL": "1",
        ]
        for (key, value) in extra {
            environment[key] = value
        }
        return ServiceLaunchPlan(
            executableURL: executable,
            arguments: [],
            environment: environment,
            workingDirectory: folder
        )
    }

    static func processArguments(pid: Int32) -> String {
        run("/bin/ps", ["-o", "args=", "-p", "\(pid)"])
    }

    static func processEnvironment(pid: Int32) -> String {
        run("/bin/ps", ["-E", "-o", "command=", "-p", "\(pid)"])
    }

    static func run(_ executable: String, _ arguments: [String]) -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        let output = Pipe()
        process.standardOutput = output
        process.standardError = Pipe()
        process.standardInput = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            return ""
        }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return String(data: data, encoding: .utf8) ?? ""
    }

    /// 等非同步狀態出現；逾時就讓測試失敗。
    static func waitUntil(
        timeout: TimeInterval = 5,
        interval: TimeInterval = 0.02,
        message: String = "等待逾時",
        _ condition: () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return }
            try await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
        }
        XCTFail(message)
    }
}

private final class TestSupportAnchor {}

/// 收集殼日誌，讓測試檢查 Token 沒有出現在裡面。
final class CapturingLog: @unchecked Sendable {
    private let lock = NSLock()
    private var lines: [String] = []
    private let log: ShellLog
    let fileURL: URL

    init(directory: URL, redactTokensWith tokens: [ControlToken] = []) throws {
        fileURL = directory.appendingPathComponent("test-shell.log")
        log = ShellLog(fileURL: fileURL)
        for token in tokens {
            log.addSecret(token.value)
        }
    }

    func write(_ message: String) {
        log.write(message)
        lock.lock()
        lines.append(message)
        lock.unlock()
    }

    var captured: [String] {
        lock.lock()
        defer { lock.unlock() }
        return lines
    }

    var fileContents: String {
        (try? String(contentsOf: fileURL, encoding: .utf8)) ?? ""
    }
}
