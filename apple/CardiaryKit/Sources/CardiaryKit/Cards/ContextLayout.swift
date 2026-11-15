import Foundation

/// 檢視欄版面配置用的尺寸（單位與畫面一致，測試不依賴 SwiftUI）。
public struct ContextLayoutSize: Equatable, Sendable {
    public let width: Double
    public let height: Double

    public init(width: Double, height: Double) {
        self.width = width
        self.height = height
    }

    var isValid: Bool { width > 0 && height > 0 }
}

/// 檢視欄裡的一個矩形，原點在左上角。
public struct ContextLayoutRect: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public var maxX: Double { x + width }
    public var maxY: Double { y + height }
    public var area: Double { max(0, width) * max(0, height) }
}

// MARK: - 矩形樹狀圖

/// 樹狀圖的一塊：一張卡，或是合併後的小卡。
public struct ContextTreemapItem: Equatable, Sendable {
    public enum Content: Equatable, Sendable {
        case entry(ContextEntry)
        case aggregate(count: Int, entryIds: [String], titles: [String], tokens: Int)
    }

    public let content: Content
    public let tokens: Int
    public let rect: ContextLayoutRect

    public init(content: Content, tokens: Int, rect: ContextLayoutRect) {
        self.content = content
        self.tokens = tokens
        self.rect = rect
    }

    public var entryIds: [String] {
        switch content {
        case .entry(let entry): return [entry.entryId]
        case .aggregate(_, let entryIds, _, _): return entryIds
        }
    }

    public var isAggregate: Bool {
        if case .aggregate = content { return true }
        return false
    }

    public var aggregateCount: Int? {
        if case .aggregate(let count, _, _, _) = content { return count }
        return nil
    }

    public var aggregateTitles: [String] {
        if case .aggregate(_, _, let titles, _) = content { return titles }
        return []
    }
}

/// 矩形樹狀圖（ordered strip treemap）。
///
/// 依上下文順序由左到右、由上到下排列，一列放不下就換列；面積對應 token。
/// 每列放幾張由長寬比決定：加入下一張會讓整列的平均長寬比變差時就換列，
/// 所以窄的檢視欄也會排成多列，不會變成一排細長條。面積佔比小於
/// `minimumShare` 的卡合併成一塊「其他 N 張」，位置落在第一張小卡的位置。
public enum ContextTreemap {
    public static func layout(
        entries: [ContextEntry],
        in size: ContextLayoutSize,
        minimumShare: Double = 0.02
    ) -> [ContextTreemapItem] {
        guard size.isValid else { return [] }
        let visible = entries.filter { $0.tokenEstimate > 0 }
        let total = visible.reduce(0) { $0 + $1.tokenEstimate }
        guard total > 0 else { return [] }

        // 小卡只在同一層裡合併，合併塊留在該層第一張小卡的位置。
        let nodes = groupByLayer(visible).flatMap {
            mergeSmallCards($0.entries, total: total, minimumShare: minimumShare)
        }
        return strips(nodes, in: size)
    }

    // MARK: - 分層與合併

    private struct LayerGroup {
        let layer: ContextLayer
        var entries: [ContextEntry]
        var tokens: Int
    }

    private static func groupByLayer(_ entries: [ContextEntry]) -> [LayerGroup] {
        var groups: [LayerGroup] = []
        for entry in entries {
            if let last = groups.last, last.layer == entry.layer {
                groups[groups.count - 1].entries.append(entry)
                groups[groups.count - 1].tokens += entry.tokenEstimate
            } else {
                groups.append(
                    LayerGroup(layer: entry.layer, entries: [entry], tokens: entry.tokenEstimate)
                )
            }
        }
        return groups
    }

    private enum NodeContent {
        case entry(ContextEntry)
        case aggregate(count: Int, entries: [ContextEntry])
    }

    private struct Node {
        let tokens: Int
        let content: NodeContent
    }

    private static func mergeSmallCards(
        _ entries: [ContextEntry],
        total: Int,
        minimumShare: Double
    ) -> [Node] {
        let tiny = entries.filter {
            Double($0.tokenEstimate) / Double(total) < minimumShare
        }
        guard tiny.count >= 2 else {
            return entries.map { Node(tokens: $0.tokenEstimate, content: .entry($0)) }
        }

        var nodes: [Node] = []
        var insertedAggregate = false
        for entry in entries {
            if Double(entry.tokenEstimate) / Double(total) < minimumShare {
                if !insertedAggregate {
                    nodes.append(Node(
                        tokens: tiny.reduce(0) { $0 + $1.tokenEstimate },
                        content: .aggregate(count: tiny.count, entries: tiny)
                    ))
                    insertedAggregate = true
                }
                continue
            }
            nodes.append(Node(tokens: entry.tokenEstimate, content: .entry(entry)))
        }
        return nodes
    }

