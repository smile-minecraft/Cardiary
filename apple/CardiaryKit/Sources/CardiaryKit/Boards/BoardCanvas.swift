import Foundation

/// 畫布座標上的一個點。整數格點用 `BoardPoint`（協定型別）；
/// 平移與縮放的中間結果需要小數，這裡用 Double，交給畫面之前不再四捨五入。
public struct BoardCanvasPoint: Equatable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

/// 畫布上的一塊矩形，單位跟著座標系（畫布格點或螢幕點）。
public struct BoardRect: Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public init(origin: BoardCanvasPoint, size: BoardCanvasPoint) {
        self.init(x: origin.x, y: origin.y, width: size.x, height: size.y)
    }

    public var minX: Double { x }
    public var minY: Double { y }
    public var maxX: Double { x + width }
    public var maxY: Double { y + height }
    public var midX: Double { x + width / 2 }
    public var midY: Double { y + height / 2 }

    public func contains(_ point: BoardCanvasPoint) -> Bool {
        point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
    }

    /// 邊界相接不算重疊；框選時貼邊的物件不該被選進來。
    public func intersects(_ other: BoardRect) -> Bool {
        minX < other.maxX && maxX > other.minX && minY < other.maxY && maxY > other.minY
    }

    public func union(_ other: BoardRect) -> BoardRect {
        let left = Swift.min(minX, other.minX)
        let top = Swift.min(minY, other.minY)
        let right = Swift.max(maxX, other.maxX)
        let bottom = Swift.max(maxY, other.maxY)
        return BoardRect(x: left, y: top, width: right - left, height: bottom - top)
    }

    /// 兩點圍出的矩形；拖曳框選時起點可能在終點右下方。
    public static func spanning(_ a: BoardCanvasPoint, _ b: BoardCanvasPoint) -> BoardRect {
        BoardRect(
            x: Swift.min(a.x, b.x),
            y: Swift.min(a.y, b.y),
            width: abs(b.x - a.x),
            height: abs(b.y - a.y)
        )
    }
}

/// 畫布上的一個卡片投影。畫面只認這個型別，不直接碰協定型別。
public struct BoardCanvasItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let cardId: String
    public var frame: BoardRect
    public var pinned: Bool

    public init(id: String, cardId: String, frame: BoardRect, pinned: Bool) {
        self.id = id
        self.cardId = cardId
        self.frame = frame
        self.pinned = pinned
    }
}

/// 白板畫布的視圖狀態：平移縮放、座標轉換、框選、多選、對齊與復原重做。
///
/// 這裡只管畫面幾何，不知道卡片內容，也不發出請求。畫布上的資料異動由
/// `BoardsView`／`BoardModel` 在放開滑鼠後寫回主機；復原堆疊只覆蓋本機的
/// 手勢，主機版本衝突一律以主機為準。
public struct BoardCanvas: Equatable, Sendable {
    public enum Alignment: String, CaseIterable, Sendable {
        case left
        case centerX
        case right
        case top
        case middleY
        case bottom
    }

    public static let minimumZoom = 0.1
    public static let maximumZoom = 4.0

    private struct Snapshot: Equatable, Sendable {
        var items: [BoardCanvasItem]
        var selectedIds: Set<String>
    }

    public private(set) var items: [BoardCanvasItem]
    public private(set) var selectedIds: Set<String> = []
    /// 縮放倍率，1 代表一個格點對一個螢幕點。
    public private(set) var zoom: Double = 1
    /// 可見範圍左上角在畫布座標的位置。
    public private(set) var origin = BoardCanvasPoint(x: 0, y: 0)
    public private(set) var viewport: BoardCanvasPoint
    /// 拖曳中的框選範圍（畫布座標）；放開後清空。
    public private(set) var marquee: BoardRect?
    private var marqueeAnchor: BoardCanvasPoint?
    private var undoStack: [Snapshot] = []
    private var redoStack: [Snapshot] = []

    public init(
        items: [BoardCanvasItem] = [],
        viewport: BoardCanvasPoint = BoardCanvasPoint(x: 1200, y: 800)
    ) {
        self.items = items
        self.viewport = viewport
    }

    // MARK: - 可見範圍

    /// 畫面目前看得到的畫布矩形。只畫這裡面的物件，五百張卡也不會全部進繪圖。
    public var visibleBoardRect: BoardRect {
        BoardRect(
            x: origin.x,
            y: origin.y,
            width: viewport.x / zoom,
            height: viewport.y / zoom
        )
    }

    public var visibleItems: [BoardCanvasItem] {
        let rect = visibleBoardRect
        return items.filter { $0.frame.intersects(rect) }
    }

