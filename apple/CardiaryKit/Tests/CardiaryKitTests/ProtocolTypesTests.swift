import XCTest

import CardiaryKit

final class ProtocolTypesTests: XCTestCase {
    func testDocumentProtocolExamplesDecodeAndRoundTrip() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("packages/protocol/examples/protocol-examples.json"))
        let examples = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: [String: Any]])
        let names = [
            "cardPatchesListRequest", "cardPatchesListResponse", "cardPatchAcceptRequest", "cardPatchAcceptResponse",
            "cardPatchRejectRequest", "cardPatchRejectResponse", "cardVersionsListRequest", "cardVersionsListResponse",
            "cardVersionGetRequest", "cardVersionGetResponse", "cardVersionRestoreRequest", "cardVersionRestoreResponse",
        ]
        for name in names {
            let example = try XCTUnwrap(examples[name], name)
            let input = try JSONSerialization.data(withJSONObject: example, options: [.sortedKeys])
            let output: Data
            if example["kind"] as? String == "request" {
                output = try JSONEncoder().encode(JSONDecoder().decode(ClientFrame.self, from: input))
            } else {
                output = try JSONEncoder().encode(JSONDecoder().decode(ServerFrame.self, from: input))
            }
            let actual = try XCTUnwrap(JSONSerialization.jsonObject(with: output) as? NSDictionary)
            XCTAssertEqual(actual, example as NSDictionary, name)
        }
    }

    func testDecodesHelloRequest() throws {
        let json = """
        {
          "v": 1,
          "kind": "request",
          "id": "req_hello_1",
          "type": "system.hello",
          "payload": {
            "auth": { "token": "secret" },
            "protocol": { "min": 1, "max": 1 },
            "client": {
              "name": "Cardiary macOS",
              "version": "0.1.0",
              "platform": "macos",
              "instanceId": "inst_mac_1"
            },
            "resume": { "systemSeq": 41 }
          }
        }
        """

        let frame = try JSONDecoder().decode(ClientFrame.self, from: Data(json.utf8))
        guard case .systemHelloRequest(let request) = frame else {
            return XCTFail("預期 system.hello 請求")
        }

        XCTAssertEqual(request.id, "req_hello_1")
        XCTAssertEqual(request.payload.client.platform, .macos)
        XCTAssertEqual(request.payload.resume?.systemSeq, 41)
        XCTAssertEqual(request.payload.auth?.token, "secret")
    }

    func testDecodesApprovalRequestedEvent() throws {
        let json = """
        {
          "v": 1,
          "kind": "event",
          "type": "approval.requested",
          "stream": "session:sess_1",
          "seq": 23,
          "emittedAt": "2026-11-14T10:07:05Z",
          "payload": {
            "approvalId": "appr_1",
            "sessionId": "sess_1",
            "turnId": "turn_1",
            "toolCallId": "call_1",
            "title": "執行指令前需要核准",
            "summary": "pnpm check",
            "scope": { "kind": "tool_call", "target": "bash", "detail": { "cwd": "." } },
            "options": [
              { "id": "approve", "label": "核准一次", "effect": "approve" },
              { "id": "reject", "label": "拒絕", "effect": "reject" }
            ],
            "requestedAt": "2026-11-14T10:07:05Z",
            "sourceScheduleName": "每日摘要"
          }
        }
        """

        let frame = try JSONDecoder().decode(ServerFrame.self, from: Data(json.utf8))
        guard case .approvalRequestedEvent(let event) = frame else {
            return XCTFail("預期 approval.requested 事件")
        }

        XCTAssertEqual(event.seq, 23)
        XCTAssertEqual(event.payload.options.count, 2)
        XCTAssertEqual(event.payload.options.first?.effect, .approve)
        XCTAssertEqual(event.payload.scope.kind, .toolCall)
        XCTAssertEqual(event.payload.sourceScheduleName, "每日摘要")
    }

    func testDecodesToolResultWithInterruptedDiagnostic() throws {
        let json = """
        {
          "v": 1,
          "kind": "event",
          "type": "stream.tool_result",
          "stream": "session:sess_1",
          "seq": 24,
          "emittedAt": "2026-11-14T10:07:08Z",
          "payload": {
            "sessionId": "sess_1",
            "turnId": "turn_1",
            "toolCallId": "call_1",
            "status": "error",
            "output": { "text": "指令被中斷", "truncated": false },
            "diagnostics": [
              { "code": "interrupted", "message": "主機重啟時工具正在執行" }
            ]
          }
        }
        """

        let frame = try JSONDecoder().decode(ServerFrame.self, from: Data(json.utf8))
        guard case .streamToolResultEvent(let event) = frame else {
            return XCTFail("預期 stream.tool_result 事件")
        }

        XCTAssertEqual(event.payload.status, .error)
        XCTAssertEqual(event.payload.diagnostics.first?.code, "interrupted")
    }

    func testDecodesModuleEvent() throws {
        let json = """
        {
          "v": 1,
          "kind": "event",
          "type": "module.cards.changed",
          "stream": "system",
          "seq": 44,
          "emittedAt": "2026-11-14T10:09:00Z",
          "payload": {
            "data": { "cardId": "card_1", "change": "updated" },
            "schemaVersion": "1"
          }
        }
        """

        let frame = try JSONDecoder().decode(ServerFrame.self, from: Data(json.utf8))
        guard case .moduleEvent(let event) = frame else {
            return XCTFail("預期 module 事件")
        }

        XCTAssertEqual(event.type, "module.cards.changed")
        XCTAssertEqual(event.payload.schemaVersion, "1")
    }

    func testRoundTripsSessionSendMessageRequest() throws {
        let request = SessionSendMessageRequest(
            id: "req_send_test",
            payload: SessionSendMessageRequestPayload(
                sessionId: "sess_1",
                text: "先定信封",
                delivery: .queue
            )
        )

        let data = try JSONEncoder().encode(request)
        let frame = try JSONDecoder().decode(ClientFrame.self, from: data)
        XCTAssertEqual(frame, .sessionSendMessageRequest(request))
    }

    func testDecodesIncompatibleVersionError() throws {
        let json = """
        {
          "v": 1,
          "kind": "error",
          "replyTo": "req_hello_1",
          "code": "incompatible_version",
          "message": "沒有共同的協定版本。",
          "details": { "serverMin": 1, "serverMax": 1 },
          "retryable": false
        }
        """

        let frame = try JSONDecoder().decode(ServerFrame.self, from: Data(json.utf8))
        guard case .errorFrame(let error) = frame else {
            return XCTFail("預期錯誤影格")
        }

        XCTAssertEqual(error.code, .incompatibleVersion)
        XCTAssertEqual(error.retryable, false)
    }

    func testDecodesHelloResponseWithEpoch() throws {
        let json = """
        {
          "v": 1,
          "kind": "response",
          "replyTo": "req_hello_1",
          "type": "system.hello",
          "payload": {
            "protocol": { "version": 1, "min": 1, "max": 1 },
            "server": { "name": "Cardiary", "version": "0.1.0" },
            "connectionId": "conn_1",
            "limits": { "maxFrameBytes": 1048576, "replayWindow": 512, "heartbeatSeconds": 20 },
            "capabilities": { "modules": true, "files": true },
            "epoch": "epoch_1"
          }
        }
        """

        let frame = try JSONDecoder().decode(ServerFrame.self, from: Data(json.utf8))
        guard case .systemHelloResponse(let response) = frame else {
            return XCTFail("預期 system.hello 回應")
        }

        XCTAssertEqual(response.payload.epoch, "epoch_1")
    }

    func testDecodesSessionSubscribeResponseWithStreaming() throws {
        let json = """
        {
          "v": 1,
          "kind": "response",
          "replyTo": "req_sub_1",
          "type": "session.subscribe",
          "payload": {
            "sessionId": "sess_1",
            "stream": "session:sess_1",
            "seq": 18,
            "epoch": "epoch_1",
            "resyncRequired": true,
            "snapshot": {
              "session": {
                "id": "sess_1",
                "title": "協定設計討論",
                "status": "running",
                "createdAt": "2026-11-14T10:06:00Z",
                "updatedAt": "2026-11-14T10:07:20Z",
                "messageCount": 1
              },
              "entries": [],
              "streaming": {
                "messageId": "msg_1",
                "turnId": "turn_1",
                "text": "我先確認資料夾狀態，",
                "startedAt": "2026-11-14T10:07:01Z",
                "truncated": false
              }
            }
          }
        }
        """

        let frame = try JSONDecoder().decode(ServerFrame.self, from: Data(json.utf8))
        guard case .sessionSubscribeResponse(let response) = frame else {
            return XCTFail("預期 session.subscribe 回應")
        }

        XCTAssertEqual(response.payload.epoch, "epoch_1")
        let streaming = try XCTUnwrap(response.payload.snapshot?.streaming)
        XCTAssertEqual(streaming.messageId, "msg_1")
        XCTAssertEqual(streaming.turnId, "turn_1")
        XCTAssertEqual(streaming.text, "我先確認資料夾狀態，")
        XCTAssertEqual(streaming.truncated, false)
    }

    func testDecodesSessionSubscribeRequestWithoutEpoch() throws {
        let json = """
        {
          "v": 1,
          "kind": "request",
          "id": "req_sub_1",
          "type": "session.subscribe",
          "payload": { "sessionId": "sess_1" }
        }
        """

        let frame = try JSONDecoder().decode(ClientFrame.self, from: Data(json.utf8))
        guard case .sessionSubscribeRequest(let request) = frame else {
            return XCTFail("預期 session.subscribe 請求")
        }

        XCTAssertNil(request.payload.epoch)
        XCTAssertNil(request.payload.lastSeq)
    }
}
