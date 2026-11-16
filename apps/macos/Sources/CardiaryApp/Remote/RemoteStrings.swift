// 由 Remote.xcstrings 整理而成的執行期字串表。
// 執行時不讀 bundle：`LocalizationTests` 會逐 key 比對兩邊是否一致。
import Foundation

/// 遠端配對與裝置管理的可在地化 key。
public enum RemoteString: String, CaseIterable, Sendable {
    case remotePairingTitle
    case remotePairingBody
    case remotePairingDevice
    case remotePairingKindWeb
    case remotePairingKindIos
    case remotePairingCode
    case remotePairingExpires
    case remotePairingApprove
    case remotePairingDeny
    case remotePairingApproved
    case remotePairingDenied
    case remotePairingFailed
    case remotePairingDeciding
    case remoteDevicesTitle
    case remoteDevicesEmpty
    case remoteDevicesLastUsed
    case remoteDevicesRevoked
    case remoteDevicesRevoke
    case remoteDevicesRevokeConfirm
    case remoteDevicesRevokedDone
    case remoteDevicesRevokeFailed
    case remoteDevicesNever
    case remoteDevicesFingerprint
    case remoteAccessUnavailable
    case remoteDevicesRefresh
}

/// 遠端介面的字串查詢。
public enum RemoteL10n {
    public static func text(_ key: RemoteString, language: AppLanguage? = nil) -> String {
        resolve(key.rawValue, table: RemoteStringTables.remote, language: language)
    }

    public static func format(
        _ key: RemoteString,
        _ values: [String: String],
        language: AppLanguage? = nil
    ) -> String {
        var text = resolve(key.rawValue, table: RemoteStringTables.remote, language: language)
        for (name, value) in values {
            text = text.replacingOccurrences(of: "{\(name)}", with: value)
        }
        return text
    }

    public static func format(_ key: RemoteString, value: String, language: AppLanguage? = nil) -> String {
        format(key, ["value": value], language: language)
    }

    /// 一份語言的字串表，給逐 key 比對的測試用。
    public static func table(_ language: AppLanguage) -> [String: String] {
        RemoteStringTables.remote[language] ?? [:]
    }

    static func catalogKeys() -> [String] {
        RemoteString.allCases.map(\.rawValue)
    }

    private static func resolve(
        _ rawKey: String,
        table: [AppLanguage: [String: String]],
        language: AppLanguage?
    ) -> String {
        let chosen = language ?? AppL10n.language
        return table[chosen]?[rawKey] ?? table[.en]?[rawKey] ?? rawKey
    }
}

enum RemoteStringTables {
    static let remote: [AppLanguage: [String: String]] = [
        .zhHant: [
            "remotePairingTitle": "核准新裝置",
            "remotePairingBody": "確認裝置上顯示的短碼與下面相同，再決定是否核准。",
            "remotePairingDevice": "裝置：{value}",
            "remotePairingKindWeb": "網頁瀏覽器",
            "remotePairingKindIos": "iPhone 或 iPad",
            "remotePairingCode": "短碼：{value}",
            "remotePairingExpires": "將於 {value} 過期",
            "remotePairingApprove": "核准",
            "remotePairingDeny": "拒絕",
            "remotePairingApproved": "已核准，裝置可以領取憑證。",
            "remotePairingDenied": "已拒絕這筆配對。",
            "remotePairingFailed": "配對處理失敗：{value}",
            "remotePairingDeciding": "正在送出決定…",
            "remoteDevicesTitle": "已配對裝置",
            "remoteDevicesEmpty": "還沒有已配對的裝置。",
            "remoteDevicesLastUsed": "建立於 {value}",
            "remoteDevicesRevoked": "已撤銷",
            "remoteDevicesRevoke": "撤銷裝置",
            "remoteDevicesRevokeConfirm": "撤銷這台裝置？它會立即失去連線，必須重新配對。",
            "remoteDevicesRevokedDone": "已撤銷裝置。",
            "remoteDevicesRevokeFailed": "撤銷失敗：{value}",
            "remoteDevicesNever": "未知",
            "remoteDevicesFingerprint": "指紋：{value}",
            "remoteAccessUnavailable": "還沒連上服務，遠端存取需要連線。",
            "remoteDevicesRefresh": "重新整理",
        ],
        .en: [
            "remotePairingTitle": "Approve a new device",
            "remotePairingBody": "Check that the code on the device matches the one below before deciding.",
            "remotePairingDevice": "Device: {value}",
            "remotePairingKindWeb": "Web browser",
            "remotePairingKindIos": "iPhone or iPad",
            "remotePairingCode": "Code: {value}",
            "remotePairingExpires": "Expires at {value}",
            "remotePairingApprove": "Approve",
            "remotePairingDeny": "Deny",
            "remotePairingApproved": "Approved. The device can claim its token.",
            "remotePairingDenied": "Denied this pairing.",
            "remotePairingFailed": "Could not decide the pairing: {value}",
            "remotePairingDeciding": "Sending the decision…",
            "remoteDevicesTitle": "Paired devices",
            "remoteDevicesEmpty": "No paired devices yet.",
            "remoteDevicesLastUsed": "Created {value}",
            "remoteDevicesRevoked": "Revoked",
            "remoteDevicesRevoke": "Revoke device",
            "remoteDevicesRevokeConfirm": "Revoke this device? It loses its connection immediately and must pair again.",
            "remoteDevicesRevokedDone": "Device revoked.",
            "remoteDevicesRevokeFailed": "Could not revoke: {value}",
            "remoteDevicesNever": "Unknown",
            "remoteDevicesFingerprint": "Fingerprint: {value}",
            "remoteAccessUnavailable": "Not connected; remote access needs a service connection.",
            "remoteDevicesRefresh": "Refresh",
        ],
    ]
}
