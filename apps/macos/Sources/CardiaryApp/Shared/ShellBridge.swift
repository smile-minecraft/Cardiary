import Combine
import Foundation

/// 殼與 SwiftUI 之間的橋：殼把資料夾、連線與待審批數量放進來，畫面只讀這裡。
///
/// 殼是唯一知道服務行程、Token 與鑰匙圈的地方；介面（含 `CardiaryApp` 的 view model）
/// 不碰這些，只看得到這裡的狀態。
@MainActor
public final class ShellBridge: ObservableObject {
    @Published public private(set) var folder: FolderPresentation
    @Published public private(set) var connection: ConnectionPresentation
    /// `nil` 代表還沒有連上服務，數量未知（不是 0）。
    @Published public private(set) var approvalCount: Int?

    /// 殼實作的動作；介面按鈕呼叫這裡，不直接開面板或關服務。
    public var actions: ShellActions

    public init(
        folder: FolderPresentation = .unselected,
        connection: ConnectionPresentation = .waitingForService,
        approvalCount: Int? = nil,
        actions: ShellActions = ShellActions()
    ) {
        self.folder = folder
        self.connection = connection
        self.approvalCount = approvalCount
        self.actions = actions
    }

    public func update(folder: FolderPresentation) {
        guard self.folder != folder else { return }
        self.folder = folder
    }

    public func update(connection: ConnectionPresentation) {
        guard self.connection != connection else { return }
        self.connection = connection
    }

    public func update(approvalCount: Int?) {
        guard self.approvalCount != approvalCount else { return }
        self.approvalCount = approvalCount
    }
}
