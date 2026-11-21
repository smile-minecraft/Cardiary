import AppKit
import CardiaryShellCore
import SwiftUI

/// 遠端存取開關與服務位址：開關寫入主機的 human-only 設定。
struct AccessSettingsView: View {
    @ObservedObject var model: RemoteModel
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            Text(RemoteL10n.text(.remoteAccessTitle))
                .cardiaryFont(.title3, weight: .semibold)
            Toggle(
                isOn: Binding(
                    get: { model.accessEnabled },
                    set: { enabled in Task { await model.setAccessEnabled(enabled) } }
                )
            ) {
                Text(RemoteL10n.text(.remoteAccessToggle))
            }
            .toggleStyle(.switch)
            .disabled(model.savingAccess)
            Text(RemoteL10n.text(.remoteAccessBody))
                .cardiaryFont(.caption)
                .foregroundStyle(Palette.inkSecondary)
            if model.isPairingPaused {
                Text(RemoteL10n.text(.remoteAccessDisabledHint))
                    .cardiaryFont(.caption)
                    .foregroundStyle(Palette.inkSecondary)
            }
            if let message = model.accessError {
                Text(message).cardiaryFont(.caption).foregroundStyle(Palette.red)
            }
            if let message = model.accessNotice {
                Text(message).cardiaryFont(.caption).foregroundStyle(Palette.sageInk)
            }

            VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
                Text(RemoteL10n.text(.remoteAddressTitle))
                    .cardiaryFont(.callout, weight: .semibold)
                if let address = model.remoteAddress {
                    HStack {
                        Text(address)
                            .cardiaryFont(.callout, weight: .regular, monospacedDigits: true)
                            .textSelection(.enabled)
                        Spacer()
                        Button {
                            copy(address)
                        } label: {
                            Label(RemoteL10n.text(.remoteAddressCopy), systemImage: "doc.on.doc")
                        }
                        .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
                    }
                    Text(RemoteL10n.text(.remoteAddressHint))
                        .cardiaryFont(.caption)
                        .foregroundStyle(Palette.inkSecondary)
                } else {
                    Text(RemoteL10n.text(.remoteAddressUnavailable))
                        .cardiaryFont(.caption)
                        .foregroundStyle(Palette.inkSecondary)
                }
                if copied {
                    Text(RemoteL10n.text(.remoteAddressCopied))
                        .cardiaryFont(.caption)
                        .foregroundStyle(Palette.sageInk)
                }
            }
            .padding(DesignTokens.spacingM)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
        }
        .padding(DesignTokens.spacingM)
    }

    private func copy(_ address: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(address, forType: .string)
        copied = true
    }
}

/// 配對核准視窗：顯示裝置名稱、種類、短碼與期限，讓人決定核准或拒絕。
///
/// 由 `notify.pairing_requested` 推入待辦；一次顯示一筆，核准或拒絕後換下一筆。
public struct PairingApprovalView: View {
    @ObservedObject var model: RemoteModel

