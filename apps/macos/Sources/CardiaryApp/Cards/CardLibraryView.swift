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
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            header
            HSplitView {
                libraryPane
                    .frame(minWidth: 240, idealWidth: DesignTokens.cardListWidth, maxWidth: 380)
                detailPane
                    .frame(minWidth: 260, maxWidth: .infinity, maxHeight: .infinity)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: DesignTokens.panelRadius, style: .continuous))
            }
        }
        .padding(DesignTokens.spacingL)
        .background(Palette.canvas)
        .dropDestination(for: URL.self) { urls, _ in
            Task { await model.importDropped(urls: urls) }
            return true
        } isTargeted: { isDropTargeted = $0 }
        .overlay {
            if isDropTargeted {
                RoundedRectangle(cornerRadius: DesignTokens.panelRadius, style: .continuous)
                    .fill(Palette.orangeSoft.opacity(0.85))
                    .overlay {
                        Label(CardL10n.text(.cardsDropHint), systemImage: "square.and.arrow.down.fill")
                            .font(.cardiary(.headline))
                            .foregroundStyle(Palette.orangeInk)
                    }
                    .padding(DesignTokens.spacingM)
                    .allowsHitTesting(false)
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
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            HStack(spacing: DesignTokens.spacingM) {
                ThemePageTitle(
                    title: CardL10n.text(.cardsTitle),
                    subtitle: CardL10n.count(.cardsCount, count: model.items.count),
                    suit: .diamond
                )
                Spacer()
                if model.isImporting {
                    SuitLoader()
                }
                Button {
                    Task { await model.reload() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 12, weight: .bold))
                }
                .buttonStyle(ThemeIconButtonStyle(diameter: 30))
                .help(CardL10n.text(.cardsRefresh))
                .accessibilityLabel(CardL10n.text(.cardsRefresh))
                .disabled(model.isLoading || !model.isServiceAvailable)
                Button {
                    isNewCardPresented = true
                } label: {
                    Label(CardL10n.text(.cardsNew), systemImage: "plus")
                }
                .buttonStyle(.themePrimary)
                .disabled(!model.isServiceAvailable)
            }

            HStack(spacing: DesignTokens.spacingS) {
                ThemeSegmented(
                    selection: Binding(
                        get: { model.mode },
                        set: { model.setMode($0) }
                    ),
                    options: [
                        (CardLibraryMode.list, CardL10n.text(.cardsModeList)),
                        (CardLibraryMode.overview, CardL10n.text(.cardsModeOverview)),
                    ]
                )
                .fixedSize()
                searchField
                tagPicker
                Spacer(minLength: 0)
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: DesignTokens.spacingXS) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Palette.inkSecondary)
            TextField(CardL10n.text(.cardsSearchPlaceholder), text: $model.query)
                .textFieldStyle(.plain)
                .font(.cardiary(.callout))
                .onSubmit { Task { await model.loadFirstPage() } }
            if !model.query.isEmpty {
                Button {
                    model.query = ""
                    Task { await model.loadFirstPage() }
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 8, weight: .bold))
                }
                .buttonStyle(ThemeIconButtonStyle(diameter: 18))
                .help(CardL10n.text(.cardsSearchClear))
            }
        }
        .padding(.horizontal, DesignTokens.spacingM)
        .padding(.vertical, 6)
        .background(Palette.sunken, in: Capsule(style: .continuous))
        .frame(maxWidth: 260)
    }

    private var tagPicker: some View {
        ThemeMenuPicker(
            selection: Binding(
                get: { model.tagFilter },
                set: { value in
                    model.tagFilter = value
                    Task { await model.loadFirstPage() }
                }
            ),
            options: [(String?.none, CardL10n.text(.cardsTagAll))]
                + model.tags.map { (String?.some($0), "# " + $0) }
        )
        .help(CardL10n.text(.cardsTagLabel))
    }

    // MARK: - 左側：列表或總覽

    @ViewBuilder
    private var libraryPane: some View {
        if model.mode == .overview {
            overviewGrid
        } else {
            VStack(spacing: DesignTokens.spacingS) {
                if model.isLoading && model.items.isEmpty {
                    VStack(spacing: DesignTokens.spacingS) {
                        SuitLoader()
                        Text(CardL10n.text(.cardsLoading))
                            .font(.cardiary(.callout))
                            .foregroundStyle(Palette.inkSecondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if model.items.isEmpty {
                    ThemeEmptyState(
                        text: model.query.isEmpty ? CardL10n.text(.cardsEmpty) : CardL10n.text(.cardsNoResults),
                        suit: .diamond
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
            LazyVStack(spacing: DesignTokens.spacingS) {
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
                    HStack(spacing: DesignTokens.spacingS) {
                        SuitLoader(size: 7)
                        Text(CardL10n.text(.cardsLoadingMore))
                            .font(.cardiary(.caption))
                            .foregroundStyle(Palette.inkSecondary)
                    }
                    .padding(DesignTokens.spacingM)
                }
            }
        }
        .scrollIndicators(.never)
    }

    private var overviewGrid: some View {
        ScrollView {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 16, maximum: 22), spacing: 4)],
                spacing: 4
            ) {
                ForEach(model.items) { item in
                    let appearance = model.appearance(for: item)
                    let suit = CardFreshnessFill.suit(kind: item.kind, lifecycle: item.lifecycle)
                    let isSelected = model.selectedCardId == item.id
                    RoundedRectangle(cornerRadius: DesignTokens.smallRadius, style: .continuous)
                        .fill(CardFreshnessFill.overview(for: appearance, suit: suit))
                        .frame(height: 18)
                        .overlay {
                            if isSelected {
                                RoundedRectangle(cornerRadius: DesignTokens.smallRadius, style: .continuous)
                                    .strokeBorder(Palette.ink, lineWidth: 1.5)
                            }
                        }
                        .scaleEffect(isSelected ? 1.15 : 1)
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
            .padding(DesignTokens.spacingM)
            if model.isLoadingMore {
                SuitLoader(size: 7).padding(DesignTokens.spacingS)
            }
        }
        .scrollIndicators(.never)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: DesignTokens.panelRadius, style: .continuous))
        .overlay(alignment: .bottom) {
            Text(CardL10n.text(.cardsOverviewHint))
                .font(.cardiary(.caption2))
                .foregroundStyle(Palette.inkSecondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Palette.sunken, in: Capsule(style: .continuous))
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
            ThemeEmptyState(text: CardL10n.text(.cardsDetailEmpty), suit: .heart)
        }
    }

    @ViewBuilder
    private var statusBanners: some View {
        if let error = model.errorMessage {
            MessageBanner(text: error, systemImage: "exclamationmark.triangle", tone: .red)
        }
        if let notice = model.noticeMessage {
            MessageBanner(text: notice, systemImage: "checkmark.circle", tone: .sage)
        }
    }
}

