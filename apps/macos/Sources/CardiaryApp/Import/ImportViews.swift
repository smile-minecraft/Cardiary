import AppKit
import SwiftUI
import UniformTypeIdentifiers

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
                    MessageBanner(text: message, systemImage: "exclamationmark.triangle", tone: .red)
                }
                if let progress = model.progress {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(ImportL10n.format(
                            .importProgress,
                            value: "\(progress.done) / \(progress.total)"
                        ))
                        .font(.cardiary(.callout, monospacedDigits: true))
                        .foregroundStyle(Palette.inkSecondary)
                        ThemeProgressBar(
                            value: progress.total > 0 ? Double(progress.done) / Double(progress.total) : 0,
                            tone: .orange
                        )
                    }
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
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.never)
        .background(Palette.canvas)
        .cardiaryTheme()
        .task {
            if case .idle = model.phase {
                await model.load()
            }
        }
    }

    // MARK: - 區塊

    private var header: some View {
        ThemePageTitle(
            title: ImportL10n.text(.importTitle),
            subtitle: ImportL10n.text(.importSubtitle),
            suit: .diamond
        )
    }

    private var sourceSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            SuitHeading(title: ImportL10n.text(.importSources), suit: .heart)
            ForEach(model.sources) { source in
                let isChosen = model.sourceKind == source.kind
                Button {
                    if source.kind == .claude {
                        chooseClaudeExport()
                    } else if source.kind == .openClaw && !source.available {
                        chooseFolder(kind: .openClaw)
                    } else {
                        Task { await model.chooseSource(kind: source.kind, path: source.path) }
                    }
                } label: {
                    HStack(alignment: .top, spacing: DesignTokens.spacingM) {
                        Image(systemName: isChosen ? "checkmark" : Suit.diamond.symbol)
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(isChosen ? Palette.onAccent : Palette.orangeInk)
                            .frame(width: 24, height: 24)
                            .background(isChosen ? Palette.red : Palette.orangeSoft, in: Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            Text(source.name)
                                .font(.cardiary(.callout, weight: .semibold))
                            Text(source.detail)
                                .font(.cardiary(.caption))
                                .foregroundStyle(Palette.inkSecondary)
                            if let unverified = source.unverified {
                                Text(ImportL10n.format(.importSourceUnverified, value: unverified))
                                    .font(.cardiary(.caption))
                                    .foregroundStyle(Palette.orangeInk)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(DesignTokens.spacingM)
                    .background(isChosen ? Palette.redSoft : Palette.canvas, in: RoundedRectangle(cornerRadius: DesignTokens.cardRadius, style: .continuous))
                    .contentShape(RoundedRectangle(cornerRadius: DesignTokens.cardRadius, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(!source.available && source.kind != .generic && source.kind != .openClaw && source.kind != .claude)
            }
            if model.sourceKind == .generic || model.sourceKind == .openClaw {
                HStack(spacing: DesignTokens.spacingM) {
                    Button(ImportL10n.text(.importChooseFolder)) {
                        chooseFolder(kind: model.sourceKind)
                    }
                    if !model.sourcePath.isEmpty {
                        Text(model.sourcePath)
                            .font(.cardiary(.caption))
                            .foregroundStyle(Palette.inkSecondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }
            if model.sourceKind == .claude && !model.sourcePath.isEmpty {
                Text(model.sourcePath)
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .themeBlock(Palette.surface, radius: DesignTokens.panelRadius, padding: DesignTokens.spacingL)
    }

    private func chooseFolder(kind: ImportSourceKind) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = ImportL10n.text(.importChooseFolder)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await model.chooseSource(kind: kind, path: url.path) }
    }

    private func chooseClaudeExport() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.json, .zip]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { await model.chooseSource(kind: .claude, path: url.path) }
    }

    private var fileSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            SuitHeading(title: ImportL10n.text(.importCategoriesTitle), suit: .club)
            if model.files.isEmpty {
                Text(ImportL10n.text(.importChooseFolder))
                    .font(.cardiary(.callout))
                    .foregroundStyle(Palette.inkSecondary)
            } else {
                ForEach(model.files) { file in
                    HStack(spacing: DesignTokens.spacingM) {
                        Text(file.relativePath)
                            .font(.cardiary(.callout))
                            .lineLimit(1)
                        Spacer()
                        ThemeMenuPicker(
                            selection: categoryBinding(for: file),
                            options: [(ImportCategory?.none, ImportL10n.text(.importUnsupported))]
                                + ImportCategory.allCases.map { (ImportCategory?.some($0), ImportL10n.text($0.titleKey)) }
                        )
                        .disabled(!file.supported)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeBlock(Palette.surface, radius: DesignTokens.panelRadius, padding: DesignTokens.spacingL)
    }

    private var includesPersonaField: Bool {
        model.sourceKind == .alma || model.sourceKind == .hermes
    }

    private var personaSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            Text(ImportL10n.text(.importPersonaProvided))
                .font(.cardiary(.callout))
                .foregroundStyle(Palette.inkSecondary)
            TextEditor(text: $model.personaText)
                .font(.cardiary(.callout))
                .themeEditor(minHeight: 96)
                .accessibilityLabel(ImportL10n.text(.importPersonaPlaceholder))
        }
    }

    private var conversationSection: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            Toggle(ImportL10n.text(.importIncludeConversations), isOn: $model.includeConversations)
                .onChange(of: model.includeConversations) { _, value in
                    if value {
                        model.setRange(start: startDate, end: endDate)
                    }
                }
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
                        .font(.cardiary(.callout))
                        .foregroundStyle(Palette.orangeInk)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeBlock(Palette.surface, radius: DesignTokens.panelRadius, padding: DesignTokens.spacingL)
    }

    /// 有重複項目時才出現；打開後，重複的項目可以勾選再建立一份。
    @ViewBuilder
    private var reimportSection: some View {
        if let preview = model.preview, preview.duplicates > 0 {
            VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
                Toggle(ImportL10n.text(.importReimport), isOn: $model.allowReimport)
                Text(ImportL10n.text(.importReimportDetail))
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkSecondary)
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
            .buttonStyle(.themePrimary)
            .disabled(!model.canWrite)

            Spacer()

            Button(ImportL10n.text(.importSelectAll)) {
                model.selectAll()
            }
            .buttonStyle(.themeLink)
            Button(ImportL10n.text(.importDeselectAll)) {
                model.deselectAll()
            }
            .buttonStyle(.themeLink)
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
                        .foregroundStyle(Palette.inkSecondary)
                }
            }
            .font(.cardiary(.headline))

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
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeBlock(Palette.surface, radius: DesignTokens.panelRadius, padding: DesignTokens.spacingL)
    }

    private func estimateSection(_ estimate: ImportConversationEstimate) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Text(ImportL10n.text(.importEstimateTitle))
                .font(.cardiary(.headline))
            Text(ImportL10n.count(.importEstimateConversations, count: estimate.candidates))
            Text(ImportL10n.count(.importEstimateTokens, count: estimate.estimatedModelInputTokens))
            if estimate.existingSummaries > 0 {
                Text(ImportL10n.count(
                    .importEstimateExisting,
                    count: estimate.existingSummaries
                ))
                .foregroundStyle(Palette.inkSecondary)
            }
        }
        .font(.cardiary(.callout))
    }

    private func categorySection(
        _ category: ImportCategory,
        items: [ImportPreviewItem]
    ) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Text(ImportL10n.text(category.titleKey))
                .font(.cardiary(.headline))
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
                .font(.cardiary(.headline))
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
                .font(.cardiary(.headline))
            ForEach(skills) { skill in
                Toggle(isOn: binding(for: skill.key, duplicate: skill.existingSkillPath != nil)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(skill.name)
                        Text(skill.description)
                            .font(.cardiary(.caption))
                            .foregroundStyle(Palette.inkSecondary)
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
                        .font(.cardiary(.caption))
                        .foregroundStyle(Palette.inkSecondary)
                }
                Spacer()
            }
            if !item.body.isEmpty {
                Text(item.body)
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkSecondary)
                    .lineLimit(3)
            }
            if showsCoreMemory || item.category == .user || item.category == .memory {
                Toggle(
                    ImportL10n.text(.importCoreMemory),
                    isOn: coreMemoryBinding(for: item.key)
                )
                .font(.cardiary(.caption))
                .disabled(!isSelected)
            }
        }
    }

    private func skippedList(_ skipped: [ImportSkippedItem]) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Text(ImportL10n.text(.importSkippedTitle))
                .font(.cardiary(.headline))
            ForEach(Array(skipped.enumerated()), id: \.offset) { _, item in
                Text("\(item.path)：\(item.reason)")
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkSecondary)
            }
        }
    }

    private func noteList(_ title: String, _ notes: [String]) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Text(title)
                .font(.cardiary(.headline))
            ForEach(Array(notes.enumerated()), id: \.offset) { _, note in
                Text(note)
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkSecondary)
            }
        }
    }

    // MARK: - 結果

    private func resultSection(_ result: ImportWriteResult) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Text(ImportL10n.text(.importResultTitle))
                .font(.cardiary(.headline))
            Text(ImportL10n.count(.importResultCards, count: result.cardsCreated))
            Text(ImportL10n.count(.importResultSkills, count: result.skillsCopied))
            if result.duplicates > 0 {
                Text(ImportL10n.count(.importDuplicates, count: result.duplicates))
                    .foregroundStyle(Palette.inkSecondary)
            }
            if result.failed > 0 {
                Text(ImportL10n.format(.importFailed, value: "\(result.failed)"))
                    .foregroundStyle(Palette.redInk)
            }
        }
        .font(.cardiary(.callout))
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeBlock(Palette.sageSoft, radius: DesignTokens.panelRadius, padding: DesignTokens.spacingL)
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
