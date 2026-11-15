import CardiaryKit
import SwiftUI

/// 首次設定：選資料夾、設定主力模型、開第一場對話。
struct FirstRunView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var firstRun: FirstRunModel
    /// 供應商、金鑰與角色的狀態由設定頁的模型分頁共用；首次設定只顯示主模型需要的部分。
    @ObservedObject var modelSettings: ModelsSettingsModel

    init(model: AppModel) {
        self.model = model
        self.firstRun = model.firstRun
        self.modelSettings = model.firstRun.modelSettings
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.spacingL) {
                Text(AppL10n.text(.firstRunTitle))
                    .font(.largeTitle.bold())
                Text(AppL10n.text(.firstRunBody))
                    .foregroundStyle(.secondary)

                stepContent
                    .padding(DesignTokens.spacingL)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: DesignTokens.cardRadius))
            }
            .frame(maxWidth: DesignTokens.firstRunMaxWidth, alignment: .leading)
            .padding(DesignTokens.spacingXL)
        }
        .task(id: firstRun.step) {
            if firstRun.step == .model, firstRun.providers.isEmpty {
                await firstRun.loadModels()
            }
        }
    }

    @ViewBuilder
    private var stepContent: some View {
        switch firstRun.step {
        case .folder:
            VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
                Text(AppL10n.text(.firstRunStepFolder))
                    .font(.headline)
                Text(AppL10n.text(.firstRunFolderBody))
                    .foregroundStyle(.secondary)
                if let name = model.bridge.folder.displayName ?? model.bridge.folder.path {
                    Text(AppL10n.format(.firstRunFolderChosen, value: name))
                        .font(.callout)
                }
                Button(AppL10n.text(.unavailableChooseFolder)) { model.chooseFolder() }
                    .keyboardShortcut(.defaultAction)
            }

        case .model:
            modelStep

        case .conversation:
            VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
                Text(AppL10n.text(.firstRunStepConversation))
                    .font(.headline)
                HStack(spacing: DesignTokens.spacingM) {
                    Button(AppL10n.text(.firstRunStartConversation)) {
                        Task { await model.startFirstConversation() }
                    }
                    .keyboardShortcut(.defaultAction)

                    Button(AppL10n.text(.firstRunStepModel)) {
                        firstRun.editModel()
                    }
                }
            }

        case .done:
            ProgressView()
        }
    }

    private var modelStep: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            Text(AppL10n.text(.firstRunStepModel))
                .font(.headline)
            Text(AppL10n.text(.firstRunModelBody))
                .foregroundStyle(.secondary)

            if firstRun.isLoadingModels {
                ProgressView()
            } else {
                if firstRun.providers.isEmpty {
                    Text(AppL10n.text(.settingsProvidersEmpty))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else {
                    Picker(AppL10n.text(.firstRunProvider), selection: $firstRun.selectedProviderId) {
                        ForEach(firstRun.providers, id: \.providerId) { provider in
                            Text(provider.displayName).tag(Optional(provider.providerId))
                        }
                    }
                    .onChange(of: firstRun.selectedProviderId) { _, _ in
                        // 換供應商時把模型換成新供應商的第一個，避免留下另一個供應商的模型。
                        firstRun.selectedModelId = firstRun.models.first?.modelId
                    }
                    Picker(AppL10n.text(.firstRunModel), selection: $firstRun.selectedModelId) {
                        ForEach(firstRun.models, id: \.modelId) { info in
                            Text(info.displayName ?? info.modelId).tag(Optional(info.modelId))
                        }
                    }
                }

                if !firstRun.providers.isEmpty {
                    SettingsSection(title: .settingsProviders) {
                        ForEach(firstRun.providers, id: \.providerId) { provider in
                            ProviderCard(model: modelSettings, provider: provider)
                        }
                    }
                }

                SettingsSection(title: .settingsAddProvider) {
                    AddProviderForm(model: modelSettings) { await firstRun.addProvider() }
                }
            }

            if let message = firstRun.message {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            if let error = modelSettings.errorMessage {
                MessageBanner(text: error, systemImage: "exclamationmark.triangle", tint: .red)
            }
            if let notice = modelSettings.noticeMessage {
                MessageBanner(text: notice, systemImage: "checkmark.circle", tint: .secondary)
            }

            HStack(spacing: DesignTokens.spacingM) {
                Button(AppL10n.text(.firstRunSaveModel)) {
                    Task { await firstRun.saveMainModel() }
                }
                .disabled(!firstRun.canSave || firstRun.isSaving)

                Button(AppL10n.text(.firstRunSkipModel)) {
                    firstRun.skipModel()
                }
            }
        }
    }
}
