import Foundation
import XCTest

@testable import CardiaryShellCore

/// 私有控制通道的配對路由白名單與通知解析。
final class PairingControlTests: XCTestCase {
    func testControlRoutesIncludePairingAndDevices() {
        XCTAssertTrue(ControlRoute.controlRoutes.contains(ControlRoute.pairingApprove))
        XCTAssertTrue(ControlRoute.controlRoutes.contains(ControlRoute.pairingDeny))
        XCTAssertTrue(ControlRoute.controlRoutes.contains(ControlRoute.devicesList))
        XCTAssertTrue(ControlRoute.controlRoutes.contains(ControlRoute.devicesRevoke))
        XCTAssertTrue(ControlRoute.notificationRoutes.contains(ControlRoute.notifyPairingRequested))
        XCTAssertEqual(ControlRoute.controlRoutes.count, 8)
        XCTAssertEqual(ControlRoute.notificationRoutes.count, 3)
    }

    func testEncodesPairingDecisionRequest() throws {
        let data = try ControlFrameEncoder.request(
            id: "ctl-1",
            route: ControlRoute.pairingApprove,
            token: ControlToken(value: "t"),
            payload: .object(["pairingRequestId": .string("pair-1")])
        )
        let envelope = try ControlFrameDecoder.envelope(data, maxFrameBytes: 65_536)
        XCTAssertEqual(envelope.route, ControlRoute.pairingApprove)
        XCTAssertEqual(envelope.payload?["pairingRequestId"]?.stringValue, "pair-1")
    }

    func testParsesDeviceListResponse() throws {
        let json = """
        {"v":1,"kind":"response","id":"r-1","replyTo":"ctl-1","ok":true,\
        "auth":{"token":"t"},"payload":{"devices":[\
        {"deviceId":"dev-1","deviceName":"MacBook","deviceKind":"web",\
        "fingerprint":"aa:bb","createdAt":"2026-01-01T00:00:00Z"},\
        {"deviceId":"dev-2","deviceName":"iPhone","deviceKind":"ios",\
        "fingerprint":"cc:dd","createdAt":"2026-01-02T00:00:00Z",\
        "revokedAt":"2026-01-03T00:00:00Z"}]}}
        """
        let envelope = try ControlFrameDecoder.envelope(Data(json.utf8), maxFrameBytes: 65_536)
        guard case .object(let object) = envelope.payload,
            case .array(let devices) = object["devices"]
        else {
            return XCTFail("回應必須帶 devices 陣列")
        }
        XCTAssertEqual(devices.count, 2)
        guard case .string(let name) = devices[0].object?["deviceName"] else {
            return XCTFail("第一台裝置要有名稱")
        }
        XCTAssertEqual(name, "MacBook")
    }
}

private extension JSONValue {
    var object: [String: JSONValue]? {
        if case .object(let value) = self { return value }
        return nil
    }
}
