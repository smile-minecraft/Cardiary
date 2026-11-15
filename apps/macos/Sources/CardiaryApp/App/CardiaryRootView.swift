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
    }
}

/// 資料不可用：接回磁碟、換資料夾或重試。Cardiary 不會建立空資料夾。
struct UnavailableView: View {
    @ObservedObject var model: AppModel
    let folderState: FolderPresentation.Availability

    var body: some View {
        VStack(spacing: DesignTokens.spacingL) {
            Image(systemName: "externaldrive.badge.questionmark")
                .font(.system(size: 42))
                .foregroundStyle(.secondary)
            Text(AppL10n.text(.unavailableTitle))
                .font(.title2.bold())
            Text(AppL10n.format(.folderLabel, value: model.bridge.folder.path ?? model.bridge.folder.displayName ?? "—"))
                .font(.callout)
                .foregroundStyle(.secondary)
            Text(AppL10n.text(.unavailableBody))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .frame(maxWidth: DesignTokens.firstRunMaxWidth)
            HStack(spacing: DesignTokens.spacingM) {
                Button(AppL10n.text(.unavailableChooseFolder)) { model.chooseFolder() }
                    .keyboardShortcut(.defaultAction)
                Button(AppL10n.text(.unavailableRetry)) { model.retry() }
            }
        }
        .padding(DesignTokens.spacingXL)
    }
}

/// 服務或協定版本不符：重連沒有用，要更新 App。
struct NeedsUpdateView: View {
    var body: some View {
        VStack(spacing: DesignTokens.spacingL) {
            Image(systemName: "arrow.down.circle")
                .font(.system(size: 42))
                .foregroundStyle(.secondary)
            Text(AppL10n.text(.updateRequiredTitle))
                .font(.title2.bold())
            Text(AppL10n.text(.updateRequiredBody))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .frame(maxWidth: DesignTokens.firstRunMaxWidth)
        }
        .padding(DesignTokens.spacingXL)
    }
}

/// 主視窗上方的連線狀態；連線正常時不佔空間。
struct ConnectionBanner: View {
    @ObservedObject var model: AppModel

    var body: some View {
        if let text {
            HStack(spacing: DesignTokens.spacingS) {
                Image(systemName: "bolt.horizontal.circle")
                    .foregroundStyle(.orange)
                Text(text)
                    .font(.callout)
                Spacer()
                if case .disconnected = model.bridge.connection {
                    Button(AppL10n.text(.connectionRetry)) { model.retry() }
                        .controlSize(.small)
                }
            }
            .padding(.horizontal, DesignTokens.spacingM)
            .padding(.vertical, DesignTokens.spacingS)
            .background(.orange.opacity(0.12))
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
