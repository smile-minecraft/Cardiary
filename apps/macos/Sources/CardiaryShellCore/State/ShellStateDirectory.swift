import Foundation

/// 殼的狀態目錄：`~/Library/Application Support/com.cardiary/`。
///
/// 只放三類內容：資料夾書籤與授權紀錄、殼的除錯日誌與 `os_log`、必要的執行期檔案。
/// 上限 50 MB，由殼清理；`folder-authorization.json` 永遠不刪。
public final class ShellStateDirectory: @unchecked Sendable {
    public static let defaultLimitBytes = 50 * 1024 * 1024
    public static let authorizationFileName = "folder-authorization.json"
    public static let logPrefix = "shell-"
    public static let logSuffix = ".log"
    /// 可重建的執行期檔案放在這個子目錄。
    public static let runtimeDirectoryName = "runtime"

    public let root: URL
    public let limitBytes: Int

    public init(root: URL, limitBytes: Int = ShellStateDirectory.defaultLimitBytes) {
        self.root = root
        self.limitBytes = max(1, limitBytes)
    }

    /// 預設位置。Bundle ID 固定，所以路徑固定。
    public static func defaultRoot(bundleIdentifier: String = "com.cardiary") -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent(bundleIdentifier, isDirectory: true)
    }

    public func ensureExists() throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    public var authorizationURL: URL {
        root.appendingPathComponent(Self.authorizationFileName)
    }

    public func logURL(now: Date = Date()) -> URL {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyyMMdd"
        return root.appendingPathComponent("\(Self.logPrefix)\(formatter.string(from: now))\(Self.logSuffix)")
    }

    /// 目前用量（只算檔案，不算目錄本身）。
    public func usedBytes() -> Int {
        guard
            let enumerator = FileManager.default.enumerator(
                at: root,
                includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey],
                options: [.skipsHiddenFiles]
            )
        else { return 0 }

        var total = 0
        for case let url as URL in enumerator {
            let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            if values?.isRegularFile == true {
                total += values?.fileSize ?? 0
            }
        }
        return total
    }

    /// `broker.shell-state.get` 的回應：只有大小，沒有檔案清單、路徑或內容。
    public func payload() -> JSONValue {
        .object([
            "usedBytes": .number(Double(usedBytes())),
            "limitBytes": .number(Double(limitBytes)),
        ])
    }

    public struct PruneReport: Equatable, Sendable {
        public var removedFiles: [String]
        public var bytesBefore: Int
        public var bytesAfter: Int
        public var stillOverLimit: Bool

        public init(
            removedFiles: [String] = [],
            bytesBefore: Int = 0,
            bytesAfter: Int = 0,
            stillOverLimit: Bool = false
        ) {
            self.removedFiles = removedFiles
            self.bytesBefore = bytesBefore
            self.bytesAfter = bytesAfter
            self.stillOverLimit = stillOverLimit
        }
    }

    /// 超過上限時清理：先刪最舊的除錯日誌，再刪可重建的執行期檔案。
    ///
    /// `folder-authorization.json` 不刪；不認得的檔案也不刪，只回報還超限。
    public func pruneIfNeeded() -> PruneReport {
        let before = usedBytes()
        guard before > limitBytes else {
            return PruneReport(bytesBefore: before, bytesAfter: before, stillOverLimit: false)
        }

        var removed: [String] = []
        var current = before
        let target = Int(Double(limitBytes) * 0.8)

        for url in logFilesOldestFirst() {
            guard current > target else { break }
            if let size = fileSize(url), remove(url) {
                current -= size
                removed.append(url.lastPathComponent)
            }
        }

        if current > target {
            for url in runtimeFilesOldestFirst() {
                guard current > target else { break }
                if let size = fileSize(url), remove(url) {
                    current -= size
                    removed.append(url.lastPathComponent)
                }
            }
        }

        let after = usedBytes()
        return PruneReport(
            removedFiles: removed,
            bytesBefore: before,
            bytesAfter: after,
            stillOverLimit: after > limitBytes
        )
    }

    private func logFilesOldestFirst() -> [URL] {
        regularFiles(in: root)
            .filter {
                $0.lastPathComponent.hasPrefix(Self.logPrefix)
                    && $0.lastPathComponent.hasSuffix(Self.logSuffix)
            }
            .sorted { modificationDate($0) < modificationDate($1) }
    }

    private func runtimeFilesOldestFirst() -> [URL] {
        let runtime = root.appendingPathComponent(Self.runtimeDirectoryName, isDirectory: true)
        return regularFiles(in: runtime)
            .sorted { modificationDate($0) < modificationDate($1) }
    }

    private func regularFiles(in directory: URL) -> [URL] {
        guard
            let enumerator = FileManager.default.enumerator(
                at: directory,
                includingPropertiesForKeys: [.isRegularFileKey],
                options: [.skipsHiddenFiles, .skipsSubdirectoryDescendants]
            )
        else { return [] }
        var files: [URL] = []
        for case let url as URL in enumerator {
            if (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true {
                files.append(url)
            }
        }
        return files
    }

    private func fileSize(_ url: URL) -> Int? {
        (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize
    }

    private func modificationDate(_ url: URL) -> Date {
        (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            ?? .distantPast
    }

    private func remove(_ url: URL) -> Bool {
        guard url.lastPathComponent != Self.authorizationFileName else { return false }
        do {
            try FileManager.default.removeItem(at: url)
            return true
        } catch {
            return false
        }
    }
}
