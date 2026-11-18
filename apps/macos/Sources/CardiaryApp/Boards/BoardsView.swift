import AppKit
import CardiaryKit
import SwiftUI

/// 白板：左邊是畫布，右邊是收件區。
///
/// 畫布只畫可見範圍的投影；拖曳、框選與縮放都在 `BoardCanvas` 裡算好，
/// 這裡只把手勢接上去，並在放開後交給模型存回主機。
struct BoardsView: View {
    @ObservedObject var model: BoardModel

    private enum DragMode {
        case none
        case pan
        case move
        case marquee
    }

    @State private var dragMode: DragMode = .none
    @State private var dragStart: BoardCanvasPoint?
    @State private var panStartOrigin = BoardCanvasPoint(x: 0, y: 0)
    @State private var lastDragTranslation = CGSize.zero
    @State private var isDropTargeted = false
    @State private var isNewBoardPresented = false
    @State private var newBoardTitle = ""
    @State private var isNewCardPresented = false
    @State private var newCardTitle = ""
    @State private var newCardBody = ""
    @State private var isNewGroupPresented = false
    @State private var newGroupLabel = ""
    @State private var isDeletePresented = false

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            header
            if model.boards.isEmpty {
                emptyState
            } else {
                HSplitView {
                    canvasPane
                        .frame(minWidth: 360, maxWidth: .infinity, maxHeight: .infinity)
                    inboxPane
                        .frame(minWidth: 220, idealWidth: 260, maxWidth: 320)
                }
            }
        }
        .padding(DesignTokens.spacingL)
        .background(Palette.canvas)
        .task { await model.reload() }
        .sheet(isPresented: $isNewBoardPresented) { newBoardSheet }
        .sheet(isPresented: $isNewCardPresented) { newCardSheet }
        .sheet(isPresented: $isNewGroupPresented) { newGroupSheet }
        .alert(BoardL10n.text(.boardsDeleteConfirmTitle), isPresented: $isDeletePresented) {
            Button(BoardL10n.text(.boardsDelete), role: .destructive) {
                Task { await model.deleteCurrentBoard() }
            }
            Button(BoardL10n.text(.boardsCancel), role: .cancel) {}
        } message: {
            Text(BoardL10n.text(.boardsDeleteConfirmBody))
        }
    }

    // MARK: - 標頭

    private var header: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            HStack(spacing: DesignTokens.spacingM) {
                ThemePageTitle(
                    title: BoardL10n.text(.boardsTitle),
                    subtitle: model.board.map {
                        BoardL10n.count(.boardsSubtitle, count: $0.items.count)
                    } ?? BoardL10n.text(.boardsEmpty),
                    suit: .diamond
                )
                Spacer()
                if model.isSaving || model.isLoading {
                    SuitLoader()
                }
                boardMenu
                structureMenu
                Button {
                    newBoardTitle = ""
                    isNewBoardPresented = true
                } label: {
                    Label(BoardL10n.text(.boardsNew), systemImage: "plus")
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft))
            }
            if let conflict = model.conflictMessage {
                banner(conflict, tone: .warning)
            }
            if let error = model.errorMessage {
                banner(error, tone: .error)
            }
            if let notice = model.noticeMessage {
                banner(notice, tone: .success)
            }
            selectionBar
        }
    }

    private var boardMenu: some View {
        Menu {
            ForEach(model.boards, id: \.id) { summary in
                Button {
                    Task { await model.open(summary.id) }
                } label: {
                    if summary.id == model.selectedBoardId {
                        Label(summary.title, systemImage: "checkmark")
                    } else {
                        Text(summary.title)
                    }
                }
            }
            Divider()
            Button(BoardL10n.text(.boardsDelete), role: .destructive) {
                isDeletePresented = true
            }
            .disabled(model.board == nil)
        } label: {
            Label(model.board?.title ?? BoardL10n.text(.boardsTitle), systemImage: "rectangle.on.rectangle")
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
    }

    /// 連線與分組的入口：建立、指派、選取整組與刪除都在這裡。
    private var structureMenu: some View {
        Menu {
            Button(BoardL10n.text(.boardsCreateEdge)) {
                Task { await model.createEdgeBetweenSelection() }
            }
            .disabled(model.selectionCount != 2)
            Button(BoardL10n.text(.boardsCreateGroup)) {
                presentNewGroup()
            }
            .disabled(model.selectionCount < 2)
            if model.selectionGroupId != nil {
                Button(BoardL10n.text(.boardsRemoveFromGroup)) {
                    Task { await model.removeSelectionFromGroup() }
                }
            }
            if let edges = model.board?.edges, !edges.isEmpty {
                Divider()
                Section(BoardL10n.text(.boardsLink)) {
                    ForEach(edges, id: \.id) { edge in
                        Button(
                            BoardL10n.format(.boardsDeleteEdgeTo, [
                                "from": model.itemTitle(forItemId: edge.from),
                                "to": model.itemTitle(forItemId: edge.to),
                            ]),
                            role: .destructive
                        ) {
                            Task { await model.deleteEdge(edge.id) }
                        }
                    }
                }
            }
            if let groups = model.board?.groups, !groups.isEmpty {
                Divider()
                Section(BoardL10n.text(.boardsGroupSection)) {
                    ForEach(groups, id: \.id) { group in
                        Menu(group.label) {
                            Button(BoardL10n.text(.boardsSelectGroup)) {
                                model.selectItems(inGroup: group.id)
                            }
                            Button(BoardL10n.text(.boardsAssignToGroup)) {
                                Task { await model.assignItems(Array(model.canvas.selectedIds), toGroup: group.id) }
                            }
                            .disabled(model.selectionCount == 0)
                            Divider()
                            Button(BoardL10n.text(.boardsDeleteGroup), role: .destructive) {
                                Task { await model.deleteGroup(group.id) }
                            }
                        }
                    }
                }
            }
        } label: {
            Label(BoardL10n.text(.boardsStructure), systemImage: "rectangle.3.group")
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .disabled(model.board == nil)
    }

    private var selectionBar: some View {
        HStack(spacing: DesignTokens.spacingS) {
            Text(
                model.selectionCount > 0
                    ? BoardL10n.count(.boardsSelection, count: model.selectionCount)
                    : BoardL10n.text(.boardsNoSelection)
            )
            .font(.cardiary(.caption))
            .foregroundStyle(Palette.inkSecondary)
            Spacer()
            if model.selectionCount > 0 {
                Menu {
                    alignmentButton(.left, .boardsAlignLeft)
                    alignmentButton(.centerX, .boardsAlignCenterX)
                    alignmentButton(.right, .boardsAlignRight)
                    Divider()
                    alignmentButton(.top, .boardsAlignTop)
                    alignmentButton(.middleY, .boardsAlignMiddleY)
                    alignmentButton(.bottom, .boardsAlignBottom)
                } label: {
                    Label("Align", systemImage: "align.horizontal.left")
                }
                .menuStyle(.borderlessButton)
                .fixedSize()

                if model.selectionCount == 2 {
                    Button {
                        Task { await model.createEdgeBetweenSelection() }
                    } label: {
                        Label(BoardL10n.text(.boardsCreateEdge), systemImage: "link")
                    }
                    .buttonStyle(ThemeButtonStyle(kind: .soft))
                }

                if model.selectionCount >= 2 {
                    Button {
                        presentNewGroup()
                    } label: {
                        Label(BoardL10n.text(.boardsCreateGroup), systemImage: "rectangle.3.group")
                    }
                    .buttonStyle(ThemeButtonStyle(kind: .soft))
                }

                if model.selectionGroupId != nil {
                    Button {
                        Task { await model.removeSelectionFromGroup() }
                    } label: {
                        Label(BoardL10n.text(.boardsRemoveFromGroup), systemImage: "rectangle.badge.minus")
                    }
                    .buttonStyle(ThemeButtonStyle(kind: .soft))
                }

                Button {
                    model.togglePinSelected()
                } label: {
                    Label(
                        model.canvas.selectedItems.first?.pinned == true
                            ? BoardL10n.text(.boardsUnpin)
                            : BoardL10n.text(.boardsPin),
                        systemImage: "pin"
                    )
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft))

                Button {
                    newCardTitle = ""
                    newCardBody = ""
                    isNewCardPresented = true
                } label: {
                    Label(BoardL10n.text(.boardsGenerateCard), systemImage: "sparkles")
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft))

                Button {
                    Task { await model.sendSelectionToConversation() }
                } label: {
                    Label(BoardL10n.text(.boardsSendToConversation), systemImage: "bubble.left.and.text.bubble.right")
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft))
            }
            Button {
                model.undo()
            } label: {
                Image(systemName: "arrow.uturn.backward")
            }
            .buttonStyle(ThemeIconButtonStyle())
            .disabled(!model.canvas.canUndo)
            .help(BoardL10n.text(.boardsUndo))
            Button {
                model.redo()
            } label: {
                Image(systemName: "arrow.uturn.forward")
            }
            .buttonStyle(ThemeIconButtonStyle())
            .disabled(!model.canvas.canRedo)
            .help(BoardL10n.text(.boardsRedo))
        }
    }

    private func presentNewGroup() {
        newGroupLabel = ""
        isNewGroupPresented = true
    }

    private func alignmentButton(_ alignment: BoardCanvas.Alignment, _ key: BoardString) -> some View {
        Button {
            model.align(alignment)
        } label: {
            Text(BoardL10n.text(key))
        }
    }

    // MARK: - 畫布

    private var canvasPane: some View {
        GeometryReader { proxy in
            let size = BoardCanvasPoint(x: proxy.size.width, y: proxy.size.height)
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: DesignTokens.panelRadius, style: .continuous)
                    .fill(Palette.surface)
                Canvas { context, _ in
                    drawGroups(context: &context)
                    drawEdges(context: &context)
                    drawItems(context: &context)
                    drawMarquee(context: &context)
                }
                .contentShape(Rectangle())
                .gesture(canvasGesture)
                .overlay(alignment: .bottomTrailing) { zoomControls }
                if isDropTargeted {
                    RoundedRectangle(cornerRadius: DesignTokens.panelRadius, style: .continuous)
                        .fill(Palette.orangeSoft.opacity(0.7))
                        .overlay {
                            Label(BoardL10n.text(.boardsDropHint), systemImage: "rectangle.stack.badge.plus")
                                .font(.cardiary(.headline))
                                .foregroundStyle(Palette.orangeInk)
                        }
                        .allowsHitTesting(false)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.panelRadius, style: .continuous))
            .onAppear { model.canvas.setViewport(size) }
            .onChange(of: proxy.size) { _, newValue in
                model.canvas.setViewport(BoardCanvasPoint(x: newValue.width, y: newValue.height))
            }
            .dropDestination(for: BoardCardDrag.self) { items, location in
                let point = model.canvas.boardPoint(forScreen: BoardCanvasPoint(x: location.x, y: location.y))
                let ids = items.map(\.cardId)
                guard !ids.isEmpty else { return false }
                Task {
                    await model.project(
                        cardIds: ids,
                        at: BoardPoint(x: max(0, Int(point.x)), y: max(0, Int(point.y)))
                    )
                }
                return true
            } isTargeted: { isDropTargeted = $0 }
        }
    }

    private var canvasGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                let screen = BoardCanvasPoint(x: value.location.x, y: value.location.y)
                if dragMode == .none {
                    beginDrag(at: BoardCanvasPoint(x: value.startLocation.x, y: value.startLocation.y))
                }
                switch dragMode {
                case .pan:
                    let delta = BoardCanvasPoint(
                        x: value.translation.width - lastDragTranslation.width,
                        y: value.translation.height - lastDragTranslation.height
                    )
                    model.canvas.pan(byScreen: delta)
                    lastDragTranslation = value.translation
                case .move:
                    let delta = BoardCanvasPoint(
                        x: (value.translation.width - lastDragTranslation.width) / model.canvas.zoom,
                        y: (value.translation.height - lastDragTranslation.height) / model.canvas.zoom
                    )
                    model.canvas.moveSelected(by: delta)
                    lastDragTranslation = value.translation
                case .marquee:
                    model.canvas.updateMarquee(toScreen: screen)
                case .none:
                    break
                }
            }
            .onEnded { _ in
                if dragMode == .marquee {
                    _ = model.canvas.endMarquee()
                }
                if dragMode == .move {
                    Task { await model.saveCanvas() }
                }
                dragMode = .none
                dragStart = nil
                lastDragTranslation = .zero
            }
    }

    private func beginDrag(at screen: BoardCanvasPoint) {
        dragStart = screen
        lastDragTranslation = .zero
        if NSEvent.modifierFlags.contains(.option) || NSEvent.modifierFlags.contains(.command) {
            dragMode = .pan
            panStartOrigin = model.canvas.origin
            return
        }
        if let hit = model.canvas.hitTest(screen) {
            if !model.canvas.selectedIds.contains(hit) {
                model.canvas.select(hit)
            }
            dragMode = .move
            return
        }
        model.canvas.beginMarquee(atScreen: screen)
        dragMode = .marquee
    }

    private func drawItems(context: inout GraphicsContext) {
        for item in model.canvas.visibleItems {
            let rect = model.canvas.screenRect(forBoard: item.frame)
            let path = Path(roundedRect: CGRect(x: rect.x, y: rect.y, width: rect.width, height: rect.height), cornerRadius: 12)
            let opacity = BoardCanvas.opacity(pinned: item.pinned, freshness: model.freshness(for: item))
            let selected = model.canvas.selectedIds.contains(item.id)
            context.fill(path, with: .color(color(for: model.kind(for: item)).opacity(opacity)))
            context.stroke(
                path,
                with: .color(selected ? Palette.ink : Palette.inkTertiary.opacity(0.35)),
                lineWidth: selected ? 2.5 : 1
            )
            if item.pinned {
                let badge = CGRect(x: rect.maxX - 24, y: rect.minY + 8, width: 16, height: 16)
                context.fill(Path(ellipseIn: badge), with: .color(Palette.surface))
                context.draw(
                    Text(Image(systemName: "pin.fill")).font(.system(size: 10)).foregroundStyle(Palette.orangeInk),
                    at: CGPoint(x: badge.midX, y: badge.midY)
                )
            }
            let title = Text(model.title(for: item))
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Palette.ink)
            context.draw(title, at: CGPoint(x: rect.midX, y: rect.minY + 28))
            if rect.width > 100, rect.height > 70 {
                let meta = Text(BoardL10n.format(.boardsCardCount, ["count": "\(Int(rect.width))×\(Int(rect.height))"]))
                    .font(.system(size: 9))
                    .foregroundStyle(Palette.inkTertiary)
                context.draw(meta, at: CGPoint(x: rect.midX, y: rect.maxY - 14))
            }
        }
    }

    private func drawEdges(context: inout GraphicsContext) {
        guard let board = model.board else { return }
        for edge in board.edges {
            guard let from = model.canvas.item(edge.from), let to = model.canvas.item(edge.to) else { continue }
            var path = Path()
            path.move(to: center(from))
            path.addLine(to: center(to))
            context.stroke(path, with: .color(Palette.inkTertiary), lineWidth: 1.5)
        }
    }

    private func drawGroups(context: inout GraphicsContext) {
        guard let board = model.board else { return }
        for group in board.groups {
            let frames = board.items.filter { $0.groupId == group.id }.compactMap { model.canvas.item($0.id) }
            guard let first = frames.first?.frame else { continue }
            let bounds = frames.dropFirst().reduce(first) { $0.union($1.frame) }
            let rect = model.canvas.screenRect(forBoard: bounds)
            let path = Path(roundedRect: CGRect(x: rect.minX - 8, y: rect.minY - 8, width: rect.width + 16, height: rect.height + 16), cornerRadius: 18)
            context.stroke(path, with: .color(Palette.purple.opacity(0.6)), style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
            context.draw(
                Text(group.label).font(.system(size: 10, weight: .semibold)).foregroundStyle(Palette.purple),
                at: CGPoint(x: rect.midX, y: rect.minY - 18)
            )
        }
    }

    private func drawMarquee(context: inout GraphicsContext) {
        guard let marquee = model.canvas.marquee else { return }
        let rect = model.canvas.screenRect(forBoard: marquee)
        let path = Path(CGRect(x: rect.x, y: rect.y, width: rect.width, height: rect.height))
        context.fill(path, with: .color(Palette.orange.opacity(0.12)))
        context.stroke(path, with: .color(Palette.orangeInk), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
    }

    private func center(_ item: BoardCanvasItem) -> CGPoint {
        let rect = model.canvas.screenRect(forBoard: item.frame)
        return CGPoint(x: rect.midX, y: rect.midY)
    }

    private func color(for kind: CardKind) -> Color {
        switch kind {
        case .memory: return Palette.orangeSoft
        case .summary: return Palette.graySoft
        case .bedrock, .persona: return Palette.redSoft
        case .note, .image, .audio: return Palette.pinkSoft
        }
    }

    private var zoomControls: some View {
        HStack(spacing: 2) {
            Button { model.zoomOut() } label: { Image(systemName: "minus.magnifyingglass") }
                .buttonStyle(ThemeIconButtonStyle())
                .help(BoardL10n.text(.boardsZoomOut))
            Button { model.zoomToFit() } label: { Image(systemName: "arrow.up.left.and.arrow.down.right") }
                .buttonStyle(ThemeIconButtonStyle())
                .help(BoardL10n.text(.boardsZoomFit))
            Button { model.zoomIn() } label: { Image(systemName: "plus.magnifyingglass") }
                .buttonStyle(ThemeIconButtonStyle())
                .help(BoardL10n.text(.boardsZoomIn))
        }
        .padding(6)
        .background(Palette.surface, in: Capsule())
        .padding(DesignTokens.spacingM)
    }

    // MARK: - 收件區

    private var inboxPane: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            HStack {
                Label(BoardL10n.text(.boardsInbox), systemImage: "tray")
                    .font(.cardiary(.headline))
                Spacer()
                Text(BoardL10n.count(.boardsCardCount, count: model.inbox.count))
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkSecondary)
            }
            Text(BoardL10n.text(.boardsInboxHint))
                .font(.cardiary(.caption))
                .foregroundStyle(Palette.inkTertiary)
            if model.inbox.isEmpty {
                Text(BoardL10n.text(.boardsInboxEmpty))
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkSecondary)
                    .padding(.top, DesignTokens.spacingS)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: DesignTokens.spacingS) {
                        ForEach(model.inbox, id: \.id) { item in
                            inboxRow(item)
                        }
                    }
                }
            }
        }
        .padding(DesignTokens.spacingM)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Palette.sunken, in: RoundedRectangle(cornerRadius: DesignTokens.panelRadius, style: .continuous))
    }

    private func inboxRow(_ item: BoardItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.cardInfo[item.cardId]?.title ?? String(item.cardId.suffix(6)))
                .font(.cardiary(.body))
                .lineLimit(2)
            HStack(spacing: 6) {
                if item.projectedBy == .agent {
                    Text("AI")
                        .font(.cardiary(.caption2))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Palette.pinkSoft, in: Capsule())
                        .foregroundStyle(Palette.pinkInk)
                }
                Spacer()
                Button(BoardL10n.text(.boardsMoveToCanvas)) {
                    Task { await model.moveInboxItemToCanvas(itemId: item.id) }
                }
                .buttonStyle(.borderless)
                Button(BoardL10n.text(.boardsRemoveProjection), role: .destructive) {
                    Task { await model.unproject(itemId: item.id) }
                }
                .buttonStyle(.borderless)
            }
            .font(.cardiary(.caption))
        }
        .padding(DesignTokens.spacingS)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: DesignTokens.panelRadius, style: .continuous))
    }

    // MARK: - 空狀態與表單

    private var emptyState: some View {
        VStack(spacing: DesignTokens.spacingM) {
            ThemeEmptyState(
                text: BoardL10n.text(.boardsEmpty),
                suit: .diamond,
                systemImage: "rectangle.3.group"
            )
            Button(BoardL10n.text(.boardsNew)) {
                newBoardTitle = ""
                isNewBoardPresented = true
            }
            .buttonStyle(ThemeButtonStyle(kind: .soft))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var newBoardSheet: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            Text(BoardL10n.text(.boardsNewTitle))
                .font(.cardiary(.title3))
            TextField(BoardL10n.text(.boardsBoardName), text: $newBoardTitle)
                .textFieldStyle(ThemeFieldStyle())
            HStack {
                Spacer()
                Button(BoardL10n.text(.boardsCancel)) { isNewBoardPresented = false }
                Button(BoardL10n.text(.boardsCreate)) {
                    let title = newBoardTitle
                    isNewBoardPresented = false
                    Task { await model.createBoard(title: title) }
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft))
                .disabled(newBoardTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(DesignTokens.spacingL)
        .frame(width: 360)
    }

    private var newCardSheet: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            Text(BoardL10n.text(.boardsGenerateCard))
                .font(.cardiary(.title3))
            TextField(BoardL10n.text(.boardsNewCardTitle), text: $newCardTitle)
                .textFieldStyle(ThemeFieldStyle())
            TextEditor(text: $newCardBody)
                .font(.cardiary(.body))
                .frame(minHeight: 120)
                .overlay {
                    RoundedRectangle(cornerRadius: DesignTokens.panelRadius, style: .continuous)
                        .stroke(Palette.inkTertiary.opacity(0.3))
                }
            if model.isCreatingCard {
                Text(BoardL10n.text(.boardsCreating))
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkSecondary)
            }
            HStack {
                Spacer()
                Button(BoardL10n.text(.boardsCancel)) { isNewCardPresented = false }
                Button(BoardL10n.text(.boardsCreateCard)) {
                    let title = newCardTitle
                    let body = newCardBody
                    isNewCardPresented = false
                    Task { await model.createCardFromSelection(title: title, body: body) }
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft))
                .disabled(newCardTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.selectionCount == 0)
            }
        }
        .padding(DesignTokens.spacingL)
        .frame(width: 420)
    }

    private var newGroupSheet: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            Text(BoardL10n.text(.boardsCreateGroup))
                .font(.cardiary(.title3))
            TextField(BoardL10n.text(.boardsGroupNameTitle), text: $newGroupLabel)
                .textFieldStyle(ThemeFieldStyle())
            Text(BoardL10n.count(.boardsSelection, count: model.selectionCount))
                .font(.cardiary(.caption))
                .foregroundStyle(Palette.inkSecondary)
            HStack {
                Spacer()
                Button(BoardL10n.text(.boardsCancel)) { isNewGroupPresented = false }
                Button(BoardL10n.text(.boardsCreate)) {
                    let label = newGroupLabel
                    isNewGroupPresented = false
                    Task { await model.createGroup(label: label) }
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft))
                .disabled(
                    newGroupLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || model.selectionCount < 2
                )
            }
        }
        .padding(DesignTokens.spacingL)
        .frame(width: 360)
    }

    private func banner(_ text: String, tone: BannerTone) -> some View {
        Text(text)
            .font(.cardiary(.caption))
            .foregroundStyle(tone.ink)
            .padding(.horizontal, DesignTokens.spacingM)
            .padding(.vertical, DesignTokens.spacingS)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tone.background, in: RoundedRectangle(cornerRadius: DesignTokens.panelRadius, style: .continuous))
    }

    private enum BannerTone {
        case success
        case warning
        case error

        var background: Color {
            switch self {
            case .success: return Palette.sageSoft
            case .warning: return Palette.orangeSoft
            case .error: return Palette.redSoft
            }
        }

        var ink: Color {
            switch self {
            case .success: return Palette.sage
            case .warning: return Palette.orangeInk
            case .error: return Palette.redInk
            }
        }
    }
}
