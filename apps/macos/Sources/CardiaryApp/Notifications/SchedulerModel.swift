import CardiaryKit
import Combine
import Foundation

/// 排程管理畫面：清單、建立、暫停／恢復與刪除。
///
/// 只透過 `SchedulerAdminService`（`module.scheduler.*`）操作；代理提議的排程
/// 不在這裡建立，必須先經過審批。
@MainActor
public final class SchedulerModel: ObservableObject {
    @Published public private(set) var schedules: [CardiarySchedule] = []
    @Published public private(set) var isKnown = false
    @Published public private(set) var isLoading = false
    @Published public private(set) var busyIds: Set<String> = []
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var noticeMessage: String?
    @Published public var draft = SchedulerDraft()
    @Published public private(set) var isCreating = false

    private var service: (any SchedulerAdminService)?
    private let language: AppLanguage

    public init(language: AppLanguage = AppL10n.language) {
        self.language = language
    }

    public func attach(service: any SchedulerAdminService) {
        self.service = service
    }

    public func detach() {
        service = nil
        schedules = []
        isKnown = false
        busyIds = []
    }

    public func reload() async {
        guard let service else {
            errorMessage = NotificationL10n.text(.notificationServiceUnavailable, language: language)
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            schedules = try await service.listSchedules()
                .sorted { ($0.enabled ? 1 : 0, $1.nextRunAt) > ($1.enabled ? 1 : 0, $0.nextRunAt) }
            isKnown = true
            errorMessage = nil
        } catch {
            errorMessage = Self.failure(error, language: language)
        }
    }

    /// 驗證表單並建立排程；成功後清空表單。
    @discardableResult
    public func create() async -> Bool {
        guard let service else {
            errorMessage = NotificationL10n.text(.notificationServiceUnavailable, language: language)
            return false
        }
        guard let problem = validationProblem() else {
            isCreating = true
            defer { isCreating = false }
            do {
                let created = try await service.createSchedule(
                    SchedulerDraft(
                        name: draft.name.trimmingCharacters(in: .whitespacesAndNewlines),
                        kind: draft.kind,
                        onceAt: draft.onceAt,
                        dailyTime: draft.dailyTime,
                        everyMinutes: draft.everyMinutes,
                        task: draft.task
                    )
                )
                schedules.insert(created, at: 0)
                isKnown = true
                draft = SchedulerDraft()
                noticeMessage = NotificationL10n.text(.notificationScheduleCreated, language: language)
                errorMessage = nil
                return true
            } catch {
                errorMessage = Self.failure(error, language: language)
                return false
            }
        }
        errorMessage = problem
        return false
    }

    public func setEnabled(_ schedule: CardiarySchedule, enabled: Bool) async {
        guard !busyIds.contains(schedule.scheduleId) else { return }
        guard let service else {
            errorMessage = NotificationL10n.text(.notificationServiceUnavailable, language: language)
            return
        }
        busyIds.insert(schedule.scheduleId)
        defer { busyIds.remove(schedule.scheduleId) }
        do {
            let updated = try await service.setScheduleEnabled(
                scheduleId: schedule.scheduleId,
                enabled: enabled
            )
            apply(updated)
            noticeMessage = NotificationL10n.text(
                enabled ? .notificationScheduleResumed : .notificationSchedulePaused,
                language: language
            )
            errorMessage = nil
        } catch {
            errorMessage = Self.failure(error, language: language)
        }
    }

    public func delete(_ schedule: CardiarySchedule) async {
        guard !busyIds.contains(schedule.scheduleId) else { return }
        guard let service else {
            errorMessage = NotificationL10n.text(.notificationServiceUnavailable, language: language)
            return
        }
        busyIds.insert(schedule.scheduleId)
        defer { busyIds.remove(schedule.scheduleId) }
        do {
            try await service.deleteSchedule(scheduleId: schedule.scheduleId)
            schedules.removeAll { $0.scheduleId == schedule.scheduleId }
            noticeMessage = NotificationL10n.text(.notificationScheduleDeleted, language: language)
            errorMessage = nil
        } catch {
            errorMessage = Self.failure(error, language: language)
        }
    }

