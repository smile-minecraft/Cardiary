import CardiaryKit
import SwiftUI

/// 左側欄：對話清單與其他入口。入口的順序由 `SidebarRegistry` 決定。
struct SidebarView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var conversations: ConversationListModel

    init(model: AppModel) {
        self.model = model
        self.conversations = model.conversations
    }

    var body: some View {
        List(selection: selectionBinding) {
            Section(AppL10n.text(.sidebarSectionSession)) {
                if conversations.sessions.isEmpty {
                    Text(AppL10n.text(.conversationListEmpty))
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(conversations.sessions) { session in
                        Label {
                            Text(session.title.isEmpty ? AppL10n.text(.conversationUntitled) : session.title)
                                .lineLimit(1)
                        } icon: {
                            Image(systemName: symbol(for: session.status))
                                .foregroundStyle(tint(for: session.status))
                        }
                        .tag(AppSelection.conversation(session.id))
                    }
                }
            }

            Section {
                ForEach(otherSlots) { slot in
                    Label(AppL10n.text(slot.titleKey), systemImage: slot.systemImage)
                        .tag(AppSelection.slot(slot.id))
                }
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) {
            Button {
                Task { await model.createConversation() }
            } label: {
                Label(AppL10n.text(.conversationNew), systemImage: "square.and.pencil")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.borderless)
            .padding(DesignTokens.spacingM)
        }
    }

    private var otherSlots: [SidebarSlot] {
        model.sidebar.all.filter { $0.id != AppRegistry.conversationsSlotId }
    }

    private var selectionBinding: Binding<AppSelection?> {
        Binding(
            get: { model.selection == .none ? nil : model.selection },
            set: { newValue in
                guard let newValue else { return }
                switch newValue {
                case .conversation(let id):
                    Task { await model.selectConversation(id) }
                case .slot(let id):
                    model.selectSlot(id)
                case .none:
                    break
                }
            }
        )
    }

    private func symbol(for status: SessionStatus) -> String {
        switch status {
        case .idle: return "bubble.left"
        case .running: return "bubble.left.and.text.bubble.right"
        case .waitingApproval: return "hand.raised"
        case .archived: return "archivebox"
        }
    }

    private func tint(for status: SessionStatus) -> Color {
        switch status {
        case .idle: return .secondary
        case .running: return .accentColor
        case .waitingApproval: return .orange
        case .archived: return .secondary
        }
    }
}
