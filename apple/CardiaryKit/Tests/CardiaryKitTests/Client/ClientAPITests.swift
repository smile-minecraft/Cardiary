import Foundation
import XCTest

@testable import CardiaryKit

/// 介面用的客戶端 API：請求格式、回應解碼與重連時的重新訂閱。
final class ClientAPITests: XCTestCase {
    private let clientInfo = ClientInfo(
        name: "Cardiary macOS",
        version: "0.1.0",
        platform: .macos,
        instanceId: "inst_test"
    )

    private func makeClient(
        queue: TransportQueue,
        statuses: Recorder<SystemStatus>
    ) -> CardiaryClient {
        let configuration = CardiaryClient.Configuration(
            endpoint: URL(string: "ws://127.0.0.1:1/v1/ws")!,
            clientToken: "client-token",
            client: clientInfo,
            reconnect: ReconnectPolicy(
                baseDelay: .milliseconds(10),
                maxDelay: .milliseconds(20)
            ),
            subscribeActiveSessions: false
        )
        let client = CardiaryClient(configuration: configuration) { _ in
            queue.next()
        }
        client.handlers.onSystemStatus = { status in
            statuses.append(status)
        }
        return client
    }

    /// 完成一次連線握手與 system 訂閱；回傳第一個傳輸層，方便推入後續訊息。
    private func connect(
        client: CardiaryClient,
        transport: FakeServerTransport,
        epoch: String
    ) async throws {
        await client.start()
        let hello = JSONFixture.decode(try await transport.nextSent())
        await transport.push(
            JSONFixture.helloResponse(
                replyTo: try XCTUnwrap(hello["id"] as? String),
                epoch: epoch
            )
        )
        let subscribe = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(subscribe["type"] as? String, "system.subscribe")
        await transport.push(
            JSONFixture.systemSubscribeResponse(
                replyTo: try XCTUnwrap(subscribe["id"] as? String),
                seq: 5,
                epoch: epoch,
                resyncRequired: true,
                snapshot: JSONFixture.systemStatus()
            )
        )
    }

    // MARK: - 請求與回應

    func testGetHistorySendsCursorAndDecodesEntries() async throws {
        let queue = TransportQueue()
        let transport = FakeServerTransport()
        queue.append(transport)
        let statuses = Recorder<SystemStatus>()
        let client = makeClient(queue: queue, statuses: statuses)
        try await connect(client: client, transport: transport, epoch: "epoch_a")
        _ = try await statuses.waitForFirst()

        let task = Task {
            try await client.getHistory(sessionId: "sess_1", limit: 50)
        }
        let sent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(sent["type"] as? String, "session.get_history")
        let request = try XCTUnwrap(sent["payload"] as? [String: Any])
        XCTAssertEqual(request["sessionId"] as? String, "sess_1")
        XCTAssertEqual(request["limit"] as? Int, 50)
        XCTAssertNil(request["cursor"], "沒有 cursor 時不能送出空的 cursor")

        await transport.push(
            Self.getHistoryResponse(
                replyTo: try XCTUnwrap(sent["id"] as? String),
                entries: [
                    Self.userEntry(id: "entry_1", turnId: "turn_1", text: "你好"),
                    Self.assistantEntry(id: "entry_2", turnId: "turn_1", text: "你好，有什麼可以幫你？"),
                ],
                nextCursor: "cursor_page_2"
            )
        )
        let firstPage = try await task.value
        XCTAssertEqual(firstPage.entries.count, 2)
        XCTAssertEqual(firstPage.nextCursor, "cursor_page_2")

        // 往回翻頁帶上一次回傳的游標。
        let olderTask = Task {
            try await client.getHistory(sessionId: "sess_1", cursor: "cursor_page_2", limit: 50)
        }
        let olderSent = JSONFixture.decode(try await transport.nextSent())
        let olderRequest = try XCTUnwrap(olderSent["payload"] as? [String: Any])
        XCTAssertEqual(olderRequest["cursor"] as? String, "cursor_page_2")
        await transport.push(
            Self.getHistoryResponse(
                replyTo: try XCTUnwrap(olderSent["id"] as? String),
                entries: [Self.userEntry(id: "entry_0", turnId: "turn_0", text: "更早的訊息")],
                nextCursor: nil
            )
        )
        let secondPage = try await olderTask.value
        XCTAssertEqual(secondPage.entries.count, 1)
        XCTAssertNil(secondPage.nextCursor)

        await client.stop()
    }

