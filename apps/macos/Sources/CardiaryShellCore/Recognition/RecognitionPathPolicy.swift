import Darwin
import Foundation

/// 辨識路徑的驗證規則（`shell-control.md` 第 5.2 節）。
///
/// 只接受授權資料夾內的絕對路徑、一般檔案、不是符號連結，大小上限 200 MB。
/// 驗證完才回傳 `realpath` 後的 URL；任何一項不符都不讀檔，回應
/// `path_not_allowed`。
public struct RecognitionPathPolicy: Sendable {
    public static let defaultMaxFileBytes = 200 * 1024 * 1024

    public let maxFileBytes: Int

    public init(maxFileBytes: Int = RecognitionPathPolicy.defaultMaxFileBytes) {
        self.maxFileBytes = maxFileBytes
    }

    /// 驗證路徑並回傳可讀的 URL 與位元組數；不合法時丟 `RecognitionPathError`。
    public func resolve(
        path: String,
        folderPath: String
    ) throws -> (url: URL, sizeBytes: Int) {
        guard !path.isEmpty, path.hasPrefix("/"), !path.contains("\0") else {
            throw RecognitionPathError.notAllowed
        }
        guard !folderPath.isEmpty, folderPath.hasPrefix("/") else {
            throw RecognitionPathError.notAllowed
        }
        let folder = URL(fileURLWithPath: folderPath).standardizedFileURL
            .resolvingSymlinksInPath()
        let resolved = URL(fileURLWithPath: path).standardizedFileURL
            .resolvingSymlinksInPath()

        // 必須是資料夾內的路徑，不能是資料夾本身。用 pathComponents 比對，
        // 避免 `/CardsExtra` 被當成 `/Cards` 的子路徑。
        let folderComponents = folder.pathComponents
        let fileComponents = resolved.pathComponents
        guard fileComponents.count > folderComponents.count,
            Array(fileComponents.prefix(folderComponents.count)) == folderComponents
        else {
            throw RecognitionPathError.notAllowed
        }

        var info = stat()
        guard lstat(path, &info) == 0 else { throw RecognitionPathError.notAllowed }
        // lstat 不跟隨符號連結：最後一段是連結就拒絕，即使它指向資料夾內。
        guard info.st_mode & S_IFMT == S_IFREG else { throw RecognitionPathError.notAllowed }
        guard info.st_size >= 0, Int64(maxFileBytes) >= info.st_size else {
            throw RecognitionPathError.tooLarge
        }
        return (resolved, Int(info.st_size))
    }
}

public enum RecognitionPathError: Error, Equatable, Sendable {
    case notAllowed
    case tooLarge
}