    // MARK: - 依序換列

    private static func strips(_ nodes: [Node], in size: ContextLayoutSize) -> [ContextTreemapItem] {
        let total = Double(nodes.reduce(0) { $0 + $1.tokens })
        guard total > 0 else { return [] }
        // 每個 token 佔的面積；整張圖剛好填滿。
        let scale = size.width * size.height / total
        var result: [ContextTreemapItem] = []
        var y = 0.0
        var start = 0

        while start < nodes.count {
            var end = start + 1
            var best = averageAspect(nodes[start..<end], width: size.width, scale: scale)
            while end < nodes.count {
                let candidate = averageAspect(nodes[start...end], width: size.width, scale: scale)
                if candidate > best { break }
                best = candidate
                end += 1
            }

            let row = nodes[start..<end]
            let rowTokens = Double(row.reduce(0) { $0 + $1.tokens })
            // 最後一列吃掉剩下的高度，避免浮點誤差留下縫。
            let height = end == nodes.count ? size.height - y : rowTokens * scale / size.width
            var x = 0.0
            for (offset, node) in row.enumerated() {
                let width = offset == row.count - 1
                    ? size.width - x
                    : size.width * Double(node.tokens) / rowTokens
                result.append(item(node, rect: ContextLayoutRect(x: x, y: y, width: width, height: height)))
                x += width
            }
            y += height
            start = end
        }
        return result
    }

    /// 一列裡每塊的平均長寬比（長邊除以短邊，1 是正方形）。
    private static func averageAspect(
        _ row: ArraySlice<Node>,
        width: Double,
        scale: Double
    ) -> Double {
        let rowTokens = Double(row.reduce(0) { $0 + $1.tokens })
        guard rowTokens > 0 else { return .infinity }
        let height = rowTokens * scale / width
        let sum = row.reduce(0.0) { partial, node in
            let blockWidth = width * Double(node.tokens) / rowTokens
            guard blockWidth > 0, height > 0 else { return partial + .infinity }
            return partial + max(blockWidth / height, height / blockWidth)
        }
        return sum / Double(row.count)
    }

    private static func item(_ node: Node, rect: ContextLayoutRect) -> ContextTreemapItem {
        switch node.content {
        case .entry(let entry):
            return ContextTreemapItem(content: .entry(entry), tokens: node.tokens, rect: rect)
        case .aggregate(let count, let entries):
            return ContextTreemapItem(
                content: .aggregate(
                    count: count,
                    entryIds: entries.map(\.entryId),
                    titles: entries.map(\.title),
                    tokens: node.tokens
                ),
                tokens: node.tokens,
                rect: rect
            )
        }
    }

}

// MARK: - 比例熱力格

/// 比例熱力格：格子由左而右、由上而下就是上下文順序；空格是剩餘容量。
public struct ContextHeatGridLayout: Equatable, Sendable {
    public struct Cell: Equatable, Sendable {
        public let index: Int
        public let entryId: String?
        public let cardId: String?
        public let title: String?
        public let isFirstCell: Bool
        /// 這張卡在檢視欄裡的編號，從 1 開始；只有每張卡的第一格有值。
        public let ordinal: Int?
        public let state: ContextEntryState?

        public init(
            index: Int,
            entryId: String?,
            cardId: String?,
            title: String?,
            isFirstCell: Bool,
            ordinal: Int?,
            state: ContextEntryState?
        ) {
            self.index = index
            self.entryId = entryId
            self.cardId = cardId
            self.title = title
            self.isFirstCell = isFirstCell
            self.ordinal = ordinal
            self.state = state
        }
    }

    public let totalCells: Int
    public let cellTokens: Double
    public let cells: [Cell]

    public init(totalCells: Int, cellTokens: Double, cells: [Cell]) {
        self.totalCells = totalCells
        self.cellTokens = cellTokens
        self.cells = cells
    }

    public var usedCells: Int {
        cells.filter { $0.entryId != nil }.count
    }
}