    func testInterruptSessionSendsReasonAndDecodesResponse() async throws {
        let queue = TransportQueue()
        let transport = FakeServerTransport()
        queue.append(transport)
        let statuses = Recorder<SystemStatus>()
        let client = makeClient(queue: queue, statuses: statuses)
        try await connect(client: client, transport: transport, epoch: "epoch_a")

        let task = Task {
            try await client.interruptSession(sessionId: "sess_1", reason: "user_request")
        }
        let sent = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(sent["type"] as? String, "session.interrupt")
        let request = try XCTUnwrap(sent["payload"] as? [String: Any])
        XCTAssertEqual(request["sessionId"] as? String, "sess_1")
        XCTAssertEqual(request["reason"] as? String, "user_request")

        await transport.push(
            JSONFixture.string([
                "v": 1,
                "kind": "response",
                "replyTo": try XCTUnwrap(sent["id"] as? String),
                "type": "session.interrupt",
                "payload": ["sessionId": "sess_1", "interrupted": true],
            ])
        )
        let response = try await task.value
        XCTAssertEqual(response.sessionId, "sess_1")
        XCTAssertTrue(response.interrupted)

        await client.stop()
    }

    func testGetModelsAndSetModelsRoundTrip() async throws {
        let queue = TransportQueue()
        let transport = FakeServerTransport()
        queue.append(transport)
        let statuses = Recorder<SystemStatus>()
        let client = makeClient(queue: queue, statuses: statuses)
        try await connect(client: client, transport: transport, epoch: "epoch_a")

        let state = Self.modelsState(roleMode: "model")
        let getTask = Task {
            try await client.getModels()
        }
        let getRequest = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(getRequest["type"] as? String, "system.models.get")
        await transport.push(
            Self.response(type: "system.models.get", replyTo: try XCTUnwrap(getRequest["id"] as? String), payload: state)
        )
        let fetched = try await getTask.value
        XCTAssertEqual(fetched.providers.map(\.providerId), ["prov_main"])
        XCTAssertEqual(fetched.roles.first?.ref?.modelId, "model-big")
        XCTAssertEqual(fetched.resolved.first?.source, .configured)

        // set 帶 roles 與 clientRequestId；providers 不帶時不能出現在請求裡。
        let roleChange = ModelRoleSelection(
            role: .small,
            mode: .model,
            ref: ModelRef(providerId: "prov_main", modelId: "model-small")
        )
        let setTask = Task {
            try await client.setModels(roles: [roleChange], clientRequestId: "req_models_1")
        }
        let setRequest = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(setRequest["type"] as? String, "system.models.set")
        let setPayload = try XCTUnwrap(setRequest["payload"] as? [String: Any])
        XCTAssertEqual(setPayload["clientRequestId"] as? String, "req_models_1")
        XCTAssertNil(setPayload["providers"], "providers 沒有傳時不能送出")
        let roles = try XCTUnwrap(setPayload["roles"] as? [[String: Any]])
        XCTAssertEqual(roles.first?["role"] as? String, "small")

        await transport.push(
            Self.response(
                type: "system.models.set",
                replyTo: try XCTUnwrap(setRequest["id"] as? String),
                payload: Self.modelsState(roleMode: "model", smallRole: true)
            )
        )
        let applied = try await setTask.value
        XCTAssertEqual(applied.providers.map(\.providerId), ["prov_main"])

        await client.stop()
    }

    func testGetSettingsAndSetSettingsRoundTrip() async throws {
        let queue = TransportQueue()
        let transport = FakeServerTransport()
        queue.append(transport)
        let statuses = Recorder<SystemStatus>()
        let client = makeClient(queue: queue, statuses: statuses)
        try await connect(client: client, transport: transport, epoch: "epoch_a")

        let settings = [Self.settingItem(key: "ui.language", value: "zh-TW")]
        let getTask = Task {
            try await client.getSettings()
        }
        let getRequest = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(getRequest["type"] as? String, "system.settings.get")
        await transport.push(
            Self.response(type: "system.settings.get", replyTo: try XCTUnwrap(getRequest["id"] as? String), payload: ["settings": settings])
        )
        let fetched = try await getTask.value
        XCTAssertEqual(fetched.settings.map(\.key), ["ui.language"])
        XCTAssertEqual(fetched.settings.first?.value, .string("zh-TW"))

        let setTask = Task {
            try await client.setSettings(
                changes: [SettingChange(key: "ui.language", value: .string("en"))],
                clientRequestId: "req_settings_1"
            )
        }
        let setRequest = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(setRequest["type"] as? String, "system.settings.set")
        let setPayload = try XCTUnwrap(setRequest["payload"] as? [String: Any])
        XCTAssertEqual(setPayload["clientRequestId"] as? String, "req_settings_1")
        let changes = try XCTUnwrap(setPayload["changes"] as? [[String: Any]])
        XCTAssertEqual(changes.first?["key"] as? String, "ui.language")
        XCTAssertEqual(changes.first?["value"] as? String, "en")

        await transport.push(
            Self.response(
                type: "system.settings.set",
                replyTo: try XCTUnwrap(setRequest["id"] as? String),
                payload: [
                    "applied": [Self.settingItem(key: "ui.language", value: "en")],
                    "requiresApproval": false,
                ]
            )
        )
        let applied = try await setTask.value
        XCTAssertFalse(applied.requiresApproval)
        XCTAssertEqual(applied.applied.first?.value, .string("en"))

        await client.stop()
    }

