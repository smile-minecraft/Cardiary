import CardiaryKit
import Foundation

/// 排程的觸發方式；與主機的正本格式一致。
public enum SchedulerKind: String, CaseIterable, Sendable, Equatable {
    case once
    case daily
    case interval
    case heartbeat
}

/// 排程要執行的背景任務。
public enum SchedulerTask: Sendable, Equatable {
    case agent(prompt: String)
    case distillation

    var wireValue: JSONValue {
        switch self {
        case .agent(let prompt):
            return .object(["type": .string("agent"), "prompt": .string(prompt)])
        case .distillation:
            return .object(["type": .string("distillation")])
        }
    }
}

/// 建立排程時要送出的內容。
public struct SchedulerDraft: Sendable, Equatable {
    public var name: String
    public var kind: SchedulerKind
    /// `once` 的執行時間；RFC 3339。
    public var onceAt: String
    /// `daily` 的執行時間；本機時區的 HH:MM。
    public var dailyTime: String
    /// `interval` 與 `heartbeat` 的間隔；分鐘。
    public var everyMinutes: Int
    public var task: SchedulerTask

    public init(
        name: String = "",
        kind: SchedulerKind = .daily,
        onceAt: String = "",
        dailyTime: String = "04:00",
        everyMinutes: Int = 60,
        task: SchedulerTask = .agent(prompt: "")
    ) {
        self.name = name
        self.kind = kind
        self.onceAt = onceAt
        self.dailyTime = dailyTime
        self.everyMinutes = everyMinutes
        self.task = task
    }

    var wireSpec: JSONValue {
        switch kind {
        case .once:
            return .object(["at": .string(onceAt)])
        case .daily:
            return .object(["time": .string(dailyTime)])
        case .interval, .heartbeat:
            return .object(["everyMs": .number(Double(everyMinutes * 60_000))])
        }
    }
}

/// 主機回報的排程。`spec` 與 `task` 保留原始 JSON，介面只讀需要的欄位。
public struct CardiarySchedule: Decodable, Equatable, Identifiable, Sendable {
    public let scheduleId: String
    public let name: String
    public let kind: String
    public let spec: JSONValue?
    public let task: JSONValue?
    public let enabled: Bool
    public let createdBy: String
    public let sourceConversationId: String?
    public let nextRunAt: String
    public let lastRunAt: String?
    public let lastStatus: String?
    public let lastError: String?
    public let runCount: Int
    public let createdAt: String
    public let updatedAt: String

    public var id: String { scheduleId }

    public var schedulerKind: SchedulerKind? { SchedulerKind(rawValue: kind) }

    public var taskPrompt: String? {
        guard case .object(let object)? = task, case .string(let prompt)? = object["prompt"] else {
            return nil
        }
        return prompt
    }

    public var isDistillation: Bool {
        guard case .object(let object)? = task, case .string(let type)? = object["type"] else {
            return false
        }
        return type == "distillation"
    }
}

/// 排程管理介面；只走 `module.scheduler.*`，不直接碰協定 frame。
public protocol SchedulerAdminService: Sendable {
    func listSchedules() async throws -> [CardiarySchedule]
    func createSchedule(_ draft: SchedulerDraft) async throws -> CardiarySchedule
    func setScheduleEnabled(scheduleId: String, enabled: Bool) async throws -> CardiarySchedule
    func deleteSchedule(scheduleId: String) async throws
}

/// 把排程管理接到 `ModuleRequestSending` 上。
public struct ModuleSchedulerAdminService: SchedulerAdminService {
    private let sender: any ModuleRequestSending

    public init(sender: any ModuleRequestSending) {
        self.sender = sender
    }

    public func listSchedules() async throws -> [CardiarySchedule] {
        struct Response: Decodable { let schedules: [CardiarySchedule] }
        return try await call("module.scheduler.list", payload: .object([:]), as: Response.self).schedules
    }

    public func createSchedule(_ draft: SchedulerDraft) async throws -> CardiarySchedule {
        struct Response: Decodable { let schedule: CardiarySchedule }
        return try await call(
            "module.scheduler.create",
            payload: .object([
                "name": .string(draft.name),
                "kind": .string(draft.kind.rawValue),
                "spec": draft.wireSpec,
                "task": draft.task.wireValue,
            ]),
            as: Response.self
        ).schedule
    }

    public func setScheduleEnabled(scheduleId: String, enabled: Bool) async throws -> CardiarySchedule {
        struct Response: Decodable { let schedule: CardiarySchedule }
        return try await call(
            "module.scheduler.update",
            payload: .object([
                "scheduleId": .string(scheduleId),
                "enabled": .bool(enabled),
            ]),
            as: Response.self
        ).schedule
    }

    public func deleteSchedule(scheduleId: String) async throws {
        struct Response: Decodable { let deleted: Bool }
        _ = try await call(
            "module.scheduler.delete",
            payload: .object(["scheduleId": .string(scheduleId)]),
            as: Response.self
        )
    }

    private func call<T: Decodable>(
        _ type: String,
        payload: JSONValue,
        as: T.Type
    ) async throws -> T {
        let response = try await sender.sendModuleRequest(type, payload: payload)
        guard case .object(let object) = response, let data = object["data"] else {
            throw SchedulerAdminError.malformedResponse(type)
        }
        let dataValue = try JSONEncoder().encode(data)
        return try JSONDecoder().decode(T.self, from: dataValue)
    }
}

/// 排程管理失敗的原因。
public enum SchedulerAdminError: Error, Equatable, LocalizedError {
    case malformedResponse(String)

    public var errorDescription: String? {
        switch self {
        case .malformedResponse(let type):
            return "主機回應的不是排程格式：\(type)"
        }
    }
}
