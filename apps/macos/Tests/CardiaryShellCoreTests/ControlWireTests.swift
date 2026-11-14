import Foundation
import XCTest

@testable import CardiaryShellCore

final class ControlWireTests: XCTestCase {
    func testDecodesReadyMessage() throws {
        let json = """
        {"type":"ready","protocol":1,"pid":4711,"clientPort":52341,\
        "folderId":"01JCX8Q3W7Z9K5V2N4M6P8R0T1","epoch":"01JCX8Q3W7Z9K5V2N4M6P8R0T2"}
        """
        let ready = try ControlFrameDecoder.ready(Data(json.utf8), maxFrameBytes: 65_536)
        XCTAssertEqual(ready.pid, 4711)
        XCTAssertEqual(ready.clientPort, 52_341)
        XCTAssertEqual(ready.epoch, "01JCX8Q3W7Z9K5V2N4M6P8R0T2")
    }

    func testRejectsWrongProtocolVersion() {
        let json = """
        {"type":"ready","protocol":2,"pid":4711,"clientPort":52341,\
        "folderId":"f","epoch":"e"}
        """
        XCTAssertThrowsError(try ControlFrameDecoder.ready(Data(json.utf8), maxFrameBytes: 65_536)) {
            XCTAssertEqual($0 as? EnvelopeError, EnvelopeError(.unsupportedVersion(2)))
        }
    }

    func testRejectsOversizeFrame() {
        let data = Data(String(repeating: "x", count: 100).utf8)
        XCTAssertThrowsError(try ControlFrameDecoder.envelope(data, maxFrameBytes: 50)) {
            XCTAssertEqual($0 as? EnvelopeError, EnvelopeError(.frameTooLarge(limit: 50, actual: 100)))
        }
    }

    func testRejectsUnknownKindAndMissingVersion() throws {
        let unknown = Data(#"{"v":1,"kind":"bogus"}"#.utf8)
        XCTAssertThrowsError(try ControlFrameDecoder.envelope(unknown, maxFrameBytes: 65_536)) {
            XCTAssertEqual($0 as? EnvelopeError, EnvelopeError(.unknownKind("bogus")))
        }

        let missing = Data(#"{"kind":"hello"}"#.utf8)
        XCTAssertThrowsError(try ControlFrameDecoder.envelope(missing, maxFrameBytes: 65_536)) {
            XCTAssertEqual($0 as? EnvelopeError, EnvelopeError(.missingField("v")))
        }

        let wrongVersion = Data(#"{"v":2,"kind":"hello"}"#.utf8)
        XCTAssertThrowsError(try ControlFrameDecoder.envelope(wrongVersion, maxFrameBytes: 65_536)) {
            XCTAssertEqual($0 as? EnvelopeError, EnvelopeError(.unsupportedVersion(2)))
        }
    }

    func testDecodesHelloEnvelopeWithAuth() throws {
        let broker = ControlToken.generate()
        let json = """
        {"v":1,"kind":"hello","role":"host-service","pid":4711,"auth":{"token":"\(broker.value)"}}
        """
        let envelope = try ControlFrameDecoder.envelope(Data(json.utf8), maxFrameBytes: 65_536)
        XCTAssertEqual(envelope.kind, .hello)
        XCTAssertEqual(envelope.role, "host-service")
        XCTAssertEqual(envelope.pid, 4711)
        XCTAssertEqual(envelope.token, broker.value)
    }

    func testDecodesResponseWithErrorPayload() throws {
        let json = """
        {"v":1,"kind":"response","id":"ctl_1","replyTo":"ctl_1","auth":{"token":"t"},\
        "ok":false,"error":{"code":"busy","message":"忙碌","retryable":true}}
        """
        let envelope = try ControlFrameDecoder.envelope(Data(json.utf8), maxFrameBytes: 65_536)
        XCTAssertEqual(envelope.ok, false)
        XCTAssertEqual(envelope.error?.code, .busy)
        XCTAssertEqual(envelope.error?.retryable, true)
    }

    func testEncodedFramesCarryTheirOwnToken() throws {
        let control = ControlToken.generate()
        let request = try ControlFrameEncoder.request(
            id: "ctl_1",
            route: ControlRoute.health,
            token: control
        )
        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: request) as? [String: Any]
        )
        XCTAssertEqual(object["kind"] as? String, "request")
        XCTAssertEqual((object["auth"] as? [String: Any])?["token"] as? String, control.value)

        let ack = try ControlFrameEncoder.helloAck(token: control)
        let ackObject = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: ack) as? [String: Any]
        )
        XCTAssertEqual(ackObject["kind"] as? String, "hello-ack")
        XCTAssertEqual(ackObject["role"] as? String, "shell")
        XCTAssertEqual((ackObject["auth"] as? [String: Any])?["token"] as? String, control.value)
    }

    func testRouteWhitelistsAreExact() {
        XCTAssertTrue(ControlRoute.brokerRoutes.contains("broker.keychain.get"))
        XCTAssertFalse(ControlRoute.brokerRoutes.contains("broker.keychain.list"))
        XCTAssertFalse(ControlRoute.brokerRoutes.contains("broker.keychain"))
        XCTAssertFalse(ControlRoute.notificationRoutes.contains("notify.anything"))
        XCTAssertTrue(ControlRoute.controlRoutes.contains("control.shutdown"))
        XCTAssertFalse(ControlRoute.controlRoutes.contains("control.health.extra"))
    }
}