/// 新鮮度的五格膠囊：亮起的格數對應新鮮度（工作目標以五顆點數表示新鮮度）。
struct FreshnessPips: View {
    let appearance: CardFreshnessAppearance
    let suit: Suit
    var count = 5

    var body: some View {
        let lit = Int((appearance.fraction * Double(count)).rounded(.up))
        HStack(spacing: 2) {
            ForEach(0..<count, id: \.self) { index in
                Capsule(style: .continuous)
                    .fill(index < lit ? suit.ink : Palette.hover)
                    .frame(width: 9, height: 5)
            }
        }
        .accessibilityHidden(true)
    }
}

/// 花色圖塊：卡片的花色。實色色塊配深墨字，任何新鮮度都看得清楚；
/// 新鮮度改用 `FreshnessPips` 與數值表示，不放在底色濃淡上。
private struct SuitTile: View {
    let suit: Suit
    var size: CGFloat = 34

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.32, style: .continuous)
                .fill(suit.color)
            Image(systemName: suit.symbol)
                .font(.system(size: size * 0.42, weight: .bold))
                .foregroundStyle(Palette.onAccent)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

private struct CardRowView: View {
    let item: CardLibraryModel.Item
    let appearance: CardFreshnessAppearance
    let isSelected: Bool
    let onSelect: () -> Void
    let onRefresh: () -> Void

