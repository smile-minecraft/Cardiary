import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 排程管理的視圖模型：列表、建立、暫停／恢復、刪除與驗證。
/// 字串固定用繁體中文，不跟著 CI runner 的系統語言。
@MainActor
final class SchedulerModelTests: XCTestCase {
    private func schedule(
        id: String = "s-1",
        name: String = "每日摘要",
        kind: String = "daily",
        everyMinutes: Int = 120,
        taskJSON: JSONValue = .object(["type": .string("agent"), "prompt": .string("整理今天的卡片")])
    ) -> JSONValue {
        var fields: [String: JSONValue] = [
            "scheduleId": .string(id),
            "persona": .string("default"),
            "name": .string(name),
            "kind": .string(kind),
            "task": taskJSON,
            "enabled": .bool(true),
            "createdBy": .string("user"),
            "nextRunAt": .string("2026-01-02T04:00:00+08:00"),
            "runCount": .number(3),
            "createdAt": .string("2026-01-01T00:00:00Z"),
            "updatedAt": .string("2026-01-01T00:00:00Z"),
        ]
        switch kind {
        case "daily":
            fields["spec"] = .object(["time": .string("04:00")])
        case "once":
            fields["spec"] = .object(["at": .string("2026-01-02T04:00:00+08:00")])
        default:
            fields["spec"] = .object(["everyMs": .number(Double(everyMinutes * 60_000))])
        }
        return .object(fields)
    }

    private func envelope(_ data: JSONValue) -> JSONValue {
        .object(["data": data])
    }

    func testReloadListsSchedulesFromModuleProtocol() async {
        let sender = FakeModuleSender(responses: [
            "module.scheduler.list": envelope(.object(["schedules": .array([schedule()])])),
        ])
        let model = SchedulerModel(language: .zhHant)
        model.attach(service: ModuleSchedulerAdminService(sender: sender))

        await model.reload()

        XCTAssertTrue(model.isKnown)
        XCTAssertEqual(model.schedules.map(\.scheduleId), ["s-1"])
        XCTAssertEqual(model.schedules.first?.name, "每日摘要")
        let calls = await sender.calls
        XCTAssertEqual(calls.map { $0.type }, ["module.scheduler.list"])
    }

    func testCreateSendsWirePayloadAndInsertsResult() async {
        let created = schedule(id: "s-2", name: "每天整理")
        let sender = FakeModuleSender(responses: [
            "module.scheduler.create": envelope(.object(["schedule": created])),
        ])
        let model = SchedulerModel(language: .zhHant)
        model.attach(service: ModuleSchedulerAdminService(sender: sender))

        let ok = await model.create(
            SchedulerDraft(name: "每天整理", kind: .daily, dailyTime: "09:30", task: .agent(prompt: "整理卡片"))
        )

        XCTAssertTrue(ok)
        XCTAssertEqual(model.schedules.first?.scheduleId, "s-2")
        XCTAssertEqual(model.noticeMessage, "已建立排程。")
        let calls = await sender.calls
        guard let call = calls.first else { return XCTFail("沒有呼叫 module.scheduler.create") }
        XCTAssertEqual(call.type, "module.scheduler.create")
        guard case .object(let payload) = call.payload,
              case .object(let spec) = payload["spec"],
              case .string(let time) = spec["time"]
        else { return XCTFail("payload 格式不對：\(call.payload)") }
        XCTAssertEqual(time, "09:30")
        // 介面不得替使用者送 createdBy。
        XCTAssertNil(payload["createdBy"])
    }

    func testCreateHeartbeatBelowFiveMinutesIsRejectedBeforeRequest() async {
        let sender = FakeModuleSender(responses: [:])
        let model = SchedulerModel(language: .zhHant)
        model.attach(service: ModuleSchedulerAdminService(sender: sender))

        let ok = await model.create(
            SchedulerDraft(name: "太密", kind: .heartbeat, everyMinutes: 2, task: .agent(prompt: "檢查"))
        )

        XCTAssertFalse(ok)
        XCTAssertEqual(model.errorMessage, "心跳檢查與固定間隔至少要 5 分鐘。")
        let calls = await sender.calls
        XCTAssertTrue(calls.isEmpty)
    }

