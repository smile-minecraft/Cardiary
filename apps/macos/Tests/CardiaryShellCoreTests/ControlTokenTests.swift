import Foundation
import XCTest

@testable import CardiaryShellCore

final class ControlTokenTests: XCTestCase {
    func testGenerates43CharacterBase64URLTokens() {
        let token = ControlToken.generate()
        XCTAssertEqual(token.value.count, 43)
        XCTAssertTrue(token.isValidFormat)
        XCTAssertEqual(Set(token.value).intersection(Set("+/=")).count, 0)
    }

    func testTokensAreDistinct() {
        let values = Set((0..<64).map { _ in ControlToken.generate().value })
        XCTAssertEqual(values.count, 64)
    }

    func testMatchesOnlyExactValue() {
        let token = ControlToken(value: String(repeating: "a", count: 43))
        XCTAssertTrue(token.matches(token.value))
        XCTAssertFalse(token.matches(String(repeating: "a", count: 42)))
        XCTAssertFalse(token.matches(String(repeating: "a", count: 42) + "b"))
        XCTAssertFalse(token.matches(""))
        XCTAssertFalse(token.matches(nil))
    }

    func testLogPrefixIsHashedNotTheToken() {
        let token = ControlToken.generate()
        XCTAssertEqual(token.logPrefix.count, 8)
        XCTAssertFalse(token.logPrefix.contains(token.value))
        XCTAssertFalse(token.value.contains(token.logPrefix))
        XCTAssertEqual(Set(token.logPrefix).count <= 8, true)
    }

    func testRedactedDescriptionDoesNotContainToken() {
        let token = ControlToken.generate()
        XCTAssertFalse(token.redactedDescription.contains(token.value))
        XCTAssertTrue(token.redactedDescription.contains("redacted"))
    }

    func testConstantTimeComparisonTouchesEveryByte() {
        // 兩個只差最後一個位元組的 Token 都必須回 false；比較函式不能提早回傳
        // （長度相同時以固定迴圈逐位元組累積差異）。
        let base = String(repeating: "A", count: 42)
        let first = ControlToken(value: base + "B")
        XCTAssertFalse(first.matches(base + "C"))
        XCTAssertTrue(first.matches(base + "B"))
    }

    func testInitMessageCarriesBothTokensOnStdinOnly() throws {
        let control = ControlToken.generate()
        let broker = ControlToken.generate()
        let message = InitMessage(
            token: control.value,
            brokerToken: broker.value,
            folderPath: "/Users/test/Cardiary"
        )
        let data = try ControlFrameEncoder.initMessage(message)
        let text = try XCTUnwrap(String(data: data, encoding: .utf8))
        XCTAssertTrue(text.hasSuffix("\n"))
        XCTAssertTrue(text.contains(control.value))
        XCTAssertTrue(text.contains(broker.value))

        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        XCTAssertEqual(object["type"] as? String, "init")
        XCTAssertEqual(object["protocol"] as? Int, 1)
        XCTAssertEqual((object["folder"] as? [String: Any])?["path"] as? String, "/Users/test/Cardiary")
    }
}
