import AppKit
import CardiaryKit
import SwiftUI

/// 卡片庫：左邊是列表或總覽，右邊是選中卡片的內容。
/// 資料只從 view model 來；這裡不計算新鮮度與 token，只把主機回報的值畫成
/// 顏色與文字。拖進檔案時由 view model 上傳原檔並匯入。
struct CardLibraryView: View {
    @ObservedObject var model: CardLibraryModel

    @State private var isNewCardPresented = false
    @State private var isDeletePresented = false
    @State private var isDropTargeted = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            HSplitView {
                libraryPane
                    .frame(minWidth: 260)
                detailPane
                    .frame(minWidth: 300)
            }
        }
        .background(Color(nsColor: .controlBackgroundColor))
        .dropDestination(for: URL.self) { urls, _ in
            Task { await model.importDropped(urls: urls) }
            return true
        } isTargeted: { isDropTargeted = $0 }
        .overlay(alignment: .top) {
            if isDropTargeted {
                Label(CardL10n.text(.cardsDropHint), systemImage: "square.and.arrow.down")
                    .font(.callout)
                    .padding(DesignTokens.spacingS)
                    .background(.regularMaterial, in: Capsule())
                    .padding(.top, DesignTokens.spacingS)
            }
        }
        .task {
            if model.items.isEmpty {
                await model.loadFirstPage()
            }
        }
        .sheet(isPresented: $isNewCardPresented) {
            NewCardSheet(model: model)
        }
        .alert(CardL10n.text(.cardsDeleteConfirmTitle), isPresented: $isDeletePresented) {
            Button(CardL10n.text(.cardsDetailDelete), role: .destructive) {
                Task { await model.deleteSelected() }
            }
            Button(AppL10n.text(.genericCancel), role: .cancel) {}
        } message: {
            Text(CardL10n.text(.cardsDeleteConfirmBody))
        }
    }

    private var header: some View {
        HStack(spacing: DesignTokens.spacingM) {
            VStack(alignment: .leading, spacing: 2) {
                Text(CardL10n.text(.cardsTitle))
                    .font(.title3.bold())
                Text(CardL10n.count(.cardsCount, count: model.items.count))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Picker("", selection: Binding(
                get: { model.mode },
                set: { model.setMode($0) }
            )) {
                Text(CardL10n.text(.cardsModeList)).tag(CardLibraryMode.list)
                Text(CardL10n.text(.cardsModeOverview)).tag(CardLibraryMode.overview)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 150)

            searchField
            tagPicker
            Spacer()

            if model.isImporting {
                ProgressView()
                    .controlSize(.small)
            }
            Button {
                isNewCardPresented = true
            } label: {
                Label(CardL10n.text(.cardsNew), systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(!model.isServiceAvailable)
        }
        .padding(.horizontal, DesignTokens.spacingL)
        .padding(.vertical, DesignTokens.spacingM)
    }

    private var searchField: some View {
        HStack(spacing: DesignTokens.spacingXS) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField(CardL10n.text(.cardsSearchPlaceholder), text: $model.query)
                .textFieldStyle(.plain)
                .onSubmit { Task { await model.loadFirstPage() } }
            if !model.query.isEmpty {
                Button {
                    model.query = ""
                    Task { await model.loadFirstPage() }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help(CardL10n.text(.cardsSearchClear))
            }
        }
        .padding(.horizontal, DesignTokens.spacingS)
        .padding(.vertical, 5)
        .background(.quaternary.opacity(0.35), in: Capsule())
        .frame(maxWidth: 240)
    }

    private var tagPicker: some View {
        Picker(CardL10n.text(.cardsTagLabel), selection: Binding(
            get: { model.tagFilter },
            set: { value in
                model.tagFilter = value
                Task { await model.loadFirstPage() }
            }
        )) {
            Text(CardL10n.text(.cardsTagAll)).tag(String?.none)
            ForEach(model.tags, id: \.self) { tag in
                Text(tag).tag(String?.some(tag))
            }
        }
        .labelsHidden()
        .frame(width: 140)
    }

    // MARK: - 左側：列表或總覽

    @ViewBuilder
    private var libraryPane: some View {
        if model.mode == .overview {
            overviewGrid
        } else {
            VStack(spacing: 0) {
                if model.isLoading && model.items.isEmpty {
                    centeredMessage(CardL10n.text(.cardsLoading), systemImage: "hourglass")
                } else if model.items.isEmpty {
                    centeredMessage(
                        model.query.isEmpty ? CardL10n.text(.cardsEmpty) : CardL10n.text(.cardsNoResults),
                        systemImage: "rectangle.on.rectangle"
                    )
                } else {
                    cardList
                }
                statusBanners
            }
        }
    }

    private var cardList: some View {
        ScrollView {
            LazyVStack(spacing: 1) {
                ForEach(model.items) { item in
                    CardRowView(
                        item: item,
                        appearance: model.appearance(for: item),
                        isSelected: model.selectedCardId == item.id,
                        onSelect: { Task { await model.select(cardId: item.id) } },
                        onRefresh: { Task { await model.refresh(cardId: item.id) } }
                    )
                    .draggable(item.id)
                    .onAppear {
                        Task { await model.loadMoreIfNeeded(current: item) }
                    }
                }
                if model.isLoadingMore {
                    ProgressView(CardL10n.text(.cardsLoadingMore))
                        .controlSize(.small)
                        .padding(DesignTokens.spacingM)
                }
            }
            .padding(DesignTokens.spacingS)
        }
    }

    private var overviewGrid: some View {
        ScrollView {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 12, maximum: 20), spacing: 2)],
                spacing: 2
            ) {
                ForEach(model.items) { item in
                    let appearance = model.appearance(for: item)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(CardFreshnessFill.overview(for: appearance))
                        .frame(height: 14)
                        .overlay {
                            if model.selectedCardId == item.id {
                                RoundedRectangle(cornerRadius: 3)
                                    .stroke(Color.primary, lineWidth: 1.5)
                            }
                        }
                        .help("\(item.title) · \(CardL10n.text(.cardsDetailFreshness).replacingOccurrences(of: "{value}", with: "\(appearance.value)"))")
                        .onTapGesture {
                            Task {
                                await model.select(cardId: item.id)
                                model.setMode(.list)
                            }
                        }
                        .onAppear {
                            Task { await model.loadMoreIfNeeded(current: item) }
                        }
                }
            }
            .padding(DesignTokens.spacingS)
            if model.isLoadingMore {
                ProgressView().controlSize(.small).padding(DesignTokens.spacingS)
            }
        }
        .overlay(alignment: .bottom) {
            Text(CardL10n.text(.cardsOverviewHint))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .padding(6)
                .background(.regularMaterial, in: Capsule())
                .padding(.bottom, DesignTokens.spacingS)
        }
    }

    // MARK: - 右側：詳細內容

    @ViewBuilder
    private var detailPane: some View {
        if let card = model.selectedCard {
            CardDetailView(
                model: model,
                card: card,
                onDelete: { isDeletePresented = true }
            )
        } else {
            centeredMessage(CardL10n.text(.cardsDetailEmpty), systemImage: "rectangle.portrait")
        }
    }

    private var statusBanners: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            if let error = model.errorMessage {
                MessageBanner(text: error, systemImage: "exclamationmark.triangle", tint: .red)
            }
            if let notice = model.noticeMessage {
                MessageBanner(text: notice, systemImage: "checkmark.circle", tint: .secondary)
            }
        }
        .padding(.horizontal, DesignTokens.spacingM)
        .padding(.bottom, model.errorMessage == nil && model.noticeMessage == nil ? 0 : DesignTokens.spacingS)
    }

    private func centeredMessage(_ text: String, systemImage: String) -> some View {
        VStack(spacing: DesignTokens.spacingS) {
            Image(systemName: systemImage)
                .font(.title2)
                .foregroundStyle(.secondary)
            Text(text)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(DesignTokens.spacingL)
    }
}

