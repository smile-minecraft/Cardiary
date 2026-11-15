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
final class KeychainStore: KeychainReading, KeychainWriting, @unchecked Sendable {
    private let service: String

    init(service: String = "com.cardiary.shell") {
        self.service = service
    }

    func read(account: String) -> String? {
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
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    func store(account: String, value: String) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        var attributes = base
        attributes[kSecValueData as String] = data
        attributes[kSecUseDataProtectionKeychain as String] = false
        return SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess
    }

    @discardableResult
    func delete(account: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
