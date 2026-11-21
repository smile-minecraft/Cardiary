import CardiaryKit
import SwiftUI

/// 左側欄：標誌、新對話、對話清單與其他入口。入口的順序由 `SidebarRegistry` 決定。
///
/// 選中的一列是實色紅塊、深墨字；懸停是淺色塊。不畫分隔線，章節靠花色標籤分開。
struct SidebarView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var conversations: ConversationListModel
    @StateObject private var dropTarget: NotificationDropTarget

    init(model: AppModel) {
        self.model = model
        self.conversations = model.conversations
        _dropTarget = StateObject(
            wrappedValue: NotificationDropTarget(
                selectConversation: { id in
                    await model.selectConversation(id)
                },
                addNotifications: { drags, sessionId, title in
                    let added = await model.notifications.addToConversation(
                        drags: drags,
                        sessionId: sessionId,
                        conversationTitle: title
                    )
                    return NotificationDropTarget.AddOutcome(
                        added: added,
                        errorMessage: model.notifications.errorMessage
                    )
                }
            )
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
                BrandHeader()
                    .padding(.leading, DesignTokens.spacingXS)
                SuitDivider()
                Button {
                    Task { await model.createConversation() }
                } label: {
                    Label(AppL10n.text(.conversationNew), systemImage: "plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.themePrimary)
                .disabled(!model.isServiceAvailable)
                Button {
                    model.openImport()
                } label: {
                    Label(AppL10n.text(.commandGroupImport), systemImage: "square.and.arrow.down")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
            }
            .padding(.horizontal, DesignTokens.spacingM)
            .padding(.bottom, DesignTokens.spacingM)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: DesignTokens.spacingXS) {
                    SidebarSectionLabel(title: AppL10n.text(.sidebarSectionSession), suit: .spade)
                        .padding(.bottom, DesignTokens.spacingXS)
                    if conversations.sessions.isEmpty {
                        Text(AppL10n.text(.conversationListEmpty))
                            .cardiaryFont(.caption)
                            .foregroundStyle(Palette.inkTertiary)
                            .padding(.horizontal, DesignTokens.spacingM)
                            .padding(.vertical, DesignTokens.spacingXS)
                    } else {
                        ForEach(conversations.sessions) { session in
                            let title = session.title.isEmpty
                                ? AppL10n.text(.conversationUntitled) : session.title
                            NotificationDropRow(
                                conversationId: session.id,
                                conversationTitle: session.title.isEmpty ? nil : session.title,
                                displayTitle: title,
                                target: dropTarget
                            ) { isDropTarget in
                                SidebarRowLabel(
                                    title: title,
                                    systemImage: symbol(for: session.status),
                                    tone: tone(for: session.status),
                                    isSelected: model.selection == .conversation(session.id),
                                    isDropTarget: isDropTarget,
                                    onActivate: { select(.conversation(session.id)) }
                                )
                                .contextMenu {
                                    if session.status != .archived {
                                        Button {
                                            guard let service = model.service else { return }
                                            Task { await conversations.archive(sessionId: session.id, using: service) }
                                        } label: {
                                            Label(AppL10n.text(.conversationArchive), systemImage: "archivebox")
                                        }
                                        .disabled(!model.isServiceAvailable)
                                    }
                                }
                            }
                        }
                    }
                    if let error = conversations.errorMessage {
                        MessageBanner(
                            text: error,
                            systemImage: "exclamationmark.triangle",
                            tone: .red
                        )
                        .padding(.horizontal, DesignTokens.spacingXS)
                    }
                    if let message = dropTarget.message {
                        MessageBanner(
                            text: message,
                            systemImage: dropTarget.isError ? "exclamationmark.triangle" : "checkmark.circle",
                            tone: dropTarget.isError ? .red : .sage
                        )
                        .padding(.horizontal, DesignTokens.spacingXS)
                        .onTapGesture { dropTarget.dismiss() }
                    }

                    SidebarSectionLabel(title: AppL10n.text(.sidebarSectionTools), suit: .diamond)
                        .padding(.top, DesignTokens.spacingM)
                        .padding(.bottom, DesignTokens.spacingXS)
                    ForEach(otherSlots) { slot in
                        SidebarRowLabel(
                            title: AppL10n.text(slot.titleKey),
                            systemImage: slot.systemImage,
                            tone: Self.tone(forSlot: slot.id),
                            isSelected: model.selection == .slot(slot.id),
                            isSymbolDecorative: true,
                            onActivate: { select(.slot(slot.id)) }
                        )
                    }
                }
                .focusable()
                .focusEffectDisabled()
                .onMoveCommand(perform: moveSelection)
            }
            .scrollIndicators(.never)

            SidebarFooter(bridge: model.bridge)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Palette.sidebar)
    }

    /// 目前可用方向鍵選取的列，順序和畫面上一致。
    private var selectableItems: [AppSelection] {
        conversations.sessions.map { .conversation($0.id) } + otherSlots.map { .slot($0.id) }
    }

    private func select(_ selection: AppSelection) {
        switch selection {
        case let .conversation(id):
            Task { await model.selectConversation(id) }
        case let .slot(id):
            model.selectSlot(id)
        case .none:
            break
        }
    }

    /// 側欄本身承接方向鍵：上下移動選取，和滑鼠點選走同一條路。
    private func moveSelection(_ direction: MoveCommandDirection) {
        guard let target = Self.moveTarget(
            in: selectableItems,
            from: model.selection,
            direction: direction
        ) else { return }
        select(target)
    }

    /// 方向鍵要移到的列：上下各移一列，到頭不繞回；目前沒有選中可選的列時選第一列。
    /// 不需要移動（已在邊界、清單是空的、左右鍵）時回 nil。
    static func moveTarget(
        in items: [AppSelection],
        from selection: AppSelection,
        direction: MoveCommandDirection
    ) -> AppSelection? {
        guard !items.isEmpty else { return nil }
        let current = items.firstIndex(of: selection)
        let index: Int
        switch direction {
        case .up:
            index = current.map { max(0, $0 - 1) } ?? 0
        case .down:
            index = current.map { min(items.count - 1, $0 + 1) } ?? 0
        default:
            return nil
        }
        let target = items[index]
        return target == selection ? nil : target
    }

    private var otherSlots: [SidebarSlot] {
        model.sidebar.all.filter { $0.id != AppRegistry.conversationsSlotId }
    }

    /// 各入口的顏色。卡片庫是方塊橘（記憶），白板是梅花粉（一般），
    /// 通知與文件同用輔助色紫；其餘是黑桃灰。紅心只留給基岩與人格。
    static func tone(forSlot id: String) -> Tone {
        switch id {
        case AppRegistry.cardsSlotId: return .orange
        case "whiteboard": return .orange
        case "notifications": return .purple
        case "documents": return .purple
        default: return .gray
        }
    }

    private func symbol(for status: SessionStatus) -> String {
        switch status {
        case .idle: return "bubble.left.fill"
        case .running: return "ellipsis.bubble.fill"
        case .waitingApproval: return "hand.raised.fill"
        case .archived: return "archivebox.fill"
        }
    }

    private func tone(for status: SessionStatus) -> Tone {
        switch status {
        case .idle: return .gray
        case .running: return .red
        case .waitingApproval: return .orange
        case .archived: return .gray
        }
    }
}