    /// 所有物件的外框；平移時用它夾住可見範圍，避免滑到空白無限遠。
    public var contentBounds: BoardRect {
        guard let first = items.first?.frame else { return visibleBoardRect }
        return items.dropFirst().reduce(first) { $0.union($1.frame) }
    }

    // MARK: - 平移縮放與座標轉換

    public func screenPoint(forBoard point: BoardCanvasPoint) -> BoardCanvasPoint {
        BoardCanvasPoint(
            x: (point.x - origin.x) * zoom,
            y: (point.y - origin.y) * zoom
        )
    }

    public func boardPoint(forScreen point: BoardCanvasPoint) -> BoardCanvasPoint {
        BoardCanvasPoint(
            x: origin.x + point.x / zoom,
            y: origin.y + point.y / zoom
        )
    }

    public func screenRect(forBoard rect: BoardRect) -> BoardRect {
        let topLeft = screenPoint(forBoard: BoardCanvasPoint(x: rect.minX, y: rect.minY))
        return BoardRect(x: topLeft.x, y: topLeft.y, width: rect.width * zoom, height: rect.height * zoom)
    }

    public mutating func setViewport(_ size: BoardCanvasPoint) {
        viewport = BoardCanvasPoint(x: Swift.max(1, size.x), y: Swift.max(1, size.y))
        clampOrigin()
    }

    /// 手指或滑鼠拖曳：畫面往右移，`origin` 就往左退。
    public mutating func pan(byScreen delta: BoardCanvasPoint) {
        origin.x -= delta.x / zoom
        origin.y -= delta.y / zoom
        clampOrigin()
    }

    public mutating func scroll(toBoardPoint point: BoardCanvasPoint) {
        origin = point
        clampOrigin()
    }

    /// 以畫面上的某一點為錨縮放；錨點下的內容留在原地。
    public mutating func zoom(by factor: Double, anchorScreen: BoardCanvasPoint) {
        guard factor > 0, factor.isFinite else { return }
        setZoom(zoom * factor, anchorScreen: anchorScreen)
    }

    public mutating func setZoom(_ value: Double, anchorScreen: BoardCanvasPoint) {
        let clamped = Swift.min(Self.maximumZoom, Swift.max(Self.minimumZoom, value))
        guard clamped != zoom else { return }
        let anchored = boardPoint(forScreen: anchorScreen)
        zoom = clamped
        // 縮放時不夾：內容比視窗小時，錨點仍必須停在原處。
        // 之後使用者真的平移時，pan/scroll 才會把 origin 夾回內容範圍。
        origin = BoardCanvasPoint(
            x: anchored.x - anchorScreen.x / zoom,
            y: anchored.y - anchorScreen.y / zoom
        )
    }

    /// 讓所有物件剛好入鏡。
    public mutating func zoomToFit() {
        guard !items.isEmpty else {
            zoom = 1
            origin = BoardCanvasPoint(x: 0, y: 0)
            return
        }
        let bounds = contentBounds
        let fit = Swift.min(viewport.x / Swift.max(1, bounds.width), viewport.y / Swift.max(1, bounds.height))
        zoom = Swift.min(Self.maximumZoom, Swift.max(Self.minimumZoom, fit * 0.94))
        origin = BoardCanvasPoint(x: bounds.minX, y: bounds.minY)
        clampOrigin()
    }

    // MARK: - 命中與選取

    /// 最上層（陣列最後一個）先命中，符合畫面的堆疊順序。
    public func hitTest(_ screenPoint: BoardCanvasPoint) -> String? {
        let point = boardPoint(forScreen: screenPoint)
        return items.reversed().first { $0.frame.contains(point) }?.id
    }

    public func items(inBoardRect rect: BoardRect) -> [BoardCanvasItem] {
        items.filter { $0.frame.intersects(rect) }
    }

    public mutating func select(_ id: String, additive: Bool = false) {
        guard items.contains(where: { $0.id == id }) else { return }
        if additive, selectedIds.contains(id) {
            selectedIds.remove(id)
        } else if additive {
            selectedIds.insert(id)
        } else {
            selectedIds = [id]
        }
    }

    public mutating func setSelection(_ ids: Set<String>) {
        let available = Set(items.map(\.id))
        selectedIds = ids.intersection(available)
    }

    public mutating func clearSelection() {
        selectedIds.removeAll()
    }

    public mutating func beginMarquee(atScreen point: BoardCanvasPoint, additive: Bool = false) {
        let board = boardPoint(forScreen: point)
        marqueeAnchor = board
        marquee = BoardRect(x: board.x, y: board.y, width: 0, height: 0)
        if !additive {
            selectedIds.removeAll()
        }
    }

