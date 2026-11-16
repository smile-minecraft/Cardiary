import AppKit
import CardiaryKit
import SwiftUI

/// 檢視欄的上下文面板。掛在 `InspectorRegistry` 的 `context` 位置。
public final class ContextInspectorPanel: InspectorPanel {
    public let id = "context"
    public let titleKey: AppString = .inspectorTitle
    public var subtitleKey: AppString? { nil }

    private let model: ContextInspectorModel
    private let app: AppModel

    public init(model: ContextInspectorModel, app: AppModel) {
        self.model = model
        self.app = app
    }

    public func makeBody() -> AnyView {
        AnyView(ContextInspectorView(model: model, app: app))
    }
}

struct ContextInspectorView: View {
    @ObservedObject var model: ContextInspectorModel
    @ObservedObject var app: AppModel
    @State private var isDropTargeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            if model.sessionId == nil {
                Text(CardL10n.text(.inspectorNoSession))
                    .font(.cardiary(.callout))
                    .foregroundStyle(Palette.inkSecondary)
            } else {
                header
                usage
                if model.isLoading && !model.hasContext {
                    HStack(spacing: DesignTokens.spacingS) {
                        SuitLoader(size: 7)
                        Text(CardL10n.text(.cardsLoading))
                            .font(.cardiary(.caption))
                            .foregroundStyle(Palette.inkSecondary)
                    }
                } else if model.entries.isEmpty {
                    Text(CardL10n.text(.inspectorEmpty))
                        .font(.cardiary(.callout))
                        .foregroundStyle(Palette.inkSecondary)
                } else if model.mode == .treemap {
                    treemap
                } else {
                    heatGrid
                }
                legend
                selection
                messages
            }
        }
        .overlay {
            if isDropTargeted {
                RoundedRectangle(cornerRadius: DesignTokens.cardRadius, style: .continuous)
                    .fill(Palette.orangeSoft.opacity(0.9))
                    .overlay {
                        Label(CardL10n.text(.inspectorDropping), systemImage: "arrow.down.to.line")
                            .font(.cardiary(.callout, weight: .semibold))
                            .foregroundStyle(Palette.orangeInk)
                    }
                    .allowsHitTesting(false)
            }
        }
        .task(id: app.selection) {
            await model.syncSelection(app.selection)
        }
        .dropDestination(for: String.self) { items, _ in
            // SwiftUI 的回傳值要同步給出：只在真的有對話可加入時回 true。
            // 主機拒絕時 addCard 會把錯誤放上面的橫幅，不會靜默失敗。
            guard let cardId = items.first, model.canAddCards else { return false }
            Task { await model.addCard(cardId: cardId) }
            return true
        } isTargeted: { isDropTargeted = $0 }
    }

    private var header: some View {
        HStack(spacing: DesignTokens.spacingS) {
            ThemeSegmented(
                selection: Binding(
                    get: { model.mode },
                    set: { model.setMode($0) }
                ),
                options: [
                    (ContextInspectorMode.treemap, CardL10n.text(.inspectorTreemap)),
                    (ContextInspectorMode.heatGrid, CardL10n.text(.inspectorHeatGrid)),
                ]
            )

            Button {
                Task { await model.compact() }
            } label: {
                Image(systemName: "arrow.down.right.and.arrow.up.left")
                    .font(.system(size: 11, weight: .bold))
            }
            .buttonStyle(ThemeIconButtonStyle(fill: Palette.purpleSoft, foreground: Palette.purpleInk, diameter: 30))
            .help(CardL10n.text(.inspectorCompact))
            .accessibilityLabel(CardL10n.text(.inspectorCompact))
            .disabled(model.isCompacting)
        }
    }

    private var usage: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: DesignTokens.spacingXS) {
                if model.budgetTokens > 0 {
                    Text(CardL10n.format(
                        .inspectorUsage,
                        ["used": "\(model.usedTokens)", "budget": "\(model.budgetTokens)"]
                    ))
                    .font(.cardiary(.callout, weight: .semibold, monospacedDigits: true))
                    Text(CardL10n.text(.inspectorEstimated))
                        .font(.cardiary(.caption2))
                        .foregroundStyle(Palette.inkTertiary)
                } else {
                    Text(CardL10n.format(.inspectorUsageNoBudget, value: "\(model.usedTokens)"))
                        .font(.cardiary(.callout, weight: .semibold, monospacedDigits: true))
                }
                Spacer(minLength: 0)
                if model.isCompacting {
                    SuitLoader(size: 6)
                }
            }
            if model.budgetTokens > 0 {
                ThemeProgressBar(
                    value: min(1, Double(model.usedTokens) / Double(model.budgetTokens)),
                    tone: .red
                )
            }
            if model.contextWindow > 0 {
                Text(CardL10n.count(.inspectorContextWindow, count: model.contextWindow))
                    .font(.cardiary(.caption2))
                    .foregroundStyle(Palette.inkSecondary)
            }
        }
        .themeBlock(Palette.canvas, radius: DesignTokens.cornerRadius, padding: 10)
    }

    /// 圖例：每個顏色代表的層，以及新鮮度的濃淡。
    private var legend: some View {
        VStack(alignment: .leading, spacing: 6) {
            FlowLayout(spacing: 6) {
                ForEach(ContextBlockColor.legendLayers, id: \.self) { layer in
                    HStack(spacing: 4) {
                        RoundedRectangle(cornerRadius: 3, style: .continuous)
                            .fill(ContextBlockColor.tone(for: layer).color)
                            .overlay {
                                RoundedRectangle(cornerRadius: 3, style: .continuous)
                                    .strokeBorder(Palette.ink.opacity(0.4), lineWidth: 1)
                            }
                            .frame(width: 10, height: 10)
                        Text(model.layerTitle(layer))
                            .font(.cardiary(.caption2))
                            .foregroundStyle(Palette.inkSecondary)
                    }
                }
            }
            HStack(spacing: 4) {
                Text(CardL10n.text(.inspectorLegendFresh))
                ForEach([100, 60, 30, 0], id: \.self) { value in
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(CardFreshnessFill.block(for: CardFreshnessStyle.appearance(for: value), suit: .diamond))
                        .frame(width: 14, height: 8)
                }
                Text(CardL10n.text(.inspectorLegendStale))
            }
            .font(.cardiary(.caption2))
            .foregroundStyle(Palette.inkSecondary)
        }
    }

    // MARK: - 矩形樹狀圖

    private var treemap: some View {
        GeometryReader { geometry in
            let size = ContextLayoutSize(
                width: Double(geometry.size.width),
                height: Double(geometry.size.height)
            )
            let items = ContextTreemap.layout(entries: model.entries, in: size)
            ZStack(alignment: .topLeading) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    treemapBlock(item)
                        .frame(
                            width: max(1, item.rect.width - 3),
                            height: max(1, item.rect.height - 3)
                        )
                        .position(
                            x: item.rect.x + item.rect.width / 2,
                            y: item.rect.y + item.rect.height / 2
                        )
                }
            }
        }
        .frame(height: 240)
    }

    @ViewBuilder
    private func treemapBlock(_ item: ContextTreemapItem) -> some View {
        let entry = treemapEntry(item)
        let isSelected = item.entryIds.contains(model.selectedEntryId ?? "")
        let fill = treemapFill(item)
        let radius = min(10, max(3, min(item.rect.width, item.rect.height) / 5))
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(fill.color)
            .overlay {
                if let entry, entry.state == .pendingRemoval {
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .strokeBorder(Palette.orangeInk, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                }
            }
            .overlay(alignment: .topLeading) {
                if item.rect.width > 46, item.rect.height > 18 {
                    Text(treemapTitle(item))
                        .font(.cardiary(size: 10, weight: .semibold))
                        .lineLimit(2)
                        .padding(4)
                        .foregroundStyle(fill.text)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if isSelected {
                    Image(systemName: "suit.heart.fill")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Palette.surface)
                        .padding(4)
                        .background(Palette.ink.opacity(0.75), in: Circle())
                        .padding(3)
                }
            }
            .scaleEffect(isSelected ? 0.96 : 1)
            .animation(.easeOut(duration: 0.12), value: isSelected)
            .help(item.aggregateTitles.isEmpty ? treemapTitle(item) : item.aggregateTitles.joined(separator: "、"))
            .onTapGesture {
                if let entry {
                    model.selectedEntryId = entry.entryId
                }
            }
    }

    private func treemapEntry(_ item: ContextTreemapItem) -> ContextEntry? {
        if case .entry(let entry) = item.content { return entry }
        return nil
    }

    private func treemapTitle(_ item: ContextTreemapItem) -> String {
        if case .entry(let entry) = item.content { return entry.title }
        if let count = item.aggregateCount {
            return CardL10n.count(.inspectorOtherCards, count: count)
        }
        return ""
    }

    private func treemapFill(_ item: ContextTreemapItem) -> ContextBlockColor.Fill {
        if case .entry(let entry) = item.content {
            return ContextBlockColor.fill(for: entry, appearance: model.appearance(for: entry))
        }
        return ContextBlockColor.Fill(color: Palette.pinkSoft, text: Palette.ink)
    }

    // MARK: - 比例熱力格

    private var heatGrid: some View {
        let layout = ContextHeatGrid.layout(
            entries: model.entries,
            usedTokens: model.usedTokens,
            budgetTokens: model.budgetTokens
        )
        let columns = Array(
            repeating: GridItem(.flexible(), spacing: 2),
            count: 20
        )
        return LazyVGrid(columns: columns, spacing: 2) {
            ForEach(layout.cells, id: \.index) { cell in
                heatCell(cell)
            }
        }
    }

    @ViewBuilder
    private func heatCell(_ cell: ContextHeatGridLayout.Cell) -> some View {
        let entry = heatEntry(cell)
        let isSelected = cell.entryId != nil && cell.entryId == model.selectedEntryId
        let fill = heatFill(cell)
        RoundedRectangle(cornerRadius: 3, style: .continuous)
            .fill(fill.color)
            .frame(height: 12)
            .overlay {
                if let ordinal = cell.ordinal {
                    Text("\(ordinal)")
                        .font(.cardiary(size: 7.5, weight: .bold))
                        .foregroundStyle(fill.text)
                }
            }
            .overlay {
                if entry?.state == .pendingRemoval {
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .strokeBorder(Palette.orangeInk, lineWidth: 1)
                }
            }
            .overlay {
                if isSelected {
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .strokeBorder(Palette.ink, lineWidth: 2)
                }
            }
            .help(heatHelp(cell, entry: entry))
            .onTapGesture {
                if let entryId = cell.entryId {
                    model.selectedEntryId = entryId
                }
            }
    }

    private func heatEntry(_ cell: ContextHeatGridLayout.Cell) -> ContextEntry? {
        guard let entryId = cell.entryId else { return nil }
        return model.entries.first { $0.entryId == entryId }
    }

    private func heatFill(_ cell: ContextHeatGridLayout.Cell) -> ContextBlockColor.Fill {
        guard let entry = heatEntry(cell) else {
            return ContextBlockColor.Fill(color: ContextBlockColor.empty, text: Palette.ink)
        }
        return ContextBlockColor.fill(for: entry, appearance: model.appearance(for: entry))
    }

    private func heatHelp(_ cell: ContextHeatGridLayout.Cell, entry: ContextEntry?) -> String {
        guard let entry else { return "" }
        return "\(entry.title) · \(CardL10n.count(.inspectorTokens, count: entry.tokenEstimate))"
    }

    // MARK: - 選取與訊息

    @ViewBuilder
    private var selection: some View {
        if let entry = model.selectedEntry {
            let tone = ContextBlockColor.tone(for: entry.layer)
            VStack(alignment: .leading, spacing: 6) {
                Text(CardL10n.text(.inspectorSelectedTitle))
                    .font(.cardiary(.caption2, weight: .semibold))
                    .foregroundStyle(Palette.inkSecondary)
                Text(entry.title)
                    .font(.cardiary(.callout, weight: .bold))
                FlowLayout(spacing: 4) {
                    ThemeChip(text: model.layerTitle(entry.layer), tone: tone, filled: true)
                    ThemeChip(text: CardL10n.count(.inspectorTokens, count: entry.tokenEstimate), tone: .gray)
                    if let appearance = model.appearance(for: entry) {
                        ThemeChip(
                            text: CardL10n.format(.cardsDetailFreshness, value: "\(appearance.value)"),
                            tone: appearance.needsAttention ? .orange : .gray
                        )
                    }
                }

                if entry.state == .pendingRemoval {
                    Label(CardL10n.text(.inspectorPendingRemoval), systemImage: "clock.arrow.circlepath")
                        .font(.cardiary(.caption, weight: .semibold))
                        .foregroundStyle(Palette.orangeInk)
                } else if entry.cardId != nil {
                    Button(CardL10n.text(.inspectorRemove)) {
                        Task { await model.removeSelected() }
                    }
                    .buttonStyle(.themeDanger)
                    .controlSize(.small)
                }

                dealProbability(for: entry)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .themeBlock(tone.soft, radius: DesignTokens.cardRadius)
        } else {
            Text(CardL10n.text(.inspectorDropHint))
                .font(.cardiary(.caption))
                .foregroundStyle(Palette.inkTertiary)
        }
    }

    /// 發牌機率、相關標記與來源；退路與手動加入的卡沒有機率，不顯示。
    @ViewBuilder
    private func dealProbability(for entry: ContextEntry) -> some View {
        if let text = model.dealProbabilityText(for: entry) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: DesignTokens.spacingXS) {
                    Text(text)
                        .font(.cardiary(.caption2, weight: .semibold, monospacedDigits: true))
                        .foregroundStyle(Palette.inkSecondary)
                    if model.isPossiblyRelated(entry) {
                        ThemeChip(
                            text: CardL10n.text(.inspectorDealPossiblyRelated),
                            tone: .orange
                        )
                    }
                    if model.isDealtByRetrieval(entry) {
                        Text(CardL10n.text(.inspectorDealByRetrieval))
                            .font(.cardiary(.caption2))
                            .foregroundStyle(Palette.inkTertiary)
                    }
                }
                if let hint = model.smallModelQualityHint {
                    Text(hint)
                        .font(.cardiary(.caption2))
                        .foregroundStyle(Palette.orangeInk)
                }
            }
        }
    }

    @ViewBuilder
    private var messages: some View {
        if model.isCompacting {
            HStack(spacing: DesignTokens.spacingS) {
                SuitLoader(size: 7)
                Text(CardL10n.text(.inspectorCompacting))
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkSecondary)
            }
        }
        if let compaction = model.lastCompaction {
            MessageBanner(
                text: CardL10n.format(.inspectorCompacted, [
                    "before": "\(compaction.beforeTokens)",
                    "after": "\(compaction.afterTokens)",
                ]),
                systemImage: "checkmark.circle",
                tone: .sage
            )
        }
        if let error = model.errorMessage {
            MessageBanner(text: error, systemImage: "exclamationmark.triangle", tone: .red)
        }
        if let notice = model.noticeMessage {
            MessageBanner(text: notice, systemImage: "info.circle", tone: .gray)
        }
    }
}