/// 章節標籤：花色加標題，放在淺色膠囊裡。花色對照 `Suit` 的語意表：
/// 「對話」是黑桃（摘要與對話），「工具與卡片」是方塊（記憶）。
private struct SidebarSectionLabel: View {
    let title: String
    let suit: Suit

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: suit.symbol)
                .cardiarySymbolFont(size: 9, weight: .bold)
                .foregroundStyle(suit.ink)
            Text(title)
                .cardiaryFont(.caption, weight: .semibold)
                .foregroundStyle(Palette.inkSecondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(suit.soft.opacity(0.7), in: Capsule(style: .continuous))
        .padding(.bottom, 4)
        .accessibilityAddTraits(.isHeader)
    }
}

/// 左側欄的一列。
///
/// 滑鼠點選與輔助技術的「按下」（VoiceOver 的 VO-空白鍵、AXPress）都呼叫 `onActivate`。
/// 只加 `.isButton` 不夠：SwiftUI 不會把 AXPress 接到 `onTapGesture`，
/// 而且圖示和文字會各自成為一個沒有動作的按鈕。
private struct SidebarRowLabel: View {
    let title: String
    let systemImage: String
    let tone: Tone
    let isSelected: Bool
    var isDropTarget = false
    /// 圖示只是裝飾時設 true，輔助技術只唸標題。工具列是這樣；
    /// 對話列的圖示代表狀態，保留系統讀出的圖示說明。
    var isSymbolDecorative = false
    let onActivate: () -> Void

    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .cardiarySymbolFont(size: 13, weight: .semibold)
                .foregroundStyle(isSelected && !isDropTarget ? Palette.onAccent : tone.ink)
                .frame(width: 20)
            Text(title)
                .cardiaryFont(.callout, weight: isSelected ? .semibold : .medium)
                .foregroundStyle(isSelected && !isDropTarget ? Palette.onAccent : Palette.ink)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, DesignTokens.rowPadding)
        .padding(.vertical, 7)
        .background(background, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
        .overlay {
            if isDropTarget {
                RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous)
                    .strokeBorder(Palette.purple, lineWidth: 1.5)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
        .onTapGesture(perform: onActivate)
        .onHover { isHovered = $0 }
        .animation(.easeOut(duration: 0.12), value: isHovered)
        .animation(.easeOut(duration: 0.12), value: isDropTarget)
        // 一列一個元素。`.combine` 會丟掉 SF Symbol 的說明，所以標籤自己組。
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityTitle)
        .accessibilityAction { onActivate() }
        .accessibilityAddTraits(.isButton)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    /// 對話列的標籤是「狀態圖示的系統說明, 標題」，和修正前讀得到的資訊相同，
    /// 不另外加字串；工具列只唸標題。
    private var accessibilityTitle: Text {
        isSymbolDecorative ? Text(title) : Text("\(Image(systemName: systemImage)), \(title)")
    }

    private var background: Color {
        if isDropTarget { return Palette.purpleSoft }
        if isSelected { return Palette.red }
        return isHovered ? Palette.hover : .clear
    }
}

/// 左側欄底部：資料夾與連線狀態。
private struct SidebarFooter: View {
    @ObservedObject var bridge: ShellBridge

    var body: some View {
        HStack(spacing: DesignTokens.spacingS) {
            Circle()
                .fill(isConnected ? Palette.sageInk : Palette.orangeInk)
                .frame(width: 8, height: 8)
            Text(bridge.folder.displayName ?? AppL10n.text(.appTitle))
                .cardiaryFont(.caption, weight: .medium)
                .foregroundStyle(Palette.inkSecondary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
            if let count = bridge.approvalCount, count > 0 {
                ThemeChip(text: "\(count)", tone: .orange, systemImage: "hand.raised.fill", filled: true)
            }
        }
        .padding(.horizontal, DesignTokens.spacingM)
        .padding(.vertical, 10)
        .background(Palette.surface.opacity(0.7), in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
        .padding(DesignTokens.spacingM)
    }

    private var isConnected: Bool {
        if case .connected = bridge.connection { return true }
        return false
    }
}
