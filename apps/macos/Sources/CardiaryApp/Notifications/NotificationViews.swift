import CardiaryKit
import SwiftUI

/// 通知畫面：通知流與排程管理共用左側欄的一格。
public struct NotificationListView: View {
    @ObservedObject var model: NotificationModel
    @State private var tab: ScreenTab = .notifications
    @State private var addingToConversation: NotificationPresentation?

    public init(model: NotificationModel) {
        self.model = model
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            HStack {
                Text(NotificationL10n.text(.notificationTitle))
                    .font(.cardiary(.title3, weight: .semibold))
                Spacer()
                ThemeSegmented(
                    selection: $tab,
                    options: [
                        (.notifications, NotificationL10n.text(.notificationTabNotifications)),
                        (.schedules, NotificationL10n.text(.notificationTabSchedules)),
                    ]
                )
            }

            switch tab {
            case .notifications:
                notificationsPanel
            case .schedules:
                SchedulerView(model: model.scheduler)
            }
        }
        .padding(DesignTokens.spacingM)
        .sheet(item: $addingToConversation) { item in
            NotificationConversationPicker(
                item: item,
                model: model
            ) { sessionId, title in
                Task {
                    let ok = await model.addToConversation(item, sessionId: sessionId, conversationTitle: title)
                    if ok {
                        addingToConversation = nil
                    }
                }
            }
        }
        .task { await model.reload() }
    }

    private var notificationsPanel: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            HStack {
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
                            NotificationRow(item: item, model: model) {
                                addingToConversation = $0
                            }
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
    }

    private enum ScreenTab: Hashable {
        case notifications
        case schedules
    }
}

private struct NotificationRow: View {
    let item: NotificationPresentation
    @ObservedObject var model: NotificationModel
    let onAddToConversation: (NotificationPresentation) -> Void

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
            if let source = item.sourceScheduleId, !source.isEmpty {
                Text(NotificationL10n.format(.notificationSourceSchedule, value: source, language: nil))
                    .font(.cardiary(.caption))
                    .foregroundStyle(Palette.inkTertiary)
                    .lineLimit(1)
            }

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
                Button {
                    onAddToConversation(item)
                } label: {
                    Label(NotificationL10n.text(.notificationAddToConversation), systemImage: "text.bubble")
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
                .disabled(model.actingIds.contains(item.notificationId))
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
