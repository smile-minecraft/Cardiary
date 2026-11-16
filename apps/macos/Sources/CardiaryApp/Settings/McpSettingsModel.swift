import CardiaryKit
import Combine
import Foundation

/// MCP 分頁：伺服器清單、新增（送審批）、移除、啟停與允許網域。
///
/// 新增不會立刻生效：主機先建立審批，批准後才以 `mcp.servers_changed` 事件送來
/// 真正的伺服器。畫面在等待期間顯示「等待審批」。
@MainActor
public final class McpSettingsModel: ObservableObject {
    @Published public private(set) var servers: [McpServerInfo] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var updatingIds: Set<String> = []
    @Published public private(set) var awaitingApproval = false
    @Published public private(set) var pendingApprovalId: String?
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?

    private var service: (any CardiaryService)?
    private let language: AppLanguage
    /// 換服務時遞增；舊訂閱收到的事件直接丟掉，不會蓋掉新連線的資料。
    private var subscriptionGeneration = 0
    /// 已送出審批、還沒出現在清單裡的伺服器名稱。只有同名的伺服器出現才算批准完成。
    private var pendingServerName: String?

    /// - Parameter language: 這個模型產生訊息時用的介面語言。預設跟著 App 目前的語言，
    ///   測試可以指定，讓結果不受系統語言影響。
    public init(language: AppLanguage = AppL10n.language) {
        self.language = language
    }

    public func attach(service: any CardiaryService) {
        self.service = service
        subscriptionGeneration += 1
        let generation = subscriptionGeneration
        Task { [weak self] in
            await service.setMcpServersChangedHandler { [weak self] payload in
                guard let self else { return }
                Task { @MainActor in
                    guard self.subscriptionGeneration == generation else { return }
                    self.apply(payload)
                }
            }
            // 安裝期間剛好 detach：晚到的訂閱要撤掉，不能留在舊服務上。
            guard let self, self.subscriptionGeneration == generation else {
                await service.setMcpServersChangedHandler(nil)
                return
            }
        }
    }

    public func detach() {
        subscriptionGeneration += 1
        let previous = service
        service = nil
        servers = []
        updatingIds = []
        awaitingApproval = false
        pendingApprovalId = nil
        pendingServerName = nil
        if let previous {
            Task { await previous.setMcpServersChangedHandler(nil) }
        }
    }

    public func load() async {
        guard let service else {
            errorMessage = McpL10n.text(.mcpServiceUnavailable, language: language)
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            servers = try await service.listMcpServers().servers
            errorMessage = nil
        } catch {
            errorMessage = failure(error)
        }
    }

    /// 新增伺服器。回傳值代表請求是否送出；伺服器本身要等審批通過才會出現。
    @discardableResult
    public func add(
        name: String,
        transport: McpTransport,
        command: String? = nil,
        arguments: String = "",
        url: String? = nil,
        allowedHosts: String = ""
    ) async -> Bool {
        guard let service else {
            errorMessage = McpL10n.text(.mcpServiceUnavailable, language: language)
            return false
        }
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedCommand = command?.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedURL = url?.trimmingCharacters(in: .whitespacesAndNewlines)
        switch transport {
        case .stdio:
            guard !trimmedName.isEmpty, let trimmedCommand, !trimmedCommand.isEmpty else {
                errorMessage = McpL10n.text(.mcpInvalidForm, language: language)
                return false
            }
        case .http:
            guard !trimmedName.isEmpty, let trimmedURL, !trimmedURL.isEmpty else {
                errorMessage = McpL10n.text(.mcpInvalidForm, language: language)
                return false
            }
        }

        do {
            let hosts = transport == .http
                ? Self.hostsIncludingURLHost(Self.parseHosts(allowedHosts), url: trimmedURL ?? "")
                : []
            let payload = try await service.addMcpServer(
                name: trimmedName,
                transport: transport,
                command: transport == .stdio ? trimmedCommand : nil,
                args: transport == .stdio ? Self.parseArguments(arguments) : nil,
                url: transport == .http ? trimmedURL : nil,
                allowedHosts: hosts,
                clientRequestId: ClientRequestID.next("mcp")
            )
            pendingApprovalId = payload.approvalId
            pendingServerName = trimmedName
            awaitingApproval = true
            errorMessage = nil
            noticeMessage = McpL10n.text(.mcpApprovalSubmitted, language: language)
            return true
        } catch {
            errorMessage = failure(error)
            return false
        }
    }

    public func remove(_ server: McpServerInfo) async {
        guard let service else {
            errorMessage = McpL10n.text(.mcpServiceUnavailable, language: language)
            return
        }
        guard !updatingIds.contains(server.serverId) else { return }
        updatingIds.insert(server.serverId)
        defer { updatingIds.remove(server.serverId) }
        do {
            _ = try await service.removeMcpServer(serverId: server.serverId)
            servers.removeAll { $0.serverId == server.serverId }
            errorMessage = nil
            noticeMessage = McpL10n.text(.mcpRemoved, language: language)
        } catch {
            errorMessage = failure(error)
        }
    }