    public mutating func updateMarquee(toScreen point: BoardCanvasPoint) {
        guard let anchor = marqueeAnchor else { return }
        marquee = BoardRect.spanning(anchor, boardPoint(forScreen: point))
    }

    /// 結束框選；回傳這次框到的識別碼。框選範圍太小（只是點一下）視為取消。
    @discardableResult
    public mutating func endMarquee(additive: Bool = false) -> Set<String> {
        defer { marquee = nil; marqueeAnchor = nil }
        guard let rect = marquee else { return selectedIds }
        guard rect.width >= 2 || rect.height >= 2 else { return selectedIds }
        let hits = Set(items(inBoardRect: rect).map(\.id))
        selectedIds = additive ? selectedIds.union(hits) : hits
        return selectedIds
    }

    public var selectedItems: [BoardCanvasItem] {
        items.filter { selectedIds.contains($0.id) }
    }

    // MARK: - 移動與對齊

    /// 移動選取的物件；座標不得小於零。整個手勢只記一筆復原。
    @discardableResult
    public mutating func moveSelected(by delta: BoardCanvasPoint) -> Bool {
        guard !selectedIds.isEmpty, delta.x != 0 || delta.y != 0 else { return false }
        recordUndo()
        for index in items.indices where selectedIds.contains(items[index].id) {
            items[index].frame.x = Swift.max(0, items[index].frame.x + delta.x)
            items[index].frame.y = Swift.max(0, items[index].frame.y + delta.y)
        }
        return true
    }

    /// 把選取的物件對齊到它們的外框；回傳是否有東西被移動。
    @discardableResult
    public mutating func alignSelected(_ alignment: Alignment) -> Bool {
        guard selectedIds.count > 1 else { return false }
        guard let first = selectedItems.first?.frame else { return false }
        let bounds = selectedItems.dropFirst().reduce(first) { $0.union($1.frame) }
        recordUndo()
        var changed = false
        for index in items.indices where selectedIds.contains(items[index].id) {
            var frame = items[index].frame
            switch alignment {
            case .left: frame.x = bounds.minX
            case .centerX: frame.x = bounds.minX + (bounds.width - frame.width) / 2
            case .right: frame.x = bounds.maxX - frame.width
            case .top: frame.y = bounds.minY
            case .middleY: frame.y = bounds.minY + (bounds.height - frame.height) / 2
            case .bottom: frame.y = bounds.maxY - frame.height
            }
            if frame != items[index].frame {
                items[index].frame = frame
                changed = true
            }
        }
        if !changed {
            undoStack.removeLast()
        }
        return changed
    }

    // MARK: - 復原重做

    public var canUndo: Bool { !undoStack.isEmpty }
    public var canRedo: Bool { !redoStack.isEmpty }

    @discardableResult
    public mutating func undo() -> Bool {
        guard let snapshot = undoStack.popLast() else { return false }
        redoStack.append(currentSnapshot())
        apply(snapshot)
        return true
    }

    @discardableResult
    public mutating func redo() -> Bool {
        guard let snapshot = redoStack.popLast() else { return false }
        undoStack.append(currentSnapshot())
        apply(snapshot)
        return true
    }

    private func currentSnapshot() -> Snapshot {
        Snapshot(items: items, selectedIds: selectedIds)
    }

    private mutating func apply(_ snapshot: Snapshot) {
        items = snapshot.items
        selectedIds = snapshot.selectedIds
    }

    private mutating func recordUndo() {
        undoStack.append(currentSnapshot())
        redoStack.removeAll()
        if undoStack.count > 100 {
            undoStack.removeFirst(undoStack.count - 100)
        }
    }

    // MARK: - 新鮮度

    /// 卡片投影的不透明度。釘選的卡永遠滿版，不隨新鮮度褪色。
    public static func opacity(pinned: Bool, freshness: Int) -> Double {
        pinned ? 1 : CardFreshnessStyle.appearance(for: freshness).opacity
    }

    // MARK: - 內部

    private mutating func clampOrigin() {
        let bounds = contentBounds
        let visibleWidth = viewport.x / zoom
        let visibleHeight = viewport.y / zoom
        let maxX = Swift.max(0, bounds.maxX - visibleWidth)
        let maxY = Swift.max(0, bounds.maxY - visibleHeight)
        origin.x = Swift.min(maxX, Swift.max(0, origin.x))
        origin.y = Swift.min(maxY, Swift.max(0, origin.y))
    }
}
