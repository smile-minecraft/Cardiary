import CardiaryKit
import SwiftUI

/// 左側欄：標誌、新對話、對話清單與其他入口。入口的順序由 `SidebarRegistry` 決定。
///
/// 選中的一列是實色紅塊、深墨字；懸停是淺色塊。不畫分隔線，章節靠花色標籤分開。
struct SidebarView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var conversations: ConversationListModel

    init(model: AppModel) {
        self.model = model
        self.conversations = model.conversations
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

            List(selection: sidebarSelection) {
                Section {
                    if conversations.sessions.isEmpty {
                        Text(AppL10n.text(.conversationListEmpty))
                            .font(.cardiary(.caption))
                            .foregroundStyle(Palette.inkTertiary)
                            .padding(.horizontal, DesignTokens.spacingM)
                            .padding(.vertical, DesignTokens.spacingXS)
                    } else {
                        ForEach(conversations.sessions) { session in
                            SidebarRowLabel(
                                title: session.title.isEmpty ? AppL10n.text(.conversationUntitled) : session.title,
                                systemImage: symbol(for: session.status),
                                tone: tone(for: session.status),
                                isSelected: model.selection == .conversation(session.id)
                            )
                            .tag(AppSelection.conversation(session.id))
                        }
                    }
                } header: {
                    SidebarSectionLabel(title: AppL10n.text(.sidebarSectionSession), suit: .spade)
                }

                Section {
                    ForEach(otherSlots) { slot in
                        SidebarRowLabel(
                            title: AppL10n.text(slot.titleKey),
                            systemImage: slot.systemImage,
                            tone: Self.tone(forSlot: slot.id),
                            isSelected: model.selection == .slot(slot.id)
                        )
                        .tag(AppSelection.slot(slot.id))
                    }
                } header: {
                    SidebarSectionLabel(title: AppL10n.text(.sidebarSectionTools), suit: .diamond)
                        .padding(.top, DesignTokens.spacingM)
                }
            }
            .listStyle(.plain)
            .scrollIndicators(.never)

            SidebarFooter(bridge: model.bridge)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Palette.sidebar)
    }

    private var sidebarSelection: Binding<AppSelection?> {
        Binding(
            get: { model.selection == .none ? nil : model.selection },
            set: { selection in
                switch selection {
                case let .conversation(id):
                    Task { await model.selectConversation(id) }
                case let .slot(id):
                    model.selectSlot(id)
                case .some(.none), nil:
                    break
                }
            }
        )
    }

    private var otherSlots: [SidebarSlot] {
        model.sidebar.all.filter { $0.id != AppRegistry.conversationsSlotId }
    }

    /// 各入口的顏色。卡片庫是方塊橘（記憶），白板是梅花粉（一般），
    /// 通知與文件同用輔助色紫；其餘是黑桃灰。紅心只留給基岩與人格。
    static func tone(forSlot id: String) -> Tone {
        switch id {
        case AppRegistry.cardsSlotId: return .orange
        case "whiteboard": return .pink
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
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(suit.ink)
            Text(title)
                .font(.cardiary(.caption, weight: .semibold))
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
private struct SidebarRowLabel: View {
    let title: String
    let systemImage: String
    let tone: Tone
    let isSelected: Bool

    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(isSelected ? Palette.onAccent : tone.ink)
                .frame(width: 20)
            Text(title)
                .font(.cardiary(.callout, weight: isSelected ? .semibold : .medium))
                .foregroundStyle(isSelected ? Palette.onAccent : Palette.ink)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, DesignTokens.rowPadding)
        .padding(.vertical, 7)
        .background(background, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius, style: .continuous))
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .onHover { isHovered = $0 }
        .animation(.easeOut(duration: 0.12), value: isHovered)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var background: Color {
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
                .font(.cardiary(.caption, weight: .medium))
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
