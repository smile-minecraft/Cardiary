import CardiaryKit
import CardiaryShellCore
import Combine
import Foundation

/// 一筆待核准的配對請求在介面上的樣子。
public struct PairingPresentation: Identifiable, Equatable, Sendable {
    public let pairingRequestId: String
    public let deviceName: String
    public let deviceKind: String
    public let code: String
    public let expiresAt: String

    public var id: String { pairingRequestId }

    public init(notice: PairingNotice) {
        self.pairingRequestId = notice.pairingRequestId
        self.deviceName = notice.deviceName
        self.deviceKind = notice.deviceKind
        self.code = notice.code
        self.expiresAt = notice.expiresAt
    }
}

/// 遠端存取的狀態：待核准配對與已配對裝置。
///
/// 核准、拒絕、列出與撤銷全部交給 `RemoteControlService`（殼的私有控制通道），
/// 介面不碰控制 Token，也不直接連服務。視圖模型可以用假服務單獨測試。
@MainActor
public final class RemoteModel: ObservableObject {
    @Published public private(set) var pendingRequests: [PairingPresentation] = []
    @Published public private(set) var devices: [ShellPairedDevice] = []
    @Published public private(set) var decidingIds: Set<String> = []
    @Published public private(set) var revokingIds: Set<String> = []
    @Published public private(set) var isKnown = false
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?

    /// 主機的人類專屬設定 `remote.accessEnabled`。還沒讀到之前一律當作關閉。
    @Published public private(set) var accessEnabled = false
    @Published public private(set) var accessLoaded = false
    @Published public private(set) var savingAccess = false
    @Published public private(set) var accessError: String?
    @Published public private(set) var accessNotice: String?
    /// 服務實際監聽的埠；由殼在服務就緒後填入。
    @Published public private(set) var servicePort: UInt16?

    private var service: (any RemoteControlService)?
    private var settingsService: (any SettingsService)?
    private let language: AppLanguage

    /// 主機設定鍵；關閉時閘道只接受本機連線。
    public static let accessSettingKey = "remote.accessEnabled"

    public init(language: AppLanguage = AppL10n.language) {
        self.language = language
    }

    /// 遠端裝置要打開的位址。沒有服務埠時為 `nil`。
    public var remoteAddress: String? {
        servicePort.map { "http://127.0.0.1:\($0)" }
    }

    /// 遠端存取關閉時，新的配對與遠端連線都會被主機拒絕；已配對裝置仍可列出。
    public var isPairingPaused: Bool { accessLoaded && !accessEnabled }

    public func attach(service: any RemoteControlService) {
        self.service = service
    }

    public func detach() {
        service = nil
        pendingRequests = []
        devices = []
        isKnown = false
        decidingIds = []
        revokingIds = []
    }

    /// 設定請求走客戶端協定；殼在連線建立後一起接上。
    public func attachSettings(service: any SettingsService) {
        settingsService = service
    }

    public func detachSettings() {
        settingsService = nil
        accessEnabled = false
        accessLoaded = false
        savingAccess = false
        accessError = nil
        accessNotice = nil
    }

    /// 殼回報服務實際監聽的埠。
    public func update(servicePort: UInt16?) {
        self.servicePort = servicePort
    }

    /// 從主機讀取 `remote.accessEnabled`。
    public func loadAccessSetting() async {
        guard let settingsService else { return }
        do {
            let payload = try await settingsService.getSettings()
            let item = payload.settings.first { $0.key == Self.accessSettingKey }
            if case .bool(let enabled)? = item?.value {
                accessEnabled = enabled
            } else {
                accessEnabled = false
            }
            accessLoaded = true
            accessError = nil
        } catch {
            accessError = RemoteL10n.format(
                .remoteAccessLoadFailed, value: Self.errorText(error), language: language
            )
        }
    }