    func testCreateDistillationScheduleDoesNotRequirePrompt() async {
        let created = schedule(id: "s-3", name: "每日蒸餾", taskJSON: .object(["type": .string("distillation")]))
        let sender = FakeModuleSender(responses: [
            "module.scheduler.create": envelope(.object(["schedule": created])),
        ])
        let model = SchedulerModel(language: .zhHant)
        model.attach(service: ModuleSchedulerAdminService(sender: sender))

        let ok = await model.create(
            SchedulerDraft(name: "每日蒸餾", kind: .daily, dailyTime: "03:00", task: .distillation)
        )

        XCTAssertTrue(ok)
        let calls = await sender.calls
        guard let call = calls.first, case .object(let payload) = call.payload,
              case .object(let task) = payload["task"], case .string(let type) = task["type"]
        else { return XCTFail("payload 格式不對：\(calls)") }
        XCTAssertEqual(type, "distillation")
    }

    func testToggleEnableCallsUpdateAndRefreshRow() async {
        let heartbeat = schedule(id: "s-4", name: "心跳", kind: "heartbeat", everyMinutes: 30)
        let disabled: JSONValue = .object([
            "scheduleId": .string("s-4"),
            "persona": .string("default"),
            "name": .string("心跳"),
            "kind": .string("heartbeat"),
            "spec": .object(["everyMs": .number(1_800_000)]),
            "task": .object(["type": .string("agent"), "prompt": .string("檢查")]),
            "enabled": .bool(false),
            "createdBy": .string("user"),
            "nextRunAt": .string("2026-01-02T04:00:00+08:00"),
            "runCount": .number(0),
            "createdAt": .string("2026-01-01T00:00:00Z"),
            "updatedAt": .string("2026-01-01T00:00:00Z"),
        ])
        let sender = FakeModuleSender(responses: [
            "module.scheduler.list": envelope(.object(["schedules": .array([heartbeat])])),
            "module.scheduler.update": envelope(.object(["schedule": disabled])),
        ])
        let model = SchedulerModel(language: .zhHant)
        model.attach(service: ModuleSchedulerAdminService(sender: sender))
        await model.reload()

        await model.setEnabled(model.schedules[0], enabled: false)

        guard let current = model.schedules.first else { return XCTFail("找不到排程") }
        XCTAssertFalse(current.enabled)
        let calls = await sender.calls
        XCTAssertEqual(calls.map { $0.type }, ["module.scheduler.list", "module.scheduler.update"])
        guard let last = calls.last,
              case .object(let payload) = last.payload,
              case .bool(let flag) = payload["enabled"]
        else { return XCTFail("update payload 格式不對：\(calls)") }
        XCTAssertEqual(flag, false)
    }

    func testDeleteRemovesLocalRowAndId() async {
        let sender = FakeModuleSender(responses: [
            "module.scheduler.list": envelope(.object(["schedules": .array([schedule()])])),
            "module.scheduler.delete": envelope(.object(["deleted": .bool(true)])),
        ])
        let model = SchedulerModel(language: .zhHant)
        model.attach(service: ModuleSchedulerAdminService(sender: sender))
        await model.reload()

        await model.delete(model.schedules[0])

        XCTAssertTrue(model.schedules.isEmpty)
        let calls = await sender.calls
        guard let call = calls.last, case .object(let payload) = call.payload,
              case .string(let scheduleId) = payload["scheduleId"]
        else { return XCTFail("delete payload 格式不對：\(calls)") }
        XCTAssertEqual(scheduleId, "s-1")
    }
}

private actor FakeModuleSender: ModuleRequestSending {
    struct Call: Equatable {
        let type: String
        let payload: JSONValue
    }

    private(set) var calls: [Call] = []
    private let responses: [String: JSONValue]

    init(responses: [String: JSONValue]) {
        self.responses = responses
    }

    func sendModuleRequest(_ type: String, payload: JSONValue) async throws -> JSONValue {
        calls.append(Call(type: type, payload: payload))
        guard let response = responses[type] else {
            throw FakeModuleError.missing
        }
        // 測試用的假主機：`data` 裡放與主機一致的內容。
        return response
    }
}

private enum FakeModuleError: Error {
    case missing
}
