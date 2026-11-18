import CardiaryShellCore
import SwiftUI

/// 設定頁的遠端存取分頁：核准配對與管理已配對裝置。
public final class RemoteSettingsTab: SettingsTab {
    public let id = "remote"
    public let titleKey: AppString = .settingsRemoteTab
    private let remote: RemoteModel

    public init(remote: RemoteModel) {
        self.remote = remote
    }

    public func makeBody() -> AnyView {
        AnyView(RemoteSettingsView(remote: remote))
    }
}

private struct RemoteSettingsView: View {
    @ObservedObject var remote: RemoteModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.spacingL) {
                AccessSettingsView(model: remote)
                Divider()
                PairingApprovalView(model: remote)
                Divider()
                DevicesView(model: remote)
            }
        }
    }
}