    func testStorageUsageAndCleanupRoundTrip() async throws {
        let queue = TransportQueue()
        let transport = FakeServerTransport()
        queue.append(transport)
        let statuses = Recorder<SystemStatus>()
        let client = makeClient(queue: queue, statuses: statuses)
        try await connect(client: client, transport: transport, epoch: "epoch_a")

        let usageTask = Task { try await client.getStorageUsage() }
        let usageRequest = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(usageRequest["type"] as? String, "storage.usage")
        await transport.push(
            Self.response(
                type: "storage.usage",
                replyTo: try XCTUnwrap(usageRequest["id"] as? String),
                payload: ["usage": [
                    ["category": "cache", "bytes": 128, "cleanableBytes": 128],
                    ["category": "shellState", "bytes": 2048, "cleanableBytes": 0],
                ]]
            )
        )
        let usage = try await usageTask.value
        XCTAssertEqual(usage.usage.count, 2)
        XCTAssertEqual(usage.usage.first?.category, .cache)
        XCTAssertEqual(usage.usage.last?.category, .shellState)
        XCTAssertEqual(usage.usage.last?.cleanableBytes, 0)

        let previewTask = Task { try await client.previewStorageCleanup(categories: ["cache"]) }
        let previewRequest = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(previewRequest["type"] as? String, "storage.cleanup.preview")
        let previewPayload = try XCTUnwrap(previewRequest["payload"] as? [String: Any])
        XCTAssertEqual(previewPayload["categories"] as? [String], ["cache"])
        await transport.push(
            Self.response(
                type: "storage.cleanup.preview",
                replyTo: try XCTUnwrap(previewRequest["id"] as? String),
                payload: [
                    "targets": [["category": "cache", "items": 2, "bytes": 128]],
                    "totalBytes": 128,
                ]
            )
        )
        let preview = try await previewTask.value
        XCTAssertEqual(preview.totalBytes, 128)
        XCTAssertEqual(preview.targets.first?.items, 2)

        let applyTask = Task { try await client.applyStorageCleanup(categories: ["cache"]) }
        let applyRequest = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(applyRequest["type"] as? String, "storage.cleanup.apply")
        await transport.push(
            Self.response(
                type: "storage.cleanup.apply",
                replyTo: try XCTUnwrap(applyRequest["id"] as? String),
                payload: [
                    "targets": [["category": "cache", "items": 2, "bytes": 128]],
                    "totalBytes": 128,
                    "recordId": "rec_1",
                ]
            )
        )
        let apply = try await applyTask.value
        XCTAssertEqual(apply.recordId, "rec_1")

        await client.stop()
    }

    func testStorageUsageOutsideWritesCompatibility() async throws {
        let queue = TransportQueue()
        let transport = FakeServerTransport()
        queue.append(transport)
        let statuses = Recorder<SystemStatus>()
        let client = makeClient(queue: queue, statuses: statuses)
        try await connect(client: client, transport: transport, epoch: "epoch_a")

        // 舊訊息沒有 outsideWrites → 解成 nil。
        let oldTask = Task { try await client.getStorageUsage() }
        let oldRequest = JSONFixture.decode(try await transport.nextSent())
        await transport.push(
            Self.response(
                type: "storage.usage",
                replyTo: try XCTUnwrap(oldRequest["id"] as? String),
                payload: ["usage": [["category": "cache", "bytes": 1, "cleanableBytes": 1]]]
            )
        )
        let oldResponse = try await oldTask.value
        XCTAssertNil(oldResponse.outsideWrites)

        // 新訊息三態：measured/absent 有 bytes，unavailable 沒有 bytes。
        let newTask = Task { try await client.getStorageUsage() }
        let newRequest = JSONFixture.decode(try await transport.nextSent())
        await transport.push(
            Self.response(
                type: "storage.usage",
                replyTo: try XCTUnwrap(newRequest["id"] as? String),
                payload: [
                    "usage": [["category": "cache", "bytes": 1, "cleanableBytes": 1]],
                    "outsideWrites": [
                        ["path": "/h/.claude/projects", "tool": "claude-code", "status": "measured", "bytes": 4096],
                        ["path": "/h/.claude/backups", "tool": "claude-code", "status": "absent", "bytes": 0],
                        ["path": "/h/.claude/plugins", "tool": "claude-code", "status": "unavailable"],
                    ],
                ]
            )
        )
        let newResponse = try await newTask.value
        let entries = try XCTUnwrap(newResponse.outsideWrites)
        XCTAssertEqual(entries.count, 3)
        XCTAssertEqual(entries[0].status, .measured)
        XCTAssertEqual(entries[0].bytes, 4096)
        XCTAssertEqual(entries[1].status, .absent)
        XCTAssertEqual(entries[1].bytes, 0)
        XCTAssertEqual(entries[2].status, .unavailable)
        XCTAssertNil(entries[2].bytes)

        await client.stop()
    }

