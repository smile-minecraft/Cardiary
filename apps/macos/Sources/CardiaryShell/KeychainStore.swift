import Foundation
import Security
import CardiaryShellCore

/// 殼獨占的系統鑰匙圈存取。
///
/// 用檔案式登入鑰匙圈（`kSecClassGenericPassword`，不加
/// `kSecUseDataProtectionKeychain`）：spike 實測資料保護鑰匙圈需要
/// provisioning 授權的 entitlement，官網直下載的 App 沒有。服務本身沒有任何
/// Security framework 呼叫，只能經 `broker.keychain.get` 讀單一帳號；
/// 設定頁的寫入走 `KeychainWriting`，與讀取共用同一個 service。
///
/// 讀到的值留在殼行程記憶體裡，直到行程結束：檔案式鑰匙圈的存取控制綁在
/// 程式簽章上，簽章一變（例如本機 ad-hoc 重新建置）每次讀取都會跳出密碼
/// 提示，而服務每次對話都要向殼取金鑰。快取讓一次啟動最多問一次；
/// 寫入與刪除會同步更新快取。快取只在記憶體，不落地、不進日誌。
final class KeychainStore: KeychainReading, KeychainWriting, @unchecked Sendable {
    private let service: String
    private let lock = NSLock()
    private var cache: [String: String] = [:]

    init(service: String = "com.cardiary.shell") {
        self.service = service
    }

    func read(account: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        if let cached = cache[account] {
            return cached
        }

        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        query[kSecUseDataProtectionKeychain as String] = false

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data,
              let value = String(data: data, encoding: .utf8)
        else { return nil }
        // 查不到或被拒絕都不快取，下次仍會向鑰匙圈重新查詢。
        cache[account] = value
        return value
    }

    @discardableResult
    func store(account: String, value: String) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }
        lock.lock()
        defer { lock.unlock() }
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        var attributes = base
        attributes[kSecValueData as String] = data
        attributes[kSecUseDataProtectionKeychain as String] = false
        guard SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else {
            cache[account] = nil
            return false
        }
        cache[account] = value
        return true
    }

    @discardableResult
    func delete(account: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        cache[account] = nil
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