    public init(model: RemoteModel) {
        self.model = model
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            if let request = model.pendingRequests.first {
                Text(RemoteL10n.text(.remotePairingTitle))
                    .cardiaryFont(.title3, weight: .semibold)
                Text(RemoteL10n.text(.remotePairingBody))
                    .cardiaryFont(.callout)
                    .foregroundStyle(Palette.inkSecondary)

                VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
                    Text(RemoteL10n.format(.remotePairingDevice, value: request.deviceName))
                    Text(kindLabel(request.deviceKind))
                        .cardiaryFont(.caption)
                        .foregroundStyle(Palette.inkSecondary)
                    Text(RemoteL10n.format(.remotePairingCode, value: request.code))
                        .cardiaryFont(.title2, weight: .bold, monospacedDigits: true)
                    Text(RemoteL10n.format(.remotePairingExpires, value: request.expiresAt))
                        .cardiaryFont(.caption)
                        .foregroundStyle(Palette.inkSecondary)
                }
                .padding(DesignTokens.spacingM)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))

                HStack(spacing: DesignTokens.spacingS) {
                    Button {
                        Task { await model.deny(request) }
                    } label: {
                        Label(RemoteL10n.text(.remotePairingDeny), systemImage: "xmark")
                    }
                    .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
                    .disabled(model.decidingIds.contains(request.pairingRequestId))

                    Button {
                        Task { await model.approve(request) }
                    } label: {
                        Label(RemoteL10n.text(.remotePairingApprove), systemImage: "checkmark")
                    }
                    .buttonStyle(.themePrimary)
                    .disabled(model.decidingIds.contains(request.pairingRequestId))
                }

                if model.decidingIds.contains(request.pairingRequestId) {
                    Text(RemoteL10n.text(.remotePairingDeciding))
                        .cardiaryFont(.caption)
                        .foregroundStyle(Palette.inkSecondary)
                }
            } else {
                ThemeEmptyState(
                    text: RemoteL10n.text(.remoteDevicesEmpty),
                    suit: .club,
                    systemImage: "bell.and.waves.left.and.right"
                )
            }

            if let message = model.errorMessage {
                Text(message).cardiaryFont(.caption).foregroundStyle(Palette.red)
            }
            if let message = model.noticeMessage {
                Text(message).cardiaryFont(.caption).foregroundStyle(Palette.sageInk)
            }
        }
        .padding(DesignTokens.spacingM)
    }

    private func kindLabel(_ kind: String) -> String {
        switch kind {
        case "web": return RemoteL10n.text(.remotePairingKindWeb)
        case "ios": return RemoteL10n.text(.remotePairingKindIos)
        default: return kind
        }
    }
}

/// 已配對裝置清單：名稱、指紋、建立時間與撤銷。
public struct DevicesView: View {
    @ObservedObject var model: RemoteModel

    public init(model: RemoteModel) {
        self.model = model
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            HStack {
                Text(RemoteL10n.text(.remoteDevicesTitle))
                    .cardiaryFont(.title3, weight: .semibold)
                Spacer()
                Button {
                    Task { await model.refreshDevices() }
                } label: {
                    Label(RemoteL10n.text(.remoteDevicesRefresh), systemImage: "arrow.clockwise")
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
            }

            if model.devices.isEmpty {
                ThemeEmptyState(text: RemoteL10n.text(.remoteDevicesEmpty), suit: .club, systemImage: "desktopcomputer")
            } else {
                ScrollView {
                    LazyVStack(spacing: DesignTokens.spacingS) {
                        ForEach(model.devices) { device in
                            DeviceRow(device: device, model: model)
                        }
                    }
                }
            }

            if let message = model.errorMessage {
                Text(message).cardiaryFont(.caption).foregroundStyle(Palette.red)
            }
            if let message = model.noticeMessage {
                Text(message).cardiaryFont(.caption).foregroundStyle(Palette.sageInk)
            }
        }
        .padding(DesignTokens.spacingM)
        .task { await model.refreshDevices() }
    }
}

private struct DeviceRow: View {
    let device: ShellPairedDevice
    @ObservedObject var model: RemoteModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(device.deviceName)
                    .cardiaryFont(.callout, weight: .semibold)
                Spacer()
                if device.isRevoked {
                    ThemeChip(text: RemoteL10n.text(.remoteDevicesRevoked), tone: .gray)
                }
            }
            Text(RemoteL10n.format(.remoteDevicesFingerprint, value: device.fingerprint))
                .cardiaryFont(.caption, weight: .regular, monospacedDigits: true)
                .foregroundStyle(Palette.inkSecondary)
                .lineLimit(1)
                .truncationMode(.middle)
            Text(RemoteL10n.format(.remoteDevicesLastUsed, value: device.createdAt))
                .cardiaryFont(.caption)
                .foregroundStyle(Palette.inkTertiary)
            if !device.isRevoked {
                Button(role: .destructive) {
                    Task { await model.revoke(device) }
                } label: {
                    Label(RemoteL10n.text(.remoteDevicesRevoke), systemImage: "slash.circle")
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .red))
                .disabled(model.revokingIds.contains(device.deviceId))
            }
        }
        .padding(DesignTokens.spacingM)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
    }
}
