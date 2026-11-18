import CardiaryKit
import Foundation

/// 代理權限模式的視圖模型：System One 審核類別、可委派網域與全部允許。
///
/// 規格第 11 章「M5 權限模式裁決」：這些模式只由人開啟，全部允許限定工具與
/// 資料夾、有期限，介面要持續顯示倒數。主機是唯一的真相來源：每個動作都以
/// 主機回傳的完整狀態為準，`system.permissions.changed`（包括緊急全部暫停時
/// 的撤銷）也直接套用。
@MainActor
public final class PermissionModesModel: ObservableObject {
    /// 全部允許可以選的本機工具；權限閘道仍會先擋禁止項。
    public static let allowAllTools = ["read_file", "write_file", "run_command"]

    @Published public private(set) var state: PermissionModesState?
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?
    @Published public private(set) var isWorking = false

    /// 每個路徑類別目前選的資料夾；類別開啟時跟主機同步。
    @Published public var categoryFolders: [DelegatedCategory: [String]] = [:]
    @Published public var domainsText = ""
    @Published public var allowAllSelectedTools: Set<String> = ["read_file"]
    @Published public var allowAllFolders: [String] = []
    @Published public var allowAllMinutes = 15

    private var service: (any PermissionModesService)?
    private let language: AppLanguage?

    public init(language: AppLanguage? = nil) {
        self.language = language
    }

    public func attach(service: any PermissionModesService) {
        self.service = service
    }

    public func detach() {
        service = nil
        state = nil
    }

    /// 路徑類別要選資料夾；其他類別只有開關。
    public static func needsFolders(_ category: DelegatedCategory) -> Bool {
        category == .readOnlyFiles || category == .gitReadonly
    }

    public func isEnabled(_ category: DelegatedCategory) -> Bool {
        state?.categories.contains { $0.category == category } ?? false
    }

    /// 全部允許還有效時的到期時間；已到期或沒開就回 nil。
    public func allowAllExpiry(now: Date = Date()) -> Date? {
        guard let raw = state?.allowAll?.expiresAt, let expiry = Self.parseDate(raw) else {
            return nil
        }
        return expiry > now ? expiry : nil
    }

    public func load() async {
        guard let service else {
            errorMessage = PermissionL10n.text(.permUnavailable, language: language)
            return
        }
        do {
            adopt(try await service.getPermissionModes(), notice: false)
        } catch {
            errorMessage = PermissionL10n.format(.permFailed, value: Self.describe(error), language: language)
        }
    }

    public func setCategory(_ category: DelegatedCategory, enabled: Bool) async {
        let folders = categoryFolders[category] ?? []
        if enabled, Self.needsFolders(category), folders.isEmpty {
            errorMessage = PermissionL10n.text(.permNeedsFolder, language: language)
            return
        }
        await perform { service, requestId in
            try await service.setPermissionCategory(
                category,
                enabled: enabled,
                paths: Self.needsFolders(category) ? folders : [],
                clientRequestId: requestId
            )
        }
    }

    public func addFolder(_ path: String, to category: DelegatedCategory) async {
        var folders = categoryFolders[category] ?? []
        guard !folders.contains(path) else { return }
        folders.append(path)
        categoryFolders[category] = folders
        if isEnabled(category) { await setCategory(category, enabled: true) }
    }

    public func removeFolder(_ path: String, from category: DelegatedCategory) async {
        let folders = (categoryFolders[category] ?? []).filter { $0 != path }
        categoryFolders[category] = folders
        guard isEnabled(category) else { return }
        // 拿掉最後一個資料夾就等於關掉這個類別，不留下沒有範圍的授權。
        await setCategory(category, enabled: !folders.isEmpty)
    }

    public func saveDomains() async {
        let domains = domainsText
            .split(whereSeparator: { $0.isNewline || $0 == "," })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        await perform { service, requestId in
            try await service.setPermissionDomains(domains, clientRequestId: requestId)
        }
    }

    public func startAllowAll() async {
        let tools = Self.allowAllTools.filter { allowAllSelectedTools.contains($0) }
        guard !tools.isEmpty, !allowAllFolders.isEmpty else {
            errorMessage = PermissionL10n.text(.permAllowAllNeedsScope, language: language)
            return
        }
        let maximum = state?.maxAllowAllMinutes ?? 60
        let minutes = min(max(allowAllMinutes, 1), maximum)
        let folders = allowAllFolders
        await perform { service, requestId in
            try await service.grantAllowAll(
                tools: tools, paths: folders, domains: [], minutes: minutes,
                clientRequestId: requestId
            )
        }
    }

    public func endAllowAll() async {
        await perform { service, requestId in
            try await service.revokeAllowAll(clientRequestId: requestId)
        }
    }

    /// 主機推來的 `system.permissions.changed`。
    public func handle(frame: ServerFrame) {
        if case .systemPermissionsChangedEvent(let event) = frame {
            adopt(event.payload, notice: false)
        }
    }

    // MARK: - 內部

    private func perform(
        _ action: (any PermissionModesService, String) async throws -> PermissionModesState
    ) async {
        guard let service else {
            errorMessage = PermissionL10n.text(.permUnavailable, language: language)
            return
        }
        isWorking = true
        defer { isWorking = false }
        do {
            let next = try await action(service, ClientRequestID.next("permissions"))
            adopt(next, notice: true)
        } catch {
            noticeMessage = nil
            errorMessage = PermissionL10n.format(.permFailed, value: Self.describe(error), language: language)
        }
    }

    private func adopt(_ next: PermissionModesState, notice: Bool) {
        state = next
        errorMessage = nil
        if notice { noticeMessage = PermissionL10n.text(.permSaved, language: language) }
        for grant in next.categories where Self.needsFolders(grant.category) {
            categoryFolders[grant.category] = grant.paths
        }
        if domainsText.isEmpty || notice {
            domainsText = next.allowedDomains.joined(separator: "\n")
        }
        allowAllMinutes = min(allowAllMinutes, next.maxAllowAllMinutes)
    }

    static func parseDate(_ raw: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
    }

    private static func describe(_ error: Error) -> String {
        (error as? CardiaryClientError)?.errorDescription ?? "\(error)"
    }
}
