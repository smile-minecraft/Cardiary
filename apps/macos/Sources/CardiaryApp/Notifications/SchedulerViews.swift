import CardiaryKit
import SwiftUI

/// 排程管理畫面：清單、建立表單、暫停／恢復與刪除。
public struct SchedulerView: View {
    @ObservedObject var model: SchedulerModel

    @State private var draft = SchedulerDraft()
    @State private var taskChoice: TaskChoice = .agent

    public init(model: SchedulerModel) {
        self.model = model
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingM) {
            HStack {
                Text(NotificationL10n.text(.schedulerTitle))
                    .cardiaryFont(.title3, weight: .semibold)
                Spacer()
                Button {
                    Task { await model.reload() }
                } label: {
                    Label(NotificationL10n.text(.notificationRefresh), systemImage: "arrow.clockwise")
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
            }

            ScrollView {
                VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
                    createForm
                    listSection
                }
            }

            if let message = model.errorMessage {
                Text(message).cardiaryFont(.caption).foregroundStyle(Palette.red)
            }
            if let message = model.noticeMessage {
                Text(message).cardiaryFont(.caption).foregroundStyle(Palette.sageInk)
            }
        }
        .padding(DesignTokens.spacingM)
        .task { await model.reload() }
    }

    private var createForm: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingS) {
            Text(NotificationL10n.text(.schedulerCreate))
                .cardiaryFont(.callout, weight: .semibold)
                .foregroundStyle(Palette.inkSecondary)

            TextField(NotificationL10n.text(.schedulerName), text: $draft.name)
                .textFieldStyle(ThemeFieldStyle())

            HStack(spacing: DesignTokens.spacingM) {
                Text(NotificationL10n.text(.schedulerKind))
                    .cardiaryFont(.caption)
                    .foregroundStyle(Palette.inkSecondary)
                ThemeMenuPicker(
                    selection: $draft.kind,
                    options: [
                        (.once, NotificationL10n.text(.schedulerKindOnce)),
                        (.daily, NotificationL10n.text(.schedulerKindDaily)),
                        (.interval, NotificationL10n.text(.schedulerKindInterval)),
                        (.heartbeat, NotificationL10n.text(.schedulerKindHeartbeat)),
                    ]
                )
            }

            switch draft.kind {
            case .once:
                TextField(NotificationL10n.text(.schedulerOnceAt), text: $draft.onceAt)
                    .textFieldStyle(ThemeFieldStyle())
            case .daily:
                TextField(NotificationL10n.text(.schedulerDailyTime), text: $draft.dailyTime)
                    .textFieldStyle(ThemeFieldStyle())
            case .interval, .heartbeat:
                Stepper(value: $draft.everyMinutes, in: 5...10080) {
                    HStack {
                        Text(NotificationL10n.text(.schedulerEveryMinutes))
                            .cardiaryFont(.caption)
                            .foregroundStyle(Palette.inkSecondary)
                        Spacer()
                        Text("\(draft.everyMinutes)")
                            .cardiaryFont(.callout)
                            .foregroundStyle(Palette.ink)
                    }
                }
            }

            HStack(spacing: DesignTokens.spacingM) {
                Text(NotificationL10n.text(.schedulerTask))
                    .cardiaryFont(.caption)
                    .foregroundStyle(Palette.inkSecondary)
                ThemeMenuPicker(
                    selection: $taskChoice,
                    options: [
                        (.agent, NotificationL10n.text(.schedulerTaskAgent)),
                        (.distillation, NotificationL10n.text(.schedulerTaskDistillation)),
                    ]
                )
            }

            if case .agent = taskChoice {
                TextField(
                    NotificationL10n.text(.schedulerPromptPlaceholder),
                    text: promptBinding,
                    axis: .vertical
                )
                .textFieldStyle(ThemeFieldStyle())
                .lineLimit(2...4)
            }

            Button {
                var submission = draft
                submission.task = taskChoice == .agent
                    ? .agent(prompt: promptText)
                    : .distillation
                Task {
                    if await model.create(submission) {
                        draft = SchedulerDraft()
                        taskChoice = .agent
                    }
                }
            } label: {
                Text(NotificationL10n.text(.schedulerCreate))
            }
            .buttonStyle(ThemeButtonStyle(kind: .primary, tone: .red))
            .disabled(model.isCreating)
        }
        .padding(DesignTokens.spacingM)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
    }

    private var promptText: String {
        if case .agent(let prompt) = draft.task { return prompt }
        return ""
    }

    private var promptBinding: Binding<String> {
        Binding(
            get: { promptText },
            set: { draft.task = .agent(prompt: $0) }
        )
    }

    private var listSection: some View {
        Group {
            if model.schedules.isEmpty {
                ThemeEmptyState(
                    text: model.isKnown
                        ? NotificationL10n.text(.schedulerEmpty)
                        : NotificationL10n.text(.notificationLoading),
                    suit: .club,
                    systemImage: "clock"
                )
            } else {
                ForEach(model.schedules) { schedule in
                    ScheduleRow(schedule: schedule, model: model)
                }
            }
        }
    }

    private enum TaskChoice: Hashable {
        case agent
        case distillation
    }
}

private struct ScheduleRow: View {
    let schedule: CardiarySchedule
    @ObservedObject var model: SchedulerModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Circle()
                    .fill(schedule.enabled ? Palette.sageInk : Palette.inkTertiary)
                    .frame(width: 9, height: 9)
                    .accessibilityHidden(true)
                Text(schedule.name)
                    .cardiaryFont(.callout, weight: .semibold)
                    .foregroundStyle(Palette.ink)
                Spacer()
                if let status = model.statusDescription(schedule) {
                    ThemeChip(text: status, tone: .gray)
                }
            }
            Text(model.specDescription(schedule))
                .cardiaryFont(.caption)
                .foregroundStyle(Palette.inkSecondary)
            Text(model.taskDescription(schedule))
                .cardiaryFont(.caption)
                .foregroundStyle(Palette.inkSecondary)
                .lineLimit(2)
            HStack(spacing: DesignTokens.spacingS) {
                Text(NotificationL10n.format(.schedulerNextRun, value: schedule.nextRunAt, language: nil))
                    .cardiaryFont(.caption)
                    .foregroundStyle(Palette.inkTertiary)
                Text(NotificationL10n.count(.schedulerRunCount, count: schedule.runCount, language: nil))
                    .cardiaryFont(.caption)
                    .foregroundStyle(Palette.inkTertiary)
                Spacer()
                Button {
                    Task { await model.setEnabled(schedule, enabled: !schedule.enabled) }
                } label: {
                    Text(
                        schedule.enabled
                            ? NotificationL10n.text(.schedulerPause)
                            : NotificationL10n.text(.schedulerResume)
                    )
                }
                .buttonStyle(ThemeButtonStyle(kind: .soft, tone: .gray))
                .disabled(model.busyIds.contains(schedule.scheduleId))
                Button(role: .destructive) {
                    Task { await model.delete(schedule) }
                } label: {
                    Text(NotificationL10n.text(.schedulerDelete))
                }
                .buttonStyle(ThemeButtonStyle(kind: .danger, tone: .red))
                .disabled(model.busyIds.contains(schedule.scheduleId))
            }
        }
        .padding(DesignTokens.spacingM)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: DesignTokens.cornerRadius))
    }
}