    /// 寫入 `remote.accessEnabled`。成功後以主機回傳的值為準。
    public func setAccessEnabled(_ enabled: Bool) async {
        guard !savingAccess else { return }
        guard let settingsService else {
            accessError = RemoteL10n.text(.remoteAccessUnavailable, language: language)
            return
        }
        savingAccess = true
        defer { savingAccess = false }
        do {
            let payload = try await settingsService.setSettings(
                changes: [
                    SettingChange(key: Self.accessSettingKey, value: .bool(enabled))
                ],
                clientRequestId: ClientRequestID.next("remote-access")
            )
            let applied = payload.applied.first { $0.key == Self.accessSettingKey }
            if case .bool(let saved)? = applied?.value {
                accessEnabled = saved
            } else {
                accessEnabled = enabled
            }
            accessLoaded = true
            accessError = nil
            accessNotice = RemoteL10n.text(.remoteAccessSaved, language: language)
        } catch {
            accessError = RemoteL10n.format(
                .remoteAccessSaveFailed, value: Self.errorText(error), language: language
            )
        }
    }

    /// 服務送來新的配對請求；同一個識別碼重複送來時不產生第二個視窗。
    public func receive(notice: PairingNotice) {
        let presentation = PairingPresentation(notice: notice)
        guard !pendingRequests.contains(where: { $0.pairingRequestId == presentation.pairingRequestId })
        else { return }
        pendingRequests.append(presentation)
    }

    /// 殼推來的完整裝置清單。
    public func update(devices: [ShellPairedDevice]) {
        self.devices = devices
        isKnown = true
        revokingIds.formIntersection(Set(devices.map(\.deviceId)))
    }

    public func approve(_ request: PairingPresentation) async {
        await decide(request, approve: true)
    }

    public func deny(_ request: PairingPresentation) async {
        await decide(request, approve: false)
    }

    /// 核准或拒絕一筆配對請求。成功後先從待辦移除；失敗時保留讓使用者重試。
    public func decide(_ request: PairingPresentation, approve: Bool) async {
        guard !decidingIds.contains(request.pairingRequestId) else { return }
        guard let service else {
            errorMessage = RemoteL10n.text(.remoteAccessUnavailable, language: language)
            return
        }
        decidingIds.insert(request.pairingRequestId)
        defer { decidingIds.remove(request.pairingRequestId) }
        do {
            try await service.decidePairing(requestId: request.pairingRequestId, approve: approve)
            pendingRequests.removeAll { $0.pairingRequestId == request.pairingRequestId }
            errorMessage = nil
            noticeMessage = approve
                ? RemoteL10n.text(.remotePairingApproved, language: language)
                : RemoteL10n.text(.remotePairingDenied, language: language)
        } catch {
            errorMessage = RemoteL10n.format(
                .remotePairingFailed, value: Self.errorText(error), language: language
            )
        }
    }

    public func refreshDevices() async {
        guard let service else {
            errorMessage = RemoteL10n.text(.remoteAccessUnavailable, language: language)
            return
        }
        do {
            update(devices: try await service.listDevices())
            errorMessage = nil
        } catch {
            errorMessage = RemoteL10n.format(
                .remoteDevicesRevokeFailed, value: Self.errorText(error), language: language
            )
        }
    }

    /// 撤銷一台裝置；成功後立即從清單移除，失敗時保留。
    public func revoke(_ device: ShellPairedDevice) async {
        guard !revokingIds.contains(device.deviceId) else { return }
        guard let service else {
            errorMessage = RemoteL10n.text(.remoteAccessUnavailable, language: language)
            return
        }
        revokingIds.insert(device.deviceId)
        defer { revokingIds.remove(device.deviceId) }
        do {
            try await service.revokeDevice(deviceId: device.deviceId)
            devices.removeAll { $0.deviceId == device.deviceId }
            errorMessage = nil
            noticeMessage = RemoteL10n.text(.remoteDevicesRevokedDone, language: language)
        } catch {
            errorMessage = RemoteL10n.format(
                .remoteDevicesRevokeFailed, value: Self.errorText(error), language: language
            )
        }
    }

    public func dismissMessages() {
        errorMessage = nil
        noticeMessage = nil
    }

    private static func errorText(_ error: any Error) -> String {
        (error as? CardiaryClientError)?.errorDescription ?? "\(error)"
    }
}