    public func setEnabled(_ server: McpServerInfo, enabled: Bool) async {
        guard let service else {
            errorMessage = McpL10n.text(.mcpServiceUnavailable, language: language)
            return
        }
        guard !updatingIds.contains(server.serverId) else { return }
        updatingIds.insert(server.serverId)
        defer { updatingIds.remove(server.serverId) }
        do {
            let payload = try await service.setMcpServerEnabled(
                serverId: server.serverId,
                enabled: enabled,
                clientRequestId: ClientRequestID.next("mcp")
            )
            replace(payload.server)
            errorMessage = nil
            noticeMessage = McpL10n.text(
                enabled ? .mcpEnabledNotice : .mcpDisabledNotice,
                language: language
            )
        } catch {
            errorMessage = failure(error)
        }
    }

    public func setAllowedHosts(_ server: McpServerInfo, hosts: [String]) async {
        guard let service else {
            errorMessage = McpL10n.text(.mcpServiceUnavailable, language: language)
            return
        }
        guard !updatingIds.contains(server.serverId) else { return }
        updatingIds.insert(server.serverId)
        defer { updatingIds.remove(server.serverId) }
        let hosts = server.transport == .http
            ? Self.hostsIncludingURLHost(hosts, url: server.url ?? "")
            : hosts
        do {
            let payload = try await service.setMcpServerAllowedHosts(
                serverId: server.serverId,
                allowedHosts: hosts
            )
            replace(payload.server)
            errorMessage = nil
            noticeMessage = McpL10n.text(.mcpHostsSaved, language: language)
        } catch {
            errorMessage = failure(error)
        }
    }

    public func addAllowedHost(_ host: String, to server: McpServerInfo) async {
        let trimmed = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return }
        var hosts = server.allowedHosts
        if !hosts.contains(trimmed) {
            hosts.append(trimmed)
        }
        await setAllowedHosts(server, hosts: hosts)
    }

    public func removeAllowedHost(_ host: String, from server: McpServerInfo) async {
        let hosts = server.allowedHosts.filter { $0 != host }
        await setAllowedHosts(server, hosts: hosts)
    }

    /// 伺服器清單變動事件。新增、批准、啟停、允許網域與移除都會走這裡。
    ///
    /// 等待審批只在「同名的伺服器出現」時結束；其他伺服器的事件不能結束它，
    /// 否則使用者會誤以為自己送出的伺服器已經批准。
    public func apply(_ payload: McpServersChangedEventPayload) {
        if payload.removed {
            servers.removeAll { $0.serverId == payload.server.serverId }
        } else {
            replace(payload.server)
        }
        if let pending = pendingServerName, payload.server.name == pending {
            pendingServerName = nil
            awaitingApproval = false
            pendingApprovalId = nil
            noticeMessage = McpL10n.text(
                payload.removed ? .mcpRemoved : .mcpAdded,
                language: language
            )
        }
        errorMessage = nil
    }

    public func dismissMessages() {
        errorMessage = nil
        noticeMessage = nil
    }

    public static func stateKey(_ state: McpServerState) -> McpString {
        switch state {
        case .ready: return .mcpStateReady
        case .disabled: return .mcpStateDisabled
        case .failed: return .mcpStateFailed
        }
    }

    /// 參數欄位：空白分隔，成對的單引號或雙引號包住的內容算一個參數。
    public static func parseArguments(_ text: String) -> [String] {
        var result: [String] = []
        var current = ""
        var quote: Character?
        var started = false
        for character in text {
            if let active = quote {
                if character == active {
                    quote = nil
                } else {
                    current.append(character)
                }
                continue
            }
            if character == "\"" || character == "'" {
                quote = character
                started = true
                continue
            }
            if character.isWhitespace {
                if started {
                    result.append(current)
                    current = ""
                    started = false
                }
                continue
            }
            current.append(character)
            started = true
        }
        if started {
            result.append(current)
        }
        return result
    }

    /// 網域欄位：逗號或空白分隔，去掉空白並轉小寫。
    public static func parseHosts(_ text: String) -> [String] {
        text.split(whereSeparator: { $0 == "," || $0.isWhitespace })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
    }

    /// HTTP 伺服器的 URL 網域一定要留在允許清單裡；主機連線時會檢查每一個重新導向的網域。
    /// 網域只取 hostname 並轉小寫，不包含通訊協定、連接埠或路徑。
    public static func hostsIncludingURLHost(_ hosts: [String], url: String) -> [String] {
        guard let host = URLComponents(string: url)?.host?.lowercased(), !host.isEmpty else {
            return hosts
        }
        var result = hosts
        if !result.contains(host) {
            result.append(host)
        }
        return result
    }

    private func replace(_ server: McpServerInfo) {
        if let index = servers.firstIndex(where: { $0.serverId == server.serverId }) {
            servers[index] = server
        } else {
            servers.append(server)
        }
    }

    private func failure(_ error: any Error) -> String {
        let detail = (error as? CardiaryClientError)?.errorDescription ?? "\(error)"
        return McpL10n.format(.mcpRequestFailed, value: detail, language: language)
    }
}
