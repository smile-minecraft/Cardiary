import Foundation

/// 拖放檔案時判斷要送給原檔端點的媒體型別。
///
/// 只接受 Cardiary 支援的圖片與音訊副檔名；其他檔案回 nil，由畫面顯示不支援，
/// 不要用 `application/octet-stream` 冒充。
public enum MediaFileType {
    private static let imageExtensions: [String: String] = [
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "heic": "image/heic",
        "heif": "image/heif",
        "tif": "image/tiff",
        "tiff": "image/tiff",
    ]

    private static let audioExtensions: [String: String] = [
        "mp3": "audio/mpeg",
        "m4a": "audio/mp4",
        "aac": "audio/aac",
        "wav": "audio/wav",
        "aif": "audio/aiff",
        "aiff": "audio/aiff",
        "caf": "audio/x-caf",
        "flac": "audio/flac",
    ]

    /// 由副檔名（不含句點、不分大小寫）取得媒體型別。
    public static func mediaType(forPathExtension pathExtension: String) -> String? {
        let key = pathExtension.lowercased()
        guard !key.isEmpty else { return nil }
        return imageExtensions[key] ?? audioExtensions[key]
    }

    /// 由檔案網址取得媒體型別。
    public static func mediaType(for fileURL: URL) -> String? {
        mediaType(forPathExtension: fileURL.pathExtension)
    }

    public static func isSupported(_ fileURL: URL) -> Bool {
        mediaType(for: fileURL) != nil
    }
}