    public func dismissMessages() {
        errorMessage = nil
        noticeMessage = nil
    }

    /// 排程規格的簡短說明，給清單顯示。
    public func specDescription(_ schedule: CardiarySchedule) -> String {
        guard case .object(let object)? = schedule.spec else {
            return schedule.kind
        }
        switch schedule.schedulerKind {
        case .once:
            if case .string(let at)? = object["at"] {
                return NotificationL10n.format(.notificationScheduleSpecOnce, value: at, language: language)
            }
        case .daily:
            if case .string(let time)? = object["time"] {
                return NotificationL10n.format(.notificationScheduleSpecDaily, value: time, language: language)
            }
        case .interval:
            if case .number(let everyMs)? = object["everyMs"] {
                let minutes = Int(everyMs / 60_000)
                return NotificationL10n.format(
                    .notificationScheduleSpecEvery, value: "\(minutes)", language: language
                )
            }
        case .heartbeat:
            if case .number(let everyMs)? = object["everyMs"] {
                let minutes = Int(everyMs / 60_000)
                return NotificationL10n.format(
                    .notificationScheduleSpecEvery, value: "\(minutes)", language: language
                )
            }
        case .none:
            return schedule.kind
        }
        return schedule.kind
    }

    public func statusDescription(_ schedule: CardiarySchedule) -> String? {
        switch schedule.lastStatus {
        case "ok": return NotificationL10n.text(.notificationScheduleStatusOK, language: language)
        case "silent": return NotificationL10n.text(.notificationScheduleStatusSilent, language: language)
        case "notify": return NotificationL10n.text(.notificationScheduleStatusNotify, language: language)
        case "error": return NotificationL10n.text(.notificationScheduleStatusError, language: language)
        case nil: return nil
        default: return schedule.lastStatus
        }
    }

    public func taskDescription(_ schedule: CardiarySchedule) -> String {
        if schedule.isDistillation {
            return NotificationL10n.text(.notificationScheduleTaskDistillation, language: language)
        }
        return schedule.taskPrompt ?? ""
    }

    private func validationProblem() -> String? {
        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty {
            return NotificationL10n.text(.notificationScheduleInvalidName, language: language)
        }
        switch draft.kind {
        case .once:
            if draft.onceAt.isEmpty {
                return NotificationL10n.text(.notificationScheduleInvalidTime, language: language)
            }
        case .daily:
            if !Self.isValidDailyTime(draft.dailyTime) {
                return NotificationL10n.text(.notificationScheduleInvalidTime, language: language)
            }
        case .interval, .heartbeat:
            if draft.everyMinutes < 5 {
                return NotificationL10n.text(.notificationScheduleInvalidInterval, language: language)
            }
        }
        if case .agent(let prompt) = draft.task,
           prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
            return NotificationL10n.text(.notificationScheduleInvalidPrompt, language: language)
        }
        return nil
    }

    private func apply(_ updated: CardiarySchedule) {
        if let index = schedules.firstIndex(where: { $0.scheduleId == updated.scheduleId }) {
            schedules[index] = updated
        } else {
            schedules.insert(updated, at: 0)
        }
    }

    private static func isValidDailyTime(_ value: String) -> Bool {
        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2,
              let hour = Int(parts[0]), let minute = Int(parts[1]),
              parts[0].count == 2, parts[1].count == 2,
              (0...23).contains(hour), (0...59).contains(minute)
        else {
            return false
        }
        return true
    }

    private static func failure(_ error: any Error, language: AppLanguage) -> String {
        NotificationL10n.format(
            .notificationActionFailed,
            value: (error as? LocalizedError)?.errorDescription ?? "\(error)",
            language: language
        )
    }
}
