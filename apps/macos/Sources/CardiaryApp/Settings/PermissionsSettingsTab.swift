import AppKit
import CardiaryKit
import SwiftUI

/// 設定頁的「代理權限」分頁：System One 審核類別、可委派網域與全部允許。
public final class PermissionsSettingsTab: SettingsTab {
    public let id = "permissions"
    public let titleKey: AppString = .settingsPermissionsTab
    private let model: PermissionModesModel

    public init(model: PermissionModesModel) {
        self.model = model
    }

    public func makeBody() -> AnyView {
        AnyView(PermissionsSettingsView(model: model))
    }
}

private struct PermissionsSettingsView: View {
    @ObservedObject var model: PermissionModesModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.spacingL) {
                AllowAllSection(model: model)
                Divider()
                SystemOneSection(model: model)
                Divider()
                DomainsSection(model: model)
                if let message = model.errorMessage {
                    Text(message).font(.cardiary(.caption)).foregroundStyle(Palette.red)
                } else if let message = model.noticeMessage {
                    Text(message).font(.cardiary(.caption)).foregroundStyle(Palette.sageInk)
                }
            }
        }
        .task { await model.load() }
    }
}

private struct AllowAllSection: View {
    @ObservedObject var model: PermissionModesModel

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            Text(PermissionL10n.text(.permAllowAllTitle))
                .font(.cardiary(.title3, weight: .semibold))
            Text(PermissionL10n.text(.permAllowAllBody))
                .font(.cardiary(.caption))
                .foregroundStyle(Palette.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)

            if model.allowAllExpiry() != nil {
                AllowAllBanner(model: model, showsScope: true)
            } else {
                HStack(spacing: DesignTokens.spacingM) {
                    ForEach(PermissionModesModel.allowAllTools, id: \.self) { tool in
                        Toggle(isOn: Binding(
                            get: { model.allowAllSelectedTools.contains(tool) },
                            set: { on in
                                if on { model.allowAllSelectedTools.insert(tool) }
                                else { model.allowAllSelectedTools.remove(tool) }
                            }
                        )) {
                            Text(PermissionL10n.text(Self.label(for: tool)))
                        }
                        .toggleStyle(.checkbox)
                    }
                }
                FolderList(
                    folders: model.allowAllFolders,
                    onAdd: { path in model.allowAllFolders.append(path) },
                    onRemove: { path in model.allowAllFolders.removeAll { $0 == path } }
                )
                Stepper(
                    value: $model.allowAllMinutes,
                    in: 1...(model.state?.maxAllowAllMinutes ?? 60),
                    step: 5
                ) {
                    Text(PermissionL10n.format(.permAllowAllMinutes, value: "\(model.allowAllMinutes)"))
                        .font(.cardiary(.callout, weight: .regular, monospacedDigits: true))
                }
                .fixedSize()
                Button(PermissionL10n.text(.permAllowAllStart)) {
                    Task { await model.startAllowAll() }
                }
                .buttonStyle(ThemeButtonStyle(kind: .danger))
                .disabled(model.isWorking)
            }
        }
    }

    static func label(for tool: String) -> PermissionString {
        switch tool {
        case "write_file": return .permToolWrite
        case "run_command": return .permToolCommand
        default: return .permToolRead
        }
    }
}

private struct SystemOneSection: View {
    @ObservedObject var model: PermissionModesModel

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            Text(PermissionL10n.text(.permSystemOneTitle))
                .font(.cardiary(.title3, weight: .semibold))
            Text(PermissionL10n.text(.permSystemOneBody))
                .font(.cardiary(.caption))
                .foregroundStyle(Palette.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(DelegatedCategory.allCases, id: \.self) { category in
                VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
                    Toggle(isOn: Binding(
                        get: { model.isEnabled(category) },
                        set: { on in Task { await model.setCategory(category, enabled: on) } }
                    )) {
                        Text(PermissionL10n.text(Self.label(for: category)))
                    }
                    .toggleStyle(.switch)
                    .disabled(model.isWorking)
                    if PermissionModesModel.needsFolders(category) {
                        FolderList(
                            folders: model.categoryFolders[category] ?? [],
                            onAdd: { path in Task { await model.addFolder(path, to: category) } },
                            onRemove: { path in Task { await model.removeFolder(path, from: category) } }
                        )
                        .padding(.leading, DesignTokens.spacingL)
                    }
                }
            }
        }
    }

    static func label(for category: DelegatedCategory) -> PermissionString {
        switch category {
        case .readOnlyFiles: return .permCategoryReadOnlyFiles
        case .gitReadonly: return .permCategoryGitReadonly
        case .createCard: return .permCategoryCreateCard
        case .ownNotification: return .permCategoryOwnNotification
        }
    }
}

