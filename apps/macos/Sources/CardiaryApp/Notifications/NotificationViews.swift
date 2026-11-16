import CardiaryKit
import SwiftUI

/// 通知流：未讀計數、標已讀、轉卡，以及即時事件的更新。
public struct NotificationListView: View {
    @ObservedObject var model: NotificationModel

    public init(model: NotificationModel) {
        self.model = model
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            HStack {
                Text(NotificationL10n.text(.notificationTitle))
                    .font(.cardiary(.title3, weight: .semibold))
                if model.totalUnread > 0 {
                    ThemeChip(
                        text: NotificationL10n.count(.notificationUnread, count: model.totalUnread),
                        tone: .orange,
                        filled: true
                    )
                }
                Spacer()
                if model.totalUnread > 0 {
                    Button {
                        Task { await model.markAllRead() }
                    } label: {
                        Label(NotificationL10n.text(.notificationMarkAllRead), systemImage: "checkmark.double")
                    }
                    .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
                }
                Button {
                    Task { await model.reload() }
                } label: {
                    Label(NotificationL10n.text(.notificationRefresh), systemImage: "arrow.clockwise")
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
            }

            if model.notifications.isEmpty {
                ThemeEmptyState(
                    text: model.isKnown
                        ? NotificationL10n.text(.notificationEmpty)
                        : NotificationL10n.text(.notificationLoading),
                    suit: .club,
                    systemImage: "bell"
                )
            } else {
                ScrollView {
                    LazyVStack(spacing: DesignTokens.spacingS) {
                        ForEach(model.notifications) { item in
                            NotificationRow(item: item, model: model)
                        }
                    }
                }
            }

            if let message = model.errorMessage {
                Text(message).font(.cardiary(.caption)).foregroundStyle(Palette.red)
            }
            if let message = model.noticeMessage {
                Text(message).font(.cardiary(.caption)).foregroundStyle(Palette.sageInk)
            }
        }
        .padding(DesignTokens.spacingM)
        .task { await model.reload() }
    }
}

private struct NotificationRow: View {
    let item: NotificationPresentation
    @ObservedObject var model: NotificationModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                ThemeChip(text: kindLabel, tone: .purple)
                if item.isUnread {
                    Circle().fill(Palette.red).frame(width: 7, height: 7)
                }
                Spacer()
                Text(item.createdAt)
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkTertiary)
                    .lineLimit(1)
            }
            Text(item.title)
                .font(.cardiary(.callout, weight: item.isUnread ? .semibold : .regular))
                .foregroundStyle(Palette.ink)
            Text(item.body)
                .font(.cardiary(.caption))
                .foregroundStyle(Palette.inkSecondary)
                .lineLimit(3)

            HStack(spacing: DesignTokens.spacingS) {
                if item.isUnread {
                    Button {
                        Task { await model.markRead(item) }
                    } label: {
                        Label(NotificationL10n.text(.notificationMarkRead), systemImage: "envelope.open")
                    }
                    .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
                    .disabled(model.actingIds.contains(item.notificationId))
                }
                Button {
                    Task { await model.createCard(for: item) }
                } label: {
                    Label(
                        item.cardId == nil
                            ? NotificationL10n.text(.notificationToCard)
                            : NotificationL10n.text(.notificationCardReused),
                        systemImage: "rectangle.on.rectangle"
                    )
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .purple))
                .disabled(item.cardId != nil || model.actingIds.contains(item.notificationId))
            }
        }
        .padding(DesignTokens.spacingM)
        .background(
            Palette.surface,
            in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius)
        )
    }

    private var kindLabel: String {
        switch item.kind {
        case .schedule: return NotificationL10n.text(.notificationKindSchedule)
        case .heartbeat: return NotificationL10n.text(.notificationKindHeartbeat)
        case .distillation: return NotificationL10n.text(.notificationKindDistillation)
        }
    }
}
