import CardiaryKit
import XCTest

@testable import CardiaryApp

/// 產品接線：`stream.ui.data` 的 Html 內容_parser。這是對話畫面決定要不要
/// 建立 McpAppWebView 的入口，也是「不凭空造資料格式」的證明：
/// 只認約定好的 renderer 與欄位，其他一律退回原本的原生呈現。
final class McpAppBlockContentTests: XCTestCase {
    func testParserAcceptsMcpAppRendererWithHtml() {
        let data: JSONValue = .object([
            "html": .string("<!doctype html><html><body>hi</body></html>"),
            "allowedHosts": .array([.string("api.example.com")]),
        ])

        let parsed = McpAppBlockContent.parse(renderer: "mcp.app", data: data)

        XCTAssertEqual(parsed?.html, "<!doctype html><html><body>hi</body></html>")
        XCTAssertEqual(parsed?.allowedHosts, ["api.example.com"])
    }

    func testParserRejectsOtherRenderers() {
        let data: JSONValue = .object(["html": .string("<b>hi</b>")])

        XCTAssertNil(McpAppBlockContent.parse(renderer: "bar", data: data))
        XCTAssertNil(McpAppBlockContent.parse(renderer: "module.cards.card", data: data))
    }

    func testParserRejectsMissingOrEmptyHtml() {
        XCTAssertNil(McpAppBlockContent.parse(
            renderer: "mcp.app",
            data: .object(["allowedHosts": .array([])])
        ))
        XCTAssertNil(McpAppBlockContent.parse(
            renderer: "mcp.app",
            data: .object(["html": .string("")])
        ))
        XCTAssertNil(McpAppBlockContent.parse(renderer: "mcp.app", data: .string("<b>x</b>")))
    }

    func testParserIgnoresMalformedAllowedHosts() {
        let data: JSONValue = .object([
            "html": .string("<b>x</b>"),
            "allowedHosts": .array([.string("ok.example.com"), .number(7), .string("")]),
        ])

        XCTAssertEqual(McpAppBlockContent.parse(renderer: "mcp.app", data: data)?.allowedHosts, ["ok.example.com"])
    }

    func testParserAllowsAbsentAllowedHosts() {
        let data: JSONValue = .object(["html": .string("<b>x</b>")])

        XCTAssertEqual(McpAppBlockContent.parse(renderer: "mcp.app", data: data)?.allowedHosts, [])
    }
}
