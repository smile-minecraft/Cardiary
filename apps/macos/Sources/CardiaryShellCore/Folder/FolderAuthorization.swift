import Foundation

/// 資料夾的內部狀態（`docs/design/storage.md` 第 5.1 節的八態）。
///
/// 協定只呈現三個粗粒度狀態；內部狀態用在殼的畫面與日誌。
public enum FolderAvailabilityState: String, CaseIterable, Sendable {
    case unselected
    case verifying
    case ready
    case paused
    case unavailable
    case mismatch
    case migrating
    case migrationFailed = "migration-failed"

    /// 對應協定 `FolderState` 的字串值。
    public var protocolState: String {
        switch self {
        case .unselected:
            return "not_selected"
        case .verifying, .ready, .paused, .migrating:
            return "ready"
        case .unavailable, .mismatch, .migrationFailed:
            return "unavailable"
        }
    }

    /// 選單列與「資料不可用」畫面用的字串鍵。
    public var localizationKey: L10n.Key {
        switch self {
        case .unselected: return .folderUnselected
        case .verifying: return .folderVerifying
        case .ready: return .folderReady
        case .paused: return .folderPaused
        case .unavailable: return .folderUnavailable
        case .mismatch: return .folderMismatch
        case .migrating: return .folderMigrating
        case .migrationFailed: return .folderMigrationFailed
        }
    }

    /// 這個狀態能不能啟動服務。
    public var allowsService: Bool {
        self != .unselected
    }
}

/// 資料夾授權紀錄：安全範圍書籤與判斷磁碟是否還在所需的中繼資料。
///
/// 只存在 `~/Library/Application Support/com.cardiary/folder-authorization.json`；
/// 殼的狀態目錄是「只准寫三區」的例外，見 `storage` 第 6.3 節。
public struct FolderAuthorization: Codable, Equatable, Sendable {
    public var displayPath: String
    public var bookmark: Data
    public var volumeUUID: String?
    public var volumePath: String?
    public var isExternalVolume: Bool
    public var folderId: String?
    public var recordedAt: Date

    public init(
        displayPath: String,
        bookmark: Data,
        volumeUUID: String? = nil,
        volumePath: String? = nil,
        isExternalVolume: Bool = false,
        folderId: String? = nil,
        recordedAt: Date = Date()
    ) {
        self.displayPath = displayPath
        self.bookmark = bookmark
        self.volumeUUID = volumeUUID
        self.volumePath = volumePath
        self.isExternalVolume = isExternalVolume
        self.folderId = folderId
        self.recordedAt = recordedAt
    }
}

public enum FolderAuthorizationStore {
    public static func encode(_ authorization: FolderAuthorization) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        // 用 Date 自己的表示法（參考日期以來的秒數）：換算 1970 秒數會掉精度。
        encoder.dateEncodingStrategy = .deferredToDate
        return try encoder.encode(authorization)
    }

    public static func decode(_ data: Data) throws -> FolderAuthorization {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .deferredToDate
        return try decoder.decode(FolderAuthorization.self, from: data)
    }

    public static func save(_ authorization: FolderAuthorization, to url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try encode(authorization).write(to: url, options: .atomic)
    }

    public static func load(from url: URL) throws -> FolderAuthorization {
        try decode(Data(contentsOf: url))
    }
}

/// 磁碟的身分資訊。殼是「資料夾在不在、是哪一顆磁碟」的權威。
public struct VolumeInfo: Equatable, Sendable {
    public var uuid: String?
    public var path: String?
    public var isExternal: Bool
    public var fileSystemName: String?
    public var localizedFormat: String?

    public init(
        uuid: String? = nil,
        path: String? = nil,
        isExternal: Bool = false,
        fileSystemName: String? = nil,
        localizedFormat: String? = nil
    ) {
        self.uuid = uuid
        self.path = path
        self.isExternal = isExternal
        self.fileSystemName = fileSystemName
        self.localizedFormat = localizedFormat
    }

    /// APFS 的 `f_fstypename` 是 `apfs`。設計用「不是 APFS 就警告」，不列舉其他格式。
    public var isAPFS: Bool {
        (fileSystemName ?? "").lowercased() == "apfs"
    }
}

public enum VolumeProbe {
    /// 讀取路徑所屬磁碟的資訊。路徑不存在時回 nil。
    public static func probe(path: String) -> VolumeInfo? {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) else {
            return nil
        }

        var info = VolumeInfo(path: path)
        var stats = statfs()
        if statfs(path, &stats) == 0 {
            info.fileSystemName = withUnsafePointer(to: &stats.f_fstypename) { pointer in
                pointer.withMemoryRebound(to: CChar.self, capacity: Int(MNAMELEN)) {
                    String(cString: $0)
                }
            }
        }

        let url = URL(fileURLWithPath: path)
        if let values = try? url.resourceValues(forKeys: [
            .volumeUUIDStringKey, .volumeIsInternalKey, .volumeLocalizedFormatDescriptionKey,
            .volumeURLKey,
        ]) {
            info.uuid = values.volumeUUIDString
            // 磁碟映像會回報內部磁碟，所以這個值只能當參考；真正的判斷要用磁碟介面。
            info.isExternal = !(values.volumeIsInternal ?? true)
            info.localizedFormat = values.volumeLocalizedFormatDescription
            info.path = values.volume?.path ?? info.path
        }
        return info
    }

    /// 檔案系統格式的警告訊息；APFS 回 nil。
    public static func formatWarning(for info: VolumeInfo) -> String? {
        guard !info.isAPFS else { return nil }
        let name = info.localizedFormat ?? info.fileSystemName ?? "unknown"
        return L10n.text(.nonAPFSWarningBody).replacingOccurrences(of: "{format}", with: name)
    }
}
