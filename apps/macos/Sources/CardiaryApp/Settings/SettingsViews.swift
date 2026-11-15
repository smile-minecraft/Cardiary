import CardiaryKit
import SwiftUI

// MARK: - 分頁註冊

/// 模型分頁：供應商、四個角色與金鑰。
public final class ModelsSettingsTab: SettingsTab {
    public let id = "models"
    public let titleKey: AppString = .settingsModelsTab
    private let model: ModelsSettingsModel

    public init(model: ModelsSettingsModel) {
        self.model = model
    }

    public func makeBody() -> AnyView {
        AnyView(ModelsSettingsView(model: model))
    }
}

/// 一般設定分頁：主機的設定值與分級。
public final class GeneralSettingsTab: SettingsTab {
    public let id = "general"
    public let titleKey: AppString = .settingsGeneralTab
    private let model: GeneralSettingsModel

    public init(model: GeneralSettingsModel) {
        self.model = model
    }

    public func makeBody() -> AnyView {
        AnyView(GeneralSettingsView(model: model))
    }
}

/// 模組分頁：清單、狀態與啟停。
public final class ModulesSettingsTab: SettingsTab {
    public let id = "modules"
    public let titleKey: AppString = .settingsModulesTab
    private let model: ModulesSettingsModel

    public init(model: ModulesSettingsModel) {
        self.model = model
    }

    public func makeBody() -> AnyView {
        AnyView(ModulesSettingsView(model: model))
    }
}

// MARK: - 模型

struct ModelsSettingsView: View {
    @ObservedObject var model: ModelsSettingsModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.spacingL) {
                providerSection
                addProviderSection
                rolesSection
                resolvedSection
                banners
            }
            .padding(DesignTokens.spacingL)
        }
        .task {
            if model.providers.isEmpty {
                await model.load()
            }
        }
    }

    private var providerSection: some View {
        SettingsSection(title: .settingsProviders) {
            if model.isLoading && model.providers.isEmpty {
                LoadingSettingsView()
            } else if model.providers.isEmpty {
                Text(AppL10n.text(.settingsProvidersEmpty))
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.providers, id: \.providerId) { provider in
                    providerRow(provider)
                }
            }
        }
    }

    private func providerRow(_ provider: ModelProviderInfo) -> some View {
        ProviderCard(model: model, provider: provider)
    }

    private var addProviderSection: some View {
        SettingsSection(title: .settingsAddProvider) {
            AddProviderForm(model: model) { await model.addProvider() }
        }
    }

    private var rolesSection: some View {
        SettingsSection(title: .settingsRoles) {
            ForEach(ModelRole.allCases, id: \.self) { role in
                Picker(AppL10n.text(Self.roleKey(role)), selection: roleBinding(role)) {
                    ForEach(model.choices(for: role)) { choice in
                        Text(choice.label).tag(choice)
                    }
                }
            }
            Button(AppL10n.text(.settingsRoleSave)) {
                Task { await model.saveRoles() }
            }
            .disabled(model.isSaving || model.providers.isEmpty)
        }
    }

    private var resolvedSection: some View {
        SettingsSection(title: .settingsResolved) {
            ForEach(ModelRole.allCases, id: \.self) { role in
                HStack(alignment: .firstTextBaseline, spacing: DesignTokens.spacingS) {
                    Text(AppL10n.text(Self.roleKey(role)))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(width: 120, alignment: .leading)
                    Text(ModelsSettingsModel.resolvedLabel(model.resolved(for: role)))
                        .font(.caption)
                }
            }
        }
    }

    @ViewBuilder
    private var banners: some View {
        if let error = model.errorMessage {
            MessageBanner(text: error, systemImage: "exclamationmark.triangle", tint: .red)
        }
        if let notice = model.noticeMessage {
            MessageBanner(text: notice, systemImage: "checkmark.circle", tint: .secondary)
        }
    }

    private func roleBinding(_ role: ModelRole) -> Binding<RoleChoice> {
        Binding(
            get: { model.choices[role] ?? .unset },
            set: { model.choices[role] = $0 }
        )
    }

    static func roleKey(_ role: ModelRole) -> AppString {
        switch role {
        case .main: return .settingsRoleMain
        case .small: return .settingsRoleSmall
        case .writing: return .settingsRoleWriting
        case .systemOne: return .settingsRoleSystemOne
        }
    }

    static func kindKey(_ kind: ModelProviderKind) -> AppString {
        switch kind {
        case .apiKey: return .settingsProviderKindAPIKey
        case .aggregator: return .settingsProviderKindAggregator
        case .local: return .settingsProviderKindLocal
        }
    }
}

