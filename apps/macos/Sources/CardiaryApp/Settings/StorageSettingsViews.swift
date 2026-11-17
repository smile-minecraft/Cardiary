import CardiaryKit
import SwiftUI

// MARK: - 分頁註冊

/// 儲存空間分頁：各類別用量，以及照「選類別、預覽、確認」走的清理。
public final class StorageSettingsTab: SettingsTab {
    public let id = "storage"
    public let titleKey: AppString = .settingsStorageTab
    private let model: StorageSettingsModel

    public init(model: StorageSettingsModel) {
        self.model = model
    }

    public func makeBody() -> AnyView {
        AnyView(StorageSettingsView(model: model))
    }
}

// MARK: - 面板

struct StorageSettingsView: View {
    @ObservedObject var model: StorageSettingsModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.spacingL) {
                usageSection
                outsideWritesSection
                cleanupSection

                if let error = model.errorMessage {
                    MessageBanner(text: error, systemImage: "exclamationmark.triangle", tone: .red)
                }
                if let notice = model.noticeMessage {
                    MessageBanner(text: notice, systemImage: "checkmark.circle", tone: .sage)
                }
            }
            .padding(.horizontal, DesignTokens.spacingL)
            .padding(.bottom, DesignTokens.spacingL)
        }
        .scrollIndicators(.never)
        .task {
            if model.usage.isEmpty {
                await model.load()
            }
        }
    }

    // MARK: 用量

    private var usageSection: some View {
        SettingsSection(title: .storageUsageTitle, suit: .spade) {
            VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
                if model.isLoading && model.usage.isEmpty {
                    LoadingSettingsView()
                } else if model.usage.isEmpty {
                    Text(AppL10n.text(.storageUsageEmpty))
                        .font(.cardiary(.callout))
                        .foregroundStyle(Palette.inkSecondary)
                } else {
                    ForEach(StorageSettingsModel.usageOrder, id: \.rawValue) { category in
                        usageRow(category)
                    }
                    Text(AppL10n.text(.storageShellStateNote))
                        .font(.cardiary(.caption2))
                        .foregroundStyle(Palette.inkTertiary)
                }
            }
        }
    }

    private func usageRow(_ category: StorageUsageCategory) -> some View {
        let row = model.usageRow(category)
        return HStack(spacing: DesignTokens.spacingS) {
            Text(AppL10n.text(StorageSettingsModel.titleKey(category)))
                .font(.cardiary(.callout))
            if let cleanable = row?.cleanableBytes, cleanable > 0 {
                ThemeChip(
                    text: AppL10n.format(
                        .storageCleanable,
                        value: StorageSettingsModel.formattedBytes(cleanable)
                    ),
                    tone: .sage
                )
            }
            Spacer()
            Text(StorageSettingsModel.formattedBytes(row?.bytes ?? 0))
                .font(.cardiary(.callout))
                .monospacedDigit()
                .foregroundStyle(Palette.inkSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: 資料夾外的工具寫入（唯讀明細，不進七類加總與清理）

    @ViewBuilder
    private var outsideWritesSection: some View {
        if !model.outsideWrites.isEmpty {
            SettingsSection(title: .storageOutsideWritesTitle, suit: .club) {
                VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
                    VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
                        ForEach(model.outsideWrites, id: \.path) { entry in
                            outsideWriteRow(entry)
                        }
                    }
                    Text(AppL10n.text(.storageOutsideWritesNote))
                        .font(.cardiary(.caption2))
                        .foregroundStyle(Palette.inkTertiary)
                }
            }
        }
    }

    private func outsideWriteRow(_ entry: StorageOutsideWriteEntry) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            HStack(spacing: DesignTokens.spacingS) {
                Text(StorageSettingsModel.outsideWriteToolName(entry.tool))
                    .font(.cardiary(.callout))
                Spacer()
                Text(StorageSettingsModel.outsideWriteSize(entry))
                    .font(.cardiary(.callout))
                    .monospacedDigit()
                    .foregroundStyle(Palette.inkSecondary)
            }
            Text(entry.path)
                .font(.cardiary(.caption2))
                .foregroundStyle(Palette.inkTertiary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: 清理

    private var cleanupSection: some View {
        SettingsSection(title: .storageCleanupTitle, suit: .diamond) {
            VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
                VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
                    ForEach(StorageCleanupCategory.allCases, id: \.rawValue) { category in
                        cleanupRow(category)
                    }
                }

                if let preview = model.preview {
                    previewSummary(preview)
                }

                HStack(spacing: DesignTokens.spacingS) {
                    Button(AppL10n.text(.storageCleanupPreview)) {
                        Task { await model.previewCleanup() }
                    }
                    .buttonStyle(.themePrimary)
                    .controlSize(.small)
                    .disabled(model.isPreviewing || model.isApplying)

                    if model.preview != nil {
                        Button(AppL10n.text(.storageCleanupApply)) {
                            Task { await model.applyCleanup() }
                        }
                        .buttonStyle(ThemeButtonStyle(kind: .danger))
                        .controlSize(.small)
                        .disabled(model.isApplying)

                        Button(AppL10n.text(.genericCancel)) {
                            model.cancelPreview()
                        }
                        .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
                        .controlSize(.small)
                        .disabled(model.isApplying)
                    }

                    if model.isApplying {
                        SuitLoader(size: 7)
                    }
                }
            }
        }
    }

    private func cleanupRow(_ category: StorageCleanupCategory) -> some View {
        Toggle(isOn: Binding(
            get: { model.selected.contains(category) },
            set: { _ in model.toggle(category) }
        )) {
            HStack(spacing: DesignTokens.spacingS) {
                Text(AppL10n.text(category.titleKey))
                    .font(.cardiary(.callout))
                Spacer()
                if let bytes = model.allocatedBytes(category) {
                    Text(StorageSettingsModel.formattedBytes(bytes))
                        .font(.cardiary(.caption))
                        .monospacedDigit()
                        .foregroundStyle(Palette.inkSecondary)
                } else {
                    Text("—")
                        .font(.cardiary(.caption))
                        .foregroundStyle(Palette.inkTertiary)
                }
            }
        }
        .toggleStyle(ThemeSwitchStyle())
        .disabled(model.isApplying)
    }

    private func previewSummary(_ preview: StorageCleanupPreviewResponsePayload) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            ForEach(preview.targets, id: \.category) { target in
                HStack(spacing: DesignTokens.spacingS) {
                    Text(cleanupTitle(target.category))
                        .font(.cardiary(.caption))
                    Text(AppL10n.count(.storagePreviewItems, count: target.items))
                        .font(.cardiary(.caption2))
                        .foregroundStyle(Palette.inkSecondary)
                    Spacer()
                    Text(StorageSettingsModel.formattedBytes(target.bytes))
                        .font(.cardiary(.caption))
                        .monospacedDigit()
                        .foregroundStyle(Palette.inkSecondary)
                }
            }
            HStack(spacing: DesignTokens.spacingS) {
                Text(AppL10n.text(.storagePreviewTotal))
                    .font(.cardiary(.caption, weight: .semibold))
                Spacer()
                Text(StorageSettingsModel.formattedBytes(preview.totalBytes))
                    .font(.cardiary(.caption, weight: .semibold))
                    .monospacedDigit()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeBlock(Palette.canvas, radius: DesignTokens.cardRadius, padding: DesignTokens.spacingM)
    }

    /// 預覽回來的類別名稱。四類以外的不會出現；真的出現就照原字串顯示，不要吞掉。
    private func cleanupTitle(_ raw: String) -> String {
        guard let category = StorageCleanupCategory(rawValue: raw) else { return raw }
        return AppL10n.text(category.titleKey)
    }
}
