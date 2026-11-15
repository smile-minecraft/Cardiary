import SwiftUI

/// 產品介面的根畫面：依 `AppModel` 的狀態決定顯示首次設定、資料不可用、需要更新或主視窗。
public struct CardiaryRootView: View {
    @ObservedObject private var model: AppModel

    public init(model: AppModel) {
        self.model = model
    }

    public var body: some View {
        Group {
            switch model.screen {
            case .firstRun:
                FirstRunView(model: model)
            case .unavailable(let state):
                UnavailableView(model: model, folderState: state)
            case .needsUpdate:
                NeedsUpdateView()
            case .main:
                MainWindowView(model: model)
            }
        }
        .frame(minWidth: DesignTokens.windowMinWidth, minHeight: DesignTokens.windowMinHeight)
        .background(Palette.canvas)
        .cardiaryTheme()
    }
}

/// 資料不可用：接回磁碟、換資料夾或重試。Cardiary 不會建立空資料夾。
struct UnavailableView: View {
    @ObservedObject var model: AppModel
    let folderState: FolderPresentation.Availability

    var body: some View {
        StatusCard(suit: .diamond, systemImage: "externaldrive.badge.questionmark") {
            Text(AppL10n.text(.unavailableTitle))
                .font(.cardiary(.title2, weight: .bold))
            Text(AppL10n.format(.folderLabel, value: model.bridge.folder.path ?? model.bridge.folder.displayName ?? "—"))
                .font(.cardiary(.callout))
                .foregroundStyle(Palette.inkSecondary)
                .padding(.horizontal, DesignTokens.spacingM)
                .padding(.vertical, DesignTokens.spacingXS)
                .background(Palette.sunken, in: Capsule(style: .continuous))
            Text(AppL10n.text(.unavailableBody))
                .multilineTextAlignment(.center)
                .foregroundStyle(Palette.inkSecondary)
            HStack(spacing: DesignTokens.spacingM) {
                Button(AppL10n.text(.unavailableChooseFolder)) { model.chooseFolder() }
                    .buttonStyle(.themePrimary)
                    .keyboardShortcut(.defaultAction)
                Button(AppL10n.text(.unavailableRetry)) { model.retry() }
            }
            .padding(.top, DesignTokens.spacingS)
        }
    }
}

/// 服務或協定版本不符：重連沒有用，要更新 App。
struct NeedsUpdateView: View {
    var body: some View {
        StatusCard(suit: .spade, systemImage: "arrow.down.circle") {
            Text(AppL10n.text(.updateRequiredTitle))
                .font(.cardiary(.title2, weight: .bold))
            Text(AppL10n.text(.updateRequiredBody))
                .multilineTextAlignment(.center)
                .foregroundStyle(Palette.inkSecondary)
        }
    }
}

/// 置中的大色塊：花色圖示、標題、說明與動作。資料不可用與需要更新共用。
private struct StatusCard<Content: View>: View {
    let suit: Suit
    let systemImage: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: DesignTokens.spacingL) {
            ZStack {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(suit.soft)
                    .frame(width: 76, height: 76)
                Image(systemName: systemImage)
                    .font(.system(size: 32, weight: .semibold))
                    .foregroundStyle(suit.ink)
            }
            content
            SuitDivider()
                .frame(width: 160)
                .padding(.top, DesignTokens.spacingS)
        }
        .frame(maxWidth: DesignTokens.firstRunMaxWidth)
        .padding(DesignTokens.spacingXL)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: DesignTokens.panelRadius, style: .continuous))
        .padding(DesignTokens.spacingXL)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// 主視窗上方的連線狀態；連線正常時不佔空間。
struct ConnectionBanner: View {
    @ObservedObject var model: AppModel

    var body: some View {
        if let text {
            HStack(spacing: DesignTokens.spacingS) {
                Image(systemName: "bolt.horizontal.circle.fill")
                    .foregroundStyle(Palette.orangeInk)
                Text(text)
                    .font(.cardiary(.callout))
                Spacer()
                if case .disconnected = model.bridge.connection {
                    Button(AppL10n.text(.connectionRetry)) { model.retry() }
                        .buttonStyle(ThemeButtonStyle(kind: .primary, tone: .orange))
                        .controlSize(.small)
                } else {
                    SuitLoader(size: 7)
                }
            }
            .padding(.horizontal, DesignTokens.spacingM)
            .padding(.vertical, DesignTokens.spacingS)
            .background(Palette.orangeSoft, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
            .padding(.horizontal, DesignTokens.spacingM)
            .padding(.top, DesignTokens.spacingS)
        }
    }

    private var text: String? {
        switch model.bridge.connection {
        case .connected:
            return nil
        case .connecting:
            return AppL10n.text(.connectionConnecting)
        case .waitingForService:
            return AppL10n.text(.connectionConnecting)
        case .disconnected(let reason):
            return AppL10n.format(.connectionDisconnected, value: reason)
        case .needsUpdate:
            return AppL10n.text(.updateRequiredBody)
        }
    }
}
