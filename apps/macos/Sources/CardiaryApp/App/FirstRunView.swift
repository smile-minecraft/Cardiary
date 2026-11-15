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
                VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
                    BrandHeader(markSize: 40, titleSize: 30)
                    SuitDivider()
                        .frame(width: 180)
                    Text(AppL10n.text(.firstRunTitle))
                        .font(.cardiary(.largeTitle, weight: .bold))
                    Text(AppL10n.text(.firstRunBody))
                        .foregroundStyle(Palette.inkSecondary)
                }

                FirstRunStepper(step: firstRun.step)

                stepContent
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .themeBlock(Palette.surface, radius: DesignTokens.panelRadius, padding: DesignTokens.spacingXL)
            }
            .frame(maxWidth: DesignTokens.firstRunMaxWidth, alignment: .leading)
            .padding(DesignTokens.spacingXL)
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.never)
        .background(Palette.canvas)
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
                SuitHeading(title: AppL10n.text(.firstRunStepFolder), suit: .heart)
                Text(AppL10n.text(.firstRunFolderBody))
                    .foregroundStyle(Palette.inkSecondary)
                if let name = model.bridge.folder.displayName ?? model.bridge.folder.path {
                    ThemeChip(text: AppL10n.format(.firstRunFolderChosen, value: name), tone: .sage, systemImage: "folder.fill")
                }
                Button(AppL10n.text(.unavailableChooseFolder)) { model.chooseFolder() }
                    .buttonStyle(.themePrimary)
                    .keyboardShortcut(.defaultAction)
            }

        case .model:
            modelStep

        case .conversation:
            VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
                SuitHeading(title: AppL10n.text(.firstRunStepConversation), suit: .club)
                HStack(spacing: DesignTokens.spacingM) {
                    Button(AppL10n.text(.firstRunStartConversation)) {
                        Task { await model.startFirstConversation() }
                    }
                    .buttonStyle(.themePrimary)
                    .keyboardShortcut(.defaultAction)

                    Button(AppL10n.text(.firstRunStepModel)) {
                        firstRun.editModel()
                    }
                }
            }

        case .done:
            SuitLoader(size: 11)
        }
    }

    private var modelStep: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            SuitHeading(title: AppL10n.text(.firstRunStepModel), suit: .diamond)
            Text(AppL10n.text(.firstRunModelBody))
                .foregroundStyle(Palette.inkSecondary)

            if firstRun.isLoadingModels {
                SuitLoader(size: 9)
            } else {
                if firstRun.providers.isEmpty {
                    Text(AppL10n.text(.settingsProvidersEmpty))
                        .font(.cardiary(.callout))
                        .foregroundStyle(Palette.inkSecondary)
                } else {
                    ThemeLabeledRow(title: AppL10n.text(.firstRunProvider)) {
                        ThemeMenuPicker(
                            selection: $firstRun.selectedProviderId,
                            options: firstRun.providers.map { (Optional($0.providerId), $0.displayName) }
                        )
                    }
                    .onChange(of: firstRun.selectedProviderId) { _, _ in
                        // 換供應商時把模型換成新供應商的第一個，避免留下另一個供應商的模型。
                        firstRun.selectedModelId = firstRun.models.first?.modelId
                    }
                    ThemeLabeledRow(title: AppL10n.text(.firstRunModel)) {
                        ThemeMenuPicker(
                            selection: $firstRun.selectedModelId,
                            options: firstRun.models.map { (Optional($0.modelId), $0.displayName ?? $0.modelId) }
                        )
                    }
                }

                if !firstRun.providers.isEmpty {
                    SettingsSection(title: .settingsProviders) {
                        ForEach(firstRun.providers, id: \.providerId) { provider in
                            ProviderCard(model: modelSettings, provider: provider)
                        }
                    }
                }

                SettingsSection(title: .settingsAddProvider, suit: .club) {
                    AddProviderForm(model: modelSettings) { await firstRun.addProvider() }
                }
            }

            if let message = firstRun.message {
                Text(message)
                    .font(.cardiary(.callout))
                    .foregroundStyle(Palette.inkSecondary)
            }
            if let error = modelSettings.errorMessage {
                MessageBanner(text: error, systemImage: "exclamationmark.triangle", tone: .red)
            }
            if let notice = modelSettings.noticeMessage {
                MessageBanner(text: notice, systemImage: "checkmark.circle", tone: .sage)
            }

            HStack(spacing: DesignTokens.spacingM) {
                Button(AppL10n.text(.firstRunSaveModel)) {
                    Task { await firstRun.saveMainModel() }
                }
                .buttonStyle(.themePrimary)
                .disabled(!firstRun.canSave || firstRun.isSaving)

                Button(AppL10n.text(.firstRunSkipModel)) {
                    firstRun.skipModel()
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
            }
        }
    }
}

/// 首次設定的三步：資料夾（紅心）、模型（方塊）、第一場對話（梅花）。
private struct FirstRunStepper: View {
    let step: FirstRunModel.Step

    var body: some View {
        HStack(spacing: DesignTokens.spacingS) {
            item(.folder, suit: .heart, title: AppL10n.text(.firstRunStepFolder))
            connector(done: index(of: step) > 0)
            item(.model, suit: .diamond, title: AppL10n.text(.firstRunStepModel))
            connector(done: index(of: step) > 1)
            item(.conversation, suit: .club, title: AppL10n.text(.firstRunStepConversation))
        }
    }

    private func index(of step: FirstRunModel.Step) -> Int {
        switch step {
        case .folder: return 0
        case .model: return 1
        case .conversation: return 2
        case .done: return 3
        }
    }

    private func item(_ target: FirstRunModel.Step, suit: Suit, title: String) -> some View {
        let current = index(of: step)
        let mine = index(of: target)
        let isActive = current == mine
        let isDone = current > mine
        return HStack(spacing: 6) {
            ZStack {
                Circle()
                    .fill(isActive || isDone ? suit.color : suit.soft)
                    .frame(width: 24, height: 24)
                Image(systemName: isDone ? "checkmark" : suit.symbol)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(isActive || isDone ? Palette.onAccent : suit.ink)
            }
            Text(title)
                .font(.cardiary(.caption, weight: isActive ? .bold : .medium))
                .foregroundStyle(isActive ? Palette.ink : Palette.inkSecondary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }

    private func connector(done: Bool) -> some View {
        Capsule(style: .continuous)
            .fill(done ? Palette.red.opacity(0.6) : Palette.hover)
            .frame(height: 3)
            .frame(minWidth: 16, maxWidth: 48)
    }
}
