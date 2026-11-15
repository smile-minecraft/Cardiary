import Foundation

/// 寫入系統鑰匙圈。產品介面與殼在同一個行程，設定頁只依賴這個協定；
/// 讀取只由殼的 Broker 提供給服務（`broker.keychain.get`），介面沒有讀取路徑。
///
/// 金鑰值不經過主機服務、不進協定、不寫日誌或狀態目錄；實作在
/// `CardiaryShell` 的 `KeychainStore`，測試用記憶體替身。
public protocol KeychainWriting: Sendable {
    /// 寫入或覆蓋一個帳號的金鑰。回傳是否成功。
    @discardableResult
    func store(account: String, value: String) -> Bool

    /// 刪除一個帳號的金鑰。帳號不存在視為成功。
    @discardableResult
    func delete(account: String) -> Bool
}
