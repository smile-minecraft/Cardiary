import CardiaryApp
import CardiaryKit
import CardiaryShellCore
import Foundation

/// 殼把 `ServiceSupervisor` 的私有控制通道包成介面用的 `RemoteControlService`。
/// 配對核准與裝置撤銷只能走這條通道；App 與網頁客戶端都碰不到。
@MainActor
final class ShellRemoteControl: RemoteControlService {
    private let supervisorProvider: @MainActor () -> ServiceSupervisor?

    init(supervisorProvider: @escaping @MainActor () -> ServiceSupervisor?) {
        self.supervisorProvider = supervisorProvider
    }

    func decidePairing(requestId: String, approve: Bool) async throws {
        guard let supervisor = supervisorProvider() else { throw RemoteControlError.notReady }
        try await supervisor.decidePairing(requestId: requestId, approve: approve)
    }

    func listDevices() async throws -> [ShellPairedDevice] {
        guard let supervisor = supervisorProvider() else { throw RemoteControlError.notReady }
        return try await supervisor.listDevices()
    }

    func revokeDevice(deviceId: String) async throws {
        guard let supervisor = supervisorProvider() else { throw RemoteControlError.notReady }
        try await supervisor.revokeDevice(deviceId: deviceId)
    }
}

enum RemoteControlError: LocalizedError {
    case notReady

    var errorDescription: String? {
        switch self {
        case .notReady: return "背景服務尚未就緒。"
        }
    }
}