// MARK: - 供應商元件

/// 一個供應商：名稱、接入方式、金鑰入口與輸入框。模型分頁與首次設定共用。
struct ProviderCard: View {
    @ObservedObject var model: ModelsSettingsModel
    let provider: ModelProviderInfo

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            HStack(spacing: DesignTokens.spacingS) {
                Text(provider.displayName)
                    .font(.callout.weight(.semibold))
                Text(AppL10n.text(ModelsSettingsView.kindKey(provider.kind)))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button(AppL10n.text(.settingsCredentialSet)) {
                    model.beginCredentialEntry(for: provider.providerId)
                }
                .controlSize(.small)
            }
            if let baseUrl = provider.baseUrl, !baseUrl.isEmpty {
                Text(baseUrl)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(AppL10n.count(.settingsProviderModelCount, count: provider.models.count))
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(AppL10n.format(
                .settingsCredentialAccount,
                value: model.keychainAccount(for: provider)
            ))
            .font(.caption2)
            .foregroundStyle(.tertiary)

            if model.credentialProviderId == provider.providerId {
                HStack(spacing: DesignTokens.spacingS) {
                    SecureField(AppL10n.text(.settingsCredentialPlaceholder), text: $model.credentialInput)
                        .textFieldStyle(.roundedBorder)
                    Button(AppL10n.text(.settingsCredentialSave)) {
                        Task { await model.storeCredential(for: provider.providerId) }
                    }
                    .controlSize(.small)
                    Button(AppL10n.text(.genericCancel)) {
                        model.cancelCredentialEntry()
                    }
                    .controlSize(.small)
                }
            }
        }
        .padding(DesignTokens.spacingM)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: DesignTokens.cardRadius))
    }
}

/// 新增供應商的表單。模型分頁與首次設定共用。
///
/// 按下「新增」後要做什麼由呼叫端決定：設定頁只更新供應商，首次設定還要選取
/// 新供應商的第一個模型。共用表單不預設任何一種，避免首次設定漏掉選取。
struct AddProviderForm: View {
    @ObservedObject var model: ModelsSettingsModel
    let addProvider: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            TextField(AppL10n.text(.settingsProviderId), text: $model.newProviderId)
            TextField(AppL10n.text(.settingsProviderName), text: $model.newProviderName)
            Picker(AppL10n.text(.settingsProviderKind), selection: $model.newProviderKind) {
                Text(AppL10n.text(.settingsProviderKindAPIKey)).tag(ModelProviderKind.apiKey)
                Text(AppL10n.text(.settingsProviderKindAggregator)).tag(ModelProviderKind.aggregator)
                Text(AppL10n.text(.settingsProviderKindLocal)).tag(ModelProviderKind.local)
            }
            TextField(AppL10n.text(.settingsProviderBaseURL), text: $model.newProviderBaseURL)
            TextField(
                AppL10n.text(.settingsProviderModels),
                text: $model.newProviderModels,
                axis: .vertical
            )
            .lineLimit(2...4)
            Button(AppL10n.text(.settingsProviderAdd)) {
                Task { await addProvider() }
            }
            .disabled(!model.canAddProvider)
        }
    }
}

// MARK: - 一般設定

