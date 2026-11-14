import Foundation
import os

/// 殼的除錯日誌：寫檔案（狀態目錄）並同步寫 `os_log`。
///
/// 只記生命週期、路徑、錯誤碼與版本；Token 與金鑰一律先經過這裡的去敏。
public final class ShellLog: @unchecked Sendable {
    private let lock = NSLock()
    private let fileURL: URL?
    private let fileManager = FileManager.default
    private var secrets: [String] = []
    private let logger = Logger(subsystem: "com.cardiary", category: "shell")

    public init(fileURL: URL?) {
        self.fileURL = fileURL
    }

    /// 註冊一筆只能在日誌中出現去敏形式的秘密。
    public func addSecret(_ secret: String) {
        guard secret.count >= 8 else { return }
        lock.lock()
        if !secrets.contains(secret) {
            secrets.append(secret)
        }
        lock.unlock()
    }

    public func write(_ message: String) {
        let line = redact(message)
        logger.info("\(line, privacy: .public)")

        guard let fileURL else { return }
        lock.lock()
        defer { lock.unlock() }
        do {
            try fileManager.createDirectory(
                at: fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            if !fileManager.fileExists(atPath: fileURL.path) {
                fileManager.createFile(atPath: fileURL.path, contents: nil)
            }
            let handle = try FileHandle(forWritingTo: fileURL)
            defer { try? handle.close() }
            try handle.seekToEnd()
            let timestamp = ISO8601DateFormatter().string(from: Date())
            guard let data = "[\(timestamp)] \(line)\n".data(using: .utf8) else { return }
            try handle.write(contentsOf: data)
        } catch {
            // 日誌寫不進去時只留 os_log，不能讓它拖垮殼。
            logger.error("無法寫入殼日誌：\(error.localizedDescription, privacy: .public)")
        }
    }

    /// 去敏：已註冊的秘密換成 `<redacted>`，43 字元的 base64url 也視為可能的 Token。
    public func redact(_ message: String) -> String {
        lock.lock()
        let known = secrets
        lock.unlock()

        var result = message
        for secret in known where !secret.isEmpty {
            result = result.replacingOccurrences(of: secret, with: "<redacted>")
        }
        result = Self.redactTokenPattern(result)
        return result
    }

    private static let tokenRegex = try! NSRegularExpression(
        pattern: "[A-Za-z0-9_-]{43}"
    )

    static func redactTokenPattern(_ message: String) -> String {
        let range = NSRange(message.startIndex..<message.endIndex, in: message)
        return tokenRegex.stringByReplacingMatches(
            in: message,
            options: [],
            range: range,
            withTemplate: "<redacted-token>"
        )
    }
}