    func testGetModulesAndSetModuleEnabledRoundTrip() async throws {
        let queue = TransportQueue()
        let transport = FakeServerTransport()
        queue.append(transport)
        let statuses = Recorder<SystemStatus>()
        let client = makeClient(queue: queue, statuses: statuses)
        try await connect(client: client, transport: transport, epoch: "epoch_a")

        let module = Self.moduleInfo(moduleId: "cards", enabled: true)
        let getTask = Task {
            try await client.getModules()
        }
        let getRequest = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(getRequest["type"] as? String, "system.modules.get")
        await transport.push(
            Self.response(type: "system.modules.get", replyTo: try XCTUnwrap(getRequest["id"] as? String), payload: ["modules": [module]])
        )
        let fetched = try await getTask.value
        XCTAssertEqual(fetched.modules.map(\.moduleId), ["cards"])
        XCTAssertTrue(fetched.modules.first?.enabled ?? false)

        let setTask = Task {
            try await client.setModuleEnabled(moduleId: "cards", enabled: false, clientRequestId: "req_modules_1")
        }
        let setRequest = JSONFixture.decode(try await transport.nextSent())
        XCTAssertEqual(setRequest["type"] as? String, "system.modules.set_enabled")
        let setPayload = try XCTUnwrap(setRequest["payload"] as? [String: Any])
        XCTAssertEqual(setPayload["moduleId"] as? String, "cards")
        XCTAssertEqual(setPayload["enabled"] as? Bool, false)
        XCTAssertEqual(setPayload["clientRequestId"] as? String, "req_modules_1")

        await transport.push(
            Self.response(
                type: "system.modules.set_enabled",
                replyTo: try XCTUnwrap(setRequest["id"] as? String),
                payload: ["module": Self.moduleInfo(moduleId: "cards", enabled: false)]
            )
        )
        let updated = try await setTask.value
        XCTAssertEqual(updated.module.moduleId, "cards")
        XCTAssertFalse(updated.module.enabled)

        await client.stop()
    }

    // MARK: - 訂閱與重連

    func testSubscribedSessionIsResubscribedOnReconnect() async throws {
        let queue = TransportQueue()
        let first = FakeServerTransport()
        let second = FakeServerTransport()
        queue.append(first)
        queue.append(second)

        let statuses = Recorder<SystemStatus>()
        let client = makeClient(queue: queue, statuses: statuses)
        try await connect(client: client, transport: first, epoch: "epoch_a")

        let subscribeTask = Task {
            try await client.subscribeSession(sessionId: "sess_1")
        }
        let subscribeRequest = JSONFixture.decode(try await first.nextSent())
        XCTAssertEqual(subscribeRequest["type"] as? String, "session.subscribe")
        let subscribePayload = try XCTUnwrap(subscribeRequest["payload"] as? [String: Any])
        XCTAssertEqual(subscribePayload["sessionId"] as? String, "sess_1")
        XCTAssertNil(subscribePayload["lastSeq"], "第一次訂閱沒有 lastSeq")
        await first.push(
            Self.sessionSubscribeResponse(
                replyTo: try XCTUnwrap(subscribeRequest["id"] as? String),
                sessionId: "sess_1",
                seq: 7,
                epoch: "epoch_a",
                resyncRequired: true,
                snapshot: Self.sessionSnapshot(sessionId: "sess_1")
            )
        )
        let subscribed = try await subscribeTask.value
        XCTAssertEqual(subscribed.seq, 7)

        // 斷線重連（同一個 epoch）：即使 subscribeActiveSessions 為 false，
        // 明確訂閱過的會話仍要重新訂閱，並帶上 lastSeq 補送。
        await first.serverClosed()
        let hello2 = JSONFixture.decode(try await second.nextSent())
        await second.push(
            JSONFixture.helloResponse(
                replyTo: try XCTUnwrap(hello2["id"] as? String),
                epoch: "epoch_a"
            )
        )
        let subscribeSystem2 = JSONFixture.decode(try await second.nextSent())
        await second.push(
            JSONFixture.systemSubscribeResponse(
                replyTo: try XCTUnwrap(subscribeSystem2["id"] as? String),
                seq: 7,
                epoch: "epoch_a",
                resyncRequired: false
            )
        )
        let resubscribe = JSONFixture.decode(try await second.nextSent())
        XCTAssertEqual(resubscribe["type"] as? String, "session.subscribe")
        let resubscribePayload = try XCTUnwrap(resubscribe["payload"] as? [String: Any])
        XCTAssertEqual(resubscribePayload["sessionId"] as? String, "sess_1")
        XCTAssertEqual(resubscribePayload["lastSeq"] as? Int, 7)
        XCTAssertEqual(resubscribePayload["epoch"] as? String, "epoch_a")

        await client.stop()
    }

