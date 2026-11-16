import Foundation
import XCTest

@testable import CardiaryApp

@MainActor
final class BoardStringCatalogTests: XCTestCase {
    func testEveryKeyHasBothLanguages() {
        let keys = BoardL10n.allKeys
        XCTAssertFalse(keys.isEmpty)
        for key in keys {
            for language in AppLanguage.allCases {
                let text = BoardL10n.table(language)[key]
                XCTAssertNotNil(text, "\(key) 缺 \(language.rawValue)")
                XCTAssertFalse(text?.isEmpty ?? true, "\(key) 是空字串")
            }
        }
    }

    func testCatalogMatchesSource() throws {
        let source = try loadCatalog()
        let keys = Set(BoardL10n.allKeys)
        XCTAssertEqual(Set(source.keys).subtracting(keys), [], "Boards.xcstrings 有程式沒用到的 key")
        for key in keys {
            let languages = try XCTUnwrap(source[key], "Boards.xcstrings 缺少 \(key)")
            for language in AppLanguage.allCases {
                let expected = try XCTUnwrap(languages[language.rawValue])
                XCTAssertEqual(BoardL10n.table(language)[key], expected, "\(key)/\(language.rawValue) 不一致")
            }
        }
    }

    func testLookupAndPlaceholders() {
        XCTAssertEqual(BoardL10n.text(.boardsTitle, language: .zhHant), "白板")
        XCTAssertEqual(BoardL10n.text(.boardsTitle, language: .en), "Boards")
        XCTAssertEqual(
            BoardL10n.count(.boardsSelection, count: 3, language: .en),
            "3 selected"
        )
        XCTAssertEqual(
            BoardL10n.format(.boardsLoadFailed, value: "離線", language: .zhHant),
            "無法載入白板：離線"
        )
    }

    private func loadCatalog() throws -> [String: [String: String]] {
        let source = URL(fileURLWithPath: "\(#filePath)")
            .deletingLastPathComponent()  // Boards
            .deletingLastPathComponent()  // CardiaryAppTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // macos
            .appendingPathComponent("Sources/CardiaryApp/Resources/Boards.xcstrings")
        let data = try Data(contentsOf: source)
        let root = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
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