private struct DomainsSection: View {
    @ObservedObject var model: PermissionModesModel

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            Text(PermissionL10n.text(.permDomainsTitle))
                .font(.cardiary(.callout, weight: .semibold))
            Text(PermissionL10n.text(.permDomainsBody))
                .font(.cardiary(.caption))
                .foregroundStyle(Palette.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            TextEditor(text: $model.domainsText)
                .font(.cardiary(.callout, weight: .regular, monospacedDigits: true))
                .frame(minHeight: 72, maxHeight: 140)
                .overlay(
                    RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous)
                        .stroke(Palette.graySoft)
                )
            Button(PermissionL10n.text(.permDomainsSave)) {
                Task { await model.saveDomains() }
            }
            .buttonStyle(ThemeButtonStyle(kind: .soft))
            .disabled(model.isWorking)
        }
    }
}

/// 資料夾清單：用系統的開啟面板挑資料夾，只存絕對路徑。
private struct FolderList: View {
    let folders: [String]
    let onAdd: (String) -> Void
    let onRemove: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            ForEach(folders, id: \.self) { folder in
                HStack {
                    Image(systemName: "folder")
                        .foregroundStyle(Palette.inkSecondary)
                    Text(folder)
                        .font(.cardiary(.caption))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .help(folder)
                    Spacer()
                    Button(PermissionL10n.text(.permRemove)) { onRemove(folder) }
                        .buttonStyle(ThemeButtonStyle(kind: .link))
                }
            }
            Button(PermissionL10n.text(.permAddFolder)) {
                let panel = NSOpenPanel()
                panel.canChooseDirectories = true
                panel.canChooseFiles = false
                panel.allowsMultipleSelection = false
                if panel.runModal() == .OK, let url = panel.url {
                    onAdd(url.standardizedFileURL.path)
                }
            }
            .buttonStyle(ThemeButtonStyle(kind: .quiet))
        }
    }
}

/// 全部允許期間的橫幅：主視窗頂端與設定頁都用它，每秒更新倒數，可以一鍵結束。
struct AllowAllBanner: View {
    @ObservedObject var model: PermissionModesModel
    var showsScope = false
    /// 放在主視窗頂端時，自己加上外距；沒開全部允許時不佔任何空間。
    var insetInWindow = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            if let expiry = model.allowAllExpiry(now: context.date) {
                VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
                    HStack(spacing: DesignTokens.spacingS) {
                        Image(systemName: "exclamationmark.shield.fill")
                            .foregroundStyle(Palette.redInk)
                        Text(PermissionL10n.format(
                            .permAllowAllActive,
                            value: Self.remaining(until: expiry, now: context.date)
                        ))
                        .font(.cardiary(.callout, weight: .semibold, monospacedDigits: true))
                        Spacer()
                        Button(PermissionL10n.text(.permAllowAllEnd)) {
                            Task { await model.endAllowAll() }
                        }
                        .buttonStyle(ThemeButtonStyle(kind: .danger))
                        .controlSize(.small)
                        .disabled(model.isWorking)
                    }
                    if showsScope, let grant = model.state?.allowAll {
                        Text(PermissionL10n.format(
                            .permAllowAllScope,
                            value: (grant.tools + grant.paths + grant.domains).joined(separator: "、")
                        ))
                        .font(.cardiary(.caption))
                        .foregroundStyle(Palette.inkSecondary)
                        .lineLimit(2)
                    }
                }
                .padding(.horizontal, DesignTokens.spacingM)
                .padding(.vertical, DesignTokens.spacingS)
                .background(
                    Palette.redSoft,
                    in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous)
                )
                .accessibilityElement(children: .combine)
                .padding(.horizontal, insetInWindow ? DesignTokens.spacingM : 0)
                .padding(.top, insetInWindow ? DesignTokens.spacingS : 0)
            }
        }
    }

    static func remaining(until expiry: Date, now: Date) -> String {
        let seconds = max(0, Int(expiry.timeIntervalSince(now).rounded(.up)))
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}