    @State private var isHovered = false

    private var suit: Suit {
        CardFreshnessFill.suit(kind: item.kind, lifecycle: item.lifecycle)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            SuitTile(suit: suit)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: DesignTokens.spacingXS) {
                    Text(item.title)
                        .font(.cardiary(.callout, weight: .semibold))
                        .lineLimit(1)
                    if item.broken {
                        ThemeChip(text: CardL10n.text(.cardsBroken), tone: .red)
                    }
                    if item.lifecycle == .cold {
                        Image(systemName: "snowflake")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Palette.grayInk)
                    }
                    Spacer(minLength: 0)
                    Text(CardL10n.text(item.kind.cardStringKey))
                        .font(.cardiary(.caption2, weight: .semibold))
                        .foregroundStyle(suit.ink)
                }
                if let snippet = item.snippet, !snippet.isEmpty {
                    Text(snippet)
                        .font(.cardiary(.caption))
                        .foregroundStyle(Palette.inkSecondary)
                        .lineLimit(2)
                } else if let summary = item.summary, !summary.isEmpty {
                    Text(summary)
                        .font(.cardiary(.caption))
                        .foregroundStyle(Palette.inkSecondary)
                        .lineLimit(2)
                }
                HStack(spacing: DesignTokens.spacingXS) {
                    FreshnessPips(appearance: appearance, suit: suit)
                        .help(CardL10n.format(.cardsFreshnessHelp, value: "\(appearance.value)"))
                    Text(CardL10n.format(.cardsDetailFreshness, value: "\(appearance.value)"))
                        .font(.cardiary(.caption2, monospacedDigits: true))
                        .foregroundStyle(appearance.needsAttention ? Palette.orangeInk : Palette.inkSecondary)
                        .fixedSize()
                        .help(
                            attentionText
                                ?? CardL10n.format(.cardsFreshnessHelp, value: "\(appearance.value)")
                        )
                    if appearance.needsAttention {
                        Button(CardL10n.text(.cardsDetailRefresh)) { onRefresh() }
                            .buttonStyle(.themeLink)
                            .controlSize(.small)
                            .fixedSize()
                    }
                    Spacer(minLength: 0)
                    if let tag = item.tags.first {
                        ThemeChip(text: "# " + tag, tone: suit.tone)
                            .layoutPriority(-1)
                    }
                }
            }
        }
        .padding(DesignTokens.rowPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(rowBackground, in: RoundedRectangle(cornerRadius: DesignTokens.cardRadius, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: DesignTokens.cardRadius, style: .continuous))
        .onTapGesture { onSelect() }
        .onHover { isHovered = $0 }
        .animation(.easeOut(duration: 0.12), value: isHovered)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    /// 快歸零或已歸零的說明，放在新鮮度的懸停提示裡。
    private var attentionText: String? {
        if appearance.isExpired { return CardL10n.text(.cardsExpired) }
        if appearance.needsAttention { return CardL10n.text(.cardsNearZero) }
        return nil
    }

    private var rowBackground: Color {
        if isSelected { return suit.soft }
        return isHovered ? Palette.surface.opacity(0.75) : Palette.surface
    }
}

