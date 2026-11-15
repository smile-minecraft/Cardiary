import AppKit
import SwiftUI

/// 匯入畫面：選來源、逐檔指定類別、預覽、勾選、標記核心記憶候選、寫入。
///
/// 這個畫面只依賴 `ImportFlowModel`；掛進主視窗由前置工作補上（位置在
/// `App/`，屬於 macOS 主視窗工作的範圍）。
public struct ImportView: View {
    @ObservedObject private var model: ImportFlowModel
    @State private var startDate: Date
    @State private var endDate: Date

    public init(model: ImportFlowModel, now: Date = Date()) {
        self.model = model
        _startDate = State(initialValue: now.addingTimeInterval(-30 * 24 * 60 * 60))
        _endDate = State(initialValue: now)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.spacingL) {
                header
                sourceSection
                if model.sourceKind == .generic {
                    fileSection
                }
                if includesPersonaField {
                    personaSection
                }
                conversationSection
                reimportSection
                actions
                if let message = model.errorMessage {
                    Text(message)
                        .font(.callout)
                        .foregroundStyle(.red)
                }
                if let progress = model.progress {
                    Text(ImportL10n.format(
                        .importProgress,
                        value: "\(progress.done) / \(progress.total)"
                    ))
                    .font(.callout)
                    .foregroundStyle(.secondary)
                }
                if let preview = model.preview {
                    previewSection(preview)
                }
                if let result = model.result {
                    resultSection(result)
                }
            }
            .padding(DesignTokens.spacingXL)
            .frame(maxWidth: DesignTokens.settingsMaxWidth, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task {
            if case .idle = model.phase {
                await model.load()
            }
        }
    }

    // MARK: - 區塊

