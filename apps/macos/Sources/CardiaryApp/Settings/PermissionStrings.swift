// 由 Permissions.xcstrings 整理而成的執行期字串表。
// 執行時不讀 bundle：`FeatureStringCatalogTests` 會逐 key 比對兩邊是否一致。
import Foundation

/// 權限模式（System One 審核與全部允許）的可在地化 key。
public enum PermissionString: String, CaseIterable, Sendable {
    case permSystemOneTitle
    case permSystemOneBody
    case permCategoryReadOnlyFiles
    case permCategoryGitReadonly
    case permCategoryCreateCard
    case permCategoryOwnNotification
    case permAddFolder
    case permRemove
    case permNeedsFolder
    case permDomainsTitle
    case permDomainsBody
    case permDomainsSave
    case permAllowAllTitle
    case permAllowAllBody
    case permToolRead
    case permToolWrite
    case permToolCommand
    case permAllowAllStart
    case permAllowAllNeedsScope
    case permAllowAllActive
    case permAllowAllEnd
    case permAllowAllScope
    case permUnavailable
    case permFailed
    case permSaved
}

/// 權限模式介面的字串查詢。
public enum PermissionL10n {
    public static func text(_ key: PermissionString, language: AppLanguage? = nil) -> String {
        resolve(key.rawValue, language: language)
    }

    public static func format(_ key: PermissionString, value: String, language: AppLanguage? = nil) -> String {
        resolve(key.rawValue, language: language).replacingOccurrences(of: "{value}", with: value)
    }

    /// 一份語言的字串表，給逐 key 比對的測試用。
    public static func table(_ language: AppLanguage) -> [String: String] {
        PermissionStringTables.permissions[language] ?? [:]
    }

    static func catalogKeys() -> [String] {
        PermissionString.allCases.map(\.rawValue)
    }

    private static func resolve(_ rawKey: String, language: AppLanguage?) -> String {
        let chosen = language ?? AppL10n.language
        let table = PermissionStringTables.permissions
        return table[chosen]?[rawKey] ?? table[.en]?[rawKey] ?? rawKey
    }
}

enum PermissionStringTables {
    static let permissions: [AppLanguage: [String: String]] = [
        .zhHant: [
            "permSystemOneTitle": "System One 代為審核",
            "permSystemOneBody": "開啟的類別裡，System One 判斷動作和目前的工作一致、沒有可疑意圖時，會代你放行；其他一律問你。",
            "permCategoryReadOnlyFiles": "讀取授權資料夾內的檔案",
            "permCategoryGitReadonly": "唯讀的 git 指令",
            "permCategoryCreateCard": "建立卡片或筆記",
            "permCategoryOwnNotification": "建立自己的通知",
            "permAddFolder": "加入資料夾…",
            "permRemove": "移除",
            "permNeedsFolder": "先加入至少一個資料夾。",
            "permDomainsTitle": "可代為讀取的網域",
            "permDomainsBody": "System One 只能對這些網域發 HTTP GET。每行一個；localhost 與私有網段不能加入。",
            "permDomainsSave": "儲存網域",
            "permAllowAllTitle": "全部允許",
            "permAllowAllBody": "在選定的工具與資料夾內不再詢問，重啟後仍保留，直到手動結束。禁止項、權限設定、金鑰與憑證、對外送訊息永遠不包含在內。按下緊急全部暫停會立刻結束。",
            "permToolRead": "讀檔",
            "permToolWrite": "寫檔",
            "permToolCommand": "執行指令",
            "permAllowAllStart": "開始全部允許",
            "permAllowAllNeedsScope": "至少選一個工具和一個資料夾。",
            "permAllowAllActive": "全部允許已開啟",
            "permAllowAllEnd": "立即結束",
            "permAllowAllScope": "範圍：{value}",
            "permUnavailable": "還沒連上服務。",
            "permFailed": "沒有套用：{value}",
            "permSaved": "已套用。",
        ],
        .en: [
            "permSystemOneTitle": "System One review",
            "permSystemOneBody": "For the categories you turn on, System One approves on your behalf when the action matches the current task and nothing looks suspicious. Everything else still asks you.",
            "permCategoryReadOnlyFiles": "Read files in chosen folders",
            "permCategoryGitReadonly": "Read-only git commands",
            "permCategoryCreateCard": "Create cards or notes",
            "permCategoryOwnNotification": "Create its own notifications",
            "permAddFolder": "Add folder…",
            "permRemove": "Remove",
            "permNeedsFolder": "Add at least one folder first.",
            "permDomainsTitle": "Domains it may read",
            "permDomainsBody": "System One may only send HTTP GET requests to these domains. One per line; localhost and private networks are not allowed.",
            "permDomainsSave": "Save domains",
            "permAllowAllTitle": "Allow all",
            "permAllowAllBody": "Stops asking for the chosen tools inside the chosen folders until you end it, including across restarts. Forbidden actions, permission settings, keys and credentials, and sending messages out are never included. Emergency pause ends it immediately.",
            "permToolRead": "Read files",
            "permToolWrite": "Write files",
            "permToolCommand": "Run commands",
            "permAllowAllStart": "Start allow all",
            "permAllowAllNeedsScope": "Choose at least one tool and one folder.",
            "permAllowAllActive": "Allow all is on",
            "permAllowAllEnd": "End now",
            "permAllowAllScope": "Scope: {value}",
            "permUnavailable": "Not connected to the service.",
            "permFailed": "Not applied: {value}",
            "permSaved": "Applied.",
        ],
    ]
}
