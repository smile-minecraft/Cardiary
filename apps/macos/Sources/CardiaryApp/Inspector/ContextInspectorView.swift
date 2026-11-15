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
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                header
                usage
                if model.isLoading && !model.hasContext {
                    HStack(spacing: DesignTokens.spacingXS) {
                        ProgressView().controlSize(.small)
                        Text(CardL10n.text(.cardsLoading)).font(.caption).foregroundStyle(.secondary)
                    }
                } else if model.entries.isEmpty {
                    Text(CardL10n.text(.inspectorEmpty))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else if model.mode == .treemap {
                    treemap
                } else {
                    heatGrid
                }
                selection
                messages
            }
        }
        .overlay(alignment: .top) {
            if isDropTargeted {
                Label(CardL10n.text(.inspectorDropping), systemImage: "arrow.down.to.line")
                    .font(.caption)
                    .padding(6)
                    .background(.regularMaterial, in: Capsule())
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
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            Picker("", selection: Binding(
                get: { model.mode },
                set: { model.setMode($0) }
            )) {
                Text(CardL10n.text(.inspectorTreemap)).tag(ContextInspectorMode.treemap)
                Text(CardL10n.text(.inspectorHeatGrid)).tag(ContextInspectorMode.heatGrid)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            HStack(spacing: DesignTokens.spacingS) {
                Button {
                    Task { await model.compact() }
                } label: {
                    Label(CardL10n.text(.inspectorCompact), systemImage: "arrow.down.right.and.arrow.up.left")
                }
                .controlSize(.small)
                .disabled(model.isCompacting)

                if model.isCompacting {
                    ProgressView().controlSize(.small)
                }
                Spacer()
                freshnessLegend
            }
        }
    }

    private var usage: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: DesignTokens.spacingXS) {
                Text(CardL10n.format(
                    .inspectorUsage,
                    ["used": "\(model.usedTokens)", "budget": "\(model.budgetTokens)"]
                ))
                .font(.caption.monospacedDigit())
                Text(CardL10n.text(.inspectorEstimated))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            ProgressView(
                value: model.budgetTokens > 0
                    ? min(1, Double(model.usedTokens) / Double(model.budgetTokens))
                    : 0
            )
            .progressViewStyle(.linear)
            Text(CardL10n.count(.inspectorContextWindow, count: model.contextWindow))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var freshnessLegend: some View {
        HStack(spacing: DesignTokens.spacingXS) {
            RoundedRectangle(cornerRadius: 2)
                .fill(CardFreshnessFill.block(for: CardFreshnessStyle.appearance(for: 100)))
                .frame(width: 18, height: 8)
            Text(CardL10n.text(.inspectorLegendFresh))
                .font(.caption2)
            RoundedRectangle(cornerRadius: 2)
                .fill(CardFreshnessFill.block(for: CardFreshnessStyle.appearance(for: 0)))
                .frame(width: 18, height: 8)
            Text(CardL10n.text(.inspectorLegendStale))
                .font(.caption2)
        }
        .foregroundStyle(.secondary)
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
                            width: max(1, item.rect.width - 1),
                            height: max(1, item.rect.height - 1)
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
        RoundedRectangle(cornerRadius: 3)
            .fill(treemapFill(item))
            .overlay {
                if let entry, entry.state == .pendingRemoval {
                    RoundedRectangle(cornerRadius: 3)
                        .strokeBorder(Color.orange, style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                }
            }
            .overlay {
                if isSelected {
                    RoundedRectangle(cornerRadius: 3)
                        .strokeBorder(Color.primary, lineWidth: 2)
                }
            }
            .overlay(alignment: .topLeading) {
                if item.rect.width > 46, item.rect.height > 18 {
                    Text(treemapTitle(item))
                        .font(.system(size: 9))
                        .lineLimit(2)
                        .padding(2)
                        .foregroundStyle(.primary)
                }
            }
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

    private func treemapFill(_ item: ContextTreemapItem) -> Color {
        if case .entry(let entry) = item.content {
            return ContextBlockColor.fill(for: entry, appearance: model.appearance(for: entry))
        }
        return Color(nsColor: .secondaryLabelColor).opacity(0.25)
    }

    // MARK: - 比例熱力格

    private var heatGrid: some View {
        let layout = ContextHeatGrid.layout(
            entries: model.entries,
            usedTokens: model.usedTokens,
            budgetTokens: model.budgetTokens
        )
        let columns = Array(
            repeating: GridItem(.flexible(), spacing: 1),
            count: 20
        )
        return LazyVGrid(columns: columns, spacing: 1) {
            ForEach(layout.cells, id: \.index) { cell in
                heatCell(cell)
            }
        }
    }

    @ViewBuilder
    private func heatCell(_ cell: ContextHeatGridLayout.Cell) -> some View {
        let entry = heatEntry(cell)
        let isSelected = cell.entryId != nil && cell.entryId == model.selectedEntryId
        RoundedRectangle(cornerRadius: 1)
            .fill(heatFill(cell))
            .frame(height: 11)
            .overlay {
                if let ordinal = cell.ordinal {
                    Text("\(ordinal)")
                        .font(.system(size: 7, weight: .semibold))
                        .foregroundStyle(.primary)
                }
            }
            .overlay {
                if entry?.state == .pendingRemoval {
                    RoundedRectangle(cornerRadius: 1)
                        .strokeBorder(Color.orange, lineWidth: 1)
                }
            }
            .overlay {
                if isSelected {
                    RoundedRectangle(cornerRadius: 1)
                        .strokeBorder(Color.primary, lineWidth: 1.5)
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

    private func heatFill(_ cell: ContextHeatGridLayout.Cell) -> Color {
        guard let entry = heatEntry(cell) else {
            return Color(nsColor: .quaternaryLabelColor).opacity(0.18)
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
        Divider()
        if let entry = model.selectedEntry {
            VStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
                Text(CardL10n.text(.inspectorSelectedTitle))
                    .font(.caption.weight(.semibold))
                Text(entry.title)
                    .font(.callout.weight(.medium))
                HStack(spacing: DesignTokens.spacingS) {
                    Text(model.layerTitle(entry.layer))
                    Text(CardL10n.count(.inspectorTokens, count: entry.tokenEstimate))
                    if let appearance = model.appearance(for: entry) {
                        Text(CardL10n.format(.cardsDetailFreshness, value: "\(appearance.value)"))
                            .foregroundStyle(appearance.needsAttention ? Color.orange : Color.secondary)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                if entry.state == .pendingRemoval {
                    Label(CardL10n.text(.inspectorPendingRemoval), systemImage: "clock.arrow.circlepath")
                        .font(.caption)
                        .foregroundStyle(.orange)
                } else if entry.cardId != nil {
                    Button(CardL10n.text(.inspectorRemove)) {
                        Task { await model.removeSelected() }
                    }
                    .controlSize(.small)
                }

                dealProbabilityPlaceholder
            }
        } else {
            Text(CardL10n.text(.inspectorDropHint))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    /// M1 只保留位置；`model.showsDealProbability` 永遠是 false。
    private var dealProbabilityPlaceholder: some View {
        HStack(spacing: DesignTokens.spacingXS) {
            Text(CardL10n.text(.inspectorDealProbability))
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("—")
                .font(.caption2)
                .foregroundStyle(.tertiary)
            Text(CardL10n.text(.inspectorDealProbabilityM2))
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .help(CardL10n.text(.inspectorDealProbabilityM2))
        .opacity(model.showsDealProbability ? 1 : 0.65)
    }

    @ViewBuilder
    private var messages: some View {
        if model.isCompacting {
            HStack(spacing: DesignTokens.spacingXS) {
                ProgressView().controlSize(.small)
                Text(CardL10n.text(.inspectorCompacting))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        if let compaction = model.lastCompaction {
            Label(
                CardL10n.format(.inspectorCompacted, [
                    "before": "\(compaction.beforeTokens)",
                    "after": "\(compaction.afterTokens)",
                ]),
                systemImage: "checkmark.circle"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        if let error = model.errorMessage {
            MessageBanner(text: error, systemImage: "exclamationmark.triangle", tint: .red)
        }
        if let notice = model.noticeMessage {
            MessageBanner(text: notice, systemImage: "info.circle", tint: .secondary)
        }
    }
}