    func testSubscribedSessionResubscribesWithoutLastSeqAfterEpochChange() async throws {
        let queue = TransportQueue()
        let first = FakeServerTransport()
        let second = FakeServerTransport()
        queue.append(first)
        queue.append(second)

        let statuses = Recorder<SystemStatus>()
        let client = makeClient(queue: queue, statuses: statuses)
        try await connect(client: client, transport: first, epoch: "epoch_a")

        let subscribeTask = Task {
            try await client.subscribeSession(sessionId: "sess_1")
        }
        let subscribeRequest = JSONFixture.decode(try await first.nextSent())
        await first.push(
            Self.sessionSubscribeResponse(
                replyTo: try XCTUnwrap(subscribeRequest["id"] as? String),
                sessionId: "sess_1",
                seq: 7,
                epoch: "epoch_a",
                resyncRequired: true,
                snapshot: Self.sessionSnapshot(sessionId: "sess_1")
            )
        )
        _ = try await subscribeTask.value

        // 新 epoch：不帶 lastSeq，要求完整快照。
        await first.serverClosed()
        let hello2 = JSONFixture.decode(try await second.nextSent())
        await second.push(
            JSONFixture.helloResponse(
                replyTo: try XCTUnwrap(hello2["id"] as? String),
                epoch: "epoch_b"
            )
        )
        let subscribeSystem2 = JSONFixture.decode(try await second.nextSent())
        await second.push(
            JSONFixture.systemSubscribeResponse(
                replyTo: try XCTUnwrap(subscribeSystem2["id"] as? String),
                seq: 1,
                epoch: "epoch_b",
                resyncRequired: true,
                snapshot: JSONFixture.systemStatus()
            )
        )
        let resubscribe = JSONFixture.decode(try await second.nextSent())
        XCTAssertEqual(resubscribe["type"] as? String, "session.subscribe")
        let resubscribePayload = try XCTUnwrap(resubscribe["payload"] as? [String: Any])
        XCTAssertEqual(resubscribePayload["sessionId"] as? String, "sess_1")
        XCTAssertNil(resubscribePayload["lastSeq"], "epoch 換代後不能帶 lastSeq")
        XCTAssertNil(resubscribePayload["epoch"], "epoch 換代後不能帶舊 epoch")

        await client.stop()
    }

    // MARK: - 事件回呼

    func testSessionEventHandlerReceivesEventsButNotResponses() async throws {
        let queue = TransportQueue()
        let transport = FakeServerTransport()
        queue.append(transport)
        let statuses = Recorder<SystemStatus>()
        let frames = Recorder<ServerFrame>()
        let client = makeClient(queue: queue, statuses: statuses)
        client.handlers.onSessionEvent = { frame in
            frames.append(frame)
        }
        try await connect(client: client, transport: transport, epoch: "epoch_a")

        await transport.push(Self.textDeltaEvent(sessionId: "sess_1", seq: 9, delta: "你"))
        try await waitUntil { frames.snapshot.count == 1 }

        // 完成一次請求／回應：回應不能被轉交給 onSessionEvent。
        let getTask = Task {
            try await client.getModels()
        }
        let getRequest = JSONFixture.decode(try await transport.nextSent())
        await transport.push(
            Self.response(
                type: "system.models.get",
                replyTo: try XCTUnwrap(getRequest["id"] as? String),
                payload: Self.modelsState(roleMode: "unset")
            )
        )
        _ = try await getTask.value

        // 事件依序轉交：回應若被當成事件，它會排在標記事件之前。
        // 等標記事件到手，就能確定回應沒有進 onSessionEvent。
        await transport.push(Self.textDeltaEvent(sessionId: "sess_1", seq: 10, delta: "標記"))
        try await waitUntil { frames.snapshot.count == 2 }
        XCTAssertEqual(frames.snapshot.count, 2)
        switch frames.snapshot[0] {
        case .streamTextDeltaEvent(let event):
            XCTAssertEqual(event.payload.delta, "你")
            XCTAssertEqual(event.stream, "session:sess_1")
        default:
            XCTFail("onSessionEvent 收到非事件 frame")
        }
        switch frames.snapshot[1] {
        case .streamTextDeltaEvent(let event):
            XCTAssertEqual(event.payload.delta, "標記")
        default:
            XCTFail("onSessionEvent 收到非事件 frame")
        }

        await client.stop()
    }