private struct CardDetailView: View {
    @ObservedObject var model: CardLibraryModel
    let card: Card
    let onDelete: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DesignTokens.spacingL) {
                faceBlock
                if card.kind == .image {
                    imageBlock
                } else if card.kind == .audio {
                    Label(CardL10n.text(.cardsAudioCard), systemImage: "waveform")
                        .font(.cardiary(.callout))
                        .foregroundStyle(Palette.inkSecondary)
                }
                bodyBlock
                linksBlock
                if let error = model.errorMessage {
                    MessageBanner(text: error, systemImage: "exclamationmark.triangle", tone: .red)
                }
                if let notice = model.noticeMessage {
                    MessageBanner(text: notice, systemImage: "checkmark.circle", tone: .sage)
                }
                HStack {
                    Spacer()
                    Button(role: .destructive, action: onDelete) {
                        Label(CardL10n.text(.cardsDetailDelete), systemImage: "trash.fill")
                    }
                    .controlSize(.small)
                }
            }
            .padding(DesignTokens.spacingL)
        }
        .scrollIndicators(.never)
    }

    private var appearance: CardFreshnessAppearance {
        model.freshness.appearance(for: card.cardId, fallback: card.freshness)
    }

    private var suit: Suit {
        CardFreshnessFill.suit(kind: card.kind, lifecycle: card.lifecycle)
    }

    /// 卡面：花色、種類、標題、新鮮度與標籤，放在花色的淺色色塊上。
    private var faceBlock: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            HStack(spacing: DesignTokens.spacingS) {
                SuitTile(suit: suit, size: 30)
                ThemeChip(text: CardL10n.text(card.kind.cardStringKey), tone: suit.tone, filled: true)
                Spacer()
                if !model.isEditing {
                    Button(CardL10n.text(.cardsDetailEdit)) { model.beginEditing() }
                        .buttonStyle(ThemeButtonStyle(kind: .surface))
                        .controlSize(.small)
                }
            }
            Text(card.title)
                .font(.cardiary(.title2, weight: .bold))
                .textSelection(.enabled)
            HStack(spacing: DesignTokens.spacingS) {
                Text(CardL10n.format(.cardsDetailFreshness, value: "\(appearance.value)"))
                    .font(.cardiary(.callout, weight: .semibold, monospacedDigits: true))
                    .foregroundStyle(appearance.needsAttention ? Palette.orangeInk : Palette.ink)
                FreshnessPips(appearance: appearance, suit: suit)
                    .help(CardL10n.format(.cardsFreshnessHelp, value: "\(appearance.value)"))
                if appearance.needsAttention {
                    Button(CardL10n.text(.cardsDetailRefresh)) {
                        Task { await model.refresh(cardId: card.cardId) }
                    }
                    .buttonStyle(ThemeButtonStyle(kind: .primary, tone: .orange))
                    .controlSize(.small)
                }
                Spacer(minLength: 0)
                Image(systemName: suit.symbol)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(suit.ink)
                    .accessibilityHidden(true)
            }
            if !card.tags.isEmpty {
                FlowTags(tags: card.tags, tone: suit.tone)
            }
        }
        .padding(DesignTokens.spacingL)
        .background(suit.soft, in: RoundedRectangle(cornerRadius: DesignTokens.cardRadius, style: .continuous))
    }

    @ViewBuilder
    private var imageBlock: some View {
        if let data = model.selectedImageData, let image = NSImage(data: data) {
            Image(nsImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxHeight: 260)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.cardRadius, style: .continuous))
        } else {
            HStack(spacing: DesignTokens.spacingS) {
                SuitLoader(size: 7)
                Text(CardL10n.text(.cardsImageLoading))
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkSecondary)
            }
        }
    }

    @ViewBuilder
    private var bodyBlock: some View {
        if model.isEditing {
            VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
                TextEditor(text: $model.editingBody)
                    .font(.body.monospaced())
                    .themeEditor(minHeight: 220)
                HStack {
                    Button(CardL10n.text(.cardsDetailSave)) {
                        Task { await model.save() }
                    }
                    .buttonStyle(.themePrimary)
                    Button(CardL10n.text(.cardsDetailCancel)) { model.cancelEditing() }
                        .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
                }
                .controlSize(.small)
            }
        } else {
            Text(card.body.isEmpty ? CardL10n.text(.cardsBodyPlaceholder) : card.body)
                .font(.cardiary(.body))
                .foregroundStyle(card.body.isEmpty ? Palette.inkTertiary : Palette.ink)
                .lineSpacing(3)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, DesignTokens.spacingXS)
        }
    }

    private var linksBlock: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            SuitHeading(title: CardL10n.text(.cardsBacklinks), suit: .club, font: .cardiary(.caption, weight: .bold))
            if card.links.backlinks.isEmpty && card.links.outgoing.isEmpty {
                Text(CardL10n.text(.cardsLinksNone))
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkTertiary)
            } else {
                ForEach(card.links.backlinks, id: \.self) { id in
                    linkRow(id, systemImage: "arrow.turn.up.left")
                }
                ForEach(card.links.outgoing, id: \.self) { id in
                    linkRow(id, systemImage: "arrow.turn.up.right")
                }
            }
            if !card.sources.isEmpty {
                SuitHeading(title: CardL10n.text(.cardsSources), suit: .diamond, font: .cardiary(.caption, weight: .bold))
                    .padding(.top, DesignTokens.spacingXS)
                ForEach(card.sources, id: \.self) { id in
                    linkRow(id, systemImage: "doc.on.doc.fill")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themeBlock(Palette.canvas, radius: DesignTokens.cardRadius)
    }

    private func linkRow(_ id: String, systemImage: String) -> some View {
        let title = model.items.first { $0.id == id }?.title ?? id
        return Button {
            Task { await model.select(cardId: id) }
        } label: {
            Label(title, systemImage: systemImage)
                .lineLimit(1)
        }
        .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .pink))
        .controlSize(.small)
    }
}

