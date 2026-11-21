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
                    .cardiaryFont(.title3, weight: .semibold)
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
                let ok = await model.addToConversation(
                    item,
                    sessionId: sessionId,
                    conversationTitle: title
                )
                if ok {
                    addingToConversation = nil
                }
                return ok
            }
        }
        .task {
            await model.reload()
            await loadScheduleNamesIfNeeded()
        }
    }

    /// 通知只帶排程識別碼；開啟通知流時補載排程，讓通知列能顯示名稱。
    private func loadScheduleNamesIfNeeded() async {
        let hasUnresolvedName = model.notifications.contains { item in
            guard let id = item.sourceScheduleId, !id.isEmpty else { return false }
            return !model.scheduler.schedules.contains { $0.scheduleId == id }
        }
        if hasUnresolvedName {
            await model.scheduler.reload()
        }
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
                Text(message).cardiaryFont(.caption).foregroundStyle(Palette.red)
            }
            if let message = model.noticeMessage {
                Text(message).cardiaryFont(.caption).foregroundStyle(Palette.sageInk)
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
                    .cardiaryFont(.caption)
                    .foregroundStyle(Palette.inkTertiary)
                    .lineLimit(1)
            }
            Text(item.title)
                .cardiaryFont(.callout, weight: item.isUnread ? .semibold : .regular)
                .foregroundStyle(Palette.ink)
            MarkdownView(text: item.body, baseStyle: .caption, textColor: Palette.inkSecondary)
            if let source = item.sourceScheduleId, !source.isEmpty {
                Text(NotificationL10n.format(
                    .notificationSourceScheduleName,
                    value: scheduleName,
                    language: nil
                ))
                    .cardiaryFont(.caption)
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

            HStack(spacing: 4) {
                Image(systemName: "hand.draw")
                    .cardiarySymbolFont(size: 10, weight: .semibold)
                Text(NotificationL10n.text(.notificationDragHint))
                    .cardiaryFont(.caption)
            }
            .foregroundStyle(Palette.inkTertiary)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(DesignTokens.spacingM)
        .background(
            Palette.surface,
            in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius)
        )
        .draggable(NotificationDrag(notificationId: item.notificationId, notification: item))
    }

    /// 通知只帶排程識別碼；名稱從已載入的排程找，找不到時顯示通用名稱而不是 UUID。
    private var scheduleName: String {
        if let id = item.sourceScheduleId,
            let name = model.scheduler.schedules.first(where: { $0.scheduleId == id })?.name,
            !name.isEmpty
        {
            return name
        }
        return NotificationL10n.text(.notificationUnknownSchedule)
    }

    private var kindLabel: String {
        switch item.kind {
        case .schedule: return NotificationL10n.text(.notificationKindSchedule)
        case .heartbeat: return NotificationL10n.text(.notificationKindHeartbeat)
        case .distillation: return NotificationL10n.text(.notificationKindDistillation)
        }
    }
}