    func testApprovalCallbacksCarrySnapshotAndEvents() async throws {
        let queue = TransportQueue()
        let transport = FakeServerTransport()
        queue.append(transport)
        let statuses = Recorder<SystemStatus>()
        let approvals = Recorder<[ApprovalRequest]>()
        let client = makeClient(queue: queue, statuses: statuses)
        client.handlers.onApprovals = { approvals.append($0) }
        try await connect(client: client, transport: transport, epoch: "epoch_a")

        // 訂閱會話：快照帶著主機目前的待審批，重連不必等補送事件。
        let subscribeTask = Task {
            try await client.subscribeSession(sessionId: "sess_1")
        }
        let subscribeRequest = JSONFixture.decode(try await transport.nextSent())
        await transport.push(
            Self.sessionSubscribeResponse(
                replyTo: try XCTUnwrap(subscribeRequest["id"] as? String),
                sessionId: "sess_1",
                seq: 7,
                epoch: "epoch_a",
                resyncRequired: true,
                snapshot: Self.sessionSnapshot(
                    sessionId: "sess_1",
                    pendingApproval: Self.approvalPayload(id: "appr_1")
                )
            )
        )
        _ = try await subscribeTask.value
        try await waitUntil { approvals.snapshot.last?.map(\.approvalId) == ["appr_1"] }
        let fromSnapshot = await client.pendingApprovals
        XCTAssertEqual(fromSnapshot.map(\.approvalId), ["appr_1"])
        XCTAssertEqual(fromSnapshot.first?.scope.target, "write_file")

        // 新的一筆進入；先前那一筆被決定後離開。
        await transport.push(
            Self.approvalEvent(
                type: "approval.requested",
                payload: Self.approvalPayload(id: "appr_2"),
                seq: 8
            )
        )
        try await waitUntil { approvals.snapshot.last?.count == 2 }
        await transport.push(
            Self.approvalEvent(
                type: "approval.decided",
                payload: [
                    "approvalId": "appr_1",
                    "sessionId": "sess_1",
                    "effect": "approve",
                    "decidedAt": "2026-11-15T00:00:04Z",
                    "decidedBy": ["kind": "client"],
                ],
                seq: 9
            )
        )
        try await waitUntil { approvals.snapshot.last?.map(\.approvalId) == ["appr_2"] }

        await client.stop()
    }

    func testEpochChangeHandlerFiresOnReconnectWithDifferentEpoch() async throws {
        let queue = TransportQueue()
        let first = FakeServerTransport()
        let second = FakeServerTransport()
        queue.append(first)
        queue.append(second)

        let statuses = Recorder<SystemStatus>()
        let epochs = Recorder<String>()
        let client = makeClient(queue: queue, statuses: statuses)
        client.handlers.onEpochChange = { epoch in
            epochs.append(epoch)
        }
        try await connect(client: client, transport: first, epoch: "epoch_a")
        XCTAssertEqual(epochs.snapshot, [], "第一次連線不算 epoch 換代")

        await first.serverClosed()
        let hello2 = JSONFixture.decode(try await second.nextSent())
        await second.push(
            JSONFixture.helloResponse(
                replyTo: try XCTUnwrap(hello2["id"] as? String),
                epoch: "epoch_b"
            )
        )
        let subscribeSystem2 = JSONFixture.decode(try await second.nextSent())
        await second.push(
            JSONFixture.systemSubscribeResponse(
                replyTo: try XCTUnwrap(subscribeSystem2["id"] as? String),
                seq: 1,
                epoch: "epoch_b",
                resyncRequired: true,
                snapshot: JSONFixture.systemStatus()
            )
        )
        try await waitUntil { epochs.snapshot == ["epoch_b"] }

        await client.stop()
    }

    func testEpochChangeHandlerFiresAfterForcedResyncInSameEpoch() async throws {
        let queue = TransportQueue()
        let first = FakeServerTransport()
        let second = FakeServerTransport()
        queue.append(first)
        queue.append(second)

        let statuses = Recorder<SystemStatus>()
        let epochs = Recorder<String>()
        let client = makeClient(queue: queue, statuses: statuses)
        client.handlers.onEpochChange = { epoch in
            epochs.append(epoch)
        }
        try await connect(client: client, transport: first, epoch: "epoch_a")
        _ = try await statuses.waitForFirst()

        // 序號跳號（5 → 7）：client 要求重新載入快照並重連。
        await first.push(
            JSONFixture.systemStatusEvent(seq: 7, status: JSONFixture.systemStatus(uptime: 7))
        )
        let hello2 = JSONFixture.decode(try await second.nextSent())
        await second.push(
            JSONFixture.helloResponse(
                replyTo: try XCTUnwrap(hello2["id"] as? String),
                epoch: "epoch_a"
            )
        )
        let subscribeSystem2 = JSONFixture.decode(try await second.nextSent())
        await second.push(
            JSONFixture.systemSubscribeResponse(
                replyTo: try XCTUnwrap(subscribeSystem2["id"] as? String),
                seq: 9,
                epoch: "epoch_a",
                resyncRequired: true,
                snapshot: JSONFixture.systemStatus(uptime: 9)
            )
        )
        try await waitUntil { epochs.snapshot == ["epoch_a"] }

        await client.stop()
    }

