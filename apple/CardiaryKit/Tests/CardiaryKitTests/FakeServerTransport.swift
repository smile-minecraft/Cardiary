import Foundation
import XCTest

@testable import CardiaryKit

/// 測試用的傳輸層：測試扮演主機，檢查客戶端送出的訊息並推入回應。
///
/// 以短間隔輪詢取代 continuation，讓測試的時序單純、不受鎖與 actor 邊界影響。
actor FakeServerTransport: CardiaryTransport {
    private var sent: [String] = []
    private var outgoing: [String] = []
    private var closed = false

    func send(_ text: String) async throws {
        guard !closed else { throw CardiaryClientError.connectionClosed }
        sent.append(text)
    }

    func receive() async throws -> String? {
        while true {
            if !outgoing.isEmpty {
                return outgoing.removeFirst()
            }
            if closed {
                return nil
            }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
    }

    func close() async {
        closed = true
    }

    /// 等客戶端送出一則訊息。
    func nextSent(timeout: TimeInterval = 3) async throws -> String {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if !sent.isEmpty {
                return sent.removeFirst()
            }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        throw CardiaryClientError.timeout
    }

    /// 由測試扮演主機，推入一則訊息給客戶端。
    func push(_ text: String) {
        outgoing.append(text)
    }

    /// 模擬連線中斷。
    func serverClosed() {
        closed = true
    }
}

enum JSONFixture {
    static func string(_ object: [String: Any]) -> String {
        let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        return String(data: data, encoding: .utf8)!
    }

    static func decode(_ text: String) -> [String: Any] {
        let data = text.data(using: .utf8)!
        return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    static func helloResponse(
        replyTo: String,
        epoch: String,
        version: Int = 1,
        min: Int = 1,
        max: Int = 1
    ) -> String {
        string([
            "v": 1,
            "kind": "response",
            "replyTo": replyTo,
            "type": "system.hello",
            "payload": [
                "protocol": ["version": version, "min": min, "max": max],
                "server": ["name": "Cardiary", "version": "0.1.0"],
                "connectionId": "conn_test",
                "limits": ["maxFrameBytes": 1_048_576, "replayWindow": 512, "heartbeatSeconds": 20],
                "capabilities": ["modules": true, "files": true],
                "epoch": epoch,
            ],
        ])
    }

    static func systemSubscribeResponse(
        replyTo: String,
        seq: Int,
        epoch: String,
        resyncRequired: Bool,
        snapshot: [String: Any]? = nil
    ) -> String {
        var payload: [String: Any] = [
            "stream": "system",
            "seq": seq,
            "epoch": epoch,
            "resyncRequired": resyncRequired,
        ]
        payload["snapshot"] = snapshot
        return string([
            "v": 1,
            "kind": "response",
            "replyTo": replyTo,
            "type": "system.subscribe",
            "payload": payload,
        ])
    }

    static func systemStatus(
        folderState: String = "ready",
        serviceState: String = "running",
        displayName: String = "Cardiary",
        writable: Bool = true,
        reason: String? = nil,
        uptime: Int = 5
    ) -> [String: Any] {
        var folder: [String: Any] = [
            "state": folderState,
            "displayName": displayName,
            "writable": writable,
        ]
        folder["reason"] = reason
        return [
            "folder": folder,
            "service": [
                "state": serviceState,
                "version": "0.1.0",
                "uptimeSeconds": uptime,
                "activeTasks": 0,
            ],
        ]
    }

    static func systemStatusEvent(seq: Int, status: [String: Any], stream: String = "system") -> String {
        string([
            "v": 1,
            "kind": "event",
            "type": "system.status",
            "stream": stream,
            "seq": seq,
            "emittedAt": "2026-11-14T10:00:00Z",
            "payload": status,
        ])
    }

    static func errorFrame(
        replyTo: String?,
        code: String,
        details: [String: Any]? = nil
    ) -> String {
        var object: [String: Any] = [
            "v": 1,
            "kind": "error",
            "code": code,
            "message": "測試錯誤",
            "retryable": false,
        ]
        object["replyTo"] = replyTo
        object["details"] = details
        return string(object)
    }
}
