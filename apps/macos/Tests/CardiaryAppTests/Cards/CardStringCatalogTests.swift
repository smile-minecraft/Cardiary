import Foundation
import XCTest

@testable import CardiaryApp

/// 卡片介面的三個字串表：每個 key 都要有繁體中文與英文，而且編譯進程式的內容
/// 與 `.xcstrings` 一致。
final class CardStringCatalogTests: XCTestCase {
    func testEveryKeyHasBothLanguages() {
        for catalog in CardStringCatalog.allCases {
            let keys = CardL10n.catalogKeys(catalog)
            XCTAssertFalse(keys.isEmpty, "\(catalog.rawValue) 沒有 key")
            for key in keys {
                for language in AppLanguage.allCases {
                    let text = CardL10n.table(catalog, language: language)[key]
                    XCTAssertNotNil(text, "\(catalog.rawValue)/\(key) 缺 \(language.rawValue)")
                    XCTAssertFalse(text?.isEmpty ?? true, "\(catalog.rawValue)/\(key) 是空字串")
                }
            }
        }
    }

    func testCatalogsMatchSources() throws {
        try assertCatalogMatches(catalog: .cards, fileName: "Cards")
        try assertCatalogMatches(catalog: .inspector, fileName: "Inspector")
        try assertCatalogMatches(catalog: .archive, fileName: "Archive")
    }

    func testLookupAndPlaceholders() {
        XCTAssertEqual(CardL10n.text(.cardsTitle, language: .zhHant), "卡片庫")
        XCTAssertEqual(CardL10n.text(.cardsTitle, language: .en), "Cards")
        XCTAssertEqual(
            CardL10n.format(.inspectorUsage, ["used": "520", "budget": "1000"], language: .zhHant),
            "520 / 1000 token"
        )
        XCTAssertEqual(
            CardL10n.count(.archiveRemainingDays, count: 3, language: .en),
            "3 days left"
        )
    }

    func testPanelKeysUseExistingInspectorTitle() {
        // 檢視欄的標題沿用主視窗的 AppString；卡片介面只補內容。
        XCTAssertEqual(AppL10n.text(.inspectorTitle, language: .zhHant), "檢視欄")
    }

    // MARK: - `.xcstrings` 比對

    private func assertCatalogMatches(
        catalog: CardStringCatalog,
        fileName: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) throws {
        let source = try loadCatalog(fileName, file: file, line: line)
        let keys = CardL10n.catalogKeys(catalog)
        XCTAssertEqual(
            Set(source.keys).subtracting(keys),
            [],
            "\(fileName).xcstrings 有程式沒用到的 key",
            file: file,
            line: line
        )
        for key in keys {
            let languages = try XCTUnwrap(source[key], "\(fileName).xcstrings 缺少 \(key)", file: file, line: line)
            for language in AppLanguage.allCases {
                let expected = try XCTUnwrap(
                    languages[language.rawValue],
                    "\(fileName).xcstrings 的 \(key) 缺 \(language.rawValue)",
                    file: file,
                    line: line
                )
                XCTAssertEqual(
                    CardL10n.table(catalog, language: language)[key],
                    expected,
                    "\(key) 在 \(fileName).xcstrings 與編譯進程式的字串表不一致",
                    file: file,
                    line: line
                )
            }
        }
    }

    private func loadCatalog(
        _ name: String,
        file: StaticString,
        line: UInt
    ) throws -> [String: [String: String]] {
        let source = URL(fileURLWithPath: "\(file)")
            .deletingLastPathComponent()  // Cards
            .deletingLastPathComponent()  // CardiaryAppTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // macos
            .appendingPathComponent("Sources/CardiaryApp/Resources/\(name).xcstrings")
        let data = try Data(contentsOf: source)
        let document = try JSONDecoder().decode(CatalogDocument.self, from: data)
        var result: [String: [String: String]] = [:]
        for (key, entry) in document.strings {
            var languages: [String: String] = [:]
            for (code, localization) in entry.localizations ?? [:] {
                if let value = localization.stringUnit?.value { languages[code] = value }
            }
            result[key] = languages
        }
        return result
    }
}

private struct CatalogDocument: Decodable {
    struct Entry: Decodable {
        struct Localization: Decodable {
            struct StringUnit: Decodable {
                let value: String
            }

            let stringUnit: StringUnit?
        }

        let localizations: [String: Localization]?
    }

    let strings: [String: Entry]
}