private struct CardRowView: View {
    let item: CardLibraryModel.Item
    let appearance: CardFreshnessAppearance
    let isSelected: Bool
    let onSelect: () -> Void
    let onRefresh: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: DesignTokens.spacingS) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color.accentColor.opacity(0.15 + 0.85 * appearance.fraction))
                .frame(width: 4)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: DesignTokens.spacingXS) {
                    Text(item.title)
                        .font(.callout.weight(.medium))
                        .lineLimit(1)
                    if item.broken {
                        Text(CardL10n.text(.cardsBroken))
                            .font(.caption2)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(.red.opacity(0.15), in: Capsule())
                    }
                    if item.lifecycle == .cold {
                        Image(systemName: "snowflake")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(CardL10n.text(item.kind.cardStringKey))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if let snippet = item.snippet, !snippet.isEmpty {
                    Text(snippet)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                } else if let summary = item.summary, !summary.isEmpty {
                    Text(summary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                HStack(spacing: DesignTokens.spacingXS) {
                    Text(CardL10n.format(.cardsDetailFreshness, value: "\(appearance.value)"))
                        .font(.caption2)
                        .foregroundStyle(appearance.needsAttention ? .orange : .secondary)
                    if appearance.isExpired {
                        Text(CardL10n.text(.cardsExpired))
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    } else if appearance.needsAttention {
                        Text(CardL10n.text(.cardsNearZero))
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                    if appearance.needsAttention {
                        Button(CardL10n.text(.cardsDetailRefresh)) { onRefresh() }
                            .buttonStyle(.link)
                            .font(.caption2)
                    }
                    Spacer()
                    ForEach(item.tags.prefix(3), id: \.self) { tag in
                        Text(tag)
                            .font(.caption2)
                            .padding(.horizontal, 5)
                            .background(.quaternary.opacity(0.4), in: Capsule())
                    }
                }
            }
        }
        .padding(DesignTokens.spacingS)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(rowBackground, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
        .contentShape(Rectangle())
        .onTapGesture { onSelect() }
    }

    private var rowBackground: Color {
        if isSelected {
            return Color.accentColor.opacity(0.18)
        }
        return CardFreshnessFill.block(for: appearance)
    }
}

private struct CardDetailView: View {
    @ObservedObject var model: CardLibraryModel
    let card: Card
    let onDelete: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
                titleBlock
                if card.kind == .image {
                    imageBlock
                } else if card.kind == .audio {
                    Label(CardL10n.text(.cardsAudioCard), systemImage: "waveform")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                bodyBlock
                linksBlock
                if let error = model.errorMessage {
                    MessageBanner(text: error, systemImage: "exclamationmark.triangle", tint: .red)
                }
                if let notice = model.noticeMessage {
                    MessageBanner(text: notice, systemImage: "checkmark.circle", tint: .secondary)
                }
                HStack {
                    Spacer()
                    Button(role: .destructive, action: onDelete) {
                        Label(CardL10n.text(.cardsDetailDelete), systemImage: "trash")
                    }
                }
            }
            .padding(DesignTokens.spacingL)
        }
    }

    private var appearance: CardFreshnessAppearance {
        model.freshness.appearance(for: card.cardId, fallback: card.freshness)
    }

    private var freshnessBadge: some View {
        HStack(spacing: DesignTokens.spacingS) {
            Text(CardL10n.format(.cardsDetailFreshness, value: "\(appearance.value)"))
                .font(.caption)
                .foregroundStyle(appearance.needsAttention ? Color.orange : Color.secondary)
            ProgressView(value: appearance.fraction)
                .progressViewStyle(.linear)
                .frame(width: 90)
            if appearance.needsAttention {
                Button(CardL10n.text(.cardsDetailRefresh)) {
                    Task { await model.refresh(cardId: card.cardId) }
                }
                .controlSize(.small)
            }
        }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            titleRow
            freshnessRow
            tagsRow
        }
    }

    private var titleRow: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(card.title)
                .font(.title3.bold())
                .textSelection(.enabled)
            Spacer()
            Text(CardL10n.text(card.kind.cardStringKey))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var freshnessRow: some View {
        HStack(spacing: DesignTokens.spacingS) {
            freshnessBadge
            Spacer()
            editButton
        }
    }

    private var editButton: some View {
        Group {
            if !model.isEditing {
                Button(CardL10n.text(.cardsDetailEdit)) { model.beginEditing() }
                    .controlSize(.small)
            }
        }
    }

    @ViewBuilder
    private var tagsRow: some View {
        if !card.tags.isEmpty {
            HStack(spacing: DesignTokens.spacingXS) {
                ForEach(card.tags, id: \.self) { tag in
                    Text(tag)
                        .font(.caption)
                        .padding(.horizontal, 6)
                        .background(.quaternary.opacity(0.4), in: Capsule())
                }
            }
        }
    }

    @ViewBuilder
    private var imageBlock: some View {
        if let data = model.selectedImageData, let image = NSImage(data: data) {
            Image(nsImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxHeight: 260)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cardRadius))
        } else {
            HStack(spacing: DesignTokens.spacingXS) {
                ProgressView().controlSize(.small)
                Text(CardL10n.text(.cardsImageLoading))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var bodyBlock: some View {
        if model.isEditing {
            VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
                TextEditor(text: $model.editingBody)
                    .font(.body.monospaced())
                    .frame(minHeight: 220)
                    .overlay {
                        RoundedRectangle(cornerRadius: DesignTokens.cornerRadius)
                            .stroke(.quaternary)
                    }
                HStack {
                    Button(CardL10n.text(.cardsDetailSave)) {
                        Task { await model.save() }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    Button(CardL10n.text(.cardsDetailCancel)) { model.cancelEditing() }
                        .controlSize(.small)
                }
            }
        } else {
            Text(card.body.isEmpty ? CardL10n.text(.cardsBodyPlaceholder) : card.body)
                .font(.body)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var linksBlock: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
            Divider()
            Text(CardL10n.text(.cardsBacklinks))
                .font(.caption.weight(.semibold))
            if card.links.backlinks.isEmpty && card.links.outgoing.isEmpty {
                Text(CardL10n.text(.cardsLinksNone))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(card.links.backlinks, id: \.self) { id in
                    linkRow(id, systemImage: "arrow.turn.up.left")
                }
                ForEach(card.links.outgoing, id: \.self) { id in
                    linkRow(id, systemImage: "arrow.turn.up.right")
                }
            }
            if !card.sources.isEmpty {
                Text(CardL10n.text(.cardsSources))
                    .font(.caption.weight(.semibold))
                ForEach(card.sources, id: \.self) { id in
                    linkRow(id, systemImage: "doc.on.doc")
                }
            }
        }
    }

    private func linkRow(_ id: String, systemImage: String) -> some View {
        let title = model.items.first { $0.id == id }?.title ?? id
        return Button {
            Task { await model.select(cardId: id) }
        } label: {
            Label(title, systemImage: systemImage)
                .font(.caption)
        }
        .buttonStyle(.link)
    }
}

private struct NewCardSheet: View {
    @ObservedObject var model: CardLibraryModel
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var bodyText = ""
    @State private var tags = ""
    @State private var isSaving = false

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            Text(CardL10n.text(.cardsNew))
                .font(.title3.bold())
            TextField(CardL10n.text(.cardsNewTitle), text: $title)
            TextField(CardL10n.text(.cardsNewTags), text: $tags)
            Text(CardL10n.text(.cardsNewBody))
                .font(.caption)
                .foregroundStyle(.secondary)
            TextEditor(text: $bodyText)
                .font(.body.monospaced())
                .frame(minHeight: 160)
                .overlay {
                    RoundedRectangle(cornerRadius: DesignTokens.cornerRadius)
                        .stroke(.quaternary)
                }
            HStack {
                Spacer()
                Button(AppL10n.text(.genericCancel)) { dismiss() }
                Button(CardL10n.text(.cardsCreateAction)) {
                    isSaving = true
                    Task {
                        let created = await model.createNote(
                            title: title,
                            body: bodyText,
                            tags: Self.parseTags(tags)
                        )
                        isSaving = false
                        if created { dismiss() }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSaving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(DesignTokens.spacingL)
        .frame(width: 520)
    }

    private static func parseTags(_ text: String) -> [String] {
        var seen = Set<String>()
        return text
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }
}
