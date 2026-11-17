import CardiaryKit
import SwiftUI

/// 選擇要把通知卡片加入哪一個對話。
struct NotificationConversationPicker: View {
    let item: NotificationPresentation
    @ObservedObject var model: NotificationModel
    let onPick: (String, String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var addingId: String?

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            Text(NotificationL10n.text(.notificationChooseConversationTitle))
                .font(.cardiary(.title3, weight: .semibold))
                .padding([.top, .horizontal], DesignTokens.spacingM)

            if model.isLoadingConversations {
                Spacer()
                SuitLoader()
                    .frame(maxWidth: .infinity)
                Spacer()
            } else if model.conversations.isEmpty {
                Spacer()
                Text(NotificationL10n.text(.notificationConversationEmpty))
                    .font(.cardiary(.callout))
                    .foregroundStyle(Palette.inkSecondary)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                    .padding(DesignTokens.spacingM)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(model.conversations, id: \.id) { session in
                            Button {
                                addingId = session.id
                                onPick(session.id, session.title)
                            } label: {
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(session.title)
                                            .font(.cardiary(.callout))
                                            .foregroundStyle(Palette.ink)
                                        Text(session.id)
                                            .font(.cardiary(.caption))
                                            .foregroundStyle(Palette.inkTertiary)
                                            .lineLimit(1)
                                    }
                                    Spacer()
                                    if addingId == session.id {
                                        SuitLoader(size: 7)
                                    }
                                }
                                .padding(.vertical, DesignTokens.spacingS)
                                .padding(.horizontal, DesignTokens.spacingM)
                                .contentShape(RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
                                .background(Palette.sunken, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
                            }
                            .buttonStyle(.plain)
                            .disabled(addingId != nil)
                        }
                    }
                    .padding(DesignTokens.spacingM)
                }
            }
        }
        .frame(minWidth: 420, minHeight: 340)
        .task { await model.loadConversations() }
    }
}