    // MARK: - 列表翻頁

    func testListAllSessionsPagesUntilNextCursorIsNil() async throws {
        let queue = TransportQueue()
        let transport = FakeServerTransport()
        queue.append(transport)
        let statuses = Recorder<SystemStatus>()
        let client = makeClient(queue: queue, statuses: statuses)
        try await connect(client: client, transport: transport, epoch: "epoch_a")

        let task = Task {
            try await client.listAllSessions()
        }

        // 第一頁：無 cursor；第二頁：帶 page_2；第三頁：帶 page_3，回傳無 nextCursor。
        let firstPage = JSONFixture.decode(try await transport.nextSent())
        let firstPayload = try XCTUnwrap(firstPage["payload"] as? [String: Any])
        XCTAssertNil(firstPayload["cursor"])
        XCTAssertEqual(firstPayload["limit"] as? Int, 50)
        await transport.push(
            Self.listResponse(
                replyTo: try XCTUnwrap(firstPage["id"] as? String),
                summaries: [Self.sessionSummary(id: "sess_1"), Self.sessionSummary(id: "sess_2")],
                nextCursor: "page_2"
            )
        )

        let secondPage = JSONFixture.decode(try await transport.nextSent())
        let secondPayload = try XCTUnwrap(secondPage["payload"] as? [String: Any])
        XCTAssertEqual(secondPayload["cursor"] as? String, "page_2")
        await transport.push(
            Self.listResponse(
                replyTo: try XCTUnwrap(secondPage["id"] as? String),
                summaries: [Self.sessionSummary(id: "sess_3"), Self.sessionSummary(id: "sess_4")],
                nextCursor: "page_3"
            )
        )

        let thirdPage = JSONFixture.decode(try await transport.nextSent())
        let thirdPayload = try XCTUnwrap(thirdPage["payload"] as? [String: Any])
        XCTAssertEqual(thirdPayload["cursor"] as? String, "page_3")
        await transport.push(
            Self.listResponse(
                replyTo: try XCTUnwrap(thirdPage["id"] as? String),
                summaries: [Self.sessionSummary(id: "sess_5")],
                nextCursor: nil
            )
        )

        let sessions = try await task.value
        XCTAssertEqual(sessions.map(\.id), ["sess_1", "sess_2", "sess_3", "sess_4", "sess_5"])

        await client.stop()
    }

    func testListAllSessionsStopsAtPageCapWhenCursorNeverEnds() async throws {
        let queue = TransportQueue()
        let transport = FakeServerTransport()
        queue.append(transport)
        let statuses = Recorder<SystemStatus>()
        let client = makeClient(queue: queue, statuses: statuses)
        try await connect(client: client, transport: transport, epoch: "epoch_a")

        let task = Task {
            try await client.listAllSessions()
        }
        // 主機一直回 nextCursor：翻頁必須在 20 頁停下，不能無限迴圈。
        for index in 1...20 {
            let sent = JSONFixture.decode(try await transport.nextSent())
            let payload = try XCTUnwrap(sent["payload"] as? [String: Any])
            if index == 1 {
                XCTAssertNil(payload["cursor"])
            } else {
                XCTAssertEqual(payload["cursor"] as? String, "again")
            }
            await transport.push(
                Self.listResponse(
                    replyTo: try XCTUnwrap(sent["id"] as? String),
                    summaries: [Self.sessionSummary(id: "sess_\(index)")],
                    nextCursor: "again"
                )
            )
        }
        let sessions = try await task.value
        XCTAssertEqual(sessions.count, 20, "頁數上限 20：不能讓主機的錯誤游標拖垮客戶端")

        await client.stop()
    }

    // MARK: - 共用 fixture

