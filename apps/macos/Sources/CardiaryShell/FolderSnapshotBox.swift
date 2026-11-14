import Foundation
import CardiaryShellCore

/// 跨執行緒讀取的資料夾快照。
///
/// 代理請求（`broker.folder.get`）來自主控通道的序列佇列，主執行緒的狀態不能
/// 直接讀；這裡用鎖保護一份唯讀快照。
final class FolderSnapshotBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value: FolderSnapshot = .unselected

    var snapshot: FolderSnapshot {
        get {
            lock.lock()
            defer { lock.unlock() }
            return value
        }
        set {
            lock.lock()
            value = newValue
            lock.unlock()
        }
    }
}
