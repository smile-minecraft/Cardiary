import Foundation
import XCTest

@testable import CardiaryApp

@MainActor
final class McpStringCatalogTests: XCTestCase {
    func testEveryKeyHasBothLanguages() {
        let keys = McpL10n.allKeys
        XCTAssertFalse(keys.isEmpty)
        for key in keys {
            for language in AppLanguage.allCases {
                let text = McpL10n.table(language)[key]
                XCTAssertNotNil(text, "\(key) 缺 \(language.rawValue)")
                XCTAssertFalse(text?.isEmpty ?? true, "\(key) 是空字串")
            }
        }
    }

    func testCatalogMatchesSource() throws {
        let source = try loadCatalog()
        let keys = Set(McpL10n.allKeys)
        XCTAssertEqual(Set(source.keys).subtracting(keys), [], "Mcp.xcstrings 有程式沒用到的 key")
        for key in keys {
            let languages = try XCTUnwrap(source[key], "Mcp.xcstrings 缺少 \(key)")
            for language in AppLanguage.allCases {
                let expected = try XCTUnwrap(languages[language.rawValue])
                XCTAssertEqual(McpL10n.table(language)[key], expected, "\(key)/\(language.rawValue) 不一致")
            }
        }
    }

    func testLookupAndPlaceholders() {
        XCTAssertEqual(McpL10n.text(.mcpServersTitle, language: .zhHant), "MCP 伺服器")
        XCTAssertEqual(McpL10n.text(.mcpServersTitle, language: .en), "MCP Servers")
        XCTAssertEqual(
            McpL10n.format(.mcpRemoveConfirmTitle, name: "Filesystem", language: .zhHant),
            "移除「Filesystem」？"
        )
        XCTAssertEqual(
            McpL10n.format(.mcpRequestFailed, value: "離線", language: .en),
            "MCP request failed: 離線"
        )
    }

    private func loadCatalog() throws -> [String: [String: String]] {
        let source = URL(fileURLWithPath: "\(#filePath)")
            .deletingLastPathComponent()  // Settings
            .deletingLastPathComponent()  // CardiaryAppTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // macos
            .appendingPathComponent("Sources/CardiaryApp/Resources/Mcp.xcstrings")
        let data = try Data(contentsOf: source)
        let root = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(root["sourceLanguage"] as? String, "en")
        let strings = try XCTUnwrap(root["strings"] as? [String: Any])
        var result: [String: [String: String]] = [:]
        for (key, value) in strings {
            let entry = try XCTUnwrap(value as? [String: Any])
            let localizations = try XCTUnwrap(entry["localizations"] as? [String: Any])
            var languages: [String: String] = [:]
            for (language, localized) in localizations {
                let object = try XCTUnwrap(localized as? [String: Any])
                let unit = try XCTUnwrap(object["stringUnit"] as? [String: Any])
                languages[language] = try XCTUnwrap(unit["value"] as? String)
            }
            result[key] = languages
        }
        return result
    }
}