/// 比例熱力格的格數與分配。
///
/// 總格數維持在 200 到 300 之間（入口超過上限時以入口數為準，否則每張卡至少
/// 一格會放不下）。每張卡分到的格數與 token 成比例，第一格帶編號；排不滿的
/// 格子留在尾端當剩餘容量。
public enum ContextHeatGrid {
    public static func layout(
        entries: [ContextEntry],
        usedTokens: Int,
        budgetTokens: Int,
        minimumCells: Int = 200,
        maximumCells: Int = 300
    ) -> ContextHeatGridLayout {
        let totalCells = cellCount(
            budgetTokens: budgetTokens,
            minimumCells: minimumCells,
            maximumCells: maximumCells
        )
        let cellTokens = budgetTokens > 0
            ? Double(budgetTokens) / Double(totalCells)
            : 1

        guard !entries.isEmpty else {
            return ContextHeatGridLayout(
                totalCells: totalCells,
                cellTokens: cellTokens,
                cells: (0..<totalCells).map { emptyCell(index: $0) }
            )
        }

        var usable = budgetTokens > 0
            ? Int((Double(max(0, usedTokens)) / Double(budgetTokens) * Double(totalCells)).rounded())
            : 0
        usable = min(totalCells, max(0, usable))
        usable = max(usable, min(entries.count, totalCells))

        let allocations = allocate(entries: entries, cells: usable)
        var cells: [ContextHeatGridLayout.Cell] = []
        var index = 0
        for (offset, entry) in entries.enumerated() {
            let count = allocations[offset]
            for cellIndex in 0..<count {
                cells.append(ContextHeatGridLayout.Cell(
                    index: index,
                    entryId: entry.entryId,
                    cardId: entry.cardId,
                    title: entry.title,
                    isFirstCell: cellIndex == 0,
                    ordinal: cellIndex == 0 ? offset + 1 : nil,
                    state: entry.state
                ))
                index += 1
            }
        }
        while cells.count < totalCells {
            cells.append(emptyCell(index: cells.count))
        }
        return ContextHeatGridLayout(totalCells: totalCells, cellTokens: cellTokens, cells: cells)
    }

    /// 依模型上限挑一個讓總格數落在範圍內的每格 token 數。
    public static func cellCount(
        budgetTokens: Int,
        minimumCells: Int = 200,
        maximumCells: Int = 300
    ) -> Int {
        let minimum = max(1, minimumCells)
        let maximum = max(minimum, maximumCells)
        guard budgetTokens > 0 else { return minimum }
        let target = 240.0
        let raw = Double(budgetTokens) / target
        let rounded = niceCeil(raw)
        let count = Int((Double(budgetTokens) / rounded).rounded(.up))
        return min(maximum, max(minimum, count))
    }

    private static func niceCeil(_ value: Double) -> Double {
        guard value > 0 else { return 1 }
        var magnitude = 1.0
        while value > 10 * magnitude {
            magnitude *= 10
        }
        while value < magnitude {
            magnitude /= 10
        }
        let fraction = value / magnitude
        let niceFraction: Double
        if fraction <= 1 {
            niceFraction = 1
        } else if fraction <= 2 {
            niceFraction = 2
        } else if fraction <= 5 {
            niceFraction = 5
        } else {
            niceFraction = 10
        }
        return niceFraction * magnitude
    }

    private static func allocate(entries: [ContextEntry], cells: Int) -> [Int] {
        guard !entries.isEmpty else { return [] }
        guard cells > entries.count else { return entries.map { _ in 1 } }

        let total = entries.reduce(0) { $0 + max(0, $1.tokenEstimate) }
        if total <= 0 {
            return (0..<entries.count).map { index in
                cells / entries.count + (index < cells % entries.count ? 1 : 0)
            }
        }

        var allocations: [Int] = []
        var fractions: [(index: Int, fraction: Double)] = []
        var distributed = 0
        for (index, entry) in entries.enumerated() {
            let quota = Double(max(0, entry.tokenEstimate)) / Double(total) * Double(cells)
            let whole = Int(quota.rounded(.down))
            allocations.append(whole)
            distributed += whole
            fractions.append((index, quota - Double(whole)))
        }

        var left = cells - distributed
        for entry in fractions.sorted(by: { $0.fraction > $1.fraction }) {
            if left == 0 { break }
            allocations[entry.index] += 1
            left -= 1
        }

        // 每張卡至少一格；不夠的格數從目前最大的分配扣回來。
        for index in entries.indices where allocations[index] == 0 {
            guard let donor = allocations.indices
                .filter({ allocations[$0] > 1 })
                .max(by: { allocations[$0] < allocations[$1] })
            else { break }
            allocations[donor] -= 1
            allocations[index] += 1
        }
        return allocations
    }

    private static func emptyCell(index: Int) -> ContextHeatGridLayout.Cell {
        ContextHeatGridLayout.Cell(
            index: index,
            entryId: nil,
            cardId: nil,
            title: nil,
            isFirstCell: false,
            ordinal: nil,
            state: nil
        )
    }
}