    private var header: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Text(ImportL10n.text(.importTitle))
                .font(.title2.bold())
            Text(ImportL10n.text(.importSubtitle))
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    private var sourceSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            Text(ImportL10n.text(.importSources))
                .font(.headline)
            ForEach(model.sources) { source in
                HStack(alignment: .firstTextBaseline, spacing: DesignTokens.spacingM) {
                    Button {
                        Task { await model.chooseSource(kind: source.kind, path: source.path) }
                    } label: {
                        HStack(spacing: DesignTokens.spacingS) {
                            Image(systemName: model.sourceKind == source.kind
                                ? "largecircle.fill.circle"
                                : "circle")
                            Text(source.name)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(!source.available && source.kind != .generic)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(source.detail)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                        if let unverified = source.unverified {
                            Text(ImportL10n.format(.importSourceUnverified, value: unverified))
                                .font(.caption)
                                .foregroundStyle(.orange)
                        }
                    }
                }
            }
            if model.sourceKind == .generic {
                HStack(spacing: DesignTokens.spacingM) {
                    Button(ImportL10n.text(.importChooseFolder)) {
                        chooseFolder()
                    }
                    if !model.sourcePath.isEmpty {
                        Text(model.sourcePath)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }
        }
    }

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = ImportL10n.text(.importChooseFolder)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await model.chooseSource(kind: .generic, path: url.path) }
    }

    private var fileSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            Text(ImportL10n.text(.importCategoriesTitle))
                .font(.headline)
            if model.files.isEmpty {
                Text(ImportL10n.text(.importChooseFolder))
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.files) { file in
                    HStack(spacing: DesignTokens.spacingM) {
                        Text(file.relativePath)
                            .font(.callout)
                            .lineLimit(1)
                        Spacer()
                        Picker("", selection: categoryBinding(for: file)) {
                            Text(ImportL10n.text(.importUnsupported)).tag(ImportCategory?.none)
                            ForEach(ImportCategory.allCases, id: \.self) { category in
                                Text(ImportL10n.text(category.titleKey)).tag(ImportCategory?.some(category))
                            }
                        }
                        .labelsHidden()
                        .frame(width: 160)
                        .disabled(!file.supported)
                    }
                }
            }
        }
    }

    private var includesPersonaField: Bool {
        model.sourceKind == .alma || model.sourceKind == .hermes
    }

    private var personaSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            Text(ImportL10n.text(.importPersonaProvided))
                .font(.callout)
                .foregroundStyle(.secondary)
            TextEditor(text: $model.personaText)
                .font(.callout)
                .frame(minHeight: 96)
                .overlay(
                    RoundedRectangle(cornerRadius: DesignTokens.cornerRadius)
                        .stroke(.quaternary)
                )
                .accessibilityLabel(ImportL10n.text(.importPersonaPlaceholder))
        }
    }

    private var conversationSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            Toggle(ImportL10n.text(.importIncludeConversations), isOn: $model.includeConversations)
            if model.includeConversations {
                HStack(spacing: DesignTokens.spacingM) {
                    DatePicker(
                        ImportL10n.text(.importRangeStart),
                        selection: $startDate,
                        displayedComponents: .date
                    )
                    DatePicker(
                        ImportL10n.text(.importRangeEnd),
                        selection: $endDate,
                        displayedComponents: .date
                    )
                }
                .onChange(of: startDate) { _, value in
                    model.setRange(start: value, end: endDate)
                }
                .onChange(of: endDate) { _, value in
                    model.setRange(start: startDate, end: value)
                }
                if model.requiresRange {
                    Text(ImportL10n.text(.importRangeRequired))
                        .font(.callout)
                        .foregroundStyle(.orange)
                }
            }
        }
    }

    /// 有重複項目時才出現；打開後，重複的項目可以勾選再建立一份。
    @ViewBuilder
    private var reimportSection: some View {
        if let preview = model.preview, preview.duplicates > 0 {
            VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
                Toggle(ImportL10n.text(.importReimport), isOn: $model.allowReimport)
                Text(ImportL10n.text(.importReimportDetail))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var actions: some View {
        HStack(spacing: DesignTokens.spacingM) {
            Button(ImportL10n.text(model.phase == .previewing ? .importPreviewing : .importPreview)) {
                Task { await model.preview() }
            }
            .keyboardShortcut(.defaultAction)
            .disabled(!model.canPreview)

            Button(ImportL10n.count(.importWrite, count: model.selectedCardCount)) {
                Task { await model.write() }
            }
            .disabled(!model.canWrite)

            Spacer()

            Button(ImportL10n.text(.importSelectAll)) {
                model.selectAll()
            }
            .buttonStyle(.link)
            Button(ImportL10n.text(.importDeselectAll)) {
                model.deselectAll()
            }
            .buttonStyle(.link)
        }
    }

    // MARK: - 預覽

    @ViewBuilder
    private func previewSection(_ preview: ImportPreview) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingL) {
            HStack(spacing: DesignTokens.spacingL) {
                Text(ImportL10n.count(.importNewCards, count: preview.newCards))
                if preview.duplicates > 0 {
                    Text(ImportL10n.count(.importDuplicates, count: preview.duplicates))
                        .foregroundStyle(.secondary)
                }
            }
            .font(.headline)

            if let estimate = preview.conversationEstimate {
                estimateSection(estimate)
            }
            ForEach(ImportCategoryOrder.all, id: \.self) { category in
                let items = preview.items.filter { $0.category == category }
                if !items.isEmpty {
                    categorySection(category, items: items)
                }
            }
            let conversations = preview.conversations
            if !conversations.isEmpty {
                conversationList(conversations)
            }
            let skills = preview.skills
            if !skills.isEmpty {
                skillList(skills)
            }
            if !preview.warnings.isEmpty {
                noteList(ImportL10n.text(.importWarningsTitle), preview.warnings)
            }
            if !preview.skipped.isEmpty {
                skippedList(preview.skipped)
            }
            if !preview.notes.isEmpty {
                noteList(
                    ImportL10n.text(.importNotesTitle),
                    preview.notes.map { "\($0.path)：\($0.detail)" }
                )
            }
        }
    }

    private func estimateSection(_ estimate: ImportConversationEstimate) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Text(ImportL10n.text(.importEstimateTitle))
                .font(.headline)
            Text(ImportL10n.count(.importEstimateConversations, count: estimate.candidates))
            Text(ImportL10n.count(.importEstimateTokens, count: estimate.estimatedModelInputTokens))
            if estimate.existingSummaries > 0 {
                Text(ImportL10n.count(
                    .importEstimateExisting,
                    count: estimate.existingSummaries
                ))
                .foregroundStyle(.secondary)
            }
        }
        .font(.callout)
    }

    private func categorySection(
        _ category: ImportCategory,
        items: [ImportPreviewItem]
    ) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Text(ImportL10n.text(category.titleKey))
                .font(.headline)
            ForEach(items) { item in
                selectableRow(
                    item: item,
                    isSelected: model.selectedKeys.contains(item.key),
                    isDuplicate: item.duplicateCardId != nil,
                    showsCoreMemory: false
                )
            }
        }
    }

    private func conversationList(_ conversations: [ImportConversation]) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Text(ImportL10n.text(.importCategoryConversation))
                .font(.headline)
            ForEach(conversations) { conversation in
                let item = ImportPreviewItem(
                    key: conversation.key,
                    category: .conversation,
                    title: conversation.title,
                    body: conversation.existingSummary ?? "",
                    summary: nil,
                    tags: [],
                    createdAt: conversation.createdAt,
                    contentHash: conversation.contentHash,
                    source: conversation.source,
                    importance: nil,
                    duplicateCardId: nil
                )
                selectableRow(
                    item: item,
                    isSelected: model.selectedKeys.contains(conversation.key),
                    isDuplicate: false,
                    showsCoreMemory: false
                )
            }
        }
    }

    private func skillList(_ skills: [ImportPreviewSkill]) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Text(ImportL10n.text(.importCategorySkill))
                .font(.headline)
            ForEach(skills) { skill in
                Toggle(isOn: binding(for: skill.key, duplicate: skill.existingSkillPath != nil)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(skill.name)
                        Text(skill.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .disabled(skill.existingSkillPath != nil)
            }
        }
    }

    private func selectableRow(
        item: ImportPreviewItem,
        isSelected: Bool,
        isDuplicate: Bool,
        showsCoreMemory: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            HStack(alignment: .firstTextBaseline, spacing: DesignTokens.spacingS) {
                Toggle(isOn: binding(for: item.key, duplicate: isDuplicate)) {
                    Text(item.title)
                        .lineLimit(1)
                }
                .disabled(isDuplicate && !model.allowReimport)
                if isDuplicate {
                    Text(ImportL10n.text(.importDuplicate))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            if !item.body.isEmpty {
                Text(item.body)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
            if showsCoreMemory || item.category == .user || item.category == .memory {
                Toggle(
                    ImportL10n.text(.importCoreMemory),
                    isOn: coreMemoryBinding(for: item.key)
                )
                .font(.caption)
                .disabled(!isSelected)
            }
        }
    }

    private func skippedList(_ skipped: [ImportSkippedItem]) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Text(ImportL10n.text(.importSkippedTitle))
                .font(.headline)
            ForEach(Array(skipped.enumerated()), id: \.offset) { _, item in
                Text("\(item.path)：\(item.reason)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func noteList(_ title: String, _ notes: [String]) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Text(title)
                .font(.headline)
            ForEach(Array(notes.enumerated()), id: \.offset) { _, note in
                Text(note)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - 結果

    private func resultSection(_ result: ImportWriteResult) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Text(ImportL10n.text(.importResultTitle))
                .font(.headline)
            Text(ImportL10n.count(.importResultCards, count: result.cardsCreated))
            Text(ImportL10n.count(.importResultSkills, count: result.skillsCopied))
            if result.duplicates > 0 {
                Text(ImportL10n.count(.importDuplicates, count: result.duplicates))
                    .foregroundStyle(.secondary)
            }
            if result.failed > 0 {
                Text(ImportL10n.format(.importFailed, value: "\(result.failed)"))
                    .foregroundStyle(.red)
            }
        }
        .font(.callout)
    }

    // MARK: - 綁定

    private func categoryBinding(for file: ImportFileEntry) -> Binding<ImportCategory?> {
        Binding(
            get: { model.category(for: file.relativePath) },
            set: { model.setCategory($0, for: file.relativePath) }
        )
    }

    private func binding(for key: String, duplicate: Bool) -> Binding<Bool> {
        let locked = duplicate && !model.allowReimport
        return Binding(
            get: { !locked && model.selectedKeys.contains(key) },
            set: { model.setSelected(key, $0) }
        )
    }

    private func coreMemoryBinding(for key: String) -> Binding<Bool> {
        Binding(
            get: { model.coreMemoryKeys.contains(key) },
            set: { model.setCoreMemory(key, $0) }
        )
    }
}