struct GeneralSettingsView: View {
    @ObservedObject var model: GeneralSettingsModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.spacingL) {
                if model.isLoading && model.items.isEmpty {
                    LoadingSettingsView()
                } else if model.items.isEmpty {
                    Text(AppL10n.text(.settingsGeneralEmpty))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.items, id: \.key) { item in
                        itemRow(item)
                    }
                }

                if let error = model.errorMessage {
                    MessageBanner(text: error, systemImage: "exclamationmark.triangle", tint: .red)
                }
                if let notice = model.noticeMessage {
                    MessageBanner(text: notice, systemImage: "checkmark.circle", tint: .secondary)
                }
            }
            .padding(DesignTokens.spacingL)
        }
        .task {
            if model.items.isEmpty {
                await model.load()
            }
        }
    }

    private func itemRow(_ item: SettingItem) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            HStack(spacing: DesignTokens.spacingS) {
                Text(model.title(for: item))
                    .font(.callout.weight(.semibold))
                Text(AppL10n.text(GeneralSettingsModel.levelKey(item.level)))
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(.quaternary.opacity(0.5), in: Capsule())
                Spacer()
            }
            Text(item.key)
                .font(.caption2)
                .foregroundStyle(.tertiary)
            if let description = model.description(for: item) {
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if model.isBool(item) {
                Toggle(AppL10n.text(.settingsModuleEnabled), isOn: Binding(
                    get: { model.boolValue(item) },
                    set: { _ in Task { await model.toggle(item) } }
                ))
                .toggleStyle(.switch)
                .labelsHidden()
                .accessibilityLabel(model.title(for: item))
            } else {
                HStack(spacing: DesignTokens.spacingS) {
                    TextField(
                        AppL10n.text(.settingsValuePlaceholder),
                        text: Binding(
                            get: { model.drafts[item.key] ?? "" },
                            set: { model.drafts[item.key] = $0 }
                        )
                    )
                    .textFieldStyle(.roundedBorder)
                    Button(AppL10n.text(.settingsSave)) {
                        Task { await model.save(key: item.key) }
                    }
                    .controlSize(.small)
                    .disabled(model.savingKeys.contains(item.key))
                }
            }
        }
        .padding(DesignTokens.spacingM)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: DesignTokens.cardRadius))
    }
}

// MARK: - 模組

struct ModulesSettingsView: View {
    @ObservedObject var model: ModulesSettingsModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.spacingL) {
                if model.isLoading && model.modules.isEmpty {
                    LoadingSettingsView()
                } else if model.modules.isEmpty {
                    Text(AppL10n.text(.settingsModulesEmpty))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.modules, id: \.moduleId) { module in
                        moduleRow(module)
                    }
                }

                if let error = model.errorMessage {
                    MessageBanner(text: error, systemImage: "exclamationmark.triangle", tint: .red)
                }
                if let notice = model.noticeMessage {
                    MessageBanner(text: notice, systemImage: "checkmark.circle", tint: .secondary)
                }
            }
            .padding(DesignTokens.spacingL)
        }
        .task {
            if model.modules.isEmpty {
                await model.load()
            }
        }
    }

    private func moduleRow(_ module: ModuleInfo) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            HStack(spacing: DesignTokens.spacingS) {
                Text(module.name)
                    .font(.callout.weight(.semibold))
                Text(AppL10n.format(.settingsModuleVersion, value: module.version))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(AppL10n.text(ModulesSettingsModel.stateKey(module.state)))
                    .font(.caption2)
                    .foregroundStyle(module.state == .failed ? .red : .secondary)
                Spacer()
                Toggle("", isOn: Binding(
                    get: { module.enabled },
                    set: { value in Task { await model.setEnabled(module, enabled: value) } }
                ))
                .labelsHidden()
                .toggleStyle(.switch)
                .disabled(model.updatingIds.contains(module.moduleId))
            }
            if let failure = module.failure, !failure.isEmpty {
                Text(AppL10n.format(.settingsModuleFailed, value: failure))
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(DesignTokens.spacingM)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: DesignTokens.cardRadius))
    }
}

// MARK: - 共用

/// 載入中的提示。三個分頁共用，避免各自寫一份。
struct LoadingSettingsView: View {
    var body: some View {
        HStack(spacing: DesignTokens.spacingS) {
            ProgressView()
                .controlSize(.small)
            Text(AppL10n.text(.settingsLoading))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// 設定分頁的一段：標題加內容，內容依序往下排。
struct SettingsSection<Content: View>: View {
    let title: AppString
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            Text(AppL10n.text(title))
                .font(.headline)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
