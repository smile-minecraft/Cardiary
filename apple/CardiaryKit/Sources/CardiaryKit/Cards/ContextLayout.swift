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

/// 矩形樹狀圖（ordered squarified treemap）。
///
/// 分層由左到右，層內依上下文順序排列；面積對應 token。面積佔比小於
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

        let layers = groupByLayer(visible)
        var items: [ContextTreemapItem] = []
        var x = 0.0
        for (index, layer) in layers.enumerated() {
            let width =
                index == layers.count - 1
                ? size.width - x
                : size.width * Double(layer.tokens) / Double(total)
            let rect = ContextLayoutRect(x: x, y: 0, width: width, height: size.height)
            let nodes = mergeSmallCards(layer.entries, total: total, minimumShare: minimumShare)
            items.append(contentsOf: squarify(nodes, in: rect))
            x += width
        }
        return items
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

    // MARK: - Squarify

    private static func squarify(
        _ nodes: [Node],
        in rect: ContextLayoutRect
    ) -> [ContextTreemapItem] {
        guard rect.area > 0, !nodes.isEmpty else { return [] }
        var remaining = nodes
        var remainingTokens = nodes.reduce(0) { $0 + $1.tokens }
        var area = rect
        var result: [ContextTreemapItem] = []

        while !remaining.isEmpty, remainingTokens > 0, area.width > 0, area.height > 0 {
            let side = min(area.width, area.height)
            var row: [Node] = []
            var rowTokens = 0
            var rowMax = 0
            var rowMin = Int.max
            var index = 0

            while index < remaining.count {
                let candidate = remaining[index]
                let candidateMax = max(rowMax, candidate.tokens)
                let candidateMin = min(rowMin, candidate.tokens)
                if !row.isEmpty {
                    let currentWorst = worst(rowTokens: rowTokens, maxTokens: rowMax, minTokens: rowMin, side: side)
                    let candidateWorst = worst(
                        rowTokens: rowTokens + candidate.tokens,
                        maxTokens: candidateMax,
                        minTokens: candidateMin,
                        side: side
                    )
                    if candidateWorst > currentWorst { break }
                }
                row.append(candidate)
                rowTokens += candidate.tokens
                rowMax = candidateMax
                rowMin = candidateMin
                index += 1
            }

            let rowArea = area.area * Double(rowTokens) / Double(remainingTokens)
            var placed: [ContextTreemapItem] = []
            if area.width >= area.height {
                // 直條：由上而下堆疊。
                let stripWidth = min(area.width, rowArea / area.height)
                var y = area.y
                for node in row {
                    let height = area.height * Double(node.tokens) / Double(rowTokens)
                    placed.append(item(node, rect: ContextLayoutRect(
                        x: area.x,
                        y: y,
                        width: stripWidth,
                        height: height
                    )))
                    y += height
                }
                area = ContextLayoutRect(
                    x: area.x + stripWidth,
                    y: area.y,
                    width: max(0, area.width - stripWidth),
                    height: area.height
                )
            } else {
                // 橫條：由左而右排列。
                let stripHeight = min(area.height, rowArea / area.width)
                var x = area.x
                for node in row {
                    let width = area.width * Double(node.tokens) / Double(rowTokens)
                    placed.append(item(node, rect: ContextLayoutRect(
                        x: x,
                        y: area.y,
                        width: width,
                        height: stripHeight
                    )))
                    x += width
                }
                area = ContextLayoutRect(
                    x: area.x,
                    y: area.y + stripHeight,
                    width: area.width,
                    height: max(0, area.height - stripHeight)
                )
            }
            result.append(contentsOf: placed)
            remaining.removeFirst(row.count)
            remainingTokens -= rowTokens
        }
        return result
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

    private static func worst(
        rowTokens: Int,
        maxTokens: Int,
        minTokens: Int,
        side: Double
    ) -> Double {
        guard rowTokens > 0, minTokens > 0, side > 0 else { return .infinity }
        let sideSquared = side * side
        let rowSquared = Double(rowTokens) * Double(rowTokens)
        return max(
            sideSquared * Double(maxTokens) / rowSquared,
            rowSquared / (sideSquared * Double(minTokens))
        )
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
