import Foundation
import CardiaryShellCore

/// App bundle 內的路徑。以 SPM 直接執行時（開發用）改用環境變數。
enum AppPaths {
    static var bundleURL: URL {
        Bundle.main.bundleURL
    }

    /// 內嵌的 Node 執行檔：`Contents/Helpers/Node/node`。
    static func nodeExecutable(environment: [String: String] = ProcessInfo.processInfo.environment) -> URL? {
        if let override = environment["CARDIARY_NODE"], !override.isEmpty {
            return URL(fileURLWithPath: override)
        }
        let bundled = bundleURL.appendingPathComponent("Contents/Helpers/Node/node")
        if FileManager.default.isExecutableFile(atPath: bundled.path) {
            return bundled
        }
        // 開發時直接跑 .build/debug/CardiaryShell：找專案裡的 Scripts/Node 或系統 node。
        if let path = which("node", environment: environment) {
            return URL(fileURLWithPath: path)
        }
        return nil
    }

    /// 服務進入點。
    ///
    /// 正式 bundle 放的是打包後的主機服務：`Contents/Resources/Service/dist/main.js`。
    /// `service.mjs` 只留給開發用的替身（`CARDIARY_SERVICE_SCRIPT` 或舊的開發資源）。
    static func serviceScript(environment: [String: String] = ProcessInfo.processInfo.environment) -> URL? {
        if let override = environment["CARDIARY_SERVICE_SCRIPT"], !override.isEmpty {
            return URL(fileURLWithPath: override)
        }
        let bundled = bundleURL.appendingPathComponent("Contents/Resources/Service")
        for candidate in ["dist/main.js", "service.mjs"] {
            let entry = bundled.appendingPathComponent(candidate)
            if FileManager.default.fileExists(atPath: entry.path) {
                return entry
            }
        }
        // 開發時：apps/macos/Resources/Service/...（由執行檔往上找）。
        var directory = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
        for _ in 0..<6 {
            for candidate in ["dist/main.js", "service.mjs"] {
                let entry = directory.appendingPathComponent("Resources/Service/\(candidate)")
                if FileManager.default.fileExists(atPath: entry.path) {
                    return entry
                }
            }
            directory = directory.deletingLastPathComponent()
        }
        return nil
    }

    static func shellStateDirectory() -> ShellStateDirectory {
        ShellStateDirectory(root: ShellStateDirectory.defaultRoot())
    }

    private static func which(_ name: String, environment: [String: String]) -> String? {
        let path = environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        for directory in path.split(separator: ":") {
            let candidate = URL(fileURLWithPath: String(directory)).appendingPathComponent(name)
            if FileManager.default.isExecutableFile(atPath: candidate.path) {
                return candidate.path
            }
        }
        return nil
    }
}
