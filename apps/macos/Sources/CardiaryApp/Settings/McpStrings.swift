// 由 Mcp.xcstrings 整理而成的執行期字串表。
// `McpStringCatalogTests` 會逐 key 比對兩邊是否一致。
import Foundation

public enum McpString: String, CaseIterable, Sendable {
    case mcpServersTitle
    case mcpServersHint
    case mcpAdd
    case mcpAddTitle
    case mcpName
    case mcpTransport
    case mcpTransportStdio
    case mcpTransportHTTP
    case mcpCommand
    case mcpArguments
    case mcpURL
    case mcpAllowedHosts
    case mcpAllowedHostsHint
    case mcpCreate
    case mcpCancel
    case mcpLoading
    case mcpLoadFailed
    case mcpRequestFailed
    case mcpServiceUnavailable
    case mcpEmpty
    case mcpWaitingApproval
    case mcpApprovalSubmitted
    case mcpApprovalNote
    case mcpAdded
    case mcpRemove
    case mcpRemoveConfirmTitle
    case mcpRemoveConfirmBody
    case mcpRemoved
    case mcpStateReady
    case mcpStateDisabled
    case mcpStateFailed
    case mcpFailure
    case mcpHostsEmpty
    case mcpHostAdd
    case mcpHostPlaceholder
    case mcpHostRemove
    case mcpHostsSaved
    case mcpEnabledNotice
    case mcpDisabledNotice
    case mcpInvalidForm
    case mcpStdioSecretNote
}

public enum McpL10n {
    public static func text(_ key: McpString, language: AppLanguage? = nil) -> String {
        resolve(key.rawValue, language: language)
    }

    public static func format(_ key: McpString, _ values: [String: String], language: AppLanguage? = nil) -> String {
        var text = resolve(key.rawValue, language: language)
        for (name, value) in values {
            text = text.replacingOccurrences(of: "{\(name)}", with: value)
        }
        return text
    }

    public static func format(_ key: McpString, value: String, language: AppLanguage? = nil) -> String {
        format(key, ["value": value], language: language)
    }

    public static func format(_ key: McpString, name: String, language: AppLanguage? = nil) -> String {
        format(key, ["name": name], language: language)
    }

    static func table(_ language: AppLanguage) -> [String: String] {
        tables[language] ?? [:]
    }

    static var allKeys: [String] { McpString.allCases.map(\.rawValue) }

    private static func resolve(_ key: String, language: AppLanguage?) -> String {
        let chosen = language ?? AppL10n.language
        return tables[chosen]?[key] ?? tables[.en]?[key] ?? key
    }

