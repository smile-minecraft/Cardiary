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
            // 和其他設定分頁一樣留左右與底部內距。
            PermissionsSettingsContent(model: model)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, DesignTokens.spacingL)
                .padding(.bottom, DesignTokens.spacingL)
        }
        .task { await model.load() }
    }
}

/// 分頁內容本身（不含捲動）；測試可以直接繪製它。
struct PermissionsSettingsContent: View {
    @ObservedObject var model: PermissionModesModel

    var body: some View {
            VStack(alignment: .leading, spacing: DesignTokens.spacingL) {
                AllowAllSection(model: model)
                Divider()
                SystemOneSection(model: model)
                Divider()
                DomainsSection(model: model)
                if let message = model.errorMessage {
                    Text(message).cardiaryFont(.caption).foregroundStyle(Palette.red)
                } else if let message = model.noticeMessage {
                    Text(message).cardiaryFont(.caption).foregroundStyle(Palette.sageInk)
                }
            }
    }
}

private struct AllowAllSection: View {
    @ObservedObject var model: PermissionModesModel

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            Text(PermissionL10n.text(.permAllowAllTitle))
                .cardiaryFont(.title3, weight: .semibold)
            Text(PermissionL10n.text(.permAllowAllBody))
                .cardiaryFont(.caption)
                .foregroundStyle(Palette.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)

            if let grant = model.activeAllowAll {
                AllowAllActiveCard(model: model, grant: grant)
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
                .cardiaryFont(.title3, weight: .semibold)
            Text(PermissionL10n.text(.permSystemOneBody))
                .cardiaryFont(.caption)
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
                    // macOS 的 switch 樣式把標籤拆成旁邊的文字，開關本身沒有名稱。
                    .accessibilityLabel(Text(PermissionL10n.text(Self.label(for: category))))
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
                .cardiaryFont(.callout, weight: .semibold)
            Text(PermissionL10n.text(.permDomainsBody))
                .cardiaryFont(.caption)
                .foregroundStyle(Palette.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            TextEditor(text: $model.domainsText)
                .cardiaryFont(.callout, weight: .regular, monospacedDigits: true)
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
                        .cardiaryFont(.caption)
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

/// 全部允許已開啟時的狀態卡：僅在設定頁顯示目前狀態、作用範圍與一鍵結束按鈕。
private struct AllowAllActiveCard: View {
    @ObservedObject var model: PermissionModesModel
    let grant: AllowAllGrantState

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            HStack(spacing: DesignTokens.spacingS) {
                Image(systemName: "checkmark.shield.fill")
                    .foregroundStyle(Palette.redInk)
                Text(PermissionL10n.text(.permAllowAllActive))
                    .cardiaryFont(.callout, weight: .semibold)
                Spacer()
                Button(PermissionL10n.text(.permAllowAllEnd)) {
                    Task { await model.endAllowAll() }
                }
                .buttonStyle(ThemeButtonStyle(kind: .danger))
                .controlSize(.small)
                .disabled(model.isWorking)
            }
            Text(PermissionL10n.format(
                .permAllowAllScope,
                value: (grant.tools + grant.paths + grant.domains)
                    .joined(separator: AppL10n.language == .zhHant ? "、" : ", ")
            ))
            .cardiaryFont(.caption)
            .foregroundStyle(Palette.inkSecondary)
            .lineLimit(2)
        }
        .padding(.horizontal, DesignTokens.spacingM)
        .padding(.vertical, DesignTokens.spacingS)
        .background(
            Palette.redSoft,
            in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}
