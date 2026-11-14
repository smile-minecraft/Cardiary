import Foundation
import XCTest

@testable import CardiaryKit

final class CardiaryConnectionTests: XCTestCase {
    private func makeConnection(
        transport: FakeServerTransport,
        token: String = "client-token"
    ) -> CardiaryConnection {
        CardiaryConnection(transport: transport, clientToken: token)
    }

    private let clientInfo = ClientInfo(
        name: "Cardiary macOS",
        version: "0.1.0",
        platform: .macos,
        instanceId: "inst_test"
    )

    func testHelloNegotiatesVersionAndRecordsEpoch() async throws {
        let transport = FakeServerTransport()
        let connection = makeConnection(transport: transport)

        let openTask = Task { [clientInfo] in
            try await connection.open(client: clientInfo)
        }

        let sent = try await transport.nextSent()
        let request = JSONFixture.decode(sent)
        XCTAssertEqual(request["type"] as? String, "system.hello")
        XCTAssertEqual(request["kind"] as? String, "request")
        let payload = try XCTUnwrap(request["payload"] as? [String: Any])
        let auth = try XCTUnwrap(payload["auth"] as? [String: Any])
        XCTAssertEqual(auth["token"] as? String, "client-token")
        let range = try XCTUnwrap(payload["protocol"] as? [String: Any])
        XCTAssertEqual(range["min"] as? Int, 1)
        XCTAssertEqual(range["max"] as? Int, 1)
        // Token 只在訊息裡，不能出現在查詢字串或 URL。
        XCTAssertFalse(sent.contains("?token"))

        let id = try XCTUnwrap(request["id"] as? String)
        await transport.push(JSONFixture.helloResponse(replyTo: id, epoch: "epoch_alpha"))

        let handshake = try await openTask.value
        XCTAssertEqual(handshake.epoch, "epoch_alpha")
        XCTAssertEqual(handshake.negotiatedVersion, 1)
        XCTAssertEqual(handshake.serverName, "Cardiary")
        XCTAssertEqual(handshake.limits.replayWindow, 512)
        await connection.close()
    }

    func testHelloRejectsIncompatibleVersion() async throws {
        let transport = FakeServerTransport()
        let connection = makeConnection(transport: transport)

        let openTask = Task { [clientInfo] in
            try await connection.open(client: clientInfo)
        }
        let sent = try await transport.nextSent()
        let id = try XCTUnwrap(JSONFixture.decode(sent)["id"] as? String)
        await transport.push(
            JSONFixture.errorFrame(
                replyTo: id,
                code: "incompatible_version",
                details: ["serverMin": 2, "serverMax": 2]
            )
        )

        do {
            _ = try await openTask.value
            XCTFail("預期版本不符")
        } catch let error as CardiaryClientError {
            XCTAssertEqual(error, .incompatibleVersion(serverMin: 2, serverMax: 2))
        }
        await connection.close()
    }

    func testUnauthorizedErrorCarriesServerFrame() async throws {
        let transport = FakeServerTransport()
        let connection = makeConnection(transport: transport)

        let openTask = Task { [clientInfo] in
            try await connection.open(client: clientInfo)
        }
        let sent = try await transport.nextSent()
        let id = try XCTUnwrap(JSONFixture.decode(sent)["id"] as? String)
        await transport.push(JSONFixture.errorFrame(replyTo: id, code: "auth_invalid"))

        do {
            _ = try await openTask.value
            XCTFail("預期驗證失敗")
        } catch let CardiaryClientError.server(frame) {
            XCTAssertEqual(frame.code, .authInvalid)
        }
        await connection.close()
    }

    func testSystemSubscribeSendsLastSeqAndEpochWhenProvided() async throws {
        let transport = FakeServerTransport()
        let connection = makeConnection(transport: transport)
        let openTask = Task { [clientInfo] in
            try await connection.open(client: clientInfo)
        }
        let hello = JSONFixture.decode(try await transport.nextSent())
        await transport.push(
            JSONFixture.helloResponse(
                replyTo: try XCTUnwrap(hello["id"] as? String),
                epoch: "epoch_alpha"
            )
        )
        _ = try await openTask.value

        let subscribeTask = Task {
            try await connection.subscribeSystem(lastSeq: 41, epoch: "epoch_alpha")
        }
        let subscribeText = try await transport.nextSent()
        let subscribe = JSONFixture.decode(subscribeText)
        let payload = try XCTUnwrap(subscribe["payload"] as? [String: Any])
        XCTAssertEqual(payload["lastSeq"] as? Int, 41)
        XCTAssertEqual(payload["epoch"] as? String, "epoch_alpha")

        await transport.push(
            JSONFixture.systemSubscribeResponse(
                replyTo: try XCTUnwrap(subscribe["id"] as? String),
                seq: 43,
                epoch: "epoch_alpha",
                resyncRequired: false
            )
        )
        let response = try await subscribeTask.value
        XCTAssertFalse(response.resyncRequired)
        XCTAssertEqual(response.seq, 43)
        XCTAssertNil(response.snapshot)
        await connection.close()
    }

    func testUnmatchedReplyClosesConnection() async throws {
        let transport = FakeServerTransport()
        let connection = makeConnection(transport: transport)
        let openTask = Task { [clientInfo] in
            try await connection.open(client: clientInfo)
        }
        _ = try await transport.nextSent()

        // 回應對不上任何在途請求：連線應關閉，等待中的請求收到錯誤。
        await transport.push(JSONFixture.helloResponse(replyTo: "req_not_mine", epoch: "epoch_alpha"))

        do {
            _ = try await openTask.value
            XCTFail("預期連線關閉")
        } catch {
            // 預期：無論是連線關閉或協定錯誤，都不能把偽造的回應當成成功。
        }
        await connection.close()
    }

    func testTimeoutDoesNotHang() async throws {
        let transport = FakeServerTransport()
        let connection = makeConnection(transport: transport)
        let openTask = Task { [clientInfo] in
            try await connection.open(
                client: clientInfo,
                options: CardiaryConnection.RequestOptions(timeout: .milliseconds(50))
            )
        }
        _ = try await transport.nextSent()

        do {
            _ = try await openTask.value
            XCTFail("預期逾時")
        } catch let error as CardiaryClientError {
            XCTAssertEqual(error, .timeout)
        }
        await connection.close()
    }
}