    private func waitUntil(
        timeout: TimeInterval = 3,
        _ condition: @Sendable () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return }
            try await Task.sleep(nanoseconds: 2_000_000)
        }
        XCTFail("等待條件逾時")
    }

    private static func response(type: String, replyTo: String, payload: [String: Any]) -> String {
        JSONFixture.string([
            "v": 1,
            "kind": "response",
            "replyTo": replyTo,
            "type": type,
            "payload": payload,
        ])
    }

    private static func userEntry(id: String, turnId: String, text: String) -> [String: Any] {
        [
            "id": id,
            "role": "user",
            "turnId": turnId,
            "createdAt": "2026-11-15T00:00:00Z",
            "text": text,
        ]
    }

    private static func assistantEntry(id: String, turnId: String, text: String) -> [String: Any] {
        [
            "id": id,
            "role": "assistant",
            "turnId": turnId,
            "createdAt": "2026-11-15T00:00:01Z",
            "text": text,
            "status": "complete",
        ]
    }

    private static func getHistoryResponse(
        replyTo: String,
        entries: [[String: Any]],
        nextCursor: String?
    ) -> String {
        var payload: [String: Any] = ["entries": entries]
        payload["nextCursor"] = nextCursor
        return response(type: "session.get_history", replyTo: replyTo, payload: payload)
    }

    private static func sessionSummary(id: String, status: String = "idle") -> [String: Any] {
        [
            "id": id,
            "title": "測試對話 \(id)",
            "status": status,
            "createdAt": "2026-11-15T00:00:00Z",
            "updatedAt": "2026-11-15T00:00:00Z",
            "messageCount": 3,
        ]
    }

    private static func sessionSnapshot(
        sessionId: String,
        pendingApproval: [String: Any]? = nil
    ) -> [String: Any] {
        var snapshot: [String: Any] = [
            "session": sessionSummary(id: sessionId, status: "running"),
            "entries": [],
        ]
        snapshot["pendingApproval"] = pendingApproval
        return snapshot
    }

    private static func approvalPayload(id: String, sessionId: String = "sess_1") -> [String: Any] {
        [
            "approvalId": id,
            "sessionId": sessionId,
            "turnId": "turn_1",
            "title": "寫入檔案",
            "summary": "代理想寫入 notes.md",
            "scope": ["kind": "tool_call", "target": "write_file"],
            "options": [
                ["id": "approve", "label": "核准", "effect": "approve"],
                ["id": "reject", "label": "拒絕", "effect": "reject"],
            ],
            "requestedAt": "2026-11-15T00:00:03Z",
        ]
    }

    private static func approvalEvent(type: String, payload: [String: Any], seq: Int) -> String {
        JSONFixture.string([
            "v": 1,
            "kind": "event",
            "type": type,
            "stream": "session:sess_1",
            "seq": seq,
            "emittedAt": "2026-11-15T00:00:03Z",
            "payload": payload,
        ])
    }

    private static func sessionSubscribeResponse(
        replyTo: String,
        sessionId: String,
        seq: Int,
        epoch: String,
        resyncRequired: Bool,
        snapshot: [String: Any]?
    ) -> String {
        var payload: [String: Any] = [
            "sessionId": sessionId,
            "stream": "session:\(sessionId)",
            "seq": seq,
            "epoch": epoch,
            "resyncRequired": resyncRequired,
        ]
        payload["snapshot"] = snapshot
        return response(type: "session.subscribe", replyTo: replyTo, payload: payload)
    }

    private static func listResponse(
        replyTo: String,
        summaries: [[String: Any]],
        nextCursor: String?
    ) -> String {
        var payload: [String: Any] = ["sessions": summaries]
        payload["nextCursor"] = nextCursor
        return response(type: "session.list", replyTo: replyTo, payload: payload)
    }

    private static func modelsState(roleMode: String, smallRole: Bool = false) -> [String: Any] {
        var roles: [[String: Any]] = [
            ["role": "main", "mode": roleMode, "ref": ["providerId": "prov_main", "modelId": "model-big"]],
        ]
        if smallRole {
            roles.append(["role": "small", "mode": "model", "ref": ["providerId": "prov_main", "modelId": "model-small"]])
        }
        return [
            "providers": [
                [
                    "providerId": "prov_main",
                    "kind": "api-key",
                    "displayName": "主要供應商",
                    "credentialRef": "keychain://models/prov_main",
                    "models": [
                        [
                            "modelId": "model-big",
                            "displayName": "大模型",
                            "contextWindow": 200_000,
                            "maxOutputTokens": 8192,
                            "input": ["text"],
                        ],
                        [
                            "modelId": "model-small",
                            "displayName": "小模型",
                            "contextWindow": 32_000,
                            "maxOutputTokens": 4096,
                            "input": ["text"],
                        ],
                    ],
                ],
            ],
            "roles": roles,
            "resolved": [
                ["role": "main", "source": "configured", "ref": ["providerId": "prov_main", "modelId": "model-big"]],
            ],
        ]
    }

    private static func settingItem(key: String, value: String) -> [String: Any] {
        [
            "key": key,
            "value": value,
            "level": "free",
            "updatedAt": "2026-11-15T00:00:00Z",
        ]
    }

    private static func moduleInfo(moduleId: String, enabled: Bool) -> [String: Any] {
        [
            "moduleId": moduleId,
            "name": "卡片模組",
            "version": "1.0.0",
            "enabled": enabled,
            "state": "active",
            "protocolPrefixes": ["cards."],
            "settings": [],
        ]
    }

    private static func textDeltaEvent(sessionId: String, seq: Int, delta: String) -> String {
        JSONFixture.string([
            "v": 1,
            "kind": "event",
            "type": "stream.text_delta",
            "stream": "session:\(sessionId)",
            "seq": seq,
            "emittedAt": "2026-11-15T00:00:02Z",
            "payload": [
                "sessionId": sessionId,
                "turnId": "turn_1",
                "messageId": "msg_1",
                "delta": delta,
            ],
        ])
    }
}
