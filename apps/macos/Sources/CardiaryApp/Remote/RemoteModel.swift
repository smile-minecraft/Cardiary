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

    private var service: (any RemoteControlService)?
    private let language: AppLanguage

    public init(language: AppLanguage = AppL10n.language) {
        self.language = language
    }

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