/// 會自動換行的標籤列。
private struct FlowTags: View {
    let tags: [String]
    let tone: Tone

    var body: some View {
        FlowLayout(spacing: DesignTokens.spacingXS) {
            ForEach(tags, id: \.self) { tag in
                Text("# " + tag)
                    .font(.cardiary(.caption, weight: .semibold))
                    .foregroundStyle(tone.ink)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 3)
                    .background(Palette.surface.opacity(0.8), in: Capsule(style: .continuous))
            }
        }
    }
}

/// 簡單的換行排版：放不下就換到下一行。
struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(proposal: proposal, subviews: subviews)
        let height = rows.last.map { $0.y + $0.height } ?? 0
        let width = rows.map { $0.width }.max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = arrange(proposal: ProposedViewSize(width: bounds.width, height: nil), subviews: subviews)
        for row in rows {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
        }
    }

    private struct Row {
        var indices: [Int] = []
        var y: CGFloat = 0
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> [Row] {
        let maxWidth = proposal.width ?? .infinity
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            if needed > maxWidth, !current.indices.isEmpty {
                rows.append(current)
                current = Row(y: current.y + current.height + spacing)
            }
            current.width = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            current.height = max(current.height, size.height)
            current.indices.append(index)
        }
        if !current.indices.isEmpty { rows.append(current) }
        return rows
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
            ThemePageTitle(title: CardL10n.text(.cardsNew), suit: .club)
            TextField(CardL10n.text(.cardsNewTitle), text: $title)
            TextField(CardL10n.text(.cardsNewTags), text: $tags)
            Text(CardL10n.text(.cardsNewBody))
                .font(.cardiary(.caption, weight: .semibold))
                .foregroundStyle(Palette.inkSecondary)
            TextEditor(text: $bodyText)
                .font(.body.monospaced())
                .themeEditor(minHeight: 160)
            HStack {
                Spacer()
                Button(AppL10n.text(.genericCancel)) { dismiss() }
                    .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
                Button(CardL10n.text(.cardsCreateAction)) {
                    isSaving = true
                    Task {
                        let created = await model.createNote(
                            title: title,
                            body: bodyText,
                            tags: CardTagInput.parse(tags)
                        )
                        isSaving = false
                        if created { dismiss() }
                    }
                }
                .buttonStyle(.themePrimary)
                .keyboardShortcut(.defaultAction)
                .disabled(isSaving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(DesignTokens.spacingXL)
        .frame(width: 520)
        .background(Palette.canvas)
        .cardiaryTheme()
    }
}