    private static let tables: [AppLanguage: [String: String]] = [
        .zhHant: [
            "mcpServersTitle": "MCP 伺服器",
            "mcpServersHint": "以標準輸入或 HTTP 連上外部工具。密鑰與環境變數留在主機，畫面不會顯示。",
            "mcpAdd": "新增伺服器",
            "mcpAddTitle": "新增 MCP 伺服器",
            "mcpName": "名稱",
            "mcpTransport": "連線方式",
            "mcpTransportStdio": "標準輸入",
            "mcpTransportHTTP": "HTTP",
            "mcpCommand": "執行檔",
            "mcpArguments": "參數（以空白分隔）",
            "mcpURL": "網址",
            "mcpAllowedHosts": "允許的網域",
            "mcpAllowedHostsHint": "只有這些網域會被允許；網址本身的網域一定會加入。",
            "mcpCreate": "新增",
            "mcpCancel": "取消",
            "mcpLoading": "正在載入 MCP 伺服器…",
            "mcpLoadFailed": "無法載入 MCP 伺服器：{value}",
            "mcpRequestFailed": "MCP 請求失敗：{value}",
            "mcpServiceUnavailable": "還沒連上服務，MCP 設定需要連線。",
            "mcpEmpty": "還沒有 MCP 伺服器。新增一個，代理就能使用它的工具。",
            "mcpWaitingApproval": "等待審批",
            "mcpApprovalSubmitted": "已送出審批。批准之後才會啟動伺服器。",
            "mcpApprovalNote": "新增伺服器要經審批；批准前不會啟動，代理也不能使用它的工具。",
            "mcpAdded": "伺服器已加入。",
            "mcpRemove": "移除",
            "mcpRemoveConfirmTitle": "移除「{name}」？",
            "mcpRemoveConfirmBody": "代理將無法再使用它的工具，快取的工具清單也會一起刪除。",
            "mcpRemoved": "已移除伺服器。",
            "mcpStateReady": "已就緒",
            "mcpStateDisabled": "已停用",
            "mcpStateFailed": "連線失敗",
            "mcpFailure": "失敗原因：{value}",
            "mcpHostsEmpty": "沒有允許的網域。",
            "mcpHostAdd": "加入",
            "mcpHostPlaceholder": "example.com",
            "mcpHostRemove": "移除網域 {name}",
            "mcpHostsSaved": "已更新允許的網域。",
            "mcpEnabledNotice": "已啟用伺服器。",
            "mcpDisabledNotice": "已停用伺服器。",
            "mcpInvalidForm": "請填寫名稱與必要的連線欄位。",
            "mcpStdioSecretNote": "標準輸入的伺服器由主機執行；環境變數與密鑰不會顯示在這裡。",
        ],
        .en: [
            "mcpServersTitle": "MCP Servers",
            "mcpServersHint": "Connect external tools over stdio or HTTP. Secrets and environment variables stay on the host and are never shown here.",
            "mcpAdd": "Add server",
            "mcpAddTitle": "New MCP server",
            "mcpName": "Name",
            "mcpTransport": "Transport",
            "mcpTransportStdio": "Standard input",
            "mcpTransportHTTP": "HTTP",
            "mcpCommand": "Command",
            "mcpArguments": "Arguments (space separated)",
            "mcpURL": "URL",
            "mcpAllowedHosts": "Allowed hosts",
            "mcpAllowedHostsHint": "Only these hosts are allowed; the URL's own host is always included.",
            "mcpCreate": "Add",
            "mcpCancel": "Cancel",
            "mcpLoading": "Loading MCP servers…",
            "mcpLoadFailed": "Could not load MCP servers: {value}",
            "mcpRequestFailed": "MCP request failed: {value}",
            "mcpServiceUnavailable": "MCP settings need a service connection.",
            "mcpEmpty": "No MCP servers yet. Add one so agents can use its tools.",
            "mcpWaitingApproval": "Waiting for approval",
            "mcpApprovalSubmitted": "Sent for approval. The server starts only after it is approved.",
            "mcpApprovalNote": "New servers need approval; until then they do not start and agents cannot use their tools.",
            "mcpAdded": "Server added.",
            "mcpRemove": "Remove",
            "mcpRemoveConfirmTitle": "Remove “{name}”?",
            "mcpRemoveConfirmBody": "Agents lose access to its tools, and the cached tool list is deleted too.",
            "mcpRemoved": "Server removed.",
            "mcpStateReady": "Ready",
            "mcpStateDisabled": "Disabled",
            "mcpStateFailed": "Failed",
            "mcpFailure": "Failure: {value}",
            "mcpHostsEmpty": "No allowed hosts.",
            "mcpHostAdd": "Add",
            "mcpHostPlaceholder": "example.com",
            "mcpHostRemove": "Remove host {name}",
            "mcpHostsSaved": "Allowed hosts updated.",
            "mcpEnabledNotice": "Server enabled.",
            "mcpDisabledNotice": "Server disabled.",
            "mcpInvalidForm": "Fill in the name and the required connection fields.",
            "mcpStdioSecretNote": "Standard-input servers run on the host; environment variables and secrets are not shown here.",
        ],
    ]
}
