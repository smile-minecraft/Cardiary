import Foundation

/// 殼回報的資料夾狀態。書籤與安全範圍存取留在殼裡，介面只看得到顯示用的資訊。
public struct FolderPresentation: Equatable, Sendable {
    public enum Availability: String, Equatable, Sendable {
        case unselected
        case ready
        case unavailable
        case mismatch
    }

    public var availability: Availability
    public var displayName: String?
    public var path: String?

    public init(availability: Availability = .unselected, displayName: String? = nil, path: String? = nil) {
        self.availability = availability
        self.displayName = displayName
        self.path = path
    }

    public static let unselected = FolderPresentation()
}

/// 介面看到的連線狀態。來源是殼的服務監管加上 `CardiaryClient` 的狀態。
public enum ConnectionPresentation: Equatable, Sendable {
    /// 資料夾可用，服務還沒就緒。
    case waitingForService
    case connecting
    case connected(epoch: String)
    case disconnected(reason: String)
    /// 服務或協定版本不符：重連沒有用，要更新 App。
    case needsUpdate

    public var isConnected: Bool {
        if case .connected = self { return true }
        return false
    }
}

/// 主視窗要顯示哪一個畫面。
public enum AppScreen: Equatable, Sendable {
    case firstRun
    case unavailable(FolderPresentation.Availability)
    case needsUpdate
    case main
}

/// 殼提供給介面的動作。介面不直接呼叫 AppKit，也不自己選資料夾。
public struct ShellActions {
    public var chooseFolder: @MainActor () -> Void
    public var retry: @MainActor () -> Void
    public var pauseAllApprovals: @MainActor () -> Void
    public var openMainWindow: @MainActor () -> Void

    public init(
        chooseFolder: @escaping @MainActor () -> Void = {},
        retry: @escaping @MainActor () -> Void = {},
        pauseAllApprovals: @escaping @MainActor () -> Void = {},
        openMainWindow: @escaping @MainActor () -> Void = {}
    ) {
        self.chooseFolder = chooseFolder
        self.retry = retry
        self.pauseAllApprovals = pauseAllApprovals
        self.openMainWindow = openMainWindow
    }
}
